package api

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/review"
	"github.com/stretchr/testify/require"
)

func (e *cmdEnv) post(h http.HandlerFunc, route, body string) (int, string) {
	w := e.do(h, http.MethodPost, route+"?path=a.md", body, true)
	return w.Code, w.Body.String()
}

func (e *cmdEnv) session(t *testing.T, h http.HandlerFunc, route, body string) review.SessionAck {
	t.Helper()
	w := e.do(h, http.MethodPost, route+"?path=a.md", body, true)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp struct {
		Session review.SessionAck `json:"session"`
		Review  model.ReviewData  `json:"review"`
	}
	decode(t, w, &resp)
	return resp.Session
}

func TestSessionEndpointsRoundTripRestoreAndConflict(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", cmdDoc)
	e.createComment(t, "c1", 3)

	ack := e.session(t, e.h.ReviewSessionBegin, "/review/begin-comment-session",
		`{"comment_id":"c1","session_id":"s1","shown_root_version":"old"}`)
	require.Equal(t, "tighten this", ack.Baseline.Text)
	require.True(t, ack.Stale)

	w := e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md", `{"comment":"typed","session_id":"s1"}`, "c1")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	// A legacy edit conflicts the session; restore is a 409 with a reason and no write.
	e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md", `{"comment":"theirs"}`, "c1")
	code, body := e.post(e.h.ReviewSessionRestore, "/review/restore-comment-session", `{"comment_id":"c1","session_id":"s1"}`)
	require.Equal(t, http.StatusConflict, code)
	require.Contains(t, body, `"reason":"external_text_edit"`)
	stored, _ := e.h.deps.Reviews.Get("a.md", "")
	require.Equal(t, "theirs", stored.Comments[0].Comment)

	// A fresh session restores cleanly and the closed session then replays.
	e.session(t, e.h.ReviewSessionBegin, "/review/begin-comment-session", `{"comment_id":"c1","session_id":"s2"}`)
	e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md", `{"comment":"scribble","session_id":"s2"}`, "c1")
	ack = e.session(t, e.h.ReviewSessionRestore, "/review/restore-comment-session", `{"comment_id":"c1","session_id":"s2"}`)
	require.Equal(t, "restored", ack.Outcome)
	require.Equal(t, "theirs", ack.Comment.Comment)
	ack = e.session(t, e.h.ReviewSessionRestore, "/review/restore-comment-session", `{"comment_id":"c1","session_id":"s2"}`)
	require.Equal(t, "restored", ack.Outcome)

	// Closed-session barrier is the 404 legacy clients handle.
	w = e.doID(e.h.ReviewCommentPatch, http.MethodPatch, "/review/comments/c1?path=a.md", `{"comment":"late","session_id":"s2"}`, "c1")
	require.Equal(t, http.StatusNotFound, w.Code)
	code, _ = e.post(e.h.ReviewSessionRestore, "/review/restore-comment-session", `{"comment_id":"c1","session_id":"nope"}`)
	require.Equal(t, http.StatusNotFound, code)
	code, _ = e.post(e.h.ReviewSessionBegin, "/review/begin-comment-session", `{"comment_id":"c1"}`)
	require.Equal(t, http.StatusBadRequest, code)
}

func TestNewAnswerSessionCreateFinishAndLateCreateAfterDiscard(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "a.md", cmdDoc)
	ack := e.session(t, e.h.ReviewSessionBegin, "/review/begin-comment-session", `{"comment_id":"n1","session_id":"s1"}`)
	require.True(t, ack.Baseline.DidNotExist)
	create := `{"id":"n1","comment":"draft","session_id":"s1","anchor":{"source_line":3,"block_text_hash":"x","selection_offset":0,"selection_length":0}}`
	code, body := e.post(e.h.ReviewCommentCreate, "/review/comments", create)
	require.Equal(t, http.StatusOK, code, body)
	e.session(t, e.h.ReviewSessionRestore, "/review/restore-comment-session", `{"comment_id":"n1","session_id":"s1"}`)
	code, _ = e.post(e.h.ReviewCommentCreate, "/review/comments", create)
	require.Equal(t, http.StatusNotFound, code, "late retried create must not resurrect")
	code, _ = e.post(e.h.ReviewCommentCreate, "/review/comments", strings.Replace(create, `,"session_id":"s1"`, "", 1))
	require.Equal(t, http.StatusNotFound, code, "deleted id stays refused for legacy clients too")
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
