package api

import (
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/review"
	"github.com/stretchr/testify/require"
)

// These tests run the real shared planning scanner — the checker's `index`
// command, from source under bun — behind the real handlers. They are skipped
// only where bun is missing.

// planDoc has three questions: OQ-1 and OQ-2 unique, OQ-D declared twice (which
// the scanner assigns to neither). Line 13 is OQ-1's body text.
const planDoc = `---
status: active
stage: x
next: y
---

# Plan

1. 💬 **OQ-1: Cache the index?**

   <!-- vantage: question id=OQ-1 leaning="yes" -->

   Alpha text about caching layers.

1. 💬 **OQ-2: Retry the push?**

   <!-- vantage: question id=OQ-2 leaning="no" -->

   Beta text about retries.

1. 💬 **OQ-D: One of two**

   <!-- vantage: question id=OQ-D leaning="no" -->

   First duplicate.

1. 💬 **OQ-D: Two of two**

   <!-- vantage: question id=OQ-D leaning="no" -->

   Second duplicate.
`

const alphaLine = 13

func scanEnv(t *testing.T) *cmdEnv {
	t.Helper()
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("bun is not installed; the real scanner cannot run")
	}
	main, err := filepath.Abs("../../packages/vantage-check/src/main.ts")
	require.NoError(t, err)
	e := newCmdEnv(t)
	deps := e.h.deps
	deps.QuestionScanner = CLIQuestionScanner{Command: []string{bun, main}}
	e.h = NewHandlers(deps)
	writeFile(t, e.dir, "a.md", planDoc)
	return e
}

func (e *cmdEnv) create(t *testing.T, id, question, extra string) model.ReviewComment {
	t.Helper()
	body := `{"id":"` + id + `","comment":"text","question_id":"` + question + `"` + extra +
		`,"anchor":{"source_line":` + itoa(alphaLine) + `,"block_text_hash":"x","selection_offset":0,"selection_length":0}}`
	code, out := e.post(e.h.ReviewCommentCreate, "/review/comments", body)
	require.Equal(t, http.StatusOK, code, out)
	data, err := e.h.deps.Reviews.Get("a.md", "")
	require.NoError(t, err)
	for _, c := range data.Comments {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("comment %s not stored", id)
	return model.ReviewComment{}
}

func TestBareCreateIsBoundOnlyWhenTheRealScannerProvesTheIDUnique(t *testing.T) {
	e := scanEnv(t)
	ok := e.create(t, "c1", "OQ-1", "")
	require.Equal(t, "OQ-1", ok.QuestionID)
	require.NotEmpty(t, ok.QuestionEvidence.UnitFingerprint, "evidence is the server's, from the scanner's unit")
	require.Equal(t, review.ContentHash(planDoc), ok.QuestionEvidence.DocumentContentHash)

	require.Empty(t, e.create(t, "c2", "OQ-D", "").QuestionID, "an id two questions claim names neither")
	require.Empty(t, e.create(t, "c3", "OQ-404", "").QuestionID, "an id that does not exist")
	require.Empty(t, e.create(t, "c4", "OQ-1", `,"question_evidence":{"unit_fingerprint":"stale"}`).QuestionID)
	require.Empty(t, e.create(t, "c5", "OQ-1", `,"question_evidence":{"selected_quote":"Beta text"}`).QuestionID,
		"a quote from another question's unit")
	require.Equal(t, "OQ-1", e.create(t, "c6", "OQ-1", `,"question_evidence":{"selected_quote":"Alpha text about caching"}`).QuestionID)

	// A retried create is an edit and never rewrites the bound id.
	again := e.create(t, "c1", "OQ-2", "")
	require.Equal(t, "OQ-1", again.QuestionID)
}

func TestBindThroughTheHandlerChecksIDFingerprintAndQuoteAgainstTheRealScanner(t *testing.T) {
	e := scanEnv(t)
	c := e.create(t, "c1", "", "")
	require.Empty(t, c.QuestionID)
	fingerprint := e.create(t, "probe", "OQ-1", "").QuestionEvidence.UnitFingerprint

	bind := func(question, evidence string) (int, string) {
		w := e.do(e.h.ReviewEvidence, http.MethodGet, "/review/evidence?path=a.md", "", true)
		var ev struct {
			review.Evidence
			MutationRevision int64 `json:"mutation_revision"`
		}
		decode(t, w, &ev)
		body := `{"comment_id":"c1","question_id":"` + question + `","evidence":` + evidence + `,"preconditions":{"boot_id":"` +
			ev.BootID + `","document_generation":` + itoa(ev.DocumentGeneration) + `,"mutation_revision":` + itoa(ev.MutationRevision) +
			`,"content_hash":"` + ev.ContentHash + `"}}`
		return e.post(e.h.ReviewBindQuestion, "/review/bind-comment-question", body)
	}
	for question, want := range map[string]string{"OQ-404": "question_id", "OQ-D": "question_id"} {
		code, body := bind(question, `{}`)
		require.Equal(t, http.StatusConflict, code)
		require.Contains(t, body, `"reason":"`+want+`"`)
	}
	code, body := bind("OQ-1", `{"unit_fingerprint":"stale"}`)
	require.Equal(t, http.StatusConflict, code)
	require.Contains(t, body, `"reason":"unit_fingerprint"`)
	code, body = bind("OQ-1", `{"unit_fingerprint":"`+fingerprint+`","selected_quote":"Beta text"}`)
	require.Equal(t, http.StatusConflict, code)
	require.Contains(t, body, `"reason":"selected_quote"`)
	code, body = bind("OQ-1", `{"unit_fingerprint":"`+fingerprint+`","selected_quote":"Alpha text"}`)
	require.Equal(t, http.StatusOK, code, body)

	// The document changes: old evidence is refused, and a new reading binds again.
	writeFile(t, e.dir, "a.md", planDoc+"\nmore\n")
	stored, _ := e.h.deps.Reviews.Get("a.md", "")
	stale := `{"comment_id":"c1","question_id":"OQ-2","allow_rebind":true,"preconditions":{"boot_id":"x","document_generation":1,"mutation_revision":` +
		itoa(stored.MutationRevision) + `,"content_hash":"y"}}`
	code, body = e.post(e.h.ReviewBindQuestion, "/review/bind-comment-question", stale)
	require.Equal(t, http.StatusConflict, code)
	require.Contains(t, body, `"reason":"boot_id"`)
}

func TestBindIsRefusedWhereNoScannerIsInstalled(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", planDoc)
	e.createComment(t, "c1", alphaLine)
	ev := e.h.documentEvidence(RepoServices{Repo: "", FS: e.fs}, "a.md")
	body := `{"comment_id":"c1","question_id":"OQ-1","preconditions":{"boot_id":"` + ev.BootID + `","document_generation":` +
		itoa(ev.DocumentGeneration) + `,"mutation_revision":1,"content_hash":"` + ev.ContentHash + `"}}`
	code, out := e.post(e.h.ReviewBindQuestion, "/review/bind-comment-question", body)
	require.Equal(t, http.StatusConflict, code)
	require.Contains(t, out, `"reason":"scanner_unavailable"`)
	require.Empty(t, e.create(t, "c9", "OQ-1", "").QuestionID)
}

// The A→B case: A's comment is bound, and the source is rewritten so that an
// unrelated question B stands in A's old slot with the same neighbouring blocks
// and many of A's words. A text edit or reply must not capture B.
func TestReplacedQuestionIsNeverRecapturedThroughTheHandlers(t *testing.T) {
	e := scanEnv(t)
	c := e.create(t, "c1", "OQ-1", "")
	require.Equal(t, "OQ-1", c.QuestionID)
	const original = "alpha text about caching layers."
	require.Equal(t, original, c.CapturedBlock)

	replaced := strings.Replace(planDoc, "OQ-1: Cache the index?", "OQ-9: Cache the index differently?", 1)
	replaced = strings.Replace(replaced, "id=OQ-1", "id=OQ-9", 1)
	replaced = strings.Replace(replaced, "Alpha text about caching layers.", "Gamma text about caching layers today.", 1)
	writeFile(t, e.dir, "a.md", replaced)

	w := e.doID(e.h.ReviewCommentReply, http.MethodPost, "/review/comments/c1/replies?path=a.md", `{"id":"r1","text":"again"}`, "c1")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	w = e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md", `{"comment":"reworded"}`, "c1")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	stored, _ := e.h.deps.Reviews.Get("a.md", "")
	require.Equal(t, original, stored.Comments[0].CapturedBlock)

	// The same question edited in place is recaptured, per round.
	inPlace := strings.Replace(planDoc, "Alpha text about caching layers.", "Alpha text about caching layers and TTLs.", 1)
	writeFile(t, e.dir, "a.md", inPlace)
	w = e.doID(e.h.ReviewCommentReply, http.MethodPost, "/review/comments/c1/replies?path=a.md", `{"id":"r2","text":"round 2"}`, "c1")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	stored, _ = e.h.deps.Reviews.Get("a.md", "")
	require.Equal(t, "alpha text about caching layers and ttls.", stored.Comments[0].CapturedBlock)
}
