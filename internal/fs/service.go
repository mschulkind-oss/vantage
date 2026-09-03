// Package fs serves the file-tree and file-content queries behind the backend's
// /tree, /content, and /files endpoints. A FileSystemService is scoped to one
// repository root and answers directory listings, recursive markdown discovery,
// and single-file reads.
//
// Every caller-supplied path passes through validatePath, which rejects absolute
// paths, ".git" access, and traversal outside the root with a typed *PathError.
// The HTTP layer maps that sentinel to a 400 carrying its Detail string; all
// other failures degrade to an empty result rather than an error (a permission
// error while walking yields [], never a 500).
//
// Symlinks are reported with a tri-state: IsSymlink plus a SymlinkTarget that is
// the target's repo-relative path when it resolves inside the root, or empty
// (serialized as the absent key) when the link is broken or points outside the
// root. Directory git status rolls up: when a directory contains any changed
// file it is annotated "contains_changes".
package fs

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/gitenv"
	"github.com/mschulkind-oss/vantage/internal/ignore"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/pathsafe"
	"github.com/mschulkind-oss/vantage/internal/perf"
)

// markdownExt is the file-extension suffix (case-insensitive) that marks a file
// as Markdown — the only file type the tree surfaces.
const markdownExt = ".md"

// mdDirCacheTTL bounds how long a _dir_has_markdown result is reused. Markdown
// files rarely appear or disappear, so a 30s window avoids re-walking every
// subdirectory on every listing while staying fresh enough for editing.
const mdDirCacheTTL = 30 * time.Second

// checkIgnoreTimeout bounds the "git check-ignore" probe used to hide gitignored
// entries when ShowGitignored is false.
const checkIgnoreTimeout = 5 * time.Second

// ErrInvalidPath is the sentinel the handler maps to HTTP 400. Callers should
// use errors.As to recover the *PathError and its Detail message.
var ErrInvalidPath = pathsafe.ErrInvalid

// PathError is returned by validatePath (and surfaced by ListDirectory and
// ReadFile) when a caller-supplied path is rejected. Detail is a human-readable
// reason the HTTP layer puts in a {"detail":…} 400 body. PathError unwraps to
// ErrInvalidPath so callers can match with errors.Is(err, ErrInvalidPath).
//
// It is an alias rather than its own type: the containment rule lives in
// [pathsafe] and every caller — this service, the API's raw-image branch, the
// git service — has to be able to raise and recognize the same rejection.
type PathError = pathsafe.Error

// newPathError builds a *PathError with the given detail message.
func newPathError(detail string) *PathError { return &PathError{Detail: detail} }

// Options configures a single ListDirectory call. The zero value lists names
// only (no git annotation), hides hidden and gitignored entries.
type Options struct {
	// IncludeGit fetches each entry's last commit and annotates working-tree
	// git status (including the directory "contains_changes" rollup).
	IncludeGit bool
	// ShowHidden includes dot-files and dot-directories.
	ShowHidden bool
	// ShowGitignored includes entries matched by .gitignore (when false, a
	// "git check-ignore" probe filters them out).
	ShowGitignored bool
}

// mdDirCache is a process-wide TTL cache of _dir_has_markdown results, keyed by
// absolute directory path. It is shared across FileSystemService instances (the
// answer depends only on disk contents) and flushed by the file watcher.
type mdDirCache struct {
	mu  sync.Mutex
	ttl time.Duration
	m   map[string]mdDirEntry
}

type mdDirEntry struct {
	at  time.Time
	has bool
}

func newMDDirCache(ttl time.Duration) *mdDirCache {
	return &mdDirCache{ttl: ttl, m: map[string]mdDirEntry{}}
}

func (c *mdDirCache) get(key string) (bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || time.Since(e.at) >= c.ttl {
		return false, false
	}
	return e.has, true
}

func (c *mdDirCache) set(key string, has bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key] = mdDirEntry{at: time.Now(), has: has}
}

func (c *mdDirCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m = map[string]mdDirEntry{}
}

// markdownDirCache backs _dir_has_markdown for every FileSystemService.
var markdownDirCache = newMDDirCache(mdDirCacheTTL)

// ClearMarkdownDirCache flushes the shared _dir_has_markdown cache. The file
// watcher calls it when files are created or deleted so the next listing
// re-evaluates which directories contain markdown.
func ClearMarkdownDirCache() {
	markdownDirCache.clear()
	slog.Debug("fs: markdown-dir cache cleared")
}

// FileSystemService answers file-tree and file-content queries for one
// repository root. It is safe for concurrent use: it holds no per-call mutable
// state, and the markdown cache and git service it uses are themselves
// concurrency-safe.
type FileSystemService struct {
	rootPath    string // absolute, cleaned
	excludeDirs map[string]struct{}
	useIgnore   bool

	gitOnce sync.Once
	gitSvc  *git.GitService
	gitOpts git.Options
}

// Config constructs a FileSystemService.
type Config struct {
	// RootPath is the repository root. It is resolved to an absolute, cleaned
	// path; symlinks in the root itself are followed.
	RootPath string
	// ExcludeDirs names directories pruned from listings and markdown discovery
	// (node_modules, .venv, …). Nil applies no name-based exclusions.
	ExcludeDirs []string
	// UseIgnoreFiles layers the .vantageignore matcher into listings and
	// discovery.
	UseIgnoreFiles bool
	// WalkMaxDepth caps recursion depth for markdown discovery (number of path
	// separators below the directory). Nil means unlimited.
	WalkMaxDepth *int
}

// New builds a FileSystemService for cfg. The root is resolved to an absolute
// path (following symlinks where possible); an unresolvable root falls back to
// its cleaned absolute form.
func New(cfg Config) *FileSystemService {
	root := resolveRoot(cfg.RootPath)
	excl := make(map[string]struct{}, len(cfg.ExcludeDirs))
	for _, d := range cfg.ExcludeDirs {
		excl[d] = struct{}{}
	}
	return &FileSystemService{
		rootPath:    root,
		excludeDirs: excl,
		useIgnore:   cfg.UseIgnoreFiles,
		gitOpts: git.Options{
			ExcludeDirs:    cfg.ExcludeDirs,
			WalkMaxDepth:   cfg.WalkMaxDepth,
			UseIgnoreFiles: cfg.UseIgnoreFiles,
		},
	}
}

// resolveRoot returns the absolute, symlink-resolved form of p, falling back to
// the cleaned absolute path when resolution fails.
func resolveRoot(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = p
	}
	abs = filepath.Clean(abs)
	if resolved, rerr := filepath.EvalSymlinks(abs); rerr == nil {
		return resolved
	}
	return abs
}

// RootPath returns the service's absolute, resolved repository root.
func (s *FileSystemService) RootPath() string { return s.rootPath }

// git lazily constructs the GitService for this root and reuses it across calls.
func (s *FileSystemService) git() *git.GitService {
	s.gitOnce.Do(func() {
		s.gitSvc = git.NewService(s.rootPath, s.gitOpts)
	})
	return s.gitSvc
}

// validatePath validates and resolves a caller-supplied path relative to the
// root, deferring the whole rule to [pathsafe.Resolve]. It returns a *PathError
// (which the handler maps to 400) when the path is empty, contains a NUL byte,
// is absolute, descends into ".git" or ".vantage", or leaves the root — either
// lexically or by following a symlink.
func (s *FileSystemService) validatePath(path string) (string, error) {
	return pathsafe.Resolve(s.rootPath, path)
}

// ListDirectory lists the entries of path (relative to the root), returning
// dirs-first then case-sensitively by name. Directories report HasMarkdown;
// symlinks carry the tri-state described on the package. With opts.IncludeGit it
// also populates each entry's LastCommit and git status, rolling
// "contains_changes" up onto ancestor directories.
//
// A path that fails validation returns a *PathError (→ 400). A path that is not
// a directory likewise returns a *PathError. A permission error while scanning
// degrades to an empty slice, never an error.
func (s *FileSystemService) ListDirectory(path string, opts Options) ([]model.FileNode, error) {
	defer perf.Default.Track(perf.CategoryFS, "list_directory")()

	targetDir, err := s.validatePath(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(targetDir)
	if err != nil || !info.IsDir() {
		return nil, newPathError("Not a directory")
	}

	entries, err := os.ReadDir(targetDir)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			slog.Debug("fs: permission denied listing directory", "dir", targetDir)
			return []model.FileNode{}, nil
		}
		// Any other read error also degrades to empty rather than a 500.
		slog.Debug("fs: cannot list directory", "dir", targetDir, "error", err)
		return []model.FileNode{}, nil
	}

	var gitignored map[string]struct{}
	if !opts.ShowGitignored {
		gitignored = s.gitignoredNames(targetDir)
	}
	matcher := s.matcher()

	var (
		nodes    []model.FileNode
		relPaths []string // entries eligible for batch git last-commit
	)
	for _, entry := range entries {
		node, eligible, keep := s.buildNode(targetDir, entry, opts, gitignored, matcher)
		if !keep {
			continue
		}
		nodes = append(nodes, node)
		if eligible {
			relPaths = append(relPaths, node.Path)
		}
	}

	if opts.IncludeGit {
		s.annotateGit(nodes, relPaths)
	}

	sortNodes(nodes)
	if nodes == nil {
		nodes = []model.FileNode{}
	}
	return nodes, nil
}

// buildNode turns one directory entry into a FileNode, applying the
// hidden/gitignored/excluded/ignore filters. It reports eligible=true when the
// node should take part in the batch git last-commit lookup, and keep=false when
// the entry is filtered out entirely.
func (s *FileSystemService) buildNode(
	dir string,
	entry os.DirEntry,
	opts Options,
	gitignored map[string]struct{},
	matcher *ignore.Matcher,
) (node model.FileNode, eligible, keep bool) {
	name := entry.Name()
	full := filepath.Join(dir, name)
	isSymlink := entry.Type()&os.ModeSymlink != 0

	// Broken symlink: stat (which follows the link) fails. Surface it as a
	// non-navigable error node, applying the same name-based filters first.
	if isSymlink {
		if _, err := os.Stat(full); err != nil {
			if !opts.ShowHidden && strings.HasPrefix(name, ".") {
				return node, false, false
			}
			if _, ig := gitignored[name]; ig {
				return node, false, false
			}
			isMD := isMarkdown(name)
			return model.FileNode{
				Name:          name,
				Path:          s.relPath(full),
				IsDir:         !isMD,
				HasMarkdown:   isMD,
				IsSymlink:     true,
				SymlinkTarget: "",
			}, false, true
		}
	}

	info, err := os.Stat(full) // follows symlinks
	if err != nil {
		return node, false, false
	}
	isDir := info.IsDir()
	isMD := isMarkdown(name)

	if isDir {
		if _, excluded := s.excludeDirs[name]; excluded {
			return node, false, false
		}
	}
	if !opts.ShowHidden && strings.HasPrefix(name, ".") {
		return node, false, false
	}
	if _, ig := gitignored[name]; ig {
		return node, false, false
	}
	rel := s.relPath(full)
	if matcher != nil && matcher.IsIgnored(rel, isDir) {
		return node, false, false
	}

	// Resolve the symlink target for the tri-state. A target inside the root
	// yields its repo-relative path; a broken or external target is an error.
	var symlinkTarget string
	symlinkError := false
	if isSymlink {
		if resolved, rerr := filepath.EvalSymlinks(full); rerr == nil {
			if tRel, ok := s.relTo(resolved); ok {
				symlinkTarget = tRel
			} else {
				symlinkError = true
			}
		} else {
			symlinkError = true
		}
	}

	switch {
	case isDir:
		// A symlinked dir pointing outside the root is shown but not traversed.
		if isSymlink && symlinkError {
			return model.FileNode{
				Name:          name,
				Path:          rel,
				IsDir:         true,
				HasMarkdown:   false,
				IsSymlink:     true,
				SymlinkTarget: "",
			}, false, true
		}
		return model.FileNode{
			Name:          name,
			Path:          rel,
			IsDir:         true,
			HasMarkdown:   s.dirHasMarkdown(full),
			IsSymlink:     isSymlink,
			SymlinkTarget: symlinkTarget,
		}, true, true

	case isMD:
		if isSymlink && symlinkError {
			return model.FileNode{
				Name:          name,
				Path:          rel,
				IsDir:         false,
				HasMarkdown:   true,
				IsSymlink:     true,
				SymlinkTarget: "",
			}, false, true
		}
		return model.FileNode{
			Name:          name,
			Path:          rel,
			IsDir:         false,
			HasMarkdown:   true,
			IsSymlink:     isSymlink,
			SymlinkTarget: symlinkTarget,
		}, true, true

	default:
		// Non-markdown regular file: not surfaced in the tree.
		return node, false, false
	}
}

// annotateGit fills LastCommit (batch) and per-entry git status into nodes, and
// rolls "contains_changes" up onto directories that contain a changed file.
func (s *FileSystemService) annotateGit(nodes []model.FileNode, relPaths []string) {
	if len(relPaths) > 0 {
		commits := s.git().LastCommitsBatch(relPaths)
		for i := range nodes {
			if c, ok := commits[nodes[i].Path]; ok {
				cc := c
				nodes[i].LastCommit = &cc
			}
		}
	}

	status := s.git().Status()
	if len(status) == 0 {
		return
	}
	for i := range nodes {
		if nodes[i].IsDir {
			prefix := nodes[i].Path + "/"
			for p := range status {
				if p == nodes[i].Path || strings.HasPrefix(p, prefix) {
					nodes[i].GitStatus = "contains_changes"
					break
				}
			}
		} else if st, ok := status[nodes[i].Path]; ok {
			nodes[i].GitStatus = st
		}
	}
}

// matcher returns the layered ignore matcher for this root.
//
// A disabled matcher is returned rather than nil, matching what the watcher
// already does: [ignore.Matcher.IsIgnored] consults the built-in always-ignored
// set before its enabled check, so returning nil here made
// use_ignore_files=false surface .vantage in listings — the one thing the
// ignore package promises no configuration can do. Building a disabled matcher
// costs nothing: it skips loading the ignore files entirely.
func (s *FileSystemService) matcher() *ignore.Matcher {
	return ignore.GetMatcher(s.rootPath, s.useIgnore)
}

// relPath returns full as a slash-separated path relative to the root. A path
// that somehow escapes the root is returned cleaned-and-slashed unchanged.
func (s *FileSystemService) relPath(full string) string {
	rel, err := filepath.Rel(s.rootPath, full)
	if err != nil {
		return filepath.ToSlash(full)
	}
	return filepath.ToSlash(rel)
}

// relTo returns full relative to the root and ok=true when it stays inside the
// root; ok=false (with "") when it resolves outside.
func (s *FileSystemService) relTo(full string) (string, bool) {
	rel, err := filepath.Rel(s.rootPath, full)
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return "", false
	}
	return rel, true
}

// gitignoredNames returns the base names of entries directly under dir that git
// considers ignored, via "git check-ignore". Any failure yields an empty set,
// so the listing simply shows everything.
func (s *FileSystemService) gitignoredNames(dir string) map[string]struct{} {
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) == 0 {
		return nil
	}
	paths := make([]string, 0, len(entries))
	for _, e := range entries {
		paths = append(paths, filepath.Join(dir, e.Name()))
	}

	ctx, cancel := context.WithTimeout(context.Background(), checkIgnoreTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "check-ignore", "--stdin", "-z")
	cmd.Dir = s.rootPath
	cmd.Env = gitenv.Scrubbed()
	cmd.Stdin = strings.NewReader(strings.Join(paths, "\x00"))
	out, err := cmd.Output()
	if err != nil {
		// "git check-ignore" exits non-zero when nothing matches; that is not a
		// real error. Any captured stdout is still parsed below.
		if len(out) == 0 {
			return nil
		}
	}
	ignored := map[string]struct{}{}
	for _, p := range strings.Split(string(out), "\x00") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		ignored[filepath.Base(p)] = struct{}{}
	}
	return ignored
}

// dirHasMarkdown reports whether dir (recursively) contains any .md file,
// memoizing the answer for mdDirCacheTTL. It stops at the first match.
func (s *FileSystemService) dirHasMarkdown(dir string) bool {
	if has, ok := markdownDirCache.get(dir); ok {
		return has
	}
	has := s.walkForMarkdown(dir)
	markdownDirCache.set(dir, has)
	return has
}

// walkForMarkdown walks dir looking for the first .md file, honoring
// WalkMaxDepth and degrading to false on any walk error (e.g. permission).
func (s *FileSystemService) walkForMarkdown(dir string) bool {
	maxDepth := s.gitOpts.WalkMaxDepth
	rootDepth := strings.Count(dir, string(os.PathSeparator))

	found := false
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			slog.Debug("fs: walk error", "path", p, "error", err)
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if maxDepth != nil && strings.Count(p, string(os.PathSeparator))-rootDepth >= *maxDepth {
				return fs.SkipDir
			}
			return nil
		}
		if isMarkdown(d.Name()) {
			found = true
			return errStopWalk
		}
		return nil
	})
	return found
}

// errStopWalk short-circuits a WalkDir once the first match is found.
var errStopWalk = errors.New("stop walk")

// ListAllFiles returns every Markdown file under the root as repo-relative,
// slash-separated paths, sorted. It prunes excluded, hidden, and ignored
// directories and skips symlinked files. Unreadable subtrees are skipped rather
// than failing the whole walk.
func (s *FileSystemService) ListAllFiles() []string {
	defer perf.Default.Track(perf.CategoryFS, "list_all_files")()

	matcher := s.matcher()
	var results []string

	_ = filepath.WalkDir(s.rootPath, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			slog.Debug("fs: list_all_files skipping unreadable path", "path", p, "error", err)
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if p == s.rootPath {
				return nil
			}
			name := d.Name()
			if _, excluded := s.excludeDirs[name]; excluded {
				return fs.SkipDir
			}
			if strings.HasPrefix(name, ".") {
				// Hidden dirs are pruned; ListAllFiles never shows hidden trees.
				return fs.SkipDir
			}
			rel := s.relPath(p)
			if matcher != nil && matcher.IsIgnored(rel, true) {
				return fs.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if !isMarkdown(d.Name()) {
			return nil
		}
		rel := s.relPath(p)
		if matcher != nil && matcher.IsIgnored(rel, false) {
			return nil
		}
		results = append(results, rel)
		return nil
	})

	sort.Strings(results)
	return results
}

// ReadFile reads path (relative to the root) and returns its content. When the
// bytes are valid UTF-8 the encoding is "utf-8" and Content is the text;
// otherwise the encoding is "binary" and Content is empty. A path that fails
// validation, or that is not a regular file, returns a *PathError (→ 400).
func (s *FileSystemService) ReadFile(path string) (*model.FileContent, error) {
	defer perf.Default.Track(perf.CategoryFS, "read_file")()

	full, err := s.validatePath(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil || !info.Mode().IsRegular() {
		return nil, newPathError("Not a file")
	}

	data, err := os.ReadFile(full)
	if err != nil {
		return nil, newPathError("Not a file")
	}
	if utf8.Valid(data) {
		return &model.FileContent{Path: path, Content: string(data), Encoding: "utf-8"}, nil
	}
	return &model.FileContent{Path: path, Content: "", Encoding: "binary"}, nil
}

// isMarkdown reports whether name ends in ".md" (case-insensitive).
func isMarkdown(name string) bool {
	return strings.HasSuffix(strings.ToLower(name), markdownExt)
}

// sortNodes orders nodes directories-first, then case-sensitively by name —
// matching the frontend's expected tree order.
func sortNodes(nodes []model.FileNode) {
	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].IsDir != nodes[j].IsDir {
			return nodes[i].IsDir // dirs before files
		}
		return nodes[i].Name < nodes[j].Name
	})
}
