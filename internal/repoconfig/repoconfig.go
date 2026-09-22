// Package repoconfig reads a repository's own `.vantage.toml`.
//
// That file already has a reader: `vantage-check` has configured its rule
// severities there since it shipped. The server is its **second** reader, and the
// two share one file on purpose — a repository should have one place to configure
// Vantage, not one per binary. Design, including why this is a design change
// rather than a config key: `docs/design/repo-config.md`.
//
// The division is strict in both directions. This package reads the tables the
// server owns and steps over everything else; the checker reads `[check]` and
// steps over everything else. Neither validates the other's keys, because the two
// ship as separate artifacts and version skew between them is the normal state —
// a checker that policed the server's keys would turn a contributor's CI red for
// a key that is not its business.
//
// # The nesting trap
//
// The server's tables are top-level or they are a breaking change. The checker's
// parser is strict one level down: `[check.starred]` reaches its unknown-key
// branch and fails the run for every existing `.vantage.toml` user. That is
// pinned by a test in the checker's own suite.
//
// # Shape
//
// One [Config] per repository root, stat-throttled the way
// [ignore.Matcher] is — the same problem (a file under the served tree that the
// user edits while the server runs) answered the same way, at most one stat per
// [reloadInterval] and a re-parse only when the modification time moves.
//
// # Hostile input
//
// The file is attacker-controlled the moment somebody opens an untrusted
// repository, so the read is guarded rather than trusting `os.ReadFile`: see
// [readGuarded].
package repoconfig

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/BurntSushi/toml"
)

// FileName is the repository-level config file, shared with `vantage-check`.
const FileName = ".vantage.toml"

// reloadInterval caps how often a [Config] re-stats its file. Borrowed from
// [ignore.Matcher] deliberately: it is the same question about the same kind of
// file, and two different answers would be two different staleness windows for
// one directory.
const reloadInterval = 2 * time.Second

// maxSize caps the read. A repository can commit a multi-gigabyte file, and
// without this the daemon answers that with an out-of-memory kill rather than a
// warning. Two hundred kilobytes is far past any real config.
const maxSize = 200 * 1024

// Settings is what the server takes from the file. Everything else in it —
// `[check]`, another tool's table — is read past.
//
// Fields are the server's own tables only. Unknown keys *within* them are an
// error (see [Parse]); unknown tables outside them are not ours.
type Settings struct {
	// Starred promotes documents into the viewer's Starred section.
	Starred StarredSettings `toml:"starred"`

	// Theme is the colour theme the repository offers its readers, by id.
	//
	// An offer and never an override: a choice made in the browser and the
	// reader's own `theme` key both beat it, so a project may suggest the palette
	// its diagrams were drawn for without taking the decision away from whoever
	// is reading. Top-level and spelled exactly as in the reader's own
	// `config.toml`, so one word means one thing in both files.
	Theme string `toml:"theme"`
}

// StarredSettings is the `[starred]` table.
type StarredSettings struct {
	// Promote is a list of repo-relative paths and gitignore-syntax patterns.
	// Order is the author's and is preserved, so a config can lead with the
	// document it most wants read first.
	Promote []string `toml:"promote"`
}

// IsZero reports whether the file said nothing the server acts on. A repository
// with only a `[check]` table is indistinguishable from one with no file at all,
// which is the point.
func (s Settings) IsZero() bool { return len(s.Starred.Promote) == 0 && s.Theme == "" }

// Parse decodes the server's settings from TOML.
//
// Rejected **whole, never half**: a syntax error, a wrong type, or an unknown key
// inside one of the server's own tables yields an error and no settings. Half a
// config is worse than none, and it is the discipline the checker already holds
// for this file.
//
// Unknown keys are refused by inspecting the decoder's leftovers, which is the
// one thing [config.LoadDaemonFile] does not do — it discards the metadata, so a
// typo in the daemon config is silently dropped today. Copying that here would
// mean `promotes = [...]` doing nothing at all with no way to find out, and
// silence is the failure mode this whole file exists to avoid.
func Parse(data []byte) (Settings, error) {
	var s Settings
	meta, err := toml.Decode(string(data), &s)
	if err != nil {
		return Settings{}, fmt.Errorf("%s: %w", FileName, err)
	}

	for _, key := range meta.Undecoded() {
		// Only the server's own names are policed. A top-level table nobody here
		// claims belongs to the checker or to another tool.
		if len(key) == 0 || !ours(key[0]) {
			continue
		}
		return Settings{}, fmt.Errorf("%s: unknown key %q", FileName, key.String())
	}
	return s, nil
}

// ours reports whether a top-level table is one this package claims, and is
// therefore one whose keys it will police.
//
// Only tables need claiming. The server's one top-level scalar, `theme`, is
// decoded, so it never reaches the undecoded list; a guess at the wrong shape
// (`[theme]`, or `theme.name = "…"`) is refused by the decoder's own type check
// before this loop runs, which is the same whole-or-nothing outcome by another
// route.
func ours(table string) bool { return table == "starred" }

// Config is one repository's settings, reloaded lazily as the file changes.
//
// Safe for concurrent use.
type Config struct {
	path string

	mu        sync.Mutex
	settings  Settings
	err       error
	lastCheck time.Time
	lastMod   time.Time
	lastSize  int64
	loaded    bool
	now       func() time.Time
}

// New returns a Config for the repository rooted at root. The file is not read
// until [Config.Settings] is called.
func New(root string) *Config {
	return &Config{path: filepath.Join(root, FileName), now: time.Now}
}

// Path returns the file this Config reads.
func (c *Config) Path() string { return c.path }

// Settings returns the repository's settings, and the error that made them
// empty, if any.
//
// A missing file is not an error: it yields the zero value and a nil error,
// because having no config is the normal case rather than a problem. A file that
// cannot be trusted yields the zero value **and** an error, so the caller can say
// so once and serve the repository as if it had none. That is deliberately not
// fatal: in daemon mode, failing startup would let one contributor's typo take
// down every other repository on the machine.
func (c *Config) Settings() (Settings, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.maybeReload()
	return c.settings, c.err
}

// maybeReload re-stats at most once per [reloadInterval], re-parsing only when
// the file looks different. Caller must hold c.mu.
func (c *Config) maybeReload() {
	now := c.now()
	if c.loaded && now.Sub(c.lastCheck) < reloadInterval {
		return
	}
	c.lastCheck = now

	info, err := os.Lstat(c.path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		c.settings, c.err = Settings{}, nil
		c.lastMod, c.lastSize = time.Time{}, 0
		c.loaded = true
		return
	case err != nil:
		c.settings, c.err = Settings{}, fmt.Errorf("%s: %w", FileName, err)
		c.loaded = true
		return
	}

	// Size as well as mtime: a filesystem with coarse timestamps, or an editor
	// that writes twice within one tick, can leave the mtime unchanged.
	if c.loaded && info.ModTime().Equal(c.lastMod) && info.Size() == c.lastSize {
		return
	}
	c.lastMod, c.lastSize = info.ModTime(), info.Size()
	c.loaded = true

	data, err := readGuarded(c.path, info)
	if err != nil {
		c.settings, c.err = Settings{}, err
		return
	}
	c.settings, c.err = Parse(data)
}

// readGuarded reads the file, refusing what a config file cannot be.
//
// `os.ReadFile` would be wrong here in two ways, both of which a repository can
// arrange deliberately. It follows symlinks, so `<root>/.vantage.toml` pointing at
// `~/.ssh/config` would be read and its parse error echoed back with a fragment
// of the file in it. And it reads whatever length it finds, so a committed
// multi-gigabyte file is a daemon out-of-memory rather than a warning.
//
// `info` comes from the [os.Lstat] the caller already performed, so the type and
// size checks happen before anything is opened.
func readGuarded(path string, info os.FileInfo) ([]byte, error) {
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s: not a regular file", FileName)
	}
	if info.Size() > maxSize {
		return nil, fmt.Errorf("%s: larger than %d bytes", FileName, maxSize)
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", FileName, err)
	}
	defer func() { _ = f.Close() }()

	// Re-check through the handle: the Lstat above and this Open are two
	// syscalls, and what sat between them can have been replaced with a symlink
	// in between. `O_NOFOLLOW` would be the direct answer and is not portable,
	// so the check is repeated where it cannot be raced.
	fi, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", FileName, err)
	}
	if !fi.Mode().IsRegular() {
		return nil, fmt.Errorf("%s: not a regular file", FileName)
	}

	// One byte past the cap, so a file that grew between the stat and the read
	// is refused rather than silently truncated into a parse error.
	data, err := io.ReadAll(io.LimitReader(f, maxSize+1))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", FileName, err)
	}
	if len(data) > maxSize {
		return nil, fmt.Errorf("%s: larger than %d bytes", FileName, maxSize)
	}
	return data, nil
}

var (
	cacheMu sync.Mutex
	cache   = map[string]*Config{}
)

// Get returns a process-cached Config for root, keyed by the cleaned path.
//
// Cached because the throttle is per-Config: a fresh one per request would stat
// the file every time and the interval would buy nothing.
func Get(root string) *Config {
	key := filepath.Clean(root)
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if c, ok := cache[key]; ok {
		return c
	}
	c := New(key)
	cache[key] = c
	return c
}

// ClearCache drops every cached Config. Call it between tests, so one test's
// repository root cannot serve another's settings.
func ClearCache() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	cache = map[string]*Config{}
}
