package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/review"
	"github.com/stretchr/testify/require"
)

// replaced is planDoc after the agent rewrote OQ-1 as a different question that
// took its slot: same neighbours, same place, most of the same words.
func replaced() string {
	d := replaceOnce(planDoc, "OQ-1: Cache the index?", "OQ-9: Cache the whole index?")
	d = replaceOnce(d, "id=OQ-1", "id=OQ-9")
	return replaceOnce(d, "Alpha text about caching layers.", "Alpha text about caching layers today.")
}

func replaceOnce(s, old, repl string) string {
	i := indexOf(s, old)
	if i < 0 {
		panic("missing " + old)
	}
	return s[:i] + repl + s[i+len(old):]
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func (e *cmdEnv) reply(t *testing.T, id, replyID string) model.ReviewComment {
	t.Helper()
	w := e.doID(e.h.ReviewCommentReply, http.MethodPost, "/review/comments/"+id+"/replies?path=a.md",
		`{"id":"`+replyID+`","text":"still unclear"}`, id)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var data model.ReviewData
	decode(t, w, &data)
	for _, c := range data.Comments {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("comment %s missing", id)
	return model.ReviewComment{}
}

// A legacy comment has no question id. After A is replaced by B in the same
// slot the real scanner reports the anchor inside a question unit nobody can
// prove to be the comment's: the capture of A stays and the owner is Unknown.
func TestLegacyUnboundCommentNeverCapturesAReplacingQuestion(t *testing.T) {
	e := scanEnv(t)
	c := e.create(t, "c1", "", "")
	require.Empty(t, c.QuestionID)
	captured := c.CapturedBlock
	require.Contains(t, captured, "alpha text about caching layers")

	writeFile(t, e.dir, "a.md", replaced())
	got := e.reply(t, "c1", "r1")
	require.Equal(t, captured, got.CapturedBlock, "B must not become A's before-text")
	require.Equal(t, model.OwnershipUnknown, got.Ownership)
	require.Equal(t, model.ReasonAnchorInQuestion, got.OwnershipReason)
}

// A note outside every question unit is a plain note: the scanner proves no
// question is involved and the block is recaptured each round as ever.
func TestLegacyNoteOutsideAnyQuestionUnitStillRecapturesPerRound(t *testing.T) {
	e := scanEnv(t)
	body := `{"id":"n1","comment":"x","anchor":{"source_line":7,"block_text_hash":"x","selection_offset":0,"selection_length":0}}`
	code, out := e.post(e.h.ReviewCommentCreate, "/review/comments", body)
	require.Equal(t, http.StatusOK, code, out)

	writeFile(t, e.dir, "a.md", replaceOnce(planDoc, "# Plan\n", "# Plan, second round\n"))
	got := e.reply(t, "n1", "r1")
	require.Equal(t, "# plan, second round", got.CapturedBlock)
	require.Equal(t, model.OwnershipUnowned, got.Ownership)
}

// Without the checker nothing is proven: the capture is kept, the comment is
// preserved, and the JSON says why — never a silent unbound, never "proven".
func TestWithoutAScannerOwnershipIsUnknownAndCommentsAreKept(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", planDoc)
	e.createComment(t, "c1", alphaLine)
	before := mustGet(t, e, "c1").CapturedBlock
	writeFile(t, e.dir, "a.md", replaced())
	got := e.reply(t, "c1", "r1")
	require.Equal(t, before, got.CapturedBlock)
	require.Equal(t, model.OwnershipUnknown, got.Ownership)
	require.Equal(t, model.ReasonScannerUnavailable, got.OwnershipReason)
	require.Len(t, got.Reactions, 1)
}

func mustGet(t *testing.T, e *cmdEnv, id string) model.ReviewComment {
	t.Helper()
	data, err := e.h.deps.Reviews.Get("a.md", "")
	require.NoError(t, err)
	for _, c := range data.Comments {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("comment %s missing", id)
	return model.ReviewComment{}
}

// A reviewer selects rendered text; the source of the same words carries
// markup. Each shape is checked against the real scanner's unit text.
const markupDoc = `---
status: active
stage: x
next: y
---

# Plan

1. 💬 **OQ-1: Which ` + "`cache`" + ` wins?** See [the spec](https://x.test/s) first.

   <!-- vantage: question id=OQ-1 leaning="the **last**" -->

   Body says the **bold** claim and [a link](n.md) with ` + "`code`" + ` inside.

   _Leaning:_ the **last** one, per [notes](n.md) and ` + "`ttl`" + `.

1. 💬 **OQ-2: Second**

   <!-- vantage: question id=OQ-2 leaning="x" -->

   Other text.
`

func TestSelectedQuoteIsCheckedAgainstTheRenderedTextOfTheRealScannersUnit(t *testing.T) {
	e := scanEnv(t)
	writeFile(t, e.dir, "a.md", markupDoc)
	n := 0
	bound := func(quote string) bool {
		n++
		id := "c" + itoa(int64(n))
		return e.create(t, id, "OQ-1", `,"question_evidence":{"selected_quote":`+jsonString(quote)+`}`).QuestionID == "OQ-1"
	}
	for name, quote := range map[string]string{
		"headline across bold and inline code": "Which cache wins?",
		"link text in the headline":            "See the spec first",
		"card body bold":                       "says the bold claim",
		"card body link and code":              "a link with code inside",
		"leaning bold, link and code":          "the last one, per notes and ttl",
	} {
		require.True(t, bound(quote), name)
	}
	// Exists is still required: source markup is not in what the page shows, and
	// another question's words are not in this unit.
	for name, quote := range map[string]string{
		"markup as written":     "the **bold** claim",
		"link destination":      "https://x.test/s",
		"another question text": "Other text",
	} {
		require.False(t, bound(quote), name)
	}
}

func jsonString(s string) string {
	b := []byte(`"`)
	for _, r := range s {
		if r == '"' || r == '\\' {
			b = append(b, '\\')
		}
		b = append(b, string(r)...)
	}
	return string(append(b, '"'))
}

// countingScanner reports a fixed index and counts the scans it is asked for.
type countingScanner struct {
	calls atomic.Int32
	gate  chan struct{}
}

func (c *countingScanner) Scan(ctx context.Context, root string) (map[string][]ScannedQuestion, error) {
	c.calls.Add(1)
	if c.gate != nil {
		<-c.gate
	}
	return map[string][]ScannedQuestion{"a.md": {{ID: "OQ-1", UnitLine: 9, UnitEndLine: 13, UnitText: "x"}}}, nil
}

// N concurrent readings of one generation of a document cost one scan: the
// cache is keyed by (repository, path, content hash) and read again under the
// scan lock, never per card or per comment.
func TestConcurrentReadingsOfOneGenerationScanOnce(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", planDoc)
	sc := &countingScanner{gate: make(chan struct{})}
	obs := NewDocumentObserver(e.h.deps.Reviews, sc)
	svc := RepoServices{Repo: e.repo, Git: e.git, FS: e.fs}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			require.NotNil(t, obs.Source(svc, "a.md")().Scanned())
		}()
	}
	close(sc.gate)
	wg.Wait()
	require.EqualValues(t, 1, sc.calls.Load())

	// A later reading of the same generation is a cache hit too.
	require.NotNil(t, obs.Source(svc, "a.md")().Scanned())
	require.EqualValues(t, 1, sc.calls.Load())

	// A new generation (different content) scans again.
	writeFile(t, e.dir, "a.md", planDoc+"\nmore\n")
	require.NotNil(t, obs.Source(svc, "a.md")().Scanned())
	require.EqualValues(t, 2, sc.calls.Load())
}

func TestCheckerDiscoveryOrder(t *testing.T) {
	dir := t.TempDir()
	server := filepath.Join(dir, "vantage")
	neighbour := filepath.Join(dir, "vantage-check")
	require.NoError(t, os.WriteFile(server, []byte("x"), 0o755))
	exe := func() (string, error) { return server, nil }
	none := func(string) string { return "" }
	onPath := func(string) (string, error) { return "/usr/bin/vantage-check", nil }
	notOnPath := func(string) (string, error) { return "", os.ErrNotExist }
	command := func(s QuestionScanner) []string {
		if s == nil {
			return nil
		}
		return s.(CLIQuestionScanner).Command
	}

	// Nothing anywhere: no scanner.
	require.Nil(t, NewCLIQuestionScannerFromEnv(none, notOnPath, exe))
	// PATH only.
	require.Equal(t, []string{"/usr/bin/vantage-check"}, command(NewCLIQuestionScannerFromEnv(none, onPath, exe)))
	// A non-executable neighbour is not a checker.
	require.NoError(t, os.WriteFile(neighbour, []byte("x"), 0o644))
	require.Equal(t, []string{"/usr/bin/vantage-check"}, command(NewCLIQuestionScannerFromEnv(none, onPath, exe)))
	// An executable neighbour beats PATH.
	require.NoError(t, os.Chmod(neighbour, 0o755))
	// Discovery resolves the server executable before finding its neighbour.
	// A temp root can itself be a symlink (macOS /var -> /private/var).
	resolvedNeighbour, err := filepath.EvalSymlinks(neighbour)
	require.NoError(t, err)
	require.Equal(t, []string{resolvedNeighbour}, command(NewCLIQuestionScannerFromEnv(none, onPath, exe)))
	require.Equal(t, []string{resolvedNeighbour}, command(NewCLIQuestionScannerFromEnv(none, notOnPath, exe)))
	// The explicit variable beats both.
	explicit := func(k string) string {
		if k == "VANTAGE_CHECK" {
			return "/opt/check"
		}
		return ""
	}
	require.Equal(t, []string{"/opt/check"}, command(NewCLIQuestionScannerFromEnv(explicit, onPath, exe)))
	_ = review.Evidence{}
}

type noQuestions struct{}

func (noQuestions) Scan(context.Context, string) (map[string][]ScannedQuestion, error) {
	return map[string][]ScannedQuestion{}, nil
}
