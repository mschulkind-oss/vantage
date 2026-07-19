// Package ignore layers gitignore-style ignore files for a single repo.
//
// Two optional files are honored, applied like gitignore (workspace rules
// layer on top of user rules, last match wins, "!pattern" un-ignores):
//
//   - the user ignore file (default ~/.config/vantage/ignore), shared by
//     every repo vantage serves; and
//   - <root>/.vantageignore, checked into the workspace.
//
// Ignored paths are hidden from recent-file search, directory listings, and
// file-watcher broadcasts. The whole subsystem is disabled by passing
// enabled=false (mirroring use_ignore_files=false in config): a disabled
// [Matcher] reports nothing as ignored except the built-in always-ignored
// set (see [IsAlwaysIgnored]), which no configuration can surface.
//
// Matchers are reloaded lazily: each [Matcher.IsIgnored] call may re-stat the
// source files, but stat-throttled to at most once per [reloadInterval] so hot
// paths stay cheap. Use [GetMatcher] for a process-wide cache keyed by
// (root, enabled); construct a [Matcher] directly when you want to own its
// lifetime (e.g. tests).
package ignore

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	gitignore "github.com/sabhiram/go-gitignore"
)

// workspaceIgnoreName is the per-repo ignore file, resolved against the root.
const workspaceIgnoreName = ".vantageignore"

// vantageDirName is vantage's own per-repo state directory (<root>/.vantage,
// holding the review delivery inbox). Its contents are machine-to-machine
// traffic, never user content, so it is unconditionally hidden.
const vantageDirName = ".vantage"

// IsAlwaysIgnored reports whether rel (repo-relative, slash-or-OS-separated)
// falls in the built-in always-ignored set: paths hidden even when ignore
// files are disabled and that no negation pattern can resurface. Currently
// that is .vantage and everything under it.
func IsAlwaysIgnored(rel string) bool {
	rel = normalizeRel(rel)
	return rel == vantageDirName || strings.HasPrefix(rel, vantageDirName+"/")
}

// reloadInterval caps how often a [Matcher] re-stats its source files. The
// files are re-parsed only when their mtime actually changes, but this bound
// keeps the stat cost off hot paths (every IsIgnored call would otherwise
// stat two files).
const reloadInterval = 2 * time.Second

// DefaultUserIgnorePath returns the user-level ignore file path
// (<config>/vantage/ignore, XDG-aware via [os.UserConfigDir]). It returns ""
// when the user config directory cannot be determined, in which case the user
// layer is simply absent.
func DefaultUserIgnorePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "vantage", "ignore")
}

// loadedSpec is one parsed ignore source plus the mtime it was parsed from, so
// reloads can be skipped when nothing changed. A nil *loadedSpec means the
// source file is currently absent.
type loadedSpec struct {
	mtime    time.Time
	compiled *compiledLines
}

// Matcher is a layered gitignore matcher for one repo root. It combines the
// user and workspace ignore files and reloads them when they change on disk.
// All methods are safe for concurrent use.
type Matcher struct {
	root          string // absolute repo root
	userPath      string // user ignore file path ("" ⇒ no user layer)
	workspacePath string // <root>/.vantageignore
	enabled       bool

	mu        sync.Mutex
	user      *loadedSpec
	workspace *loadedSpec
	combined  *gitignore.GitIgnore // user lines then workspace lines
	lastCheck time.Time
}

// NewMatcher builds a [Matcher] for root. When enabled is false the matcher
// ignores nothing beyond the built-in always-ignored set. The
// userIgnorePath names the user-level ignore file; pass "" to disable the user
// layer (e.g. tests) or [DefaultUserIgnorePath] for the standard location.
//
// root is cleaned but not required to exist; missing ignore files are treated
// as empty.
func NewMatcher(root string, enabled bool, userIgnorePath string) *Matcher {
	root = filepath.Clean(root)
	m := &Matcher{
		root:          root,
		userPath:      userIgnorePath,
		workspacePath: filepath.Join(root, workspaceIgnoreName),
		enabled:       enabled,
	}
	if enabled {
		m.mu.Lock()
		m.loadAll(true)
		m.mu.Unlock()
	}
	return m
}

// IsIgnored reports whether rel (a repo-relative, slash-or-OS-separated path)
// is ignored. Set isDir when rel names a directory so directory-only patterns
// such as ".yolo/" match it. A disabled matcher returns false for everything
// but the built-in always-ignored set.
func (m *Matcher) IsIgnored(rel string, isDir bool) bool {
	if IsAlwaysIgnored(rel) {
		return true
	}
	if !m.enabled {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.maybeReload()
	return matchPath(m.combined, rel, isDir)
}

// Explain returns a "source:pattern" diagnostic (e.g. "workspace:.yolo/") for
// the pattern that causes rel to be ignored, or "" when rel is not ignored or
// the matcher is disabled. It applies the same last-match-wins semantics as
// IsIgnored, so a negation that re-includes rel yields "".
//
// Explain is meant for debug logging, not hot paths: it re-evaluates the
// layered patterns to recover which source matched.
func (m *Matcher) Explain(rel string) string {
	return m.explain(rel, false)
}

// ExplainDir is [Matcher.Explain] for a directory entry (see IsIgnored's isDir).
func (m *Matcher) ExplainDir(rel string) string {
	return m.explain(rel, true)
}

func (m *Matcher) explain(rel string, isDir bool) string {
	if IsAlwaysIgnored(rel) {
		return "builtin:" + vantageDirName
	}
	if !m.enabled {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.maybeReload()

	// Last match wins across both sources, with negation clearing a prior
	// positive match — the same algorithm gitignore.MatchesPathHow runs
	// within a single source, extended across the two layers.
	var match string
	for _, layer := range []struct {
		source   string
		compiled *compiledLines
	}{
		{"user", specLines(m.user)},
		{"workspace", specLines(m.workspace)},
	} {
		if layer.compiled == nil {
			continue
		}
		for _, pat := range layer.compiled.patterns {
			if !matchPattern(pat.matcher, rel, isDir) {
				continue
			}
			if pat.negate {
				match = ""
			} else {
				match = layer.source + ":" + pat.text
			}
		}
	}
	return match
}

// maybeReload re-stats the source files at most once per reloadInterval,
// re-parsing only those whose mtime changed. Caller must hold m.mu.
func (m *Matcher) maybeReload() {
	now := time.Now()
	if now.Sub(m.lastCheck) < reloadInterval {
		return
	}
	m.lastCheck = now
	m.loadAll(false)
}

// loadAll reloads both sources and rebuilds the combined matcher if either
// changed (or force is set). Caller must hold m.mu.
func (m *Matcher) loadAll(force bool) {
	userChanged := m.reloadOne(m.userPath, &m.user, force)
	wsChanged := m.reloadOne(m.workspacePath, &m.workspace, force)
	if !force && !userChanged && !wsChanged {
		return
	}
	// User rules first, workspace rules last: gitignore's last-match-wins
	// lets the workspace file override the user file.
	var lines []string
	if c := specLines(m.user); c != nil {
		lines = append(lines, c.raw...)
	}
	if c := specLines(m.workspace); c != nil {
		lines = append(lines, c.raw...)
	}
	m.combined = gitignore.CompileIgnoreLines(lines...)
}

// reloadOne loads path into *dst, returning whether the slot changed. A
// missing or unreadable file clears the slot. Caller must hold m.mu.
func (m *Matcher) reloadOne(path string, dst **loadedSpec, force bool) bool {
	if path == "" {
		if *dst == nil {
			return false
		}
		*dst = nil
		return true
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		if *dst == nil {
			return false
		}
		*dst = nil
		slog.Debug("ignore: dropped source", "path", path)
		return true
	}
	mtime := info.ModTime()
	if !force && *dst != nil && (*dst).mtime.Equal(mtime) {
		return false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		slog.Debug("ignore: failed to read source", "path", path, "error", err)
		if *dst == nil {
			return false
		}
		*dst = nil
		return true
	}
	compiled := compileLines(strings.Split(string(data), "\n"))
	*dst = &loadedSpec{mtime: mtime, compiled: compiled}
	slog.Info("ignore: loaded source", "path", path, "lines", len(compiled.raw))
	return true
}

func specLines(s *loadedSpec) *compiledLines {
	if s == nil {
		return nil
	}
	return s.compiled
}

// matchPath reports whether rel matches gi, appending "/" for directory
// entries so directory-only patterns (ending in "/") match.
func matchPath(gi *gitignore.GitIgnore, rel string, isDir bool) bool {
	if gi == nil {
		return false
	}
	rel = normalizeRel(rel)
	if gi.MatchesPath(rel) {
		return true
	}
	// A trailing-slash (directory-only) pattern only matches "path/", so for a
	// directory entry try that form too. We can't just always append "/"
	// because a negation like "!path" must still un-ignore the bare form.
	if isDir && !strings.HasSuffix(rel, "/") {
		return gi.MatchesPath(rel + "/")
	}
	return false
}

// matchPattern is matchPath for a single compiled pattern.
func matchPattern(gi *gitignore.GitIgnore, rel string, isDir bool) bool {
	rel = normalizeRel(rel)
	if gi.MatchesPath(rel) {
		return true
	}
	if isDir && !strings.HasSuffix(rel, "/") {
		return gi.MatchesPath(rel + "/")
	}
	return false
}

// normalizeRel converts OS separators to "/" and strips a leading "./" so
// patterns anchored at the repo root match consistently.
func normalizeRel(rel string) string {
	rel = filepath.ToSlash(rel)
	rel = strings.TrimPrefix(rel, "./")
	return rel
}

// compiledPattern is one non-comment ignore line, kept individually so Explain
// can attribute a match to its source line.
type compiledPattern struct {
	text    string               // the stripped line, sans leading "!"
	negate  bool                 // line began with "!"
	matcher *gitignore.GitIgnore // single-line matcher for attribution
}

// compiledLines holds the raw lines (for building the combined matcher) and
// the per-line patterns (for Explain).
type compiledLines struct {
	raw      []string
	patterns []compiledPattern
}

// compileLines parses raw ignore-file lines, dropping blanks and comments and
// recording each remaining pattern for attribution.
func compileLines(raw []string) *compiledLines {
	c := &compiledLines{raw: raw}
	for _, line := range raw {
		stripped := strings.TrimSpace(strings.TrimRight(line, "\r"))
		if stripped == "" || strings.HasPrefix(stripped, "#") {
			continue
		}
		negate := strings.HasPrefix(stripped, "!")
		pattern := stripped
		if negate {
			pattern = stripped[1:]
		}
		c.patterns = append(c.patterns, compiledPattern{
			text:    stripped,
			negate:  negate,
			matcher: gitignore.CompileIgnoreLines(pattern),
		})
	}
	return c
}

// matcherKey identifies a cached [Matcher] in [GetMatcher].
type matcherKey struct {
	root    string
	enabled bool
}

var (
	cacheMu       sync.Mutex
	matcherCache  = map[matcherKey]*Matcher{}
	defaultUserFn = DefaultUserIgnorePath
)

// GetMatcher returns a process-cached [Matcher] for root, keyed by
// (cleaned root, enabled). The user ignore file is resolved via
// [DefaultUserIgnorePath]. Callers that need a custom user-ignore path should
// construct a [Matcher] with [NewMatcher] instead of using the cache.
func GetMatcher(root string, enabled bool) *Matcher {
	key := matcherKey{root: filepath.Clean(root), enabled: enabled}
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if m, ok := matcherCache[key]; ok {
		return m
	}
	m := NewMatcher(key.root, enabled, defaultUserFn())
	matcherCache[key] = m
	return m
}

// ClearCache drops every cached [Matcher]. Call it after the ignore-files
// setting changes (or between tests) so stale matchers are not reused.
func ClearCache() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	matcherCache = map[matcherKey]*Matcher{}
}
