package live

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/ignore"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/review"
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
		{"vantage top level kept", ".vantage", false},
		{"vantage inbox kept", ".vantage/inbox", false},
		{"vantage other pruned", ".vantage/reviews", true},
		{"vantage inbox subdir pruned", ".vantage/inbox/sub", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, shouldPruneDir(tc.rel, matcher))
		})
	}
}

func TestIsInboxPath(t *testing.T) {
	tests := []struct {
		rel  string
		want bool
	}{
		{".vantage/inbox", true},
		{".vantage/inbox/a.jsonl", true},
		{".vantage/inbox/a.jsonl.consuming", true},
		{".vantage", false},
		{".vantage/reviews", false},
		{".vantage/inboxes", false},
		{"docs/a.md", false},
	}
	for _, tc := range tests {
		require.Equal(t, tc.want, isInboxPath(tc.rel), "rel=%q", tc.rel)
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

// --- stale-payload warning (retired changelog protocol) ---

// drainMessages empties the test connection's buffered sends and returns the
// decoded messages.
func drainMessages(t *testing.T, c *conn) []map[string]any {
	t.Helper()
	var out []map[string]any
	for {
		select {
		case data := <-c.send:
			var msg map[string]any
			require.NoError(t, json.Unmarshal(data, &msg))
			out = append(out, msg)
		default:
			return out
		}
	}
}

// A saved document that still carries a "<!-- changelog -->" block means an
// agent followed a stale clipboard payload: its response went nowhere. The
// watcher must warn — one changelog_ignored broadcast for the document — and
// must NOT touch the review (the retired protocol is never applied).
func TestWatcherFlushWarnsOnChangelogBlockAndDoesNotMutateReview(t *testing.T) {
	root := t.TempDir()
	store := review.NewStore(t.TempDir())
	seedReviewedDoc(t, store, root, "repoX", "docs/a.md", "c1a2b3c4deadbeef")

	// The agent "responded" the retired way: a changelog block in the document,
	// with a bullet that would have resolved to the seeded comment.
	stale := testDoc + "\n<!-- changelog -->\n- [c1a2b3c4] pretended to fix it\n"
	require.NoError(t, os.WriteFile(
		filepath.Join(root, "docs", "a.md"), []byte(stale), 0o644))

	m := NewManager(quietLogger())
	c := m.newTestConn(8)
	w, err := NewWatcher(root, "repoX", m, store, false, quietLogger())
	require.NoError(t, err)

	w.flush([]string{"docs/a.md"})

	msgs := drainMessages(t, c)
	var ignored []map[string]any
	for _, msg := range msgs {
		if msg["type"] == "changelog_ignored" {
			ignored = append(ignored, msg)
		}
	}
	require.Len(t, ignored, 1, "exactly one changelog_ignored per save")
	require.Equal(t, "repoX", ignored[0]["repo"])
	require.Equal(t, "docs/a.md", ignored[0]["path"])

	// The bullet was NOT applied: the review is untouched.
	data, err := store.Get("docs/a.md", "repoX")
	require.NoError(t, err)
	require.Len(t, data.Comments, 1)
	require.Empty(t, data.Comments[0].Reactions,
		"the retired protocol must never record a reaction")
}

// The common case stays quiet: a document without a marker triggers no
// changelog_ignored broadcast.
func TestWatcherFlushNoWarningWithoutChangelogBlock(t *testing.T) {
	root := t.TempDir()
	store := review.NewStore(t.TempDir())
	seedReviewedDoc(t, store, root, "", "a.md", "c1a2b3c4deadbeef")

	m := NewManager(quietLogger())
	c := m.newTestConn(8)
	w, err := NewWatcher(root, "", m, store, false, quietLogger())
	require.NoError(t, err)

	w.flush([]string{"a.md"})

	for _, msg := range drainMessages(t, c) {
		require.NotEqual(t, "changelog_ignored", msg["type"])
	}
}

// --- inbox consumption ---

// seedReviewedDoc writes doc content at rel under root and stores a review for
// it (in repo) with one comment anchored at line 3 of testDoc.
const testDoc = "# Title\n\nBody paragraph text.\n"

func seedReviewedDoc(t *testing.T, store *review.Store, root, repo, rel, commentID string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
	require.NoError(t, os.WriteFile(full, []byte(testDoc), 0o644))
	c := model.NewReviewComment(commentID, "tighten this", 1700000000)
	c.Anchor = &model.CommentAnchor{SourceLine: 3}
	_, err := store.AddComment(rel, repo, c, testDoc)
	require.NoError(t, err)
}

// startWatcher runs w.Start in a goroutine and returns a stop func that
// cancels it and waits for exit.
func startWatcher(t *testing.T, w *Watcher) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = w.Start(ctx)
	}()
	return func() {
		cancel()
		<-done
	}
}

// waitForMessage drains c.send until a message with the wanted type arrives.
func waitForMessage(t *testing.T, c *conn, wantType string) map[string]any {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case data := <-c.send:
			var msg map[string]any
			require.NoError(t, json.Unmarshal(data, &msg))
			if msg["type"] == wantType {
				return msg
			}
		case <-deadline:
			t.Fatalf("no %q message arrived", wantType)
		}
	}
}

func TestWatcherStartConsumesInboxAndBroadcasts(t *testing.T) {
	root := t.TempDir()
	store := review.NewStore(t.TempDir())
	seedReviewedDoc(t, store, root, "repoX", "docs/a.md", "c1a2b3c4deadbeef")

	// A delivery that landed while the server was down.
	inbox := review.InboxDir(root)
	require.NoError(t, os.MkdirAll(inbox, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(inbox, "docs__a.md.jsonl"),
		[]byte(`{"path":"docs/a.md","id":"c1a2b3c4","summary":"done","nonce":"n1"}`+"\n"), 0o644))

	m := NewManager(quietLogger())
	c := m.newTestConn(8)
	w, err := NewWatcher(root, "repoX", m, store, false, quietLogger())
	require.NoError(t, err)
	stop := startWatcher(t, w)
	defer stop()

	msg := waitForMessage(t, c, "review_changed")
	require.Equal(t, "repoX", msg["repo"])
	require.Equal(t, "docs/a.md", msg["path"])

	data, err := store.Get("docs/a.md", "repoX")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Equal(t, "done", data.Comments[0].Reactions[0].Summary)
}

func TestWatcherConsumesInboxFileEvent(t *testing.T) {
	// The inbox dir already exists at startup (so no dir-create event will
	// ever fire); a delivery written later must be consumed purely off its own
	// file event.
	root := t.TempDir()
	store := review.NewStore(t.TempDir())
	seedReviewedDoc(t, store, root, "", "a.md", "c1a2b3c4deadbeef")
	inbox := review.InboxDir(root)
	require.NoError(t, os.MkdirAll(inbox, 0o755))

	m := NewManager(quietLogger())
	c := m.newTestConn(16)
	w, err := NewWatcher(root, "", m, store, false, quietLogger())
	require.NoError(t, err)
	stop := startWatcher(t, w)
	defer stop()

	// Wait for a probe round-trip first: it proves the event loop is running,
	// which also means the startup inbox sweep has already come up empty — so
	// the delivery below can only land via its own file event.
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

	require.NoError(t, os.WriteFile(filepath.Join(inbox, "a.md.jsonl"),
		[]byte(`{"path":"a.md","id":"c1a2b3c4","summary":"fixed","nonce":"n1"}`+"\n"), 0o644))
	msg := waitForMessage(t, c, "review_changed")
	require.Equal(t, "a.md", msg["path"])

	data, err := store.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)
}

func TestWatcherConsumesInboxCreatedAfterStartup(t *testing.T) {
	root := t.TempDir()
	store := review.NewStore(t.TempDir())
	seedReviewedDoc(t, store, root, "", "a.md", "c1a2b3c4deadbeef")

	m := NewManager(quietLogger())
	c := m.newTestConn(16)
	w, err := NewWatcher(root, "", m, store, false, quietLogger())
	require.NoError(t, err)
	stop := startWatcher(t, w)
	defer stop()

	// Prove the event loop is live before creating the inbox, otherwise the
	// mkdir below could race the initial watch registration. The probe itself
	// races it, so keep touching the file until an event round-trips.
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

	// The .vantage/inbox dir did not exist at startup; its creation plus a
	// delivery must still be seen and consumed.
	inbox := review.InboxDir(root)
	require.NoError(t, os.MkdirAll(inbox, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(inbox, "a.md.jsonl"),
		[]byte(`{"path":"a.md","id":"c1a2b3c4","summary":"fixed","nonce":"n1"}`+"\n"), 0o644))

	msg := waitForMessage(t, c, "review_changed")
	require.Equal(t, "", msg["repo"])
	require.Equal(t, "a.md", msg["path"])

	data, err := store.Get("a.md", "")
	require.NoError(t, err)
	require.Len(t, data.Comments[0].Reactions, 1)

	// The consumed delivery file is gone.
	require.Eventually(t, func() bool {
		ents, err := os.ReadDir(inbox)
		return err == nil && len(ents) == 0
	}, 3*time.Second, 10*time.Millisecond)
}

// A document that merely discusses the retired protocol — this project's own
// design docs among them — is not a delivery attempt. Without the review gate
// every save of such a file nagged the reviewer about a response nobody sent.
func TestWatcherFlushDoesNotWarnForDocumentWithoutAReview(t *testing.T) {
	root := t.TempDir()
	store := review.NewStore(t.TempDir())
	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs"), 0o755))

	// Same content that warns when the document is under review — but nobody
	// has commented on this one.
	stale := testDoc + "\n<!-- changelog -->\n- [c1a2b3c4] a documented example\n"
	require.NoError(t, os.WriteFile(
		filepath.Join(root, "docs", "a.md"), []byte(stale), 0o644))

	m := NewManager(quietLogger())
	c := m.newTestConn(8)
	w, err := NewWatcher(root, "repoX", m, store, false, quietLogger())
	require.NoError(t, err)

	w.flush([]string{"docs/a.md"})

	for _, msg := range drainMessages(t, c) {
		require.NotEqual(t, "changelog_ignored", msg["type"],
			"a document with no review must not warn about the retired protocol")
	}
}
