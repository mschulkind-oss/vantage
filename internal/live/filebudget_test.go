package live

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// Only kqueue holds a file per watched entry, so only macOS and the BSDs get a
// budget, and it leaves a quarter of the limit, or at least reservedFiles, to
// the rest of the server.
func TestTheFileBudgetIsForKqueueAndLeavesTheServerItsShare(t *testing.T) {
	require.Nil(t, fileBudgetFor("linux", 10240))
	require.Nil(t, fileBudgetFor("windows", 10240))
	require.Nil(t, fileBudgetFor("darwin", 0), "an unknown limit sets no budget")
	require.Equal(t, 7680, fileBudgetFor("darwin", 10240).limit)
	require.Equal(t, 744, fileBudgetFor("freebsd", 1000).limit)
	require.Equal(t, 0, fileBudgetFor("darwin", 256).limit, "a limit this low leaves nothing to watch with")
}

// A directory is charged a file for each entry, and the root one more for
// itself. One that would overspend the budget is refused and reported as the
// watch limit. Entries that come and go afterwards are counted as kqueue opens
// and closes them, and a renamed directory's files stay charged while kqueue
// holds them open under their old names.
func TestAWatchPastTheFileBudgetIsRefusedAndReported(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{
		"a.md": "", "b.md": "",
		"big/1.md": "", "big/2.md": "", "big/3.md": "", "big/4.md": "", "big/5.md": "",
		"docs/c.md": "", "docs/d.md": "",
	})
	w, err := NewWatcher(root, "p", nil, nil, false, quietLogger(), []string{})
	require.NoError(t, err)
	w.addWatch = func(string) error { return nil }
	w.removeWatch = func(string) {}
	var reports []model.Degradation
	w.SetDegradedHandler(func(d model.Degradation) { reports = append(reports, d) })
	budget := NewFileBudget(7)
	w.SetFileBudget(budget)

	// The root costs 5 (4 entries and itself), big 5 more, which is too many,
	// and docs 2, which fit.
	require.Equal(t, 2, w.addRecursive(root))
	require.Contains(t, w.dirs, "docs")
	require.NotContains(t, w.dirs, "big")
	require.Equal(t, []model.Degradation{{Repo: "p", Kind: model.DegradationWatchLimit, Path: "big", Count: 1}}, reports)
	require.Equal(t, 7, budget.Used())

	co := newCoalescer(time.Hour, time.Hour, func([]string) {})
	defer co.stop()
	e := filepath.Join(root, "docs", "e.md")
	require.NoError(t, os.WriteFile(e, nil, 0o644))
	w.handleEvent(fsnotify.Event{Name: e, Op: fsnotify.Create}, co)
	require.Equal(t, 8, budget.Used(), "kqueue opened the new file, whatever the budget says")
	require.NoError(t, os.Remove(e))
	w.handleEvent(fsnotify.Event{Name: e, Op: fsnotify.Remove}, co)
	require.Equal(t, 7, budget.Used())

	require.NoError(t, os.Rename(filepath.Join(root, "docs"), filepath.Join(root, "notes")))
	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "docs"), Op: fsnotify.Rename}, co)
	require.Equal(t, 6, budget.Used(), "docs itself is closed, and its two files are still open as docs/c.md and docs/d.md")
	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "docs", "c.md"), Op: fsnotify.Write}, co)
	require.Equal(t, 5, budget.Used(), "docs/c.md was heard, and its watch dropped")

	w.releaseAllFiles()
	require.Zero(t, budget.Used())
}

// Every watcher in the process shares one budget, and a watcher gives back
// what it held when it stops: the files its watches held and its own queue.
func TestWatchersShareOneFileBudget(t *testing.T) {
	small, large := t.TempDir(), t.TempDir()
	writeTree(t, small, map[string]string{"a.md": ""})
	writeTree(t, large, map[string]string{"b.md": "", "docs/c.md": ""})
	budget := NewFileBudget(watcherOwnFiles + 2)
	var mu sync.Mutex
	var reports []model.Degradation
	start := func(root, name string) func() {
		w, err := NewWatcher(root, name, nil, nil, false, quietLogger(), []string{})
		require.NoError(t, err)
		w.SetFileBudget(budget)
		w.SetDegradedHandler(func(d model.Degradation) {
			mu.Lock()
			defer mu.Unlock()
			reports = append(reports, d)
		})
		return startWatcher(t, w)
	}

	stopSmall := start(small, "small")
	require.Eventually(t, func() bool { return budget.Used() == watcherOwnFiles+2 }, 5*time.Second, 10*time.Millisecond,
		"small costs its queue, its one file, and its root")
	stopLarge := start(large, "large")
	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(reports) > 0
	}, 5*time.Second, 10*time.Millisecond)
	mu.Lock()
	require.Equal(t, model.Degradation{Repo: "large", Kind: model.DegradationWatchLimit, Path: ".", Count: 1}, reports[0])
	mu.Unlock()

	stopSmall()
	require.Equal(t, watcherOwnFiles, budget.Used(), "only large's own queue is left")
	stopLarge()
	require.Zero(t, budget.Used())
}
