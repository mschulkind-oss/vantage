package live

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/ignore"
)

// The root `.vantage.toml` is pushed so the viewer can rescan its planning
// index, and no ignore rule can stop that: the rules hide documents, and the
// config is not one.
func TestHandleEventKeepsTheRootConfigWhateverTheIgnoreFilesSay(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, ".vantageignore"), []byte("*.toml\n.*\n"), 0o644))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs"), 0o755))
	w, err := NewWatcher(root, "", nil, nil, true, quietLogger(), []string{})
	require.NoError(t, err)
	w.matcher = ignore.NewMatcher(root, true, "")

	var added []string
	co := newCoalescer(time.Hour, time.Hour, func([]string) {})
	defer co.stop()
	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, ".vantage.toml"), Op: fsnotify.Write}, co)
	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "docs", ".vantage.toml"), Op: fsnotify.Write}, co)
	co.mu.Lock()
	for p := range co.pending {
		added = append(added, p)
	}
	co.mu.Unlock()
	require.Equal(t, []string{".vantage.toml"}, added)
}

func TestSplitBatchSeparatesAndFoldsRemovedDirectories(t *testing.T) {
	paths, dirs := splitBatch([]string{
		"docs/old/sub/", "z.md", "docs/old/", "docs/old-x/", "a.md", "docs/old/a.md",
	})
	require.Equal(t, []string{"a.md", "docs/old/a.md", "z.md"}, paths,
		"a path under a removed directory is kept: it exists again")
	require.Equal(t, []string{"docs/old", "docs/old-x"}, dirs,
		"a directory inside a removed one is folded into it, and a sibling sharing its prefix is not")

	paths, dirs = splitBatch([]string{"a.md"})
	require.NotNil(t, paths)
	require.NotNil(t, dirs)
	require.Empty(t, dirs)
}

func TestFlushBroadcastsRemovedDirectories(t *testing.T) {
	m := NewManager(quietLogger(), nil)
	c := m.newTestConn(4)
	w, err := NewWatcher(t.TempDir(), "repoX", m, nil, false, quietLogger())
	require.NoError(t, err)

	w.flush([]string{"docs/old/", "docs/old/sub/", "a.md"})
	w.flush([]string{"gone/"})
	w.flush([]string{"b.md"})

	raw := func() string {
		select {
		case data := <-c.send:
			return string(data)
		default:
			t.Fatal("flush did not broadcast")
			return ""
		}
	}
	require.JSONEq(t,
		`{"type":"files_changed","repo":"repoX","paths":["a.md"],"removed_dirs":["docs/old"]}`, raw())
	require.JSONEq(t,
		`{"type":"files_changed","repo":"repoX","paths":[],"removed_dirs":["gone"]}`, raw(),
		"paths is [] and never null, even when only a directory went")
	require.JSONEq(t,
		`{"type":"files_changed","repo":"repoX","paths":["b.md"]}`, raw(),
		"removed_dirs is left out when there are none, so the old message is unchanged")
}

// --- the event loop ---------------------------------------------------------

// pushes accumulates the files_changed paths and removed directories one
// connection receives.
type pushes struct {
	paths map[string]bool
	dirs  map[string]bool
}

// awaitPushes reads files_changed messages from c until done holds of
// everything received so far, and fails after a deadline.
func awaitPushes(t *testing.T, c *conn, done func(pushes) bool) pushes {
	t.Helper()
	got := pushes{paths: map[string]bool{}, dirs: map[string]bool{}}
	deadline := time.After(5 * time.Second)
	for !done(got) {
		select {
		case data := <-c.send:
			var msg filesChangedMessage
			require.NoError(t, json.Unmarshal(data, &msg))
			if msg.Type != "files_changed" {
				continue
			}
			for _, p := range msg.Paths {
				got.paths[p] = true
			}
			for _, d := range msg.RemovedDirs {
				got.dirs[d] = true
			}
		case <-deadline:
			t.Fatalf("pushes never arrived; got paths %v and removed dirs %v", got.paths, got.dirs)
		}
	}
	return got
}

// liveWatcher starts a watcher on root and waits until an event round-trips,
// which proves the initial watch set is registered. The probe's own pushes are
// drained.
func liveWatcher(t *testing.T, root string) *conn {
	t.Helper()
	m := NewManager(quietLogger(), nil)
	c := m.newTestConn(256)
	w, err := NewWatcher(root, "", m, nil, false, quietLogger(), []string{})
	require.NoError(t, err)
	t.Cleanup(startWatcher(t, w))

	probe := filepath.Join(root, "probe.md")
	require.Eventually(t, func() bool {
		require.NoError(t, os.WriteFile(probe, []byte(time.Now().String()), 0o644))
		select {
		case data := <-c.send:
			var msg map[string]any
			require.NoError(t, json.Unmarshal(data, &msg))
			return msg["type"] == "files_changed"
		default:
			return false
		}
	}, 5*time.Second, 150*time.Millisecond)
	time.Sleep(2 * quietPeriod)
	for len(c.send) > 0 {
		<-c.send
	}
	return c
}

func writeTree(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for rel, content := range files {
		full := filepath.Join(root, filepath.FromSlash(rel))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
	}
}

func TestWatcherPushesTheRootConfigAndNotANestedOne(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs"), 0o755))
	c := liveWatcher(t, root)

	require.NoError(t, os.WriteFile(filepath.Join(root, "docs", ".vantage.toml"), []byte("x = 1\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, ".vantage.toml"), []byte("[planning]\n"), 0o644))

	got := awaitPushes(t, c, func(p pushes) bool { return p.paths[".vantage.toml"] })
	require.False(t, got.paths["docs/.vantage.toml"])
}

// A directory moved into the tree arrives as one Create; the files inside it
// produce no event of their own, so the walk that watches it has to report them.
func TestWatcherPushesTheMarkdownInsideADirectoryMovedIn(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs"), 0o755))
	outside := filepath.Join(t.TempDir(), "incoming")
	writeTree(t, outside, map[string]string{"b.md": "# B\n", "sub/a.md": "# A\n", "notes.txt": "x\n"})
	c := liveWatcher(t, root)

	require.NoError(t, os.Rename(outside, filepath.Join(root, "docs", "new")))

	got := awaitPushes(t, c, func(p pushes) bool {
		return p.paths["docs/new/b.md"] && p.paths["docs/new/sub/a.md"]
	})
	require.False(t, got.paths["docs/new/notes.txt"], "only content paths are pushed")
}

// A file written under a directory created a moment earlier can land before
// the directory's watch exists, and then inotify never reports it.
func TestWatcherPushesAFileWrittenUnderAJustCreatedDirectory(t *testing.T) {
	root := t.TempDir()
	c := liveWatcher(t, root)

	writeTree(t, root, map[string]string{"fresh/deeper/a.md": "# A\n"})

	awaitPushes(t, c, func(p pushes) bool { return p.paths["fresh/deeper/a.md"] })
}

// `mv docs/old docs/new` used to push nothing at all: a Rename of a directory,
// which classify drops, and a Create that only extended the watch set.
func TestWatcherReportsARenamedDirectoryAndItsNewContents(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{"docs/old/a.md": "# A\n", "docs/old/sub/b.md": "# B\n"})
	c := liveWatcher(t, root)

	require.NoError(t, os.Rename(filepath.Join(root, "docs", "old"), filepath.Join(root, "docs", "new")))

	got := awaitPushes(t, c, func(p pushes) bool {
		return p.dirs["docs/old"] && p.paths["docs/new/a.md"] && p.paths["docs/new/sub/b.md"]
	})
	require.False(t, got.dirs["docs/old/sub"], "the renamed directory names its subtree")

	// The subdirectory's watch followed its inode through the rename. Had it kept
	// the name it was registered under, this edit would be pushed as
	// docs/old/sub/c.md, a path that no longer exists.
	require.NoError(t, os.WriteFile(filepath.Join(root, "docs", "new", "sub", "c.md"), []byte("# C\n"), 0o644))
	got = awaitPushes(t, c, func(p pushes) bool { return p.paths["docs/new/sub/c.md"] })
	require.False(t, got.paths["docs/old/sub/c.md"])

	// On macOS the watch on a file directly inside the renamed directory kept its
	// old name, so this edit was pushed twice, once as docs/old/a.md. The file
	// written after it proves that no such push is still to come: events are
	// handled in order.
	require.NoError(t, os.WriteFile(filepath.Join(root, "docs", "new", "a.md"), []byte("# A, edited\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "after.md"), []byte("# After\n"), 0o644))
	got = awaitPushes(t, c, func(p pushes) bool { return p.paths["docs/new/a.md"] && p.paths["after.md"] })
	require.False(t, got.paths["docs/old/a.md"])
}

// An event from a directory the watcher does not watch comes from a watch that
// outlived its directory's, as a renamed directory's files do on macOS. It is
// dropped, and so is the watch. A watched directory's own event still counts
// when its parent is not watched, as when the parent's watch failed.
func TestHandleEventDropsEventsFromADirectoryThatIsNoLongerWatched(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{"docs/old/a.md": "# A\n", "notes/sub/b.md": "# B\n", "top.md": "# Top\n"})
	w, err := NewWatcher(root, "", nil, nil, false, quietLogger(), []string{})
	require.NoError(t, err)
	w.addWatch = func(path string) error {
		if path == filepath.Join(root, "notes") {
			return errors.New("permission denied")
		}
		return nil
	}
	var removed []string
	w.removeWatch = func(path string) {
		rel, _ := filepath.Rel(root, path)
		removed = append(removed, filepath.ToSlash(rel))
	}
	w.addRecursive(root)
	co := newCoalescer(time.Hour, time.Hour, func([]string) {})
	defer co.stop()
	pending := func() []string {
		co.mu.Lock()
		defer co.mu.Unlock()
		var out []string
		for p := range co.pending {
			out = append(out, p)
		}
		sort.Strings(out)
		clear(co.pending)
		return out
	}

	require.NoError(t, os.Rename(filepath.Join(root, "docs", "old"), filepath.Join(root, "docs", "new")))
	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "docs", "old"), Op: fsnotify.Rename}, co)
	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "docs", "new"), Op: fsnotify.Create}, co)
	require.Equal(t, []string{"docs/new/a.md", "docs/old/"}, pending())
	removed = nil

	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "docs", "old", "a.md"), Op: fsnotify.Write}, co)
	require.Empty(t, pending(), "docs/old/a.md no longer exists")
	require.Equal(t, []string{"docs/old/a.md"}, removed, "the watch that heard it is dropped")

	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "docs", "new", "a.md"), Op: fsnotify.Write}, co)
	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "top.md"), Op: fsnotify.Write}, co)
	require.Equal(t, []string{"docs/new/a.md", "top.md"}, pending())

	require.NoError(t, os.RemoveAll(filepath.Join(root, "notes", "sub")))
	w.handleEvent(fsnotify.Event{Name: filepath.Join(root, "notes", "sub"), Op: fsnotify.Remove}, co)
	require.Equal(t, []string{"notes/sub/"}, pending(), "notes is not watched, but notes/sub was")
	require.Equal(t, []string{"docs/old/a.md"}, removed)
}

// A directory moved out of the tree is removed as far as the tree is concerned,
// and nothing written into it afterwards is reported under its old name.
func TestWatcherReportsADirectoryMovedOut(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{"docs/old/sub/b.md": "# B\n"})
	c := liveWatcher(t, root)

	away := filepath.Join(t.TempDir(), "away")
	require.NoError(t, os.Rename(filepath.Join(root, "docs", "old"), away))
	awaitPushes(t, c, func(p pushes) bool { return p.dirs["docs/old"] })

	require.NoError(t, os.WriteFile(filepath.Join(away, "sub", "c.md"), []byte("# C\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "after.md"), []byte("# After\n"), 0o644))
	got := awaitPushes(t, c, func(p pushes) bool { return p.paths["after.md"] })
	require.False(t, got.paths["docs/old/sub/c.md"], "a directory outside the tree is not watched as part of it")
}

func TestWatcherReportsARemovedDirectory(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{"docs/gone/a.md": "# A\n", "docs/gone/sub/b.md": "# B\n"})
	c := liveWatcher(t, root)

	require.NoError(t, os.RemoveAll(filepath.Join(root, "docs", "gone")))

	awaitPushes(t, c, func(p pushes) bool {
		return p.dirs["docs/gone"] && p.paths["docs/gone/a.md"] && p.paths["docs/gone/sub/b.md"]
	})
}
