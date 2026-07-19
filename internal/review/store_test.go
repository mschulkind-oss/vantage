package review

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"testing"

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

// --- SaveFromClient: merging a stale browser PUT -----------------------------
//
// Two writers share one review file. The watcher appends agent reactions
// server-side (ApplyChangelog); the browser holds the whole review in memory
// and PUTs all of it on every edit. A browser payload is therefore always
// potentially stale, and a blind Save would erase reactions it never saw.
// SaveFromClient is the merge that fixes that, so these tests are written from
// the outside: seed the disk, hand a client a copy, let the disk move on,
// then PUT the client's copy and read back what a subsequent GET would return.

const mergeDoc = "doc.md"

// agentTurn and reviewerTurn build the two writers' reactions. Only "agent"
// turns are ever merged back; "reviewer" turns belong to the client.
func agentTurn(kind, summary string, ts float64) model.CommentReaction {
	return model.CommentReaction{Actor: "agent", Kind: kind, Summary: summary, Timestamp: ts}
}

func reviewerTurn(kind, summary string, ts float64) model.CommentReaction {
	return model.CommentReaction{Actor: "reviewer", Kind: kind, Summary: summary, Timestamp: ts}
}

// storedReview seeds a Store with one comment carrying the given reaction
// history, and returns the store.
func storedReview(t *testing.T, id string, reactions ...model.CommentReaction) *Store {
	t.Helper()
	s := NewStore(t.TempDir())
	data := model.NewReviewData(mergeDoc)
	c := model.NewReviewComment(id, "please fix", 1700000000)
	c.Reactions = append(c.Reactions, reactions...)
	data.Comments = append(data.Comments, c)
	require.NoError(t, s.Save(mergeDoc, "", data))
	return s
}

// clientPayload is what a browser PUTs: an independent deep copy of some
// earlier read of the review. Round-tripping through JSON is exactly what the
// real client does, and guarantees the payload shares no memory with the store.
func clientPayload(t *testing.T, from *model.ReviewData) *model.ReviewData {
	t.Helper()
	raw, err := json.Marshal(from)
	require.NoError(t, err)
	var out model.ReviewData
	require.NoError(t, json.Unmarshal(raw, &out))
	return &out
}

// trace renders a comment's reactions as "actor/kind@ts" so an assertion can
// pin both membership and order in one readable expectation.
func trace(c model.ReviewComment) []string {
	out := make([]string, 0, len(c.Reactions))
	for _, r := range c.Reactions {
		out = append(out, fmt.Sprintf("%s/%s@%g", r.Actor, r.Kind, r.Timestamp))
	}
	return out
}

// readComment reads the review back from disk and returns the comment with id.
func readComment(t *testing.T, s *Store, id string) model.ReviewComment {
	t.Helper()
	got, err := s.Get(mergeDoc, "")
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

// A stale PUT must not erase an agent reaction it predates, and the restored
// reaction belongs where it happened — not tacked onto the end.
func TestSaveFromClientRestoresAgentReactionMissedByAStaleClient(t *testing.T) {
	const id = "abcd1234-0000-0000-0000-000000000001"
	// On disk: the agent answered, the reviewer asked for more, the agent
	// answered again.
	s := storedReview(t, id,
		agentTurn("addressed", "fixed the heading", 100),
		reviewerTurn("needs_clarification", "what about the table?", 200),
		agentTurn("addressed", "fixed the table too", 300),
	)

	// The client last read the review before that second agent turn landed, and
	// has since added a reviewer turn of its own.
	stale := model.NewReviewData(mergeDoc)
	c := model.NewReviewComment(id, "please fix", 1700000000)
	c.Reactions = []model.CommentReaction{
		agentTurn("addressed", "fixed the heading", 100),
		reviewerTurn("needs_clarification", "what about the table?", 200),
		reviewerTurn("noted", "thanks", 400),
	}
	stale.Comments = append(stale.Comments, c)

	require.NoError(t, s.SaveFromClient(mergeDoc, "", stale))

	got := readComment(t, s, id)
	require.Equal(t, []string{
		"agent/addressed@100",
		"reviewer/needs_clarification@200",
		"agent/addressed@300", // restored, in the middle where it belongs
		"reviewer/noted@400",
	}, trace(got), "the agent turn the client never saw must survive, in order")
}

// Everything the client sends is the client's to own: its comment text, its
// resolved flag, its edited_at and its reviewer turns all land verbatim, and a
// reviewer turn it just added is neither dropped nor duplicated.
func TestSaveFromClientKeepsTheClientsOwnData(t *testing.T) {
	const id = "abcd1234-0000-0000-0000-000000000001"
	s := storedReview(t, id, agentTurn("addressed", "fixed it", 100))

	stale := model.NewReviewData(mergeDoc)
	c := model.NewReviewComment(id, "please fix the heading, not the title", 1700000000)
	c.EditedAt = 500
	c.Resolved = true
	// The client's copy predates the stored agent turn and carries a brand new
	// reviewer turn.
	c.Reactions = []model.CommentReaction{reviewerTurn("noted", "good enough", 400)}
	stale.Comments = append(stale.Comments, c)

	require.NoError(t, s.SaveFromClient(mergeDoc, "", stale))

	got := readComment(t, s, id)
	require.Equal(t, "please fix the heading, not the title", got.Comment)
	require.True(t, got.Resolved)
	require.Equal(t, float64(500), got.EditedAt)
	require.Equal(t, []string{
		"agent/addressed@100",
		"reviewer/noted@400",
	}, trace(got), "the client's reviewer turn survives exactly once, and the agent turn is restored")
}

// The mirror image: a reviewer turn that exists only on disk is NOT merged
// back. Only agent reactions are restored — the client is authoritative for its
// own turns, so a turn it dropped stays dropped.
func TestSaveFromClientDoesNotRestoreReviewerTurns(t *testing.T) {
	const id = "abcd1234-0000-0000-0000-000000000001"
	s := storedReview(t, id,
		agentTurn("addressed", "fixed it", 100),
		reviewerTurn("noted", "thanks", 200),
	)

	stale := model.NewReviewData(mergeDoc)
	c := model.NewReviewComment(id, "please fix", 1700000000)
	c.Reactions = []model.CommentReaction{}
	stale.Comments = append(stale.Comments, c)

	require.NoError(t, s.SaveFromClient(mergeDoc, "", stale))

	require.Equal(t, []string{"agent/addressed@100"}, trace(readComment(t, s, id)))
}

// Deleting a comment is a real intent, not staleness: a comment the client
// omitted must stay gone, and its agent reactions must not be resurrected onto
// anything else.
func TestSaveFromClientKeepsOmittedCommentsDeleted(t *testing.T) {
	const keep = "abcd1234-0000-0000-0000-000000000001"
	const drop = "beef5678-0000-0000-0000-000000000002"

	s := NewStore(t.TempDir())
	seed := model.NewReviewData(mergeDoc)
	kept := model.NewReviewComment(keep, "please fix", 1700000000)
	kept.Reactions = []model.CommentReaction{agentTurn("addressed", "fixed it", 100)}
	dropped := model.NewReviewComment(drop, "and this too", 1700000001)
	dropped.Reactions = []model.CommentReaction{agentTurn("wont_fix", "out of scope", 150)}
	seed.Comments = append(seed.Comments, kept, dropped)
	require.NoError(t, s.Save(mergeDoc, "", seed))

	// The reviewer deleted the second comment, so the client PUTs only the
	// first — and its copy of that one predates the agent's reaction.
	payload := model.NewReviewData(mergeDoc)
	survivor := model.NewReviewComment(keep, "please fix", 1700000000)
	survivor.Reactions = []model.CommentReaction{}
	payload.Comments = append(payload.Comments, survivor)

	require.NoError(t, s.SaveFromClient(mergeDoc, "", payload))

	got, err := s.Get(mergeDoc, "")
	require.NoError(t, err)
	require.Len(t, got.Comments, 1, "the deleted comment must not come back")
	require.Equal(t, keep, got.Comments[0].ID)
	require.Equal(t, []string{"agent/addressed@100"}, trace(got.Comments[0]),
		"the deleted comment's reaction must not migrate onto the survivor")
}

// Re-PUTting the same stale payload — the browser saves on every keystroke-ish
// edit — must converge, not accumulate copies of the merged-back reaction.
func TestSaveFromClientIsIdempotent(t *testing.T) {
	const id = "abcd1234-0000-0000-0000-000000000001"
	s := storedReview(t, id, agentTurn("addressed", "fixed it", 100))

	stale := model.NewReviewData(mergeDoc)
	c := model.NewReviewComment(id, "please fix", 1700000000)
	c.Reactions = []model.CommentReaction{reviewerTurn("noted", "thanks", 200)}
	stale.Comments = append(stale.Comments, c)

	// Fresh decode each time: the client keeps PUTting the copy it holds, which
	// still does not contain the agent turn.
	require.NoError(t, s.SaveFromClient(mergeDoc, "", clientPayload(t, stale)))
	first := trace(readComment(t, s, id))

	require.NoError(t, s.SaveFromClient(mergeDoc, "", clientPayload(t, stale)))
	second := trace(readComment(t, s, id))

	require.Equal(t, []string{"agent/addressed@100", "reviewer/noted@200"}, first)
	require.Equal(t, first, second, "a repeated PUT must not duplicate the merged-back reaction")
}

// An empty store is not a merge failure: the client's write must still land.
func TestSaveFromClientWithNothingStoredSavesAsIs(t *testing.T) {
	const id = "abcd1234-0000-0000-0000-000000000001"
	s := NewStore(t.TempDir())

	data := model.NewReviewData(mergeDoc)
	data.Comments = append(data.Comments, model.NewReviewComment(id, "first comment", 1700000000))
	require.NoError(t, s.SaveFromClient(mergeDoc, "", data))

	require.Equal(t, "first comment", readComment(t, s, id).Comment)
}

// --- Per-file locking --------------------------------------------------------

// The load-bearing concurrency property: the watcher and the browser hammer the
// same review file at once, every browser PUT carrying a snapshot taken before
// any agent reaction existed. Not one agent reaction may be lost, and no reader
// may ever observe a half-written file.
//
// Run with -race.
func TestApplyChangelogAndSaveFromClientConcurrentlyLoseNoAgentReactions(t *testing.T) {
	ResetCacheForTests()
	const id = "abcd1234-0000-0000-0000-000000000001"

	s := NewStore(t.TempDir())
	seed := model.NewReviewData(mergeDoc)
	seed.Comments = append(seed.Comments, model.NewReviewComment(id, "please fix", 1700000000))
	require.NoError(t, s.Save(mergeDoc, "", seed))

	// Every writer goroutine PUTs from this one stale snapshot: zero reactions.
	// A blind Save from it would wipe whatever the watcher had written.
	staleJSON, err := json.Marshal(seed)
	require.NoError(t, err)

	const rounds = 40
	var (
		writers  sync.WaitGroup
		reader   sync.WaitGroup
		written  int64
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
		p := s.reviewFile(mergeDoc, "")
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
		summary := fmt.Sprintf("change %02d", i)

		writers.Add(1)
		go func() {
			defer writers.Done()
			content := "<!-- changelog -->" + nl + "- [abcd1234] " + summary
			atomic.AddInt64(&written, int64(s.ApplyChangelog(mergeDoc, content, "")))
		}()

		writers.Add(1)
		go func() {
			defer writers.Done()
			var payload model.ReviewData
			if err := json.Unmarshal(staleJSON, &payload); err != nil {
				fail("decode stale payload: %v", err)
				return
			}
			if err := s.SaveFromClient(mergeDoc, "", &payload); err != nil {
				fail("SaveFromClient: %v", err)
			}
		}()
	}

	writers.Wait()
	close(stop)
	reader.Wait()

	mu.Lock()
	require.Empty(t, failures)
	mu.Unlock()

	// Each summary is unique, so a correct run writes each exactly once. A
	// higher count would mean a reaction was lost and then re-written by a
	// later apply.
	require.Equal(t, int64(rounds), atomic.LoadInt64(&written),
		"every changelog bullet should be written exactly once")

	got := readComment(t, s, id)
	require.Len(t, got.Reactions, rounds, "no agent reaction may be lost, and none duplicated")

	summaries := make([]string, 0, len(got.Reactions))
	for _, r := range got.Reactions {
		require.Equal(t, "agent", r.Actor)
		summaries = append(summaries, r.Summary)
	}
	sort.Strings(summaries)
	want := make([]string, 0, rounds)
	for i := 0; i < rounds; i++ {
		want = append(want, fmt.Sprintf("change %02d", i))
	}
	require.Equal(t, want, summaries)
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
			data := model.NewReviewData(mergeDoc)
			c := model.NewReviewComment(id, "please fix", 1700000000)
			c.Reactions = []model.CommentReaction{agentTurn("addressed", "fixed it", 100)}
			data.Comments = append(data.Comments, c)
			if err := s.Save(mergeDoc, "", data); err != nil {
				mu.Lock()
				failures = append(failures, err.Error())
				mu.Unlock()
			}
		}()
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := s.Get(mergeDoc, "")
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

func TestDefaultStoreUsesLiteralPath(t *testing.T) {
	s := DefaultStore()
	// The default must be the literal ~/.local/share/vantage/reviews, not an
	// XDG-resolved path — that is an on-disk upgrade contract.
	require.True(t, filepath.IsAbs(s.Dir()) || s.Dir() == filepath.Join(".local", "share", "vantage", "reviews"))
	require.Contains(t, s.Dir(), filepath.Join(".local", "share", "vantage", "reviews"))
}
