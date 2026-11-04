package api

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/review"
	"github.com/stretchr/testify/require"
)

// The reviewer reads GET /review/evidence, another box opens in between (a
// write that bumps the review's mutation revision), and the create names the
// older revision. The answer stays owned by its question, not Unassigned.
func TestCreateStaysBoundWhenAnotherBoxOpensBetweenEvidenceAndCreate(t *testing.T) {
	e := scanEnv(t)
	e.create(t, "other", "", "")
	w := e.do(e.h.ReviewEvidence, http.MethodGet, "/review/evidence?path=a.md", "", true)
	var ev struct {
		review.Evidence
		MutationRevision int64 `json:"mutation_revision"`
	}
	decode(t, w, &ev)
	pre := func(boot, hash string) string {
		return `,"preconditions":{"boot_id":"` + boot + `","document_generation":` + itoa(ev.DocumentGeneration) +
			`,"mutation_revision":` + itoa(ev.MutationRevision) + `,"content_hash":"` + hash + `"}`
	}
	e.session(t, e.h.ReviewSessionBegin, "/review/begin-comment-session", `{"comment_id":"other","session_id":"s9"}`)
	stored, _ := e.h.deps.Reviews.Get("a.md", "")
	require.NotEqual(t, ev.MutationRevision, stored.MutationRevision, "the review moved independently")

	got := e.create(t, "c1", "OQ-1", pre(ev.BootID, ev.ContentHash))
	require.Equal(t, "OQ-1", got.QuestionID)
	require.Equal(t, model.OwnershipProven, got.Ownership)

	require.Empty(t, e.create(t, "c2", "OQ-1", pre(ev.BootID, "stale")).QuestionID, "a moved document is still refused")
	require.Empty(t, e.create(t, "c3", "OQ-1", pre("other-boot", ev.ContentHash)).QuestionID, "a moved boot is still refused")
}

type failingScanner struct {
	calls atomic.Int32
	err   error
}

func (f *failingScanner) Scan(context.Context, string) (map[string][]ScannedQuestion, error) {
	f.calls.Add(1)
	return nil, f.err
}

// A refused scan is a reason of its own, end to end through the handler.
func TestRefusedScanIsNamedScanRefusedThroughTheHandler(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", planDoc)
	deps := e.h.deps
	deps.QuestionScanner = &failingScanner{err: ErrScanRefused}
	e.h = NewHandlers(deps)
	e.createComment(t, "c1", alphaLine)
	got := e.reply(t, "c1", "r1")
	require.Equal(t, model.ReasonScanRefused, got.OwnershipReason)
}

// A checker that keeps failing is not run again on every write for a moment.
func TestFailedScansAreRememberedBriefly(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", planDoc)
	sc := &failingScanner{err: errors.New("boom")}
	obs := NewDocumentObserver(e.h.deps.Reviews, sc)
	now := time.Unix(1000, 0)
	obs.now = func() time.Time { return now }
	svc := RepoServices{Repo: e.repo, Git: e.git, FS: e.fs}
	for i := 0; i < 3; i++ {
		require.Nil(t, obs.Source(svc, "a.md")().Scanned())
	}
	require.EqualValues(t, 1, sc.calls.Load())

	writeFile(t, e.dir, "a.md", planDoc+"\nmore\n")
	require.Nil(t, obs.Source(svc, "a.md")().Scanned())
	require.EqualValues(t, 2, sc.calls.Load(), "other contents are not covered")

	now = now.Add(failedScanMemory + time.Second)
	require.Nil(t, obs.Source(svc, "a.md")().Scanned())
	require.EqualValues(t, 3, sc.calls.Load(), "the memory expires")
}

// A server without a checker says so once, at startup, and says how to fix it.
func TestMissingCheckerIsWarnedAboutOnce(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	none := func(string) (string, error) { return "", errors.New("not found") }
	noExe := func() (string, error) { return "", errors.New("none") }
	get := func(string) string { return "" }
	require.Nil(t, ResolveQuestionScanner(logger, get, none, noExe))
	require.Equal(t, 1, strings.Count(buf.String(), "level=WARN"))
	for _, want := range []string{"VANTAGE_CHECK", "PATH", "next to", "Unknown"} {
		require.Contains(t, buf.String(), want)
	}

	buf.Reset()
	found := func(string) (string, error) { return "/opt/check", nil }
	require.NotNil(t, ResolveQuestionScanner(logger, get, found, noExe))
	require.Empty(t, buf.String())
}
