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
// the top-level `target`, and steps over everything else. Neither validates the
// other's keys, because the two ship as separate artifacts and version skew
// between them is the normal state — a checker that policed the server's keys
// would turn a contributor's CI red for a key that is not its business.
//
// `[planning]` is the one table both own. Each reader validates all of it, and
// one fixture (testdata/planning-config.json) holds the two to the same answer
// for every value, so a value one of them would refuse is refused by both. They
// part over a key one of them does not know: the checker ignores it with a
// warning, since it may be a newer release's, and this package refuses the
// whole file. testdata/version-skew-config.json pins each reader's answer.
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
	"maps"
	"os"
	"path/filepath"
	"strings"
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

	// Theme is the color theme the repository offers its readers, by id.
	//
	// An offer and never an override: a choice made in the browser and the
	// reader's own `theme` key both beat it, so a project may suggest the palette
	// its diagrams were drawn for without taking the decision away from whoever
	// is reading. Top-level and spelled exactly as in the reader's own
	// `config.toml`, so one word means one thing in both files.
	Theme string `toml:"theme"`

	// Planning is the `[planning]` table: which files the planning index reads,
	// and the limits past which it reads fewer or none. Reference:
	// docs/reference/planning-index.md §14.
	//
	// It is the one table both readers of this file parse in full. The server
	// uses the roadmaps, include, exclude and the two limits, to decide what the
	// planning endpoint serves — the roadmaps because a listed one is served
	// whatever include and exclude say, and every roadmap is always sent whole —
	// and hands the stages to the viewer untouched; the checker uses all of it.
	// Each validates every key, so a table one of them would refuse is refused
	// by both.
	Planning PlanningSettings `toml:"planning"`
}

// StarredSettings is the `[starred]` table.
type StarredSettings struct {
	// Promote is a list of repo-relative paths and gitignore-syntax patterns.
	// Order is the author's and is preserved, so a config can lead with the
	// document it most wants read first.
	Promote []string `toml:"promote"`
}

// PlanningSettings is the `[planning]` table as written.
//
// Every field is a pointer, or a map that may be nil, so a key that is absent
// stays distinct from one set to its zero value: `include = []` is an author
// asking for no candidates at all, which is not the same thing as leaving
// `include` to its default. [PlanningSettings.Resolved] is where the defaults are
// applied.
type PlanningSettings struct {
	// Roadmap is `roadmap` as written: the repo-relative paths of the roadmaps,
	// the files whose links set an order on the planning page, as one path or a
	// list of them. Nil when the key is absent, which makes every candidate
	// named [RoadmapFileName] a roadmap instead. Reference:
	// docs/reference/planning-index.md §4.1.
	Roadmap *RoadmapSetting `toml:"roadmap"`
	// Include and Exclude are gitignore-syntax lines, matched the way
	// `[starred] promote` matches its patterns. A candidate is a listed Markdown
	// file matched by Include and not by Exclude.
	Include *[]string `toml:"include"`
	Exclude *[]string `toml:"exclude"`
	// MaxFileBytes skips any candidate larger than it; MaxCandidates refuses the
	// whole scan past it. Both are at least 1.
	MaxFileBytes  *int64 `toml:"max-file-bytes"`
	MaxCandidates *int   `toml:"max-candidates"`
	// Stages maps a repository's stage words to one of the four [StageRoles].
	// Nil or empty means no vocabulary is declared.
	Stages map[string]string `toml:"stages"`
}

// IsZero reports whether the table resolves to the defaults because it said
// nothing at all. An empty `[planning.stages]` table says nothing, because it
// means the same as no table.
func (p PlanningSettings) IsZero() bool {
	return p.Roadmap == nil && p.Include == nil && p.Exclude == nil &&
		p.MaxFileBytes == nil && p.MaxCandidates == nil && len(p.Stages) == 0
}

// RoadmapSetting is `roadmap` as written: a TOML string, which is a list of
// one, or an array of strings. Paths holds them as written, "./" and all, and
// is non-nil once decoded, so `roadmap = []` stays a list that names nothing.
//
// It decodes through [toml.Unmarshaler], so any other shape is refused at
// decode time: a number, a boolean, a date, an inline table, an array of
// tables (`[[planning.roadmap]]`), and an array holding anything but strings.
// The unmarshaler is handed the parsed value, and BurntSushi/toml takes TOML
// 1.0's mixed arrays, so `["roadmap.md", 3]` arrives as a `[]any` holding a
// number without complaint: every element's type is checked here, as
// [PlanningSettings.validate] checks `stages`' own type for the same library's
// leniency. The path rules are validate's.
type RoadmapSetting struct{ Paths []string }

// UnmarshalTOML takes the value the decoder parsed for `roadmap`.
func (r *RoadmapSetting) UnmarshalTOML(value any) error {
	switch v := value.(type) {
	case string:
		r.Paths = []string{v}
		return nil
	case []any:
		paths := make([]string, 0, len(v))
		for i, entry := range v {
			text, ok := entry.(string)
			if !ok {
				return fmt.Errorf("planning.roadmap entry %d is %s, not text", i+1, describeTOML(entry))
			}
			paths = append(paths, text)
		}
		r.Paths = paths
		return nil
	default:
		return fmt.Errorf("planning.roadmap must be a path or a list of paths, not %s", describeTOML(value))
	}
}

// describeTOML names a value the TOML decoder parsed, with the value itself
// where it is short enough to quote, for an error message: `the number 3`,
// `the list ["roadmap.md"]`, `a table`.
func describeTOML(v any) string {
	switch v := v.(type) {
	case string:
		return fmt.Sprintf("the text %q", v)
	case bool:
		return fmt.Sprintf("the boolean %t", v)
	case int64:
		return fmt.Sprintf("the number %d", v)
	case float64:
		return fmt.Sprintf("the fractional number %v", v)
	case []any:
		return "the list " + tomlList(v)
	case map[string]any:
		return "a table"
	case []map[string]any:
		return "an array of tables"
	default:
		return "a date or time"
	}
}

// tomlList spells a parsed list roughly as TOML writes one.
func tomlList(list []any) string {
	parts := make([]string, 0, len(list))
	for _, e := range list {
		switch e := e.(type) {
		case string:
			parts = append(parts, fmt.Sprintf("%q", e))
		case []any:
			parts = append(parts, tomlList(e))
		case map[string]any:
			parts = append(parts, "{…}")
		default:
			parts = append(parts, fmt.Sprint(e))
		}
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// The `[planning]` defaults (§14). A repository that never wrote the table
// still gets an index: everything Markdown is included, nothing is excluded,
// and every candidate named [RoadmapFileName] is a roadmap.
const (
	DefaultMaxFileBytes  = int64(1 << 20) // 1 MiB
	DefaultMaxCandidates = 5000
)

// RoadmapFileName is the file name that makes a candidate a roadmap when
// `roadmap` is absent, compared ASCII case-insensitively with a path's last
// segment ([Planning.IsRoadmap]).
const RoadmapFileName = "roadmap.md"

// StageRoles is the closed set of stage roles, in the order the reference lists
// them. A role is what a stage word means to the planning page; a repository
// maps its own words onto these, and a role outside them rejects the file.
var StageRoles = []string{"open", "ready", "built", "done"}

// Planning is a resolved `[planning]` table: every key present, defaults
// applied. It is also the "config" object of the planning endpoint, which is why
// it carries JSON tags — the viewer reads its own copy of the rules from there
// rather than parsing the file a second time.
type Planning struct {
	// Roadmaps is nil when roadmaps are found by name, and marshals as null;
	// otherwise it is the listed paths, "./" dropped, in the order written,
	// non-nil and possibly empty, marshaling as a list. [PlanningSettings.Resolved]
	// never turns [] into nil, since the two mean opposite things.
	Roadmaps      []string `json:"roadmaps"`
	Include       []string `json:"include"`
	Exclude       []string `json:"exclude"`
	MaxFileBytes  int64    `json:"max_file_bytes"`
	MaxCandidates int      `json:"max_candidates"`
	// Stages is null on the wire when no vocabulary is declared, so "no stages"
	// has one spelling however the file expressed it.
	Stages map[string]string `json:"stages"`
}

// DefaultPlanning is the effective table of a repository that wrote none, and
// of one whose file was refused. Every call returns fresh slices, so a caller
// cannot edit another's defaults.
func DefaultPlanning() Planning {
	return Planning{
		Include:       []string{"**/*.md"},
		Exclude:       []string{},
		MaxFileBytes:  DefaultMaxFileBytes,
		MaxCandidates: DefaultMaxCandidates,
	}
}

// Resolved applies the defaults to whatever the table left out.
//
// It assumes the table passed [Parse]'s validation; it does not validate again.
// The lists are copied and never nil, because they are marshaled straight onto
// the wire, where the API's contract is `[]` and never `null` — except
// Roadmaps, which is null exactly when `roadmap` is absent.
func (p PlanningSettings) Resolved() Planning {
	out := DefaultPlanning()
	if p.Roadmap != nil {
		out.Roadmaps = make([]string, 0, len(p.Roadmap.Paths))
		for _, raw := range p.Roadmap.Paths {
			out.Roadmaps = append(out.Roadmaps, strings.TrimPrefix(raw, "./"))
		}
	}
	if p.Include != nil {
		out.Include = append([]string{}, (*p.Include)...)
	}
	if p.Exclude != nil {
		out.Exclude = append([]string{}, (*p.Exclude)...)
	}
	if p.MaxFileBytes != nil {
		out.MaxFileBytes = *p.MaxFileBytes
	}
	if p.MaxCandidates != nil {
		out.MaxCandidates = *p.MaxCandidates
	}
	if len(p.Stages) > 0 {
		out.Stages = maps.Clone(p.Stages)
	}
	return out
}

// validate holds the table to the rules the TOML decoder cannot express. The
// rules are pinned, for both readers, by testdata/planning-config.json.
func (p PlanningSettings) validate(meta toml.MetaData) error {
	// BurntSushi/toml decodes a TOML array into a Go map without complaint and
	// leaves the map empty, so `stages = ["DESIGN"]` would read as "no stages"
	// rather than as the mistake it is. The value's own type has to be asked.
	if t := meta.Type("planning", "stages"); t != "" && t != "Hash" {
		return fmt.Errorf("%s: planning.stages must be a table of stage = role, not %s",
			FileName, strings.ToLower(t))
	}
	for word, role := range p.Stages {
		if !isStageRole(role) {
			return fmt.Errorf("%s: planning.stages: %q maps to %q, which is not one of %s",
				FileName, word, role, strings.Join(StageRoles, ", "))
		}
	}

	if p.MaxFileBytes != nil && *p.MaxFileBytes < 1 {
		return fmt.Errorf("%s: planning.max-file-bytes must be at least 1", FileName)
	}
	if p.MaxCandidates != nil && *p.MaxCandidates < 1 {
		return fmt.Errorf("%s: planning.max-candidates must be at least 1", FileName)
	}

	if p.Roadmap != nil {
		seen := make(map[string]int, len(p.Roadmap.Paths))
		for i, raw := range p.Roadmap.Paths {
			if err := validRoadmap(raw); err != nil {
				return fmt.Errorf("%s: planning.roadmap entry %d, %q: %w", FileName, i+1, raw, err)
			}
			path := strings.TrimPrefix(raw, "./")
			if first, ok := seen[path]; ok {
				return fmt.Errorf("%s: planning.roadmap entry %d, %q: names %q again, as entry %d did",
					FileName, i+1, raw, path, first)
			}
			seen[path] = i + 1
		}
	}
	return nil
}

// IsRoadmap is the roadmap test: rel is one of Roadmaps, compared exactly, or,
// with Roadmaps nil, its last "/"-separated segment is [RoadmapFileName]
// compared ASCII case-insensitively. rel is repo-relative and slash-separated,
// as the listing spells it. Reference: docs/reference/planning-index.md §4.1.
//
// It does not ask whether rel is a candidate. A listed roadmap is one whatever
// include and exclude say, and a roadmap found by name is one only if it is a
// candidate already; the matcher in internal/planning applies both halves.
// vantage-md's isRoadmapPath is the same test, and
// testdata/planning-roadmaps.json holds the two to one answer.
func (p Planning) IsRoadmap(rel string) bool {
	if p.Roadmaps != nil {
		for _, r := range p.Roadmaps {
			if r == rel {
				return true
			}
		}
		return false
	}
	return hasRoadmapName(rel[strings.LastIndexByte(rel, '/')+1:])
}

// hasRoadmapName reports whether name is [RoadmapFileName] in any ASCII case.
// Not [strings.EqualFold], which folds by Unicode's rules: the checker's port
// compares in ASCII, and the two must agree on every name.
func hasRoadmapName(name string) bool {
	if len(name) != len(RoadmapFileName) {
		return false
	}
	for i := range len(name) {
		c := name[i]
		if 'A' <= c && c <= 'Z' {
			c += 'a' - 'A'
		}
		if c != RoadmapFileName[i] {
			return false
		}
	}
	return true
}

// validRoadmap reports why one roadmap path cannot name a file in the
// repository.
//
// The rule is lexical and deliberately small: one leading "./" is dropped, and
// what is left must be non-empty, must not start with "/", and must hold no ".."
// segment — not even one that climbs back in, since `docs/../roadmap.md` would be
// a second spelling of a path the index identifies by its exact text.
func validRoadmap(raw string) error {
	p := strings.TrimPrefix(raw, "./")
	switch {
	case p == "":
		return errors.New("must name a file")
	case strings.HasPrefix(p, "/"):
		return errors.New("must be relative to the repository root")
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return errors.New("must not leave the repository")
		}
	}
	return nil
}

func isStageRole(role string) bool {
	for _, r := range StageRoles {
		if r == role {
			return true
		}
	}
	return false
}

// IsZero reports whether the file said nothing the server acts on. A repository
// with only a `[check]` table is indistinguishable from one with no file at all,
// which is the point.
func (s Settings) IsZero() bool {
	return len(s.Starred.Promote) == 0 && s.Theme == "" && s.Planning.IsZero()
}

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
	if err := s.Planning.validate(meta); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// ours reports whether a top-level table is one this package claims, and is
// therefore one whose keys it will police. `[planning]` is claimed although the
// checker claims it too: it is shared, not someone else's.
//
// Only tables need claiming. The server's one top-level scalar, `theme`, is
// decoded, so it never reaches the undecoded list; a guess at the wrong shape
// (`[theme]`, or `theme.name = "…"`) is refused by the decoder's own type check
// before this loop runs, which is the same whole-or-nothing outcome by another
// route.
//
// The other top-level scalar, `target`, is the checker's: the oldest Vantage
// release the repository's readers use, which a checker older than it refuses
// to run under (docs/design/checker-version-skew.md §4). The server reserves
// nothing for it and reads nothing from it, so it steps over the key, in any
// form, as it does over any top-level name it does not claim. A `target`
// written below `[starred]` or `[planning]` lands inside that table and is
// refused there like any unknown key, which testdata/version-skew-config.json
// pins for both readers.
func ours(table string) bool { return table == "starred" || table == "planning" }

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
	c.maybeReload(false)
	return c.settings, c.err
}

// SettingsNow is [Config.Settings] without the throttle: it re-stats the file
// on every call, re-parsing only when the file looks different.
//
// For a caller that is answering a change to this very file. The watcher pushes
// an edit to `.vantage.toml`, and the viewer's planning index rescans within
// about a quarter of a second — usually inside the window that the `/starred`
// read the same push caused has just opened. Through [Config.Settings] that
// rescan would be served the config from before the edit, and nothing would ask
// again until the next push.
func (c *Config) SettingsNow() (Settings, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.maybeReload(true)
	return c.settings, c.err
}

// maybeReload re-stats at most once per [reloadInterval] unless force is set,
// re-parsing only when the file looks different. Caller must hold c.mu.
func (c *Config) maybeReload(force bool) {
	now := c.now()
	if !force && c.loaded && now.Sub(c.lastCheck) < reloadInterval {
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
