package review

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

func TestReviewFileFlattening(t *testing.T) {
	s := NewStore("/base")
	cases := []struct {
		name     string
		path     string
		repo     string
		wantBase string
	}{
		{"simple", "notes.md", "", "notes.md.json"},
		{"nested", "docs/design/spec.md", "", "docs__design__spec.md.json"},
		{"with-repo", "docs/spec.md", "myrepo", "myrepo__docs__spec.md.json"},
		{"backslashes", `docs\win\spec.md`, "", "docs__win__spec.md.json"},
		{"mixed-separators", `a/b\c.md`, "r", "r__a__b__c.md.json"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := s.reviewFile(tc.path, tc.repo)
			require.Equal(t, filepath.Join("/base", tc.wantBase), got)
		})
	}
}

func TestGetMissingFileReturnsNil(t *testing.T) {
	s := NewStore(t.TempDir())
	got, err := s.Get("does-not-exist.md", "")
	require.NoError(t, err)
	require.Nil(t, got)
}

func TestGetCorruptFileReturnsNil(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	// Write a file whose name matches reviewFile but with invalid JSON.
	p := s.reviewFile("broken.md", "")
	require.NoError(t, os.WriteFile(p, []byte("{not valid json"), 0o644))

	got, err := s.Get("broken.md", "")
	require.NoError(t, err)
	require.Nil(t, got, "a corrupt file must read as absent")
}

func TestSaveThenGetRoundTrips(t *testing.T) {
	s := NewStore(t.TempDir())
	data := model.NewReviewData("a/b.md")
	data.Comments = append(data.Comments, model.NewReviewComment("id-123", "looks good", 1700000000.5))

	require.NoError(t, s.Save("a/b.md", "", data))

	got, err := s.Get("a/b.md", "")
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Equal(t, "a/b.md", got.FilePath)
	require.Len(t, got.Comments, 1)
	require.Equal(t, "id-123", got.Comments[0].ID)
	require.Equal(t, 1700000000.5, got.Comments[0].CreatedAt)
}

// EditedAt persistence: the frontend's "an edit re-queues the comment for the
// agent" rule compares edited_at against the agent's last response time, so the
// field is worthless unless it survives the store's JSON round trip.
func TestEditedAtRoundTrips(t *testing.T) {
	s := NewStore(t.TempDir())
	data := model.NewReviewData("doc.md")

	edited := model.NewReviewComment("edited-1", "please fix (reworded)", 1700000000)
	edited.EditedAt = 1700000500.5
	untouched := model.NewReviewComment("untouched-1", "please fix", 1700000000)
	data.Comments = append(data.Comments, edited, untouched)

	require.NoError(t, s.Save("doc.md", "", data))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.Len(t, got.Comments, 2)
	require.Equal(t, 1700000500.5, got.Comments[0].EditedAt)
	require.Zero(t, got.Comments[1].EditedAt)

	// A never-edited comment must not emit the key at all, so existing review
	// files stay byte-identical after a rewrite.
	raw, err := os.ReadFile(s.reviewFile("doc.md", ""))
	require.NoError(t, err)
	var probe struct {
		Comments []map[string]any `json:"comments"`
	}
	require.NoError(t, json.Unmarshal(raw, &probe))
	require.Len(t, probe.Comments, 2)
	require.Contains(t, probe.Comments[0], "edited_at")
	require.NotContains(t, probe.Comments[1], "edited_at")
	require.Equal(t, 1, strings.Count(string(raw), `"edited_at"`),
		"only the edited comment may carry the key in the file bytes")
}

// A legacy review file carrying snapshots must still parse, and the snapshots
// must survive a read-modify-write cycle (the field is deprecated, not
// destroyed).
func TestLegacyFileWithSnapshotsRoundTrips(t *testing.T) {
	s := NewStore(t.TempDir())
	legacy := `{
  "file_path": "doc.md",
  "snapshots": [{"id": "s1", "content": "old body", "timestamp": 1700000000}],
  "comments": []
}`
	require.NoError(t, os.MkdirAll(s.Dir(), 0o755))
	require.NoError(t, os.WriteFile(s.reviewFile("doc.md", ""), []byte(legacy), 0o644))

	got, err := s.Get("doc.md", "")
	require.NoError(t, err)
	require.NotNil(t, got, "a legacy file with snapshots must still parse")

	// A rewrite keeps the legacy data intact. Asserted on the file bytes so
	// the test never touches the deprecated field itself.
	require.NoError(t, s.Save("doc.md", "", got))
	raw, err := os.ReadFile(s.reviewFile("doc.md", ""))
	require.NoError(t, err)
	require.Contains(t, string(raw), `"snapshots"`)
	require.Contains(t, string(raw), `"old body"`)
}

func TestSaveIsAtomicNoTempLeftBehind(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	require.NoError(t, s.Save("x.md", "", model.NewReviewData("x.md")))

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, e := range entries {
		require.NotContains(t, e.Name(), ".tmp", "no temp file should survive a successful save")
	}
	require.FileExists(t, s.reviewFile("x.md", ""))
}

func TestSaveCreatesBaseDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "reviews")
	s := NewStore(dir)
	require.NoError(t, s.Save("x.md", "", model.NewReviewData("x.md")))
	require.DirExists(t, dir)
}

func TestDelete(t *testing.T) {
	s := NewStore(t.TempDir())

	deleted, err := s.Delete("absent.md", "")
	require.NoError(t, err)
	require.False(t, deleted, "deleting a missing review reports false")

	require.NoError(t, s.Save("present.md", "", model.NewReviewData("present.md")))
	deleted, err = s.Delete("present.md", "")
	require.NoError(t, err)
	require.True(t, deleted)

	got, err := s.Get("present.md", "")
	require.NoError(t, err)
	require.Nil(t, got)
}

// --- Concurrency: inbox deliveries vs browser commands -----------------------
//
// Two writers share one review file. The watcher's inbox consumer applies
// agent deliveries (ConsumeInbox → ApplyResponses) while browser-driven
// commands (Reply, SetResolved, …) read-modify-write the same file. The
// per-file lock is what keeps their steps from interleaving; these tests are
// written from the outside: hammer both doors at once, then read back what a
// subsequent Get returns.

const raceDoc = "doc.md"

// agentTurn builds an agent reaction for fixtures.
func agentTurn(kind, summary string, ts float64) model.CommentReaction {
	return model.CommentReaction{Actor: "agent", Kind: kind, Summary: summary, Timestamp: ts}
}

// readComment reads the review back from disk and returns the comment with id.
func readComment(t *testing.T, s *Store, id string) model.ReviewComment {
	t.Helper()
	got, err := s.Get(raceDoc, "")
	require.NoError(t, err)
	require.NotNil(t, got)
	for _, c := range got.Comments {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("comment %q is not in the stored review", id)
	return model.ReviewComment{}
}

// reactionSummaries splits a comment's reactions by actor, sorted, so an
// assertion can pin exactly-once delivery for both writers at once.
func reactionSummaries(c model.ReviewComment) (agent, reviewer []string) {
	for _, r := range c.Reactions {
		switch r.Actor {
		case "agent":
			agent = append(agent, r.Summary)
		case "reviewer":
			reviewer = append(reviewer, r.Summary)
		}
	}
	sort.Strings(agent)
	sort.Strings(reviewer)
	return agent, reviewer
}

// The load-bearing concurrency property: the watcher's inbox consumer and
// browser commands hammer the same review file at once. Not one turn — agent
// delivery or reviewer command — may be lost or duplicated, and no reader may
// ever observe a half-written file. Nonce dedup must also hold under
// concurrent ConsumeInbox passes racing over the same delivery files.
//
// Run with -race.
func TestConsumeInboxAndCommandsConcurrentlyLoseNoTurns(t *testing.T) {
	const id = "abcd1234-0000-0000-0000-000000000001"

	root := t.TempDir()
	inbox := InboxDir(root)
	require.NoError(t, os.MkdirAll(inbox, 0o755))

	s := NewStore(t.TempDir())
	seed := model.NewReviewData(raceDoc)
	seed.Comments = append(seed.Comments, model.NewReviewComment(id, "please fix", 1700000000))
	require.NoError(t, s.Save(raceDoc, "", seed))

	const rounds = 40
	var (
		writers  sync.WaitGroup
		reader   sync.WaitGroup
		mu       sync.Mutex
		failures []string
	)
	fail := func(format string, args ...any) {
		mu.Lock()
		defer mu.Unlock()
		failures = append(failures, fmt.Sprintf(format, args...))
	}

	// A reader that bypasses the store's lock entirely, to catch a torn write:
	// the atomic tmp+rename means every byte sequence ever visible at that path
	// is a whole record.
	stop := make(chan struct{})
	reader.Add(1)
	go func() {
		defer reader.Done()
		p := s.reviewFile(raceDoc, "")
		for {
			select {
			case <-stop:
				return
			default:
			}
			raw, err := os.ReadFile(p)
			if err != nil {
				fail("raw read failed: %v", err)
				return
			}
			var probe model.ReviewData
			if err := json.Unmarshal(raw, &probe); err != nil {
				fail("observed a half-written review file: %v", err)
				return
			}
			if len(probe.Comments) != 1 {
				fail("observed %d comments, want 1", len(probe.Comments))
				return
			}
		}
	}()

	for i := 0; i < rounds; i++ {
		i := i

		// Agent door: drop one delivery file (unique summary + nonce), then run
		// a consume pass. Passes race over each other's files; at-least-once
		// consumption plus nonce dedup must still land each delivery exactly
		// once.
		writers.Add(1)
		go func() {
			defer writers.Done()
			line := fmt.Sprintf(
				`{"path":%q,"id":"abcd1234","summary":"agent change %02d","nonce":"nonce-%02d"}`+"\n",
				raceDoc, i, i)
			name := filepath.Join(inbox, fmt.Sprintf("delivery-%02d.jsonl", i))
			if err := os.WriteFile(name, []byte(line), 0o644); err != nil {
				fail("write delivery: %v", err)
				return
			}
			s.ConsumeInbox(root, "")
		}()

		// Browser door: a reviewer follow-up through the command path.
		writers.Add(1)
		go func() {
			defer writers.Done()
			if _, err := s.Reply(raceDoc, "", id, fmt.Sprintf("reviewer note %02d", i), ""); err != nil {
				fail("Reply: %v", err)
			}
		}()
	}

	writers.Wait()
	close(stop)
	reader.Wait()

	mu.Lock()
	require.Empty(t, failures)
	mu.Unlock()

	// Every delivery file was consumed and deleted.
	ents, err := os.ReadDir(inbox)
	require.NoError(t, err)
	require.Empty(t, ents, "every delivery must be consumed and deleted")

	got := readComment(t, s, id)
	agent, reviewer := reactionSummaries(got)

	wantAgent := make([]string, 0, rounds)
	wantReviewer := make([]string, 0, rounds)
	for i := 0; i < rounds; i++ {
		wantAgent = append(wantAgent, fmt.Sprintf("agent change %02d", i))
		wantReviewer = append(wantReviewer, fmt.Sprintf("reviewer note %02d", i))
	}
	require.Equal(t, wantAgent, agent, "no agent delivery may be lost or duplicated")
	require.Equal(t, wantReviewer, reviewer, "no reviewer command may be lost or duplicated")
}

// Concurrent plain Save/Get on the same file must also stay serialized: a Get
// never returns a partial record, and the last write wins intact.
func TestConcurrentSaveAndGetNeverTearsARecord(t *testing.T) {
	s := NewStore(t.TempDir())
	const id = "abcd1234-0000-0000-0000-000000000001"

	var wg sync.WaitGroup
	var mu sync.Mutex
	var failures []string

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			data := model.NewReviewData(raceDoc)
			c := model.NewReviewComment(id, "please fix", 1700000000)
			c.Reactions = []model.CommentReaction{agentTurn("addressed", "fixed it", 100)}
			data.Comments = append(data.Comments, c)
			if err := s.Save(raceDoc, "", data); err != nil {
				mu.Lock()
				failures = append(failures, err.Error())
				mu.Unlock()
			}
		}()
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := s.Get(raceDoc, "")
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failures = append(failures, err.Error())
				return
			}
			// nil means "not written yet"; anything else must be whole.
			if got != nil && (len(got.Comments) != 1 || len(got.Comments[0].Reactions) != 1) {
				failures = append(failures, "observed a partial review record")
			}
		}()
	}
	wg.Wait()

	require.Empty(t, failures)

	// No temp files survive a storm of concurrent saves.
	entries, err := os.ReadDir(s.Dir())
	require.NoError(t, err)
	for _, e := range entries {
		require.NotContains(t, e.Name(), ".tmp")
	}
}

// --- Sharded locking ---------------------------------------------------------
//
// The per-file mutexes are a fixed array indexed by a hash of the review file
// path, so two unrelated documents can share one mutex. That is safe only if
// sharing costs nothing but throughput: each file must still be serialized
// exactly as before, the two must not interfere, and sharing a mutex must not
// deadlock. These tests probe the real lock rather than recomputing the hash,
// so they cannot drift from however the sharding is implemented.

// sharesLockShard reports whether the store lock for path b is blocked while the
// lock for path a is held — i.e. whether the two paths land on one shard.
func sharesLockShard(s *Store, a, b string) bool {
	releaseA := s.lock(a, "")
	acquired := make(chan func(), 1)
	go func() { acquired <- s.lock(b, "") }()

	select {
	case releaseB := <-acquired:
		releaseB()
		releaseA()
		return false
	case <-time.After(100 * time.Millisecond):
		// Still blocked, so b waits on the mutex a holds. Let it through.
		releaseA()
		(<-acquired)()
		return true
	}
}

// collidingReviewPaths finds two distinct document paths that share a lock
// shard. With a fixed shard count one always exists; the search is bounded so a
// broken lock (one that never blocks) fails loudly instead of hanging.
func collidingReviewPaths(t *testing.T, s *Store) (string, string) {
	t.Helper()
	const first = "shard-0000.md"
	for i := 1; i < 1024; i++ {
		other := fmt.Sprintf("shard-%04d.md", i)
		if sharesLockShard(s, first, other) {
			return first, other
		}
	}
	t.Fatalf("no path shared a lock shard with %q", first)
	return "", ""
}

// hammerOneFile runs the delivery-vs-command workload against one review file:
// `rounds` ApplyResponses batches — each one entry with a unique summary and
// nonce, the store-level door ConsumeInbox drives — interleaved with the same
// number of Reply commands. It returns how many reactions ApplyResponses
// reports applying, plus any error the goroutines hit (assertions belong to
// the caller's goroutine).
func hammerOneFile(s *Store, doc, id, tag string, rounds int) (int64, []string) {
	seed := model.NewReviewData(doc)
	seed.Comments = append(seed.Comments, model.NewReviewComment(id, "please fix", 1700000000))
	if err := s.Save(doc, "", seed); err != nil {
		return 0, []string{"seed save: " + err.Error()}
	}

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		failures []string
		written  int64
	)
	fail := func(format string, args ...any) {
		mu.Lock()
		defer mu.Unlock()
		failures = append(failures, fmt.Sprintf(format, args...))
	}

	for i := 0; i < rounds; i++ {
		summary := fmt.Sprintf("%s change %02d", tag, i)
		reply := fmt.Sprintf("%s reviewer %02d", tag, i)
		nonce := fmt.Sprintf("%s-nonce-%02d", tag, i)

		wg.Add(1)
		go func() {
			defer wg.Done()
			entries := []ResponseEntry{{ShortID: id[:8], Summary: summary, Nonce: nonce}}
			_, n, err := s.ApplyResponses(doc, "", entries, "")
			if err != nil {
				fail("ApplyResponses: %v", err)
				return
			}
			atomic.AddInt64(&written, int64(n))
		}()

		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Reply(doc, "", id, reply, ""); err != nil {
				fail("Reply: %v", err)
			}
		}()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	return atomic.LoadInt64(&written), failures
}

// Two documents that share a lock shard, each under the full
// delivery-vs-command storm at the same time. Every reaction in BOTH files
// must survive: a shard is allowed to over-serialize, never to
// under-serialize. Cross-file contamination and deadlock (the test would time
// out) are ruled out too.
//
// Run with -race.
func TestShardedLockSerializesEachFileWhenTwoFilesShareAShard(t *testing.T) {
	s := NewStore(t.TempDir())

	docA, docB := collidingReviewPaths(t, s)
	require.NotEqual(t, docA, docB)

	const idA = "aaaa1111-0000-0000-0000-000000000001"
	const idB = "bbbb2222-0000-0000-0000-000000000002"
	const rounds = 40

	type result struct {
		written  int64
		failures []string
	}
	var (
		wg  sync.WaitGroup
		res [2]result
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		w, f := hammerOneFile(s, docA, idA, "A", rounds)
		res[0] = result{w, f}
	}()
	go func() {
		defer wg.Done()
		w, f := hammerOneFile(s, docB, idB, "B", rounds)
		res[1] = result{w, f}
	}()
	wg.Wait()

	for i, doc := range []string{docA, docB} {
		tag := []string{"A", "B"}[i]
		require.Empty(t, res[i].failures, "%s", doc)
		// Each entry carries a unique nonce, so a correct run applies it exactly
		// once. More would mean a reaction was lost and re-written by a later
		// apply.
		require.Equal(t, int64(rounds), res[i].written,
			"%s: every delivery should be applied exactly once", doc)

		got, err := s.Get(doc, "")
		require.NoError(t, err)
		require.Len(t, got.Comments, 1, "%s", doc)

		agent, reviewer := reactionSummaries(got.Comments[0])

		wantAgent := make([]string, 0, rounds)
		wantReviewer := make([]string, 0, rounds)
		for j := 0; j < rounds; j++ {
			wantAgent = append(wantAgent, fmt.Sprintf("%s change %02d", tag, j))
			wantReviewer = append(wantReviewer, fmt.Sprintf("%s reviewer %02d", tag, j))
		}
		require.Equal(t, wantAgent, agent,
			"%s: no agent delivery may be lost, duplicated, or leak in from the file sharing its shard", doc)
		require.Equal(t, wantReviewer, reviewer,
			"%s: no reviewer command may be lost, duplicated, or leak in from the file sharing its shard", doc)
	}
}

func TestDefaultStoreUsesLiteralPath(t *testing.T) {
	s := DefaultStore()
	// The default must be the literal ~/.local/share/vantage/reviews, not an
	// XDG-resolved path — that is an on-disk upgrade contract.
	require.True(t, filepath.IsAbs(s.Dir()) || s.Dir() == filepath.Join(".local", "share", "vantage", "reviews"))
	require.Contains(t, s.Dir(), filepath.Join(".local", "share", "vantage", "reviews"))
}
