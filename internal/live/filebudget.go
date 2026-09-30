package live

import (
	"runtime"
	"sync"
)

// FileBudget is how many files the watchers of one process may hold open
// between them.
//
// It exists for kqueue, fsnotify's backend on macOS and the BSDs, which holds a
// file open for every watched directory and for every entry of each: every
// document, every subdirectory, every file in .git's top level. Those count
// against the process's open-file limit, the same limit the server's
// connections, the documents it reads and the pipes to git count against. A
// big enough tree, or a directory of enough clones, used to take all of it,
// and then everything failed, not only live reload. Linux's inotify holds a
// watch per directory and no file per entry, and its own limit refuses watches
// before anything else suffers, so there is no budget there.
//
// A watch that would overspend the budget is refused the way the kernel
// refuses one past its limit, so the browser shows the same watch-limit banner
// (see [Watcher.SetDegradedHandler]).
type FileBudget struct {
	mu    sync.Mutex
	limit int
	used  int
}

// NewFileBudget returns a budget of limit open files, none of them spent.
func NewFileBudget(limit int) *FileBudget {
	return &FileBudget{limit: max(limit, 0)}
}

// Used is how many files are charged to b now.
func (b *FileBudget) Used() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.used
}

// take charges n files to b if they fit, and reports whether they did.
func (b *FileBudget) take(n int) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.used+n > b.limit {
		return false
	}
	b.used += n
	return true
}

// add charges n files that are open already, whether or not they fit: ones
// fsnotify opened for an entry that appeared in a watched directory.
func (b *FileBudget) add(n int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.used += n
}

// give returns n files to b.
func (b *FileBudget) give(n int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.used = max(b.used-n, 0)
}

// kqueuePlatforms are the platforms where fsnotify watches with kqueue.
var kqueuePlatforms = map[string]bool{"darwin": true, "dragonfly": true, "freebsd": true, "netbsd": true, "openbsd": true}

// reservedFiles is the least of the open-file limit a [DefaultFileBudget]
// leaves to the rest of the server: its connections, the documents it reads,
// and git's pipes. A quarter of the limit is left when that is more.
const reservedFiles = 256

// watcherOwnFiles is what one running watcher holds open before it watches
// anything on kqueue: the queue itself and the pipe fsnotify closes it with.
const watcherOwnFiles = 3

// DefaultFileBudget returns the budget every watcher in this process shares,
// or nil where watching holds no file per entry, which is everywhere but macOS
// and the BSDs. It is three quarters of the process's open-file limit, which
// Go raises at startup to what the system allows (on macOS,
// kern.maxfilesperproc), and leaves at least [reservedFiles] of it.
func DefaultFileBudget() *FileBudget {
	return fileBudgetFor(runtime.GOOS, openFileLimit())
}

// fileBudgetFor is [DefaultFileBudget] for goos and an open-file limit of
// limit, which 0 says is unknown.
func fileBudgetFor(goos string, limit int) *FileBudget {
	if !kqueuePlatforms[goos] || limit <= 0 {
		return nil
	}
	return NewFileBudget(limit - max(limit/4, reservedFiles))
}
