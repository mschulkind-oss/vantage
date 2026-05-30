// Package git provides a GitService that shells out to the "git" binary to
// answer the backend's history, status, diff, and recent-files queries.
//
// It never uses an in-process git library: every operation runs the "git" CLI
// with an explicit argument slice (never a shell string), placing user-supplied
// paths after a literal "--" so they cannot be interpreted as flags. The exact
// argv for each operation is a contract — the output parsing depends on it.
//
// Errors degrade to empty results. A git invocation that fails (non-zero exit,
// timeout, missing repo) yields an empty slice, nil, "", or false rather than an
// error: the HTTP layer turns these into 200-with-[] or 404, never a 500.
//
// Two package-level TTL caches back the hottest calls — git status and recent
// files — and are flushed by the file watcher via ClearStatusCache and
// ClearRecentFilesCache when git state changes on disk.
package git

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/mschulkind-oss/vantage/internal/ignore"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/perf"
)

// emptyTreeSHA is git's well-known empty-tree object. Diffing a root commit
// (one with no parent) against it yields that commit's full contents as
// additions.
const emptyTreeSHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// shaRe validates a caller-supplied commit identifier before it reaches the git
// CLI. Accepting only 4–40 hex chars keeps arbitrary strings (flags, paths,
// refs) out of the argv.
var shaRe = regexp.MustCompile(`^[0-9a-fA-F]{4,40}$`)

// defaultExtensions is the file-extension filter applied to recent-files
// discovery when the caller does not specify one.
var defaultExtensions = []string{".md"}

// Per-operation timeouts mirror the contract argv table. Recents untracked
// discovery uses the configurable walk timeout instead.
const (
	timeoutDefault = 10 * time.Second
	timeoutStaged  = 5 * time.Second
)

// Options configures a GitService. The zero value is usable: it disables ignore
// files, applies no extra excludes, and uses a 30s walk timeout.
type Options struct {
	// ExcludeDirs names directories pruned from recent-files discovery. When
	// empty, no directory-name exclusions are applied beyond git's own.
	ExcludeDirs []string
	// WalkTimeout bounds the untracked-file discovery subprocess. Zero means
	// the 30s default.
	WalkTimeout time.Duration
	// WalkMaxDepth caps recent-files path depth (number of path separators);
	// nil means unlimited.
	WalkMaxDepth *int
	// UseIgnoreFiles layers the user and workspace .vantageignore files into
	// recent-files discovery (both as git --exclude-from and as a post-filter).
	UseIgnoreFiles bool
}

func (o Options) walkTimeout() time.Duration {
	if o.WalkTimeout <= 0 {
		return 30 * time.Second
	}
	return o.WalkTimeout
}

// GitService answers git queries for a single repository root. repoPath is the
// directory the service was constructed for; workingDir is the resolved git
// working tree that contains it (they differ when repoPath is a subdirectory of
// a larger repo). When repoPath is not inside any git repo, workingDir is empty
// and the service falls back to child-repo delegation.
type GitService struct {
	repoPath    string // absolute, cleaned
	workingDir  string // absolute git work tree, or "" when not a repo
	excludeDirs map[string]struct{}
	opts        Options
}

// NewService builds a GitService for repoPath. It resolves the enclosing git
// working tree once (via "git rev-parse --show-toplevel"); if repoPath is not
// inside a git repo the service still works in a degraded mode that delegates to
// immediate child repositories.
func NewService(repoPath string, opts Options) *GitService {
	abs, err := filepath.Abs(repoPath)
	if err != nil {
		abs = repoPath
	}
	abs = filepath.Clean(abs)
	// Canonicalize symlinks so repoPath matches what "git rev-parse
	// --show-toplevel" reports. Without this, a repo under a symlinked path
	// (notably macOS, where t.TempDir/$TMPDIR live under /var -> /private/var)
	// makes every file look like it is outside the work tree, so history,
	// status, and diffs all come back empty.
	if resolved, rerr := filepath.EvalSymlinks(abs); rerr == nil {
		abs = resolved
	}

	excl := make(map[string]struct{}, len(opts.ExcludeDirs))
	for _, d := range opts.ExcludeDirs {
		excl[d] = struct{}{}
	}

	s := &GitService{
		repoPath:    abs,
		excludeDirs: excl,
		opts:        opts,
	}
	s.workingDir = s.resolveWorkingDir()
	return s
}

// resolveWorkingDir returns the absolute git work-tree root containing repoPath,
// or "" if repoPath is not inside a git repository.
func (s *GitService) resolveWorkingDir() string {
	out, err := s.run(s.repoPath, timeoutDefault, "rev-parse", "--show-toplevel")
	if err != nil {
		return ""
	}
	top := strings.TrimSpace(string(out))
	if top == "" {
		return ""
	}
	if abs, aerr := filepath.Abs(top); aerr == nil {
		return filepath.Clean(abs)
	}
	return filepath.Clean(top)
}

// RepoName returns the repository directory's base name.
func (s *GitService) RepoName() string {
	return filepath.Base(s.repoPath)
}

// run executes "git <args...>" in cwd with the given timeout and returns stdout.
// A non-zero exit, a timeout, or a missing binary is returned as an error; the
// caller is expected to degrade to an empty result. stderr is intentionally
// discarded — git diagnostics never surface to the API.
func (s *GitService) run(cwd string, timeout time.Duration, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return stdout.Bytes(), nil
}

// repoRelativePath converts path (relative to repoPath) into a path relative to
// the git working tree root, as git commands expect. When repoPath is the work
// tree itself the path is returned unchanged.
func (s *GitService) repoRelativePath(path string) string {
	if s.workingDir == "" {
		return path
	}
	full := filepath.Join(s.repoPath, path)
	rel, err := filepath.Rel(s.workingDir, full)
	if err != nil {
		return path
	}
	return filepath.ToSlash(rel)
}

// resolveChildRepo finds the immediate child repository that owns path and
// returns a service scoped to it plus the child-relative path. It returns nil
// when path has no directory component, or the child directory has no ".git".
// This lets a non-repo parent (e.g. ~/projects) transparently delegate git
// operations to project_a/.git, project_b/.git, etc.
func (s *GitService) resolveChildRepo(path string) (*GitService, string) {
	parts := strings.Split(strings.ReplaceAll(path, "\\", "/"), "/")
	if len(parts) < 2 {
		return nil, ""
	}
	childName := parts[0]
	childPath := filepath.Join(s.repoPath, childName)
	if _, err := exec.LookPath("git"); err != nil {
		// Without git the child service can do nothing useful; treat as absent.
		return nil, ""
	}
	if !dirHasGit(childPath) {
		return nil, ""
	}
	child := NewService(childPath, s.opts)
	return child, strings.Join(parts[1:], "/")
}

// History returns up to limit commits touching path, newest first. On any git
// error it returns an empty slice. When repoPath is not a git repo it delegates
// to the owning child repository.
func (s *GitService) History(path string, limit int) []model.GitCommit {
	defer perf.Default.Track(perf.CategoryGit, "get_history")()

	if s.workingDir == "" {
		if child, rel := s.resolveChildRepo(path); child != nil {
			return child.History(rel, limit)
		}
		return []model.GitCommit{}
	}

	out, err := s.run(s.workingDir, timeoutDefault,
		"log",
		"--max-count="+strconv.Itoa(limit),
		"--format=%H%x00%an%x00%ae%x00%ct%x00%s",
		"--",
		s.repoRelativePath(path),
	)
	if err != nil {
		return []model.GitCommit{}
	}

	commits := []model.GitCommit{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.SplitN(line, "\x00", 5)
		if len(fields) < 5 {
			continue
		}
		commits = append(commits, model.GitCommit{
			Hexsha:      fields[0],
			AuthorName:  orUnknown(fields[1]),
			AuthorEmail: fields[2],
			Date:        epochToTime(fields[3]),
			Message:     fields[4],
		})
	}
	return commits
}

// LastCommit returns the most recent commit touching path, or nil if none.
func (s *GitService) LastCommit(path string) *model.GitCommit {
	hist := s.History(path, 1)
	if len(hist) == 0 {
		return nil
	}
	return &hist[0]
}

// LastCommitsBatch returns the most recent commit for each of paths, in a single
// "git log --name-only" walk of the last 500 commits. Paths with no commit in
// that window are absent from the result. Missing-repo parents delegate per
// path to child repositories.
func (s *GitService) LastCommitsBatch(paths []string) map[string]model.GitCommit {
	defer perf.Default.Track(perf.CategoryGit, "get_last_commits_batch")()

	result := map[string]model.GitCommit{}
	if len(paths) == 0 {
		return result
	}
	if s.workingDir == "" {
		for _, p := range paths {
			if child, rel := s.resolveChildRepo(p); child != nil {
				if c := child.LastCommit(rel); c != nil {
					result[p] = *c
				}
			}
		}
		return result
	}

	// Map each git-root-relative path back to the caller's path.
	repoPaths := make(map[string]string, len(paths))
	for _, p := range paths {
		repoPaths[s.repoRelativePath(p)] = p
	}
	remaining := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		remaining[p] = struct{}{}
	}

	out, err := s.run(s.workingDir, timeoutDefault,
		"log",
		"--max-count=500",
		"--format=%H%x00%an%x00%ae%x00%ct%x00%s",
		"--name-only",
	)
	if err != nil {
		return result
	}

	var current *model.GitCommit
	for _, line := range strings.Split(string(out), "\n") {
		if line == "" {
			continue
		}
		if strings.Contains(line, "\x00") {
			fields := strings.SplitN(line, "\x00", 5)
			if len(fields) >= 5 {
				c := model.GitCommit{
					Hexsha:      fields[0],
					AuthorName:  orUnknown(fields[1]),
					AuthorEmail: fields[2],
					Date:        epochToTime(fields[3]),
					Message:     fields[4],
				}
				current = &c
			}
			continue
		}
		if current == nil {
			continue
		}
		name := strings.TrimSpace(line)
		orig, ok := repoPaths[name]
		if !ok {
			continue
		}
		if _, still := remaining[orig]; still {
			result[orig] = *current
			delete(remaining, orig)
			if len(remaining) == 0 {
				break
			}
		}
	}
	return result
}

// Status returns the working-directory status of changed files, keyed by their
// path relative to repoPath. Values are one of "untracked", "deleted", "added",
// or "modified". Results are cached for STATUS_CACHE_TTL. On any error it
// returns an empty map.
//
// Status codes are mapped with first-match-wins precedence: "??" ⇒ untracked,
// then any "D" ⇒ deleted, then any "A" ⇒ added, otherwise modified. A rename
// ("R  old -> new") keys the new path. Paths that resolve outside repoPath are
// skipped.
func (s *GitService) Status() map[string]string {
	defer perf.Default.Track(perf.CategoryGit, "get_working_dir_status")()

	if s.workingDir == "" {
		return map[string]string{}
	}

	cacheKey := s.repoPath
	if cached, ok := statusCache.get(cacheKey); ok {
		slog.Debug("git: status cache hit", "entries", len(cached))
		return cached
	}

	out, err := s.run(s.workingDir, timeoutDefault, "status", "--porcelain=v1", "-unormal")
	if err != nil {
		return map[string]string{}
	}

	result := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 4 {
			continue
		}
		xy := line[:2]
		filePath := strings.TrimSpace(line[3:])
		// Renames: "R  old -> new" — key the new path.
		if idx := strings.Index(filePath, " -> "); idx >= 0 {
			filePath = filePath[idx+len(" -> "):]
		}

		rel, ok := s.relToRepoPath(filePath)
		if !ok {
			continue
		}
		result[rel] = statusFromXY(xy)
	}

	statusCache.set(cacheKey, result)
	return result
}

// statusFromXY maps a two-char porcelain status code to a status string with
// first-match-wins precedence.
func statusFromXY(xy string) string {
	switch {
	case xy == "??":
		return "untracked"
	case strings.Contains(xy, "D"):
		return "deleted"
	case strings.Contains(xy, "A"):
		return "added"
	default:
		return "modified"
	}
}

// relToRepoPath converts a git-root-relative path into one relative to repoPath,
// reporting false when it resolves outside repoPath.
func (s *GitService) relToRepoPath(gitRelPath string) (string, bool) {
	full := filepath.Join(s.workingDir, gitRelPath)
	rel, err := filepath.Rel(s.repoPath, full)
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return "", false
	}
	return rel, true
}

// FileDiff returns the diff of path at the given commit, or nil when the commit
// does not touch the file or anything fails. commitSHA must already be validated
// by the caller (the HTTP layer rejects non-hex shapes with 400); ValidateSHA is
// also enforced here as defense in depth and to keep arbitrary strings out of
// the argv. A root commit (no parent) is diffed against the empty tree.
func (s *GitService) FileDiff(path, commitSHA string) (*model.FileDiff, error) {
	defer perf.Default.Track(perf.CategoryGit, "get_file_diff")()

	if !ValidateSHA(commitSHA) {
		return nil, ErrInvalidSHA
	}

	if s.workingDir == "" {
		if child, rel := s.resolveChildRepo(path); child != nil {
			return child.FileDiff(rel, commitSHA)
		}
		return nil, nil
	}

	relPath := s.repoRelativePath(path)

	// Resolve commit metadata and its parent in one show.
	meta, err := s.run(s.workingDir, timeoutDefault,
		"show", "--no-patch", "--format=%H%x00%s%x00%an%x00%ct", commitSHA)
	if err != nil {
		return nil, nil
	}
	fields := strings.SplitN(strings.TrimSpace(string(meta)), "\x00", 4)
	if len(fields) < 4 {
		return nil, nil
	}
	hexsha, summary, author, ts := fields[0], fields[1], fields[2], fields[3]

	parent := s.parentSHA(commitSHA)

	var rawOut []byte
	if parent != "" {
		rawOut, err = s.run(s.workingDir, timeoutDefault,
			"diff", parent, commitSHA, "--", relPath)
	} else {
		rawOut, err = s.run(s.workingDir, timeoutDefault,
			"diff", emptyTreeSHA, commitSHA, "--", relPath)
	}
	if err != nil {
		return nil, nil
	}
	rawDiff := string(rawOut)
	if rawDiff == "" {
		return nil, nil
	}

	return &model.FileDiff{
		CommitHexsha:  hexsha,
		CommitMessage: summary,
		CommitAuthor:  orUnknown(author),
		CommitDate:    epochToTime(ts),
		FilePath:      path,
		Hunks:         parseDiff(rawDiff),
		RawDiff:       rawDiff,
	}, nil
}

// parentSHA returns the first-parent SHA of commitSHA, or "" when the commit is
// a root (no parent) or the lookup fails.
func (s *GitService) parentSHA(commitSHA string) string {
	out, err := s.run(s.workingDir, timeoutDefault, "rev-parse", "--verify", "--quiet", commitSHA+"^")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// WorkingDiff returns the uncommitted diff for path (working tree vs HEAD), or
// nil when the file has no working-tree changes. The returned FileDiff carries
// the sentinel commit metadata the frontend keys on: hexsha "working", message
// "Uncommitted changes (<status>)", author "Working directory". Untracked files
// are rendered as an all-additions diff.
func (s *GitService) WorkingDiff(path string) (*model.FileDiff, error) {
	defer perf.Default.Track(perf.CategoryGit, "get_working_dir_diff")()

	if s.workingDir == "" {
		if child, rel := s.resolveChildRepo(path); child != nil {
			return child.WorkingDiff(rel)
		}
		return nil, nil
	}

	status := s.Status()
	fileStatus, ok := status[path]
	if !ok || fileStatus == "" {
		slog.Debug("git: no working-dir changes", "path", path)
		return nil, nil
	}

	var rawDiff string
	if fileStatus == "untracked" {
		rawDiff = s.diffUntrackedFile(path)
	} else {
		out, err := s.run(s.workingDir, timeoutDefault, "diff", "HEAD", "--", s.repoRelativePath(path))
		if err != nil {
			return nil, nil
		}
		rawDiff = string(out)
	}
	if rawDiff == "" {
		return nil, nil
	}

	return &model.FileDiff{
		CommitHexsha:  "working",
		CommitMessage: "Uncommitted changes (" + fileStatus + ")",
		CommitAuthor:  "Working directory",
		CommitDate:    time.Now().UTC(),
		FilePath:      path,
		Hunks:         parseDiff(rawDiff),
		RawDiff:       rawDiff,
	}, nil
}

// diffUntrackedFile renders an untracked file's full contents as an
// all-additions unified diff, mirroring how git would show a new file.
func (s *GitService) diffUntrackedFile(path string) string {
	full := filepath.Join(s.repoPath, path)
	data, err := readFileReplace(full)
	if err != nil {
		return ""
	}
	lines := splitLinesNoTrailing(data)
	var b strings.Builder
	b.WriteString("@@ -0,0 +1," + strconv.Itoa(len(lines)) + " @@")
	for _, line := range lines {
		b.WriteString("\n+")
		b.WriteString(line)
	}
	return b.String()
}

// HeadHash returns the short SHA of HEAD ("git rev-parse --short HEAD"), or ""
// when not a git repo or on error.
func (s *GitService) HeadHash() string {
	if s.workingDir == "" {
		return ""
	}
	out, err := s.run(s.workingDir, timeoutDefault, "rev-parse", "--short", "HEAD")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// IsDirty reports whether the working tree has any staged, unstaged, or
// untracked changes. It returns false when not a git repo or on error.
func (s *GitService) IsDirty() bool {
	if s.workingDir == "" {
		return false
	}
	out, err := s.run(s.workingDir, timeoutDefault, "status", "--porcelain")
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) != ""
}

// orUnknown returns "Unknown" for an empty author name, matching the original
// fallback the frontend expects.
func orUnknown(s string) string {
	if s == "" {
		return "Unknown"
	}
	return s
}

// epochToTime parses a "%ct" epoch-seconds field into a UTC time. An unparseable
// value yields the zero time, which marshals as the RFC3339 epoch — preferable
// to bubbling an error out of a degrade-to-empty service.
func epochToTime(s string) time.Time {
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil {
		return time.Time{}
	}
	return time.Unix(n, 0).UTC()
}

// ---------------------------------------------------------------------------
// SHA validation
// ---------------------------------------------------------------------------

// ErrInvalidSHA is returned by FileDiff when the commit identifier does not
// match the 4–40 hex-character shape. The HTTP layer maps it to a 400.
var ErrInvalidSHA = errors.New("git: invalid commit sha")

// ValidateSHA reports whether s is a syntactically valid commit identifier
// (4–40 hexadecimal characters). The HTTP layer uses it to return 400 before
// the value ever reaches the git CLI.
func ValidateSHA(s string) bool {
	return shaRe.MatchString(s)
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

// ttlMapCache is a tiny mutex-guarded TTL cache shared across GitService
// instances so multiple tabs hitting the same repo reuse one result.
type ttlMapCache struct {
	mu  sync.Mutex
	ttl time.Duration
	m   map[string]ttlEntry
}

type ttlEntry struct {
	at   time.Time
	data map[string]string
}

func newTTLMapCache(ttl time.Duration) *ttlMapCache {
	return &ttlMapCache{ttl: ttl, m: map[string]ttlEntry{}}
}

func (c *ttlMapCache) get(key string) (map[string]string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || time.Since(e.at) >= c.ttl {
		return nil, false
	}
	return e.data, true
}

func (c *ttlMapCache) set(key string, data map[string]string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key] = ttlEntry{at: time.Now(), data: data}
}

func (c *ttlMapCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m = map[string]ttlEntry{}
}

// recentsCache is a TTL cache of recent-files results keyed by a struct that
// captures every input that affects the result.
type recentsCache struct {
	mu  sync.Mutex
	ttl time.Duration
	m   map[recentsKey]recentsEntry
}

type recentsKey struct {
	repoPath       string
	limit          int
	extensions     string // joined, lowercased
	showHidden     bool
	showGitignored bool
}

type recentsEntry struct {
	at   time.Time
	data []model.RecentFile
}

func newRecentsCache(ttl time.Duration) *recentsCache {
	return &recentsCache{ttl: ttl, m: map[recentsKey]recentsEntry{}}
}

func (c *recentsCache) get(key recentsKey) ([]model.RecentFile, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || time.Since(e.at) >= c.ttl {
		return nil, false
	}
	return e.data, true
}

func (c *recentsCache) set(key recentsKey, data []model.RecentFile) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key] = recentsEntry{at: time.Now(), data: data}
}

func (c *recentsCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m = map[recentsKey]recentsEntry{}
}

const (
	statusCacheTTL = 3 * time.Second
	recentFilesTTL = 30 * time.Second
)

var (
	statusCache      = newTTLMapCache(statusCacheTTL)
	recentFilesCache = newRecentsCache(recentFilesTTL)
)

// ClearStatusCache flushes the shared git-status cache. The file watcher calls
// it when git state changes on disk so the next Status returns fresh data.
func ClearStatusCache() {
	statusCache.clear()
	slog.Debug("git: status cache cleared")
}

// ClearRecentFilesCache flushes the shared recent-files cache. The file watcher
// calls it alongside ClearStatusCache after commits, branch switches, etc.
func ClearRecentFilesCache() {
	recentFilesCache.clear()
	slog.Debug("git: recent-files cache cleared")
}

// sortRecentsDesc sorts recent files by date descending (newest first). Ties are
// resolved by path so the order is deterministic for caching and tests.
func sortRecentsDesc(rf []model.RecentFile) {
	sort.SliceStable(rf, func(i, j int) bool {
		if rf[i].Date.Equal(rf[j].Date) {
			return rf[i].Path < rf[j].Path
		}
		return rf[i].Date.After(rf[j].Date)
	})
}

// userIgnorePath / workspaceIgnorePath name the ignore files layered into the
// git ls-files walk so subtrees are pruned at the C level. They mirror the
// locations the ignore package reads.
const workspaceIgnoreName = ".vantageignore"

func (s *GitService) ignoreExcludeFromArgs() []string {
	if !s.opts.UseIgnoreFiles {
		return nil
	}
	var args []string
	if up := ignore.DefaultUserIgnorePath(); up != "" && isFile(up) {
		args = append(args, "--exclude-from", up)
	}
	ws := filepath.Join(s.repoPath, workspaceIgnoreName)
	if isFile(ws) {
		args = append(args, "--exclude-from", ws)
	}
	return args
}

// ---------------------------------------------------------------------------
// Recents
// ---------------------------------------------------------------------------

// Recents returns the most recently changed files across the repository, newest
// first, capped at limit. Tracked and untracked files are merged and sorted
// together by date. Only files whose name ends in one of extensions (default
// [".md"]) are considered. On any error it degrades to whatever it could gather
// (possibly empty). When repoPath is not a git repo, it delegates to child
// repositories.
//
// The three git probes — the recents log, untracked discovery, and the
// intent-to-add status — run concurrently via an errgroup, so wall-clock time is
// roughly the slowest probe rather than their sum. A fourth probe (staged
// names) runs afterward to catch staged-but-never-committed files.
func (s *GitService) Recents(limit int, extensions []string, showHidden, showGitignored bool) []model.RecentFile {
	defer perf.Default.Track(perf.CategoryGit, "get_recently_changed_files")()

	if len(extensions) == 0 {
		extensions = defaultExtensions
	}
	extLower := make([]string, len(extensions))
	for i, e := range extensions {
		extLower[i] = strings.ToLower(e)
	}

	key := recentsKey{
		repoPath:       s.repoPath,
		limit:          limit,
		extensions:     strings.Join(extLower, ","),
		showHidden:     showHidden,
		showGitignored: showGitignored,
	}
	if cached, ok := recentFilesCache.get(key); ok {
		slog.Debug("git: recent-files cache hit", "items", len(cached))
		return cached
	}

	result := s.computeRecents(limit, extLower, showHidden, showGitignored)
	recentFilesCache.set(key, result)
	return result
}

// matcher returns the layered ignore matcher for this repo, or nil when ignore
// files are disabled.
func (s *GitService) matcher() *ignore.Matcher {
	if !s.opts.UseIgnoreFiles {
		return nil
	}
	return ignore.GetMatcher(s.repoPath, true)
}

// shouldSkip reports whether a repo-relative path falls under an excluded
// directory or is ignored by the layered ignore files.
func (s *GitService) shouldSkip(rel string, m *ignore.Matcher) bool {
	for _, part := range strings.Split(rel, "/") {
		if _, ok := s.excludeDirs[part]; ok {
			return true
		}
	}
	if m != nil {
		return m.IsIgnored(rel, false)
	}
	return false
}

func (s *GitService) matchesExt(name string, extLower []string) bool {
	lower := strings.ToLower(name)
	for _, e := range extLower {
		if strings.HasSuffix(lower, e) {
			return true
		}
	}
	return false
}

// computeRecents does the uncached work of Recents.
func (s *GitService) computeRecents(limit int, extLower []string, showHidden, showGitignored bool) []model.RecentFile {
	if s.workingDir == "" {
		return s.recentsNoRepo(limit, extLower, showHidden, showGitignored)
	}

	m := s.matcher()
	extGlobs := make([]string, len(extLower))
	for i, e := range extLower {
		extGlobs[i] = "*" + e
	}
	excludeFrom := s.ignoreExcludeFromArgs()

	var logOut, untrackedOut, statusOut string
	g := new(errgroup.Group)
	g.Go(func() error {
		logOut = s.recentsLog()
		return nil
	})
	g.Go(func() error {
		untrackedOut = s.recentsUntracked(extGlobs, excludeFrom, showGitignored)
		return nil
	})
	g.Go(func() error {
		statusOut = s.recentsStatusITA()
		return nil
	})
	_ = g.Wait() // workers never return errors; they degrade to "".

	var results []model.RecentFile
	seen := map[string]struct{}{}

	// 1. Untracked files from git ls-files --others.
	for _, line := range strings.Split(untrackedOut, "\n") {
		rel := strings.TrimSpace(line)
		if rel == "" {
			continue
		}
		if s.shouldSkip(rel, m) {
			continue
		}
		if !showHidden && hasHiddenParent(rel) {
			continue
		}
		if s.opts.WalkMaxDepth != nil && strings.Count(rel, "/") > *s.opts.WalkMaxDepth {
			continue
		}
		rf, ok := s.recentFileStat(rel, true)
		if !ok {
			continue
		}
		results = append(results, rf)
		seen[rel] = struct{}{}
	}

	// 2. Intent-to-add files (in index, no commit; absent from --others).
	for _, rel := range s.intentToAddPaths(statusOut) {
		if _, dup := seen[rel]; dup {
			continue
		}
		if !s.matchesExt(rel, extLower) {
			continue
		}
		if s.shouldSkip(rel, m) {
			continue
		}
		if !showHidden && hasHiddenParent(rel) {
			continue
		}
		rf, ok := s.recentFileStat(rel, true)
		if !ok {
			continue
		}
		results = append(results, rf)
		seen[rel] = struct{}{}
	}

	// 3. Tracked files from the recents log (4-field format: no %ae).
	results = append(results, s.recentsFromLog(logOut, extLower, showHidden, m, seen)...)

	// 4. Staged-but-never-committed files.
	for _, rel := range s.recentsStaged() {
		if _, dup := seen[rel]; dup {
			continue
		}
		if !s.matchesExt(rel, extLower) {
			continue
		}
		if s.shouldSkip(rel, m) {
			continue
		}
		if !showHidden && hasHiddenParent(rel) {
			continue
		}
		rf, ok := s.recentFileStat(rel, true)
		if !ok {
			continue
		}
		results = append(results, rf)
		seen[rel] = struct{}{}
	}

	sortRecentsDesc(results)
	if len(results) > limit {
		results = results[:limit]
	}
	if results == nil {
		results = []model.RecentFile{}
	}
	return results
}

// recentsLog runs the recents log probe. NOTE: this format intentionally DROPS
// %ae — it has four NUL-separated fields (hash, author, ct, subject), unlike the
// history/batch format which has five. Do not unify them.
func (s *GitService) recentsLog() string {
	out, err := s.run(s.workingDir, timeoutDefault,
		"log",
		"--max-count=50",
		"--format=%H%x00%an%x00%ct%x00%s",
		"--name-only",
		"--diff-filter=ACDMR",
	)
	if err != nil {
		return ""
	}
	return string(out)
}

// recentsUntracked runs git ls-files --others to discover untracked files
// matching the extension globs. It uses the configurable walk timeout because
// this probe walks the whole working tree.
func (s *GitService) recentsUntracked(extGlobs, excludeFrom []string, showGitignored bool) string {
	args := []string{"ls-files", "--others"}
	if !showGitignored {
		args = append(args, "--exclude-standard")
	}
	args = append(args, excludeFrom...)
	args = append(args, "--")
	args = append(args, extGlobs...)
	out, err := s.run(s.workingDir, s.opts.walkTimeout(), args...)
	if err != nil {
		return ""
	}
	return string(out)
}

// recentsStatusITA runs the intent-to-add status probe (-uno: no untracked
// enumeration, just the index).
func (s *GitService) recentsStatusITA() string {
	out, err := s.run(s.workingDir, timeoutDefault, "status", "--porcelain=v1", "-uno")
	if err != nil {
		return ""
	}
	return string(out)
}

// recentsStaged returns repoPath-relative names of staged files
// ("git diff --cached --name-only").
func (s *GitService) recentsStaged() []string {
	out, err := s.run(s.workingDir, timeoutStaged, "diff", "--cached", "--name-only")
	if err != nil {
		return nil
	}
	var paths []string
	for _, line := range strings.Split(string(out), "\n") {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		if rel, ok := s.relToRepoPath(name); ok {
			paths = append(paths, rel)
		}
	}
	return paths
}

// intentToAddPaths extracts repoPath-relative paths of intent-to-add files
// (" A" status) from a porcelain status output.
func (s *GitService) intentToAddPaths(statusOutput string) []string {
	var paths []string
	for _, line := range strings.Split(statusOutput, "\n") {
		if len(line) < 4 {
			continue
		}
		if line[:2] != " A" {
			continue
		}
		name := strings.TrimSpace(line[3:])
		if rel, ok := s.relToRepoPath(name); ok {
			paths = append(paths, rel)
		}
	}
	return paths
}

// recentsFromLog parses the recents log output into tracked RecentFiles,
// skipping anything already seen, hidden (when showHidden is false), excluded,
// ignored, or missing on disk. seen is updated in place.
func (s *GitService) recentsFromLog(
	logOut string,
	extLower []string,
	showHidden bool,
	m *ignore.Matcher,
	seen map[string]struct{},
) []model.RecentFile {
	var out []model.RecentFile
	var cur *logInfo
	for _, line := range strings.Split(logOut, "\n") {
		if line == "" {
			continue
		}
		if strings.Contains(line, "\x00") {
			fields := strings.SplitN(line, "\x00", 4)
			if len(fields) >= 4 {
				cur = &logInfo{
					hexsha:  fields[0],
					author:  fields[1],
					ct:      fields[2],
					message: fields[3],
				}
			}
			continue
		}
		if cur == nil {
			continue
		}
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		rel, ok := s.relToRepoPath(name)
		if !ok {
			continue
		}
		if s.shouldSkip(rel, m) {
			continue
		}
		if !s.matchesExt(rel, extLower) {
			continue
		}
		if !showHidden && hasHiddenParent(rel) {
			continue
		}
		if _, dup := seen[rel]; dup {
			continue
		}
		info, ok := statRegularNonSymlink(filepath.Join(s.repoPath, rel))
		if !ok {
			continue
		}
		seen[rel] = struct{}{}
		out = append(out, model.RecentFile{
			Path:       rel,
			Date:       info.ModTime().UTC(),
			AuthorName: orUnknown(cur.author),
			Message:    cur.message,
			Hexsha:     cur.hexsha,
			Untracked:  false,
		})
	}
	return out
}

type logInfo struct {
	hexsha  string
	author  string
	ct      string
	message string
}

// recentFileStat stats an untracked candidate and builds its RecentFile, or
// reports false when the path is missing, not a regular file, or a symlink.
func (s *GitService) recentFileStat(rel string, untracked bool) (model.RecentFile, bool) {
	info, ok := statRegularNonSymlink(filepath.Join(s.repoPath, rel))
	if !ok {
		return model.RecentFile{}, false
	}
	return model.RecentFile{
		Path:      rel,
		Date:      info.ModTime().UTC(),
		Untracked: untracked,
	}, true
}

// recentsNoRepo handles the recents query when repoPath is not itself a git
// repo: it aggregates immediate child repositories' recents (prefixing their
// paths) plus loose .md files at the top level and in non-git subdirectories.
func (s *GitService) recentsNoRepo(limit int, extLower []string, showHidden, showGitignored bool) []model.RecentFile {
	m := s.matcher()
	childRepos := s.discoverChildRepos()

	var results []model.RecentFile
	if len(childRepos) > 0 {
		seen := map[string]struct{}{}
		childNames := map[string]struct{}{}
		for _, c := range childRepos {
			childNames[filepath.Base(c)] = struct{}{}
		}
		for _, childPath := range childRepos {
			child := NewService(childPath, s.opts)
			prefix := filepath.Base(childPath) + "/"
			for _, rf := range child.Recents(limit, extLower, showHidden, showGitignored) {
				rf.Path = prefix + rf.Path
				results = append(results, rf)
				seen[rf.Path] = struct{}{}
			}
		}
		results = append(results, s.looseMarkdown(extLower, childNames, seen)...)
	} else {
		// Truly no git: walk for matching files, all untracked.
		for _, rf := range s.looseMarkdown(extLower, nil, map[string]struct{}{}) {
			if s.shouldSkip(rf.Path, m) {
				continue
			}
			results = append(results, rf)
		}
	}

	sortRecentsDesc(results)
	if len(results) > limit {
		results = results[:limit]
	}
	if results == nil {
		results = []model.RecentFile{}
	}
	return results
}
