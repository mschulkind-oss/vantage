package live

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/ignore"
)

func TestClassify(t *testing.T) {
	tests := []struct {
		name        string
		path        string
		wantKeep    bool
		wantGitFile bool
	}{
		{"markdown kept", "docs/readme.md", true, false},
		{"markdown uppercase ext", "docs/README.MD", true, false},
		{"non-markdown dropped", "src/main.go", false, false},
		{"txt dropped", "notes.txt", false, false},
		{"git index kept", ".git/index", true, true},
		{"git HEAD kept", ".git/HEAD", true, true},
		{"git MERGE_HEAD kept", ".git/MERGE_HEAD", true, true},
		{"git object dropped", ".git/objects/ab/cdef", false, false},
		{"git refs dropped", ".git/refs/heads/main", false, false},
		{"git config dropped", ".git/config", false, false},
		{"git logs HEAD dropped (too deep)", ".git/logs/HEAD", false, false},
		{"md under .git dropped", ".git/notes.md", false, false},
		{"windows separators", `docs\guide.md`, true, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			keep, isGit := classify(tc.path)
			require.Equal(t, tc.wantKeep, keep, "keep")
			require.Equal(t, tc.wantGitFile, isGit, "isGitState")
		})
	}
}

func TestShouldPruneDir(t *testing.T) {
	matcher := ignore.GetMatcher(t.TempDir(), false) // disabled => ignores nothing
	tests := []struct {
		name string
		rel  string
		want bool
	}{
		{"root not pruned", ".", false},
		{"git top level kept", ".git", false},
		{"git objects pruned", ".git/objects", true},
		{"git refs pruned", ".git/refs", true},
		{"git logs pruned", ".git/logs", true},
		{"normal dir kept", "docs", false},
		{"nested dir kept", "docs/guide", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, shouldPruneDir(tc.rel, matcher))
		})
	}
}

func TestShouldPruneDirHonorsIgnore(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, ".vantageignore"), []byte("node_modules/\n"), 0o644))
	matcher := ignore.GetMatcher(root, true)

	require.True(t, shouldPruneDir("node_modules", matcher), "ignored dir should prune")
	require.False(t, shouldPruneDir("src", matcher), "non-ignored dir should not prune")
}

// --- coalescer / debounce ---

func TestDebounceReady(t *testing.T) {
	base := time.Unix(1000, 0)
	quiet := 100 * time.Millisecond
	cap := time.Second

	tests := []struct {
		name  string
		first time.Time
		last  time.Time
		now   time.Time
		want  bool
	}{
		{"not quiet yet", base, base.Add(50 * time.Millisecond), base.Add(120 * time.Millisecond), false},
		{"quiet elapsed", base, base, base.Add(100 * time.Millisecond), true},
		{"quiet just short", base, base, base.Add(99 * time.Millisecond), false},
		{"cap reached despite activity", base, base.Add(950 * time.Millisecond), base.Add(time.Second), true},
		{"cap just short and active", base, base.Add(950 * time.Millisecond), base.Add(980 * time.Millisecond), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, debounceReady(tc.first, tc.last, tc.now, quiet, cap))
		})
	}
}

// fakeClock drives the coalescer deterministically.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func TestCoalescerCoalescesBurstIntoOneFlush(t *testing.T) {
	var (
		mu      sync.Mutex
		batches [][]string
	)
	co := newCoalescer(100*time.Millisecond, time.Second, func(p []string) {
		mu.Lock()
		batches = append(batches, p)
		mu.Unlock()
	})
	clk := &fakeClock{t: time.Unix(2000, 0)}
	co.now = clk.now

	// Three rapid adds within the quiet window — same logical timestamp.
	co.add("a.md")
	co.add("b.md")
	co.add("a.md") // duplicate collapses

	// Move time past the quiet period and let the real AfterFunc timer fire.
	clk.advance(150 * time.Millisecond)

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(batches) == 1
	}, time.Second, 5*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	got := append([]string(nil), batches[0]...)
	sort.Strings(got)
	require.Equal(t, []string{"a.md", "b.md"}, got, "duplicate paths coalesce")
}

func TestCoalescerMaxWaitForcesFlush(t *testing.T) {
	var (
		mu      sync.Mutex
		flushed bool
	)
	// Tiny quiet, tiny cap so the real timer fires quickly; we keep "activity"
	// alive by re-adding, and assert the cap still forces a flush.
	co := newCoalescer(40*time.Millisecond, 120*time.Millisecond, func(p []string) {
		mu.Lock()
		flushed = true
		mu.Unlock()
	})
	// Steady stream: an add every 20ms keeps resetting the quiet window, but
	// the 120ms cap must still force a flush.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 10; i++ {
			co.add("stream.md")
			time.Sleep(20 * time.Millisecond)
		}
	}()
	<-done

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return flushed
	}, time.Second, 5*time.Millisecond)
}

func TestCoalescerStopDropsPending(t *testing.T) {
	var fired bool
	co := newCoalescer(50*time.Millisecond, time.Second, func([]string) { fired = true })
	co.add("a.md")
	co.stop()
	// add after stop is a no-op.
	co.add("b.md")
	time.Sleep(120 * time.Millisecond)
	require.False(t, fired, "stopped coalescer must not flush")
}

func TestNewWatcherSetsRoot(t *testing.T) {
	root := t.TempDir()
	m := NewManager(quietLogger())
	w, err := NewWatcher(root, "myrepo", m, nil, false, quietLogger())
	require.NoError(t, err)
	require.Equal(t, filepath.Clean(root), w.root)
	require.Equal(t, "myrepo", w.repoName)
}

func TestWatcherFlushBroadcastsSortedPaths(t *testing.T) {
	root := t.TempDir()
	m := NewManager(quietLogger())
	c := m.newTestConn(4)

	w, err := NewWatcher(root, "repoX", m, nil, false, quietLogger())
	require.NoError(t, err)

	w.flush([]string{"z.md", "a.md", "m.md"})

	select {
	case data := <-c.send:
		var msg filesChangedMessage
		require.NoError(t, json.Unmarshal(data, &msg))
		require.Equal(t, "files_changed", msg.Type)
		require.Equal(t, "repoX", msg.Repo)
		require.Equal(t, []string{"a.md", "m.md", "z.md"}, msg.Paths)
	default:
		t.Fatal("flush did not broadcast")
	}
}

func TestWatcherFlushEmptyIsNoop(t *testing.T) {
	root := t.TempDir()
	m := NewManager(quietLogger())
	c := m.newTestConn(1)
	w, err := NewWatcher(root, "", m, nil, false, quietLogger())
	require.NoError(t, err)
	w.flush(nil)
	require.Len(t, c.send, 0)
}
