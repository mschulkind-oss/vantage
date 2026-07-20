package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

// cmdEnv is a testEnv whose handlers record every ReviewChanged broadcast.
type cmdEnv struct {
	*testEnv
	changed []string // "<repo>|<path>" per broadcast, in order
}

// newCmdEnv rebuilds the env's Handlers with a recording ReviewChanged so
// tests can assert exactly when the broadcaster fires.
func newCmdEnv(t *testing.T) *cmdEnv {
	t.Helper()
	ce := &cmdEnv{testEnv: newTestEnv(t, false)}
	deps := ce.h.deps
	deps.ReviewChanged = func(repo, path string) {
		ce.changed = append(ce.changed, repo+"|"+path)
	}
	ce.h = NewHandlers(deps)
	return ce
}

// doID is do with the {id} path value attached, mimicking what chi does when
// the route pattern carries an id segment.
func (e *testEnv) doID(handler http.HandlerFunc, method, target, body, id string) *httptest.ResponseRecorder {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	ctx := WithRepoServices(r.Context(), RepoServices{Repo: e.repo, Git: e.git, FS: e.fs})
	r = r.WithContext(ctx)
	r.SetPathValue("id", id)
	w := httptest.NewRecorder()
	handler(w, r)
	return w
}

// cmdDoc is the document the command tests anchor against: line 3 is the first
// paragraph, line 5 the second.
const cmdDoc = "# Title\n\nFirst Paragraph text.\n\nSecond Paragraph HERE.\n"

// createComment POSTs a comment anchored at sourceLine and asserts success.
func (e *cmdEnv) createComment(t *testing.T, id string, sourceLine int) *model.ReviewData {
	t.Helper()
	body := fmt.Sprintf(
		`{"id":%q,"comment":"tighten this","anchor":{"source_line":%d,"block_text_hash":"deadbeef","selection_offset":0,"selection_length":0},"created_at":1717000000}`,
		id, sourceLine)
	w := e.do(e.h.ReviewCommentCreate, http.MethodPost, "/review/comments?path=a.md", body, true)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	var data model.ReviewData
	decode(t, w, &data)
	return &data
}

func TestReviewCommentCreateCapturesBlockAndBroadcasts(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", cmdDoc)

	data := e.createComment(t, "c1", 3)
	require.Len(t, data.Comments, 1)
	require.Equal(t, "c1", data.Comments[0].ID)
	require.Equal(t, 1717000000.0, data.Comments[0].CreatedAt)
	// The server captured the anchored block from the document on disk.
	require.Equal(t, "first paragraph text.", data.Comments[0].CapturedBlock)

	// The review file was created and persisted.
	stored, err := e.h.deps.Reviews.Get("a.md", "")
	require.NoError(t, err)
	require.NotNil(t, stored)
	require.Len(t, stored.Comments, 1)

	require.Equal(t, []string{"|a.md"}, e.changed)
}

func TestReviewCommentCreateMissingDocTolerated(t *testing.T) {
	e := newCmdEnv(t)
	// No a.md on disk: capture degrades to "" but the command succeeds.
	data := e.createComment(t, "c1", 3)
	require.Empty(t, data.Comments[0].CapturedBlock)
}

func TestReviewCommentCreateRejectsServerOwnedFields(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", cmdDoc)
	// captured_block and resolved in the body are ignored, not honored.
	body := `{"id":"c1","comment":"x","captured_block":"lie","resolved":true,"created_at":1}`
	w := e.do(e.h.ReviewCommentCreate, http.MethodPost, "/review/comments?path=a.md", body, true)
	require.Equal(t, http.StatusOK, w.Code)
	var data model.ReviewData
	decode(t, w, &data)
	require.Empty(t, data.Comments[0].CapturedBlock)
	require.False(t, data.Comments[0].Resolved)
}

func TestReviewCommentCreate400Shapes(t *testing.T) {
	e := newCmdEnv(t)
	for name, body := range map[string]string{
		"malformed json": "{not json",
		"missing id":     `{"comment":"x","created_at":1}`,
		"missing text":   `{"id":"c1","created_at":1}`,
	} {
		t.Run(name, func(t *testing.T) {
			w := e.do(e.h.ReviewCommentCreate, http.MethodPost, "/review/comments?path=a.md", body, true)
			require.Equal(t, http.StatusBadRequest, w.Code)
			var env map[string]string
			decode(t, w, &env)
			require.Contains(t, env, "error")
		})
	}
	require.Empty(t, e.changed, "no broadcast on failure")
}

func TestReviewCommentPatchEditSetsEditedAt(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)

	w := e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md",
		`{"comment":"new wording"}`, "c1")
	require.Equal(t, http.StatusOK, w.Code)
	var data model.ReviewData
	decode(t, w, &data)
	require.Equal(t, "new wording", data.Comments[0].Comment)
	require.Greater(t, data.Comments[0].EditedAt, float64(0), "edit must stamp edited_at server-side")
	require.Len(t, e.changed, 2, "create + edit each broadcast")
}

func TestReviewCommentPatchResolveAndReopen(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)

	w := e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md",
		`{"resolved":true}`, "c1")
	require.Equal(t, http.StatusOK, w.Code)
	var data model.ReviewData
	decode(t, w, &data)
	require.True(t, data.Comments[0].Resolved)
	// Dismiss-without-reaction: no conversation turn recorded.
	require.Empty(t, data.Comments[0].Reactions)

	w = e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md",
		`{"resolved":false}`, "c1")
	require.Equal(t, http.StatusOK, w.Code)
	// Fresh value: resolved:false is omitempty, so decoding into the previous
	// struct would keep the stale true.
	var reopened model.ReviewData
	decode(t, w, &reopened)
	require.False(t, reopened.Comments[0].Resolved)
}

func TestReviewCommentPatch400Shapes(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)
	before := len(e.changed)

	for name, body := range map[string]string{
		"both shapes":    `{"comment":"x","resolved":true}`,
		"neither shape":  `{}`,
		"malformed json": "{not json",
	} {
		t.Run(name, func(t *testing.T) {
			w := e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md", body, "c1")
			require.Equal(t, http.StatusBadRequest, w.Code)
		})
	}
	require.Len(t, e.changed, before, "no broadcast on failure")
}

func TestReviewCommentPatchUnknownID404(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)
	before := len(e.changed)

	w := e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/ghost?path=a.md",
		`{"resolved":true}`, "ghost")
	require.Equal(t, http.StatusNotFound, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "error")
	require.Len(t, e.changed, before)
}

func TestReviewCommentReplyAppendsAndRecaptures(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", cmdDoc)
	e.createComment(t, "c1", 3)

	// The doc changed between comment and follow-up: the reply re-captures.
	writeFile(t, e.dir, "a.md", "# Title\n\nRewritten paragraph.\n")
	w := e.doID(e.h.ReviewCommentReply, http.MethodPost, "/review/comments/c1/replies?path=a.md",
		`{"text":"still unclear"}`, "c1")
	require.Equal(t, http.StatusOK, w.Code)
	var data model.ReviewData
	decode(t, w, &data)
	c := data.Comments[0]
	require.Len(t, c.Reactions, 1)
	require.Equal(t, "reviewer", c.Reactions[0].Actor)
	require.Equal(t, "needs_clarification", c.Reactions[0].Kind)
	require.Equal(t, "still unclear", c.Reactions[0].Summary)
	require.Equal(t, "rewritten paragraph.", c.CapturedBlock)
}

func TestReviewCommentReplyEmptyText400(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)
	for _, body := range []string{`{"text":""}`, `{}`} {
		w := e.doID(e.h.ReviewCommentReply, http.MethodPost, "/review/comments/c1/replies?path=a.md", body, "c1")
		require.Equal(t, http.StatusBadRequest, w.Code)
	}
}

func TestReviewCommentReopenReply(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", cmdDoc)
	e.createComment(t, "c1", 3)
	w := e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md", `{"resolved":true}`, "c1")
	require.Equal(t, http.StatusOK, w.Code)

	w = e.doID(e.h.ReviewCommentReopenReply, http.MethodPost, "/review/comments/c1/reopen-reply?path=a.md",
		`{"text":"not fixed"}`, "c1")
	require.Equal(t, http.StatusOK, w.Code)
	var data model.ReviewData
	decode(t, w, &data)
	require.False(t, data.Comments[0].Resolved)
	require.Len(t, data.Comments[0].Reactions, 1)
	require.Equal(t, "needs_clarification", data.Comments[0].Reactions[0].Kind)
}

func TestReviewCommentDelete(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)

	w := e.doID(e.h.ReviewCommentDelete, http.MethodDelete, "/review/comments/c1?path=a.md", "", "c1")
	require.Equal(t, http.StatusOK, w.Code)
	var data model.ReviewData
	decode(t, w, &data)
	require.Empty(t, data.Comments)

	// Second delete: the comment is gone ⇒ 404.
	w = e.doID(e.h.ReviewCommentDelete, http.MethodDelete, "/review/comments/c1?path=a.md", "", "c1")
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestReviewDismissalsAll(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)
	e.createComment(t, "c2", 5)

	w := e.do(e.h.ReviewDismissals, http.MethodPost, "/review/dismissals?path=a.md", `{"scope":"all"}`, true)
	require.Equal(t, http.StatusOK, w.Code)
	var data model.ReviewData
	decode(t, w, &data)
	require.True(t, data.Comments[0].Resolved)
	require.True(t, data.Comments[1].Resolved)
}

func TestReviewDismissalsByIDs(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)
	e.createComment(t, "c2", 5)

	w := e.do(e.h.ReviewDismissals, http.MethodPost, "/review/dismissals?path=a.md",
		`{"scope":"ids","ids":["c2"]}`, true)
	require.Equal(t, http.StatusOK, w.Code)
	var data model.ReviewData
	decode(t, w, &data)
	require.False(t, data.Comments[0].Resolved)
	require.True(t, data.Comments[1].Resolved)
}

func TestReviewDismissals400Shapes(t *testing.T) {
	e := newCmdEnv(t)
	e.createComment(t, "c1", 3)
	before := len(e.changed)

	for name, body := range map[string]string{
		"bad scope":      `{"scope":"some"}`,
		"ids missing":    `{"scope":"ids"}`,
		"ids empty":      `{"scope":"ids","ids":[]}`,
		"malformed json": "{not json",
	} {
		t.Run(name, func(t *testing.T) {
			w := e.do(e.h.ReviewDismissals, http.MethodPost, "/review/dismissals?path=a.md", body, true)
			require.Equal(t, http.StatusBadRequest, w.Code)
		})
	}
	require.Len(t, e.changed, before)
}

func TestReviewDismissalsNoReview404(t *testing.T) {
	e := newCmdEnv(t)
	w := e.do(e.h.ReviewDismissals, http.MethodPost, "/review/dismissals?path=a.md", `{"scope":"all"}`, true)
	require.Equal(t, http.StatusNotFound, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Equal(t, "No review found", env["error"])
}

func TestReviewCommandsRequireRepoServices(t *testing.T) {
	e := newCmdEnv(t)
	for name, tc := range map[string]struct {
		handler http.HandlerFunc
		method  string
		target  string
	}{
		"create":     {e.h.ReviewCommentCreate, http.MethodPost, "/review/comments?path=a.md"},
		"patch":      {e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md"},
		"reply":      {e.h.ReviewCommentReply, http.MethodPost, "/review/comments/c1/replies?path=a.md"},
		"reopen":     {e.h.ReviewCommentReopenReply, http.MethodPost, "/review/comments/c1/reopen-reply?path=a.md"},
		"dismissals": {e.h.ReviewDismissals, http.MethodPost, "/review/dismissals?path=a.md"},
		"delete":     {e.h.ReviewCommentDelete, http.MethodDelete, "/review/comments/c1?path=a.md"},
	} {
		t.Run(name, func(t *testing.T) {
			w := e.do(tc.handler, tc.method, tc.target, "{}", false)
			require.Equal(t, http.StatusBadRequest, w.Code)
			var env map[string]string
			decode(t, w, &env)
			require.Contains(t, env, "error")
		})
	}
}

func TestReviewCommandsRequirePath(t *testing.T) {
	e := newCmdEnv(t)
	w := e.do(e.h.ReviewCommentCreate, http.MethodPost, "/review/comments", `{"id":"c1","comment":"x"}`, true)
	require.Equal(t, http.StatusBadRequest, w.Code)
	w = e.do(e.h.ReviewDismissals, http.MethodPost, "/review/dismissals", `{"scope":"all"}`, true)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestReviewChangedNilIsSafe(t *testing.T) {
	// The plain test env leaves Deps.ReviewChanged nil; commands must still work.
	e := newTestEnv(t, false)
	w := e.do(e.h.ReviewCommentCreate, http.MethodPost, "/review/comments?path=a.md",
		`{"id":"c1","comment":"x","created_at":1}`, true)
	require.Equal(t, http.StatusOK, w.Code)
}

func TestRoutesTableIncludesReviewCommands(t *testing.T) {
	e := newTestEnv(t, false)
	type key struct{ method, pattern string }
	got := map[key]Scope{}
	for _, rt := range e.h.Routes() {
		got[key{rt.Method, rt.Pattern}] = rt.Scope
	}
	for _, want := range []key{
		{http.MethodPost, "/review/comments"},
		{http.MethodPatch, "/review/comments/{id}"},
		{http.MethodDelete, "/review/comments/{id}"},
		{http.MethodPost, "/review/comments/{id}/replies"},
		{http.MethodPost, "/review/comments/{id}/reopen-reply"},
		{http.MethodPost, "/review/dismissals"},
	} {
		scope, ok := got[want]
		require.Truef(t, ok, "route %s %s missing from table", want.method, want.pattern)
		require.Equal(t, ScopeRepo, scope, "%s %s must be repo-scoped", want.method, want.pattern)
	}

	// The retired doors must not come back. Acceptance is a flag, not a
	// conversation turn, and agent responses arrive only via .vantage/inbox.
	for _, gone := range []key{
		{http.MethodPost, "/review/comments/{id}/accept"},
		{http.MethodPost, "/review/responses"},
	} {
		_, ok := got[gone]
		require.Falsef(t, ok, "route %s %s is retired and must stay out of the table",
			gone.method, gone.pattern)
	}
}
