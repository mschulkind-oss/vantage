package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

func TestReviewGetAbsentReturnsNullAt200(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.ReviewGet, http.MethodGet, "/review?path=a.md", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	// Absent review ⇒ literal null at 200 (preferred shape).
	require.Equal(t, "null", w.Body.String())
}

func TestReviewPutThenGetRoundTrips(t *testing.T) {
	e := newTestEnv(t, false)
	rd := model.NewReviewData("a.md")
	c := model.NewReviewComment("c1", "tighten this", 1717000000)
	c.Anchor = &model.CommentAnchor{SourceLine: 3, BlockTextHash: "d58b3fa7"}
	rd.Comments = append(rd.Comments, c)
	body, err := json.Marshal(rd)
	require.NoError(t, err)

	// PUT persists verbatim and returns {"status":"ok"}.
	wput := e.do(e.h.ReviewPut, http.MethodPut, "/review?path=a.md", string(body), true)
	require.Equal(t, http.StatusOK, wput.Code)
	require.JSONEq(t, `{"status":"ok"}`, wput.Body.String())

	// GET returns the stored data with all keys, including the anchor + hash.
	wget := e.do(e.h.ReviewGet, http.MethodGet, "/review?path=a.md", "", true)
	require.Equal(t, http.StatusOK, wget.Code)
	var got model.ReviewData
	decode(t, wget, &got)
	require.Equal(t, "a.md", got.FilePath)
	require.Len(t, got.Comments, 1)
	require.Equal(t, "c1", got.Comments[0].ID)
	require.NotNil(t, got.Comments[0].Anchor)
	require.Equal(t, "d58b3fa7", got.Comments[0].Anchor.BlockTextHash)
	// Empty slices round-trip as [].
	require.NotNil(t, got.Comments[0].Reactions)
}

// TestReviewPutDoesNotApplyChangelog verifies PUT is pure persistence: it must
// not add any reaction (which an apply-on-PUT would do). The stored record
// equals exactly what was sent.
func TestReviewPutDoesNotApplyChangelog(t *testing.T) {
	e := newTestEnv(t, false)
	rd := model.NewReviewData("a.md")
	c := model.NewReviewComment("c1", "fix this", 1717000000)
	rd.Comments = append(rd.Comments, c)
	body, err := json.Marshal(rd)
	require.NoError(t, err)

	wput := e.do(e.h.ReviewPut, http.MethodPut, "/review?path=a.md", string(body), true)
	require.Equal(t, http.StatusOK, wput.Code)

	stored, err := e.h.deps.Reviews.Get("a.md", "")
	require.NoError(t, err)
	require.NotNil(t, stored)
	require.Len(t, stored.Comments, 1)
	// No reactions were synthesized — apply-on-PUT would have added one.
	require.Empty(t, stored.Comments[0].Reactions)
}

func TestReviewPutMalformedBody400(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.ReviewPut, http.MethodPut, "/review?path=a.md", "{not json", true)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "error")
}

func TestReviewDeleteMiss404(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.ReviewDelete, http.MethodDelete, "/review?path=a.md", "", true)
	require.Equal(t, http.StatusNotFound, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Equal(t, "No review found", env["error"])
}

func TestReviewDeleteHit200(t *testing.T) {
	e := newTestEnv(t, false)
	require.NoError(t, e.h.deps.Reviews.Save("a.md", "", model.NewReviewData("a.md")))

	w := e.do(e.h.ReviewDelete, http.MethodDelete, "/review?path=a.md", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"status":"ok"}`, w.Body.String())

	// Second delete is now a miss ⇒ 404.
	w2 := e.do(e.h.ReviewDelete, http.MethodDelete, "/review?path=a.md", "", true)
	require.Equal(t, http.StatusNotFound, w2.Code)
}

func TestReviewMissingPath400(t *testing.T) {
	e := newTestEnv(t, false)
	for _, tc := range []struct {
		handler http.HandlerFunc
		method  string
	}{
		{e.h.ReviewGet, http.MethodGet},
		{e.h.ReviewPut, http.MethodPut},
		{e.h.ReviewDelete, http.MethodDelete},
	} {
		w := e.do(tc.handler, tc.method, "/review", "{}", true)
		require.Equal(t, http.StatusBadRequest, w.Code)
	}
}
