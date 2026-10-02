package live

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/require"

	gitsvc "github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/gitenv"
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

// A directory that goes away takes every recent file inside it along, and the
// viewer refreshes its recent files on the push that says so. That list is
// cached for half a minute and was dropped only when git's own state changed,
// which a plain `mv` never touches, so the refresh fetched the list from before
// the rename: the old paths, and none of the new ones. Only this repository's
// list is dropped: in daemon mode every served repository shares the cache,
// and another's did not change.
func TestFlushForgetsTheRecentFilesOfARemovedDirectory(t *testing.T) {
	root := gitRepo(t, map[string]string{"docs/old/a.md": "# A\n"})
	other := gitRepo(t, map[string]string{"b.md": "# B\n"})

	gitsvc.ClearRecentFilesCache()
	t.Cleanup(gitsvc.ClearRecentFilesCache)
	recent := func(svc *gitsvc.GitService) []string {
		return recentPaths(svc, 30)
	}
	svc, otherSvc := gitsvc.NewService(root, gitsvc.Options{}), gitsvc.NewService(other, gitsvc.Options{})
	require.Equal(t, []string{"docs/old/a.md"}, recent(svc))
	require.Equal(t, []string{"b.md"}, recent(otherSvc))

	w, err := NewWatcher(root, "", NewManager(quietLogger(), nil), nil, false, quietLogger())
	require.NoError(t, err)
	require.NoError(t, os.Rename(filepath.Join(root, "docs", "old"), filepath.Join(root, "docs", "new")))
	writeTree(t, other, map[string]string{"b2.md": "# B2\n"})
	w.flush([]string{"docs/old/", "docs/new/a.md"})
	require.Equal(t, []string{"docs/new/a.md"}, recent(svc))
	require.Equal(t, []string{"b.md"}, recent(otherSvc), "the other repository's list is still the cached one")
}

// A Markdown file written is the newest of its repository's recent files, and
// the viewer refreshes its recent files on the push that names it. That list
// was cached for half a minute and dropped only when git's own state changed,
// which a write never touches, so the refresh fetched the list from before the
// write: a file just created was not in it, and one just saved kept its old
// place. And the viewer refetches only on a push, so the page went on showing
// that list until something else changed. Only this repository's list is
// dropped, as for a directory that goes.
func TestFlushForgetsTheRecentFilesOfAWrittenMarkdownFile(t *testing.T) {
	root := gitRepo(t, map[string]string{"old.md": "# Old\n", "mid.md": "# Mid\n", "newer.md": "# Newer\n"})
	other := gitRepo(t, map[string]string{"b.md": "# B\n"})
	now := time.Now()
	age := func(rel string, by time.Duration) {
		at := now.Add(-by)
		require.NoError(t, os.Chtimes(filepath.Join(root, rel), at, at))
	}
	age("old.md", 3*time.Hour)
	age("mid.md", 2*time.Hour)
	age("newer.md", time.Hour)

	gitsvc.ClearRecentFilesCache()
	t.Cleanup(gitsvc.ClearRecentFilesCache)
	svc, otherSvc := gitsvc.NewService(root, gitsvc.Options{}), gitsvc.NewService(other, gitsvc.Options{})
	require.Equal(t, []string{"newer.md", "mid.md", "old.md"}, recentPaths(svc, 3))
	require.Equal(t, []string{"b.md"}, recentPaths(otherSvc, 3))

	w, err := NewWatcher(root, "", NewManager(quietLogger(), nil), nil, false, quietLogger())
	require.NoError(t, err)
	// One file created and one saved, the saved one with the same contents, as
	// an editor's save of an unchanged buffer leaves it. The created one is
	// the newer.
	writeTree(t, root, map[string]string{"created.md": "# Created\n", "old.md": "# Old\n"})
	age("old.md", time.Minute)
	writeTree(t, other, map[string]string{"b2.md": "# B2\n"})
	w.flush([]string{"created.md", "old.md"})
	require.Equal(t, []string{"created.md", "old.md", "newer.md"}, recentPaths(svc, 3))
	require.Equal(t, []string{"b.md"}, recentPaths(otherSvc, 3), "the other repository's list is still the cached one")
}

// gitRepo makes a git repository holding files, with nothing committed.
func gitRepo(t *testing.T, files map[string]string) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git binary not available")
	}
	root := t.TempDir()
	gitInit := exec.Command("git", "init", "-q")
	gitInit.Dir = root
	// Scrubbed, or inside the pre-commit hook, which exports GIT_DIR, this
	// init reinitialized the repository being committed to, as a bare one.
	gitInit.Env = append(gitenv.Scrubbed(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	out, err := gitInit.CombinedOutput()
	require.NoErrorf(t, err, "git init: %s", out)
	writeTree(t, root, files)
	return root
}

// recentPaths is the paths of svc's limit most recent files, as the sidebar
// asks for them: hidden files left out, gitignored ones in.
func recentPaths(svc *gitsvc.GitService, limit int) []string {
	var paths []string
	for _, rf := range svc.RecentsUnreported(limit, nil, false, true) {
		paths = append(paths, rf.Path)
	}
	return paths
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

// A removed directory is pushed in removed_dirs, and each file that was inside
// it in paths as well, so a consumer that reads only paths still hears of every
// file: the planning index drops the directory's subtree, and the viewer reloads
// a document inside it on either. On macOS the order in which kqueue reports the
// removals varies from run to run, which
// [TestHandleEventReportsTheFilesOfARemovedDirectoryInAnyOrder] pins on any
// platform.
func TestWatcherReportsARemovedDirectory(t *testing.T) {
	root := t.TempDir()
	writeTree(t, root, map[string]string{"docs/gone/a.md": "# A\n", "docs/gone/sub/b.md": "# B\n"})
	c := liveWatcher(t, root)

	require.NoError(t, os.RemoveAll(filepath.Join(root, "docs", "gone")))

	awaitPushes(t, c, func(p pushes) bool {
		return p.dirs["docs/gone"] && p.paths["docs/gone/a.md"] && p.paths["docs/gone/sub/b.md"]
	})
}

// A directory can be removed only once it is empty, so every file in it goes
// first, but kqueue, on macOS and the BSDs, can report the directory's removal
// before a file's. It queues a watch's event where that watch's first change
// put it and adds each later change to it: when `rm -rf docs/gone` empties sub
// before it deletes a.md, docs/gone's event is queued by sub's removal, and the
// removal of docs/gone joins it there, ahead of a.md's. By then docs/gone is no
// longer watched, and an event from a directory that is not watched is dropped
// as coming from a renamed directory's stale watch — which is what made
// TestWatcherReportsARemovedDirectory fail on the macOS runner now and then,
// with docs/gone/a.md never pushed. inotify always reports the removals in the
// order they were made.
//
// A renamed directory's files go on reporting under their old names, and
// those events are still dropped — also when the name is one a directory was
// removed under before.
func TestHandleEventReportsTheFilesOfARemovedDirectoryInAnyOrder(t *testing.T) {
	for _, tc := range []struct {
		name  string
		order []string
	}{
		{"inotify", []string{"docs/gone/a.md", "docs/gone/sub/b.md", "docs/gone/sub", "docs/gone"}},
		// What the macOS runner heard: a.md was deleted after sub was.
		{"kqueue, a file after its directory", []string{"docs/gone/sub/b.md", "docs/gone/sub", "docs/gone", "docs/gone/a.md"}},
		// a.md deleted first: its deletion queued docs/gone's event, ahead of
		// b.md's, and the removal of docs/gone joined it there.
		{"kqueue, a.md listed first", []string{"docs/gone/a.md", "docs/gone", "docs/gone/sub/b.md", "docs/gone/sub"}},
		// docs/gone had an earlier change still waiting to be read when the
		// removal began, so its event was queued ahead of both files'.
		{"kqueue, everything after the directory", []string{"docs/gone", "docs/gone/a.md", "docs/gone/sub/b.md", "docs/gone/sub"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			writeTree(t, root, map[string]string{
				"docs/gone/a.md": "# A\n", "docs/gone/sub/b.md": "# B\n", "docs/old/c.md": "# C\n",
			})
			w, err := NewWatcher(root, "", nil, nil, false, quietLogger(), []string{})
			require.NoError(t, err)
			w.addWatch = func(string) error { return nil }
			w.addRecursive(root)
			co := newCoalescer(time.Hour, time.Hour, func([]string) {})
			defer co.stop()
			pushed := func() (paths, dirs []string) {
				co.mu.Lock()
				defer co.mu.Unlock()
				var batch []string
				for p := range co.pending {
					batch = append(batch, p)
				}
				clear(co.pending)
				return splitBatch(batch)
			}
			event := func(rel string, op fsnotify.Op) {
				w.handleEvent(fsnotify.Event{Name: filepath.Join(root, filepath.FromSlash(rel)), Op: op}, co)
			}

			require.NoError(t, os.RemoveAll(filepath.Join(root, "docs", "gone")))
			for _, rel := range tc.order {
				event(rel, fsnotify.Remove)
			}
			paths, dirs := pushed()
			require.Equal(t, []string{"docs/gone"}, dirs)
			require.Equal(t, []string{"docs/gone/a.md", "docs/gone/sub/b.md"}, paths)

			require.NoError(t, os.Rename(filepath.Join(root, "docs", "old"), filepath.Join(root, "docs", "new")))
			event("docs/old", fsnotify.Rename)
			event("docs/new", fsnotify.Create)
			paths, dirs = pushed()
			require.Equal(t, []string{"docs/old"}, dirs)
			require.Equal(t, []string{"docs/new/c.md"}, paths)

			// docs/new/c.md deleted, and heard once more through the watch that
			// kept its old name.
			require.NoError(t, os.Remove(filepath.Join(root, "docs", "new", "c.md")))
			event("docs/new/c.md", fsnotify.Remove)
			event("docs/old/c.md", fsnotify.Remove)
			paths, _ = pushed()
			require.Equal(t, []string{"docs/new/c.md"}, paths)

			// docs/gone made again, then renamed away: its name is a renamed
			// directory's now, and a file that was in it reporting its removal
			// under that name is dropped like any other.
			writeTree(t, root, map[string]string{"docs/gone/d.md": "# D\n"})
			event("docs/gone", fsnotify.Create)
			paths, _ = pushed()
			require.Equal(t, []string{"docs/gone/d.md"}, paths)
			require.NoError(t, os.Rename(filepath.Join(root, "docs", "gone"), filepath.Join(root, "docs", "moved")))
			event("docs/gone", fsnotify.Rename)
			event("docs/moved", fsnotify.Create)
			paths, dirs = pushed()
			require.Equal(t, []string{"docs/gone"}, dirs)
			require.Equal(t, []string{"docs/moved/d.md"}, paths)
			require.NoError(t, os.Remove(filepath.Join(root, "docs", "moved", "d.md")))
			event("docs/moved/d.md", fsnotify.Remove)
			event("docs/gone/d.md", fsnotify.Remove)
			paths, _ = pushed()
			require.Equal(t, []string{"docs/moved/d.md"}, paths)
		})
	}
}

// The record of removed directories names each removal once, by its outermost
// directory, and keeps only the newest.
func TestRememberRemovedFoldsAndBoundsTheRecord(t *testing.T) {
	w, err := NewWatcher(t.TempDir(), "", nil, nil, false, quietLogger(), []string{})
	require.NoError(t, err)
	lastWord := func(rel string) bool {
		return w.lastWordOfRemoved(fsnotify.Event{Name: filepath.Join(w.root, filepath.FromSlash(rel)), Op: fsnotify.Remove})
	}

	w.rememberRemoved("docs/gone/sub")
	w.rememberRemoved("docs/gone-x")
	w.rememberRemoved("docs/gone")
	require.Equal(t, []string{"docs/gone-x", "docs/gone"}, w.removedDirs,
		"a directory replaces the ones inside it, and a sibling sharing its prefix stays")
	require.True(t, lastWord("docs/gone/a.md"))
	require.True(t, lastWord("docs/gone/sub/b.md"))
	require.False(t, lastWord("docs/gone-x-sibling/a.md"), "a sibling sharing a record's prefix is not inside it")

	for i := range removedDirsKept {
		w.rememberRemoved(fmt.Sprintf("tmp/%d", i))
	}
	require.Len(t, w.removedDirs, removedDirsKept)
	require.Equal(t, "tmp/0", w.removedDirs[0], "the oldest records went first")
	require.False(t, w.lastWordOfRemoved(fsnotify.Event{Name: filepath.Join(w.root, "docs", "gone", "a.md"), Op: fsnotify.Remove}))
	require.True(t, w.lastWordOfRemoved(fsnotify.Event{Name: filepath.Join(w.root, "tmp", "0", "deep", "a.md"), Op: fsnotify.Rename}))
	require.False(t, w.lastWordOfRemoved(fsnotify.Event{Name: filepath.Join(w.root, "tmp", "0", "a.md"), Op: fsnotify.Write}),
		"only a file's last event, which says it is gone")
}

// A directory renamed away clears the record of a removal under its own name,
// and that of one it lies in: it was made after that removal, and its files go
// on reporting under the old name. A record inside it, and a sibling's sharing
// its prefix, stay.
func TestForgetRemovedClearsTheRecordsARenamedDirectoryLiesIn(t *testing.T) {
	w, err := NewWatcher(t.TempDir(), "", nil, nil, false, quietLogger(), []string{})
	require.NoError(t, err)
	for _, dir := range []string{"docs/gone", "docs/gone-x", "docs/old/sub", "tmp/a", "keep"} {
		w.rememberRemoved(dir)
	}

	w.forgetRemoved("docs/gone")
	require.Equal(t, []string{"docs/gone-x", "docs/old/sub", "tmp/a", "keep"}, w.removedDirs)
	w.forgetRemoved("tmp/a/b")
	require.Equal(t, []string{"docs/gone-x", "docs/old/sub", "keep"}, w.removedDirs, "a record the renamed directory lies in")
	w.forgetRemoved("docs/old")
	w.forgetRemoved("keeper")
	require.Equal(t, []string{"docs/gone-x", "docs/old/sub", "keep"}, w.removedDirs)
}

// An attribute change alone, which on macOS Spotlight makes all the time, used
// to reload the document. It is dropped when the file's size and modification
// time are what they were at the last event kept for it. A truncation, which
// on macOS is only an attribute change, still counts, and so does one for a
// file with nothing to compare against.
func TestHandleEventDropsAnAttributeChangeThatLeftTheContentsAlone(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "a.md")
	require.NoError(t, os.WriteFile(a, []byte("# A\n"), 0o644))
	w, err := NewWatcher(root, "", nil, nil, false, quietLogger(), []string{})
	require.NoError(t, err)
	co := newCoalescer(time.Hour, time.Hour, func([]string) {})
	defer co.stop()
	pushed := func(op fsnotify.Op) bool {
		w.handleEvent(fsnotify.Event{Name: a, Op: op}, co)
		co.mu.Lock()
		defer co.mu.Unlock()
		_, ok := co.pending["a.md"]
		clear(co.pending)
		return ok
	}

	require.True(t, pushed(fsnotify.Chmod), "with no event kept yet, there is nothing to compare against")
	require.False(t, pushed(fsnotify.Chmod))
	require.True(t, pushed(fsnotify.Write), "a Write is never an attribute change alone")
	require.False(t, pushed(fsnotify.Chmod))

	require.NoError(t, os.Truncate(a, 0))
	require.True(t, pushed(fsnotify.Chmod), "emptying the file is a change")
	require.False(t, pushed(fsnotify.Chmod))

	later := time.Now().Add(time.Hour)
	require.NoError(t, os.Chtimes(a, later, later))
	require.True(t, pushed(fsnotify.Chmod), "a new modification time is a change")
	require.True(t, pushed(fsnotify.Chmod|fsnotify.Write))

	require.NoError(t, os.Remove(a))
	require.True(t, pushed(fsnotify.Remove))
	require.NoError(t, os.WriteFile(a, []byte("# A\n"), 0o644))
	require.True(t, pushed(fsnotify.Chmod), "a file that went away and came back starts again with nothing to compare")
}

// The same from the event loop, which is what the macOS runner checks against
// kqueue: chmod on a document pushes nothing.
func TestWatcherDoesNotPushAChmod(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "a.md")
	require.NoError(t, os.WriteFile(a, []byte("# A\n"), 0o644))
	c := liveWatcher(t, root)

	// Every event of this write is handled before mid.md's, so once mid.md is
	// pushed, nothing more is to come from it.
	require.NoError(t, os.WriteFile(a, []byte("# A, edited\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "mid.md"), []byte("# Mid\n"), 0o644))
	awaitPushes(t, c, func(p pushes) bool { return p.paths["a.md"] && p.paths["mid.md"] })

	require.NoError(t, os.Chmod(a, 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "after.md"), []byte("# After\n"), 0o644))
	got := awaitPushes(t, c, func(p pushes) bool { return p.paths["after.md"] })
	require.False(t, got.paths["a.md"])
}
