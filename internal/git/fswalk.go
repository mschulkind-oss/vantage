package git

import (
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// dirHasGit reports whether dir contains a ".git" entry (file or directory).
func dirHasGit(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

// isFile reports whether path exists and is a regular file.
func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// statRegularNonSymlink stats path and reports its info only when it is an
// existing regular file that is not a symlink. Symlinks are excluded from
// recents.
func statRegularNonSymlink(path string) (os.FileInfo, bool) {
	li, err := os.Lstat(path)
	if err != nil {
		return nil, false
	}
	if li.Mode()&os.ModeSymlink != 0 {
		return nil, false
	}
	if !li.Mode().IsRegular() {
		return nil, false
	}
	return li, true
}

// hasHiddenParent reports whether any parent directory component of rel (i.e.
// every segment except the final filename) begins with a dot.
func hasHiddenParent(rel string) bool {
	parts := strings.Split(rel, "/")
	for _, p := range parts[:len(parts)-1] {
		if strings.HasPrefix(p, ".") {
			return true
		}
	}
	return false
}

// readFileReplace reads path as UTF-8, replacing invalid sequences with the
// Unicode replacement character so the result is always valid UTF-8.
func readFileReplace(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if utf8.Valid(data) {
		return string(data), nil
	}
	return strings.ToValidUTF8(string(data), "�"), nil
}

// splitLinesNoTrailing splits s on newlines like Python's str.splitlines (used
// by the untracked-file diff): a final trailing newline does not produce a
// trailing empty element. "\r\n" and "\r" are normalized to "\n" first.
func splitLinesNoTrailing(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	if s == "" {
		return nil
	}
	lines := strings.Split(s, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

// discoverChildRepos returns immediate child directories of repoPath that are
// git repositories, skipping hidden and excluded directories. It is used when
// repoPath is not itself a git repo (e.g. ~/projects containing project_a/.git).
func (s *GitService) discoverChildRepos() []string {
	entries, err := os.ReadDir(s.repoPath)
	if err != nil {
		slog.Debug("git: cannot scan for child repos", "path", s.repoPath, "error", err)
		return nil
	}
	var repos []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if _, excluded := s.excludeDirs[name]; excluded {
			continue
		}
		full := filepath.Join(s.repoPath, name)
		if dirHasGit(full) {
			repos = append(repos, full)
		}
	}
	return repos
}

// looseMarkdown collects matching files (untracked, all of them) from the top
// level and from non-git subdirectories of repoPath. Directories named in
// childRepoNames are skipped (their files are gathered via delegation), as are
// hidden and excluded directories. Symlinks are skipped. Paths already in seen
// are not re-added. The returned paths are relative to repoPath.
func (s *GitService) looseMarkdown(
	extLower []string,
	childRepoNames map[string]struct{},
	seen map[string]struct{},
) []model.RecentFile {
	entries, err := os.ReadDir(s.repoPath)
	if err != nil {
		return nil
	}
	var results []model.RecentFile

	add := func(rel string) {
		if _, dup := seen[rel]; dup {
			return
		}
		info, ok := statRegularNonSymlink(filepath.Join(s.repoPath, rel))
		if !ok {
			return
		}
		seen[rel] = struct{}{}
		results = append(results, model.RecentFile{
			Path:      rel,
			Date:      info.ModTime().UTC(),
			Untracked: true,
		})
	}

	for _, entry := range entries {
		name := entry.Name()
		if entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		if entry.Type().IsRegular() {
			if s.matchesExt(name, extLower) {
				add(name)
			}
			continue
		}
		if !entry.IsDir() {
			continue
		}
		if strings.HasPrefix(name, ".") {
			continue
		}
		if _, excluded := s.excludeDirs[name]; excluded {
			continue
		}
		if _, isChild := childRepoNames[name]; isChild {
			continue
		}
		// Non-git subdirectory: walk it for matching files (all untracked).
		s.walkSubdir(filepath.Join(s.repoPath, name), extLower, add)
	}
	return results
}

// walkSubdir walks root (a non-git subdirectory) for files matching extLower,
// pruning hidden and excluded directories and skipping symlinks. Each matching
// file's repoPath-relative path is passed to add.
func (s *GitService) walkSubdir(root string, extLower []string, add func(rel string)) {
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			slog.Debug("git: skipping unreadable path", "path", p, "error", err)
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if p != root && (strings.HasPrefix(name, ".") || s.isExcludedDir(name)) {
				return fs.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if !s.matchesExt(d.Name(), extLower) {
			return nil
		}
		rel, rerr := filepath.Rel(s.repoPath, p)
		if rerr != nil {
			return nil
		}
		add(filepath.ToSlash(rel))
		return nil
	})
}

func (s *GitService) isExcludedDir(name string) bool {
	_, ok := s.excludeDirs[name]
	return ok
}
