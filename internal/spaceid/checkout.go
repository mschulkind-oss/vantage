package spaceid

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Hold is how a served checkout holds a space id: in its own .vantage/space,
// through a linked worktree of it, or not at all. A lookup prefers the first
// to the second, so a worktree served beside its main checkout is the project
// its own links open.
type Hold int

const (
	// NotHeld: neither the checkout nor any linked worktree of it holds the id.
	NotHeld Hold = iota
	// ThroughWorktree: a linked worktree of this main checkout holds it in
	// the worktree's own .vantage/space.
	ThroughWorktree
	// Own: the checkout's own .vantage/space holds it.
	Own
)

// Checkout is the space ids one served root answers for: its own
// .vantage/space and, when the root is a main checkout, each of its linked
// worktrees'.
//
// vantage-check makes the id in the checkout it runs in, a linked worktree
// included, so a link made in a worktree names that worktree. A Vantage
// serving the worktree finds the id in the worktree's own file. One serving
// only the main checkout finds it through the main checkout's
// .git/worktrees/<name>/gitdir, which names each worktree's .git file, and
// opens the main checkout: the nearest checkout it serves. A worktree counts
// only when its .git file names the same directory back, so a main checkout
// copied whole, whose .git/worktrees still name the original's worktrees,
// answers for none of them; and a repository whose .git is bare (`git clone
// --bare url proj/.git`, worktrees under proj) is no checkout, so its folder
// answers for none either. Reference: docs/reference/planning-index.md §13.6.
//
// Every [Checkout.Holds] lists the worktrees again, since one can be added or
// removed at any time; each worktree's file is a [File], re-read only when it
// changes. Safe for concurrent use.
type Checkout struct {
	root string
	own  *File

	mu        sync.Mutex
	worktrees map[string]*File // by worktree root
}

// NewCheckout returns the Checkout for the root a Vantage serves. Nothing is
// read until [Checkout.Holds] is called.
func NewCheckout(root string) *Checkout {
	return &Checkout{root: root, own: New(root)}
}

// Path returns the checkout's own .vantage/space.
func (c *Checkout) Path() string { return c.own.Path() }

// Holds says how the checkout holds id.
func (c *Checkout) Holds(id string) Hold {
	if held, ok := c.own.ID(); ok && held == id {
		return Own
	}
	for _, f := range c.worktreeFiles() {
		if held, ok := f.ID(); ok && held == id {
			return ThroughWorktree
		}
	}
	return NotHeld
}

// worktreeFiles is the .vantage/space of every linked worktree of the
// checkout as it is now, each the [File] an earlier lookup made for it.
func (c *Checkout) worktreeFiles() []*File {
	roots := linkedWorktrees(c.root)
	c.mu.Lock()
	defer c.mu.Unlock()
	next := make(map[string]*File, len(roots))
	out := make([]*File, 0, len(roots))
	for _, root := range roots {
		f := c.worktrees[root]
		if f == nil {
			f = New(root)
		}
		next[root] = f
		out = append(out, f)
	}
	c.worktrees = next
	return out
}

// maxWorktrees caps how many of a repository's worktrees one lookup reads.
const maxWorktrees = 256

// maxPointerBytes caps a gitdir file and a worktree's .git file, which each
// hold one path.
const maxPointerBytes = 4096

// maxConfigBytes caps the git config read for core.bare.
const maxConfigBytes = 1 << 20

// linkedWorktrees returns the root of every linked worktree of the main
// checkout root, in the order git's administrative directories list: none
// when root's .git is not a directory, or is a bare repository.
func linkedWorktrees(root string) []string {
	gitDir := filepath.Join(root, ".git")
	info, err := os.Lstat(gitDir)
	if err != nil || !info.IsDir() {
		return nil
	}
	admins := filepath.Join(gitDir, "worktrees")
	entries, err := os.ReadDir(admins)
	if err != nil || len(entries) == 0 || isBare(gitDir) {
		return nil
	}
	var out []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if worktree, ok := worktreeOf(filepath.Join(admins, entry.Name())); ok {
			out = append(out, worktree)
			if len(out) == maxWorktrees {
				break
			}
		}
	}
	return out
}

// worktreeOf returns the root of the linked worktree whose administrative
// directory is admin: the directory holding the .git file its gitdir names,
// when that file names admin back. A relative path in either file, which git
// writes with worktree.useRelativePaths, is read from the file's own
// directory: admin for gitdir, the worktree for its .git.
func worktreeOf(admin string) (string, bool) {
	forward, ok := firstLine(filepath.Join(admin, "gitdir"))
	if !ok || forward == "" {
		return "", false
	}
	if !filepath.IsAbs(forward) {
		forward = filepath.Join(admin, forward)
	}
	worktree := filepath.Dir(forward)
	back, ok := firstLine(forward)
	if !ok {
		return "", false
	}
	back, ok = strings.CutPrefix(back, "gitdir:")
	if !ok {
		return "", false
	}
	back = strings.TrimSpace(back)
	if !filepath.IsAbs(back) {
		back = filepath.Join(worktree, back)
	}
	named, err := os.Stat(back)
	if err != nil {
		return "", false
	}
	self, err := os.Stat(admin)
	if err != nil || !os.SameFile(named, self) {
		return "", false
	}
	return worktree, true
}

// firstLine returns path's first line, white space trimmed, when path is a
// regular file no larger than [maxPointerBytes].
func firstLine(path string) (string, bool) {
	data, err := readCapped(path, maxPointerBytes)
	if err != nil {
		return "", false
	}
	line, _, _ := strings.Cut(string(data), "\n")
	return strings.TrimSpace(line), true
}

// isBare reports whether the git directory gitDir is a bare repository, as
// its config's core.bare says: the last value wins, a key with no value is
// true, and true, yes, on and 1 are true whatever their case. Sections are
// matched by name alone, so [core "x"] is not core. A config that cannot be
// read says not bare. vantage-check reads it the same way, which
// testdata/space-files.json holds both to.
func isBare(gitDir string) bool {
	data, err := readCapped(filepath.Join(gitDir, "config"), maxConfigBytes)
	if err != nil {
		return false
	}
	section := ""
	bare := false
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "[") {
			end := strings.IndexByte(line, ']')
			if end < 0 {
				section = ""
				continue
			}
			section = strings.ToLower(strings.TrimSpace(line[1:end]))
			line = strings.TrimSpace(line[end+1:])
		}
		if section != "core" || line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		key, value, hasValue := strings.Cut(line, "=")
		if !strings.EqualFold(strings.TrimSpace(key), "bare") {
			continue
		}
		if !hasValue {
			bare = true
			continue
		}
		if i := strings.IndexAny(value, "#;"); i >= 0 {
			value = value[:i]
		}
		value = strings.ToLower(strings.Trim(strings.TrimSpace(value), `"`))
		bare = value == "true" || value == "yes" || value == "on" || value == "1"
	}
	return bare
}
