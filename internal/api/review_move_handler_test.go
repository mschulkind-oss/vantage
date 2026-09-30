package api

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// POST /review/move: the viewer followed a document whose folder was renamed,
// and asks for its review to be filed where the document is now.

func seedReview(t *testing.T, e *cmdEnv, path string, ids ...string) {
	t.Helper()
	rd := model.NewReviewData(path)
	for _, id := range ids {
		rd.Comments = append(rd.Comments, model.NewReviewComment(id, "comment "+id, 1717000000))
	}
	require.NoError(t, e.h.deps.Reviews.Save(path, "", rd))
}

func TestReviewMoveFilesTheReviewWhereTheDocumentWent(t *testing.T) {
	e := newCmdEnv(t)
	// The folder was renamed: the document is at its new path only.
	writeFile(t, e.dir, "docs/new/a.md", cmdDoc)
	seedReview(t, e, "docs/old/a.md", "c1")

	w := e.do(e.h.ReviewMove, http.MethodPost, "/review/move?path=docs/old/a.md", `{"to":"docs/new/a.md"}`, true)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	var got model.ReviewData
	decode(t, w, &got)
	require.Equal(t, "docs/new/a.md", got.FilePath)
	require.Len(t, got.Comments, 1)
	require.Equal(t, "c1", got.Comments[0].ID)

	stored, err := e.h.deps.Reviews.Get("docs/new/a.md", "")
	require.NoError(t, err)
	require.NotNil(t, stored)
	old, err := e.h.deps.Reviews.Get("docs/old/a.md", "")
	require.NoError(t, err)
	require.Nil(t, old)
	// Both documents' reviews changed, and the planning page lists each.
	require.Equal(t, []string{"|docs/old/a.md", "|docs/new/a.md"}, e.changed)
}

// Also a folder renamed twice in quick succession: the viewer asks for the
// first new name after the folder has already moved on from it, and the next
// request carries the review on.
func TestReviewMoveDoesNotAskWhetherTheNewPathExists(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "r3/a.md", cmdDoc)
	seedReview(t, e, "r1/a.md", "c1")

	w := e.do(e.h.ReviewMove, http.MethodPost, "/review/move?path=r1/a.md", `{"to":"r2/a.md"}`, true)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	w = e.do(e.h.ReviewMove, http.MethodPost, "/review/move?path=r2/a.md", `{"to":"r3/a.md"}`, true)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	stored, err := e.h.deps.Reviews.Get("r3/a.md", "")
	require.NoError(t, err)
	require.NotNil(t, stored)
	require.Equal(t, "c1", stored.Comments[0].ID)
}

// A review follows its document, never the other way round: a request that
// arrives once the folder is back, or from a viewer that followed the wrong
// way, leaves the review where its document still is.
func TestReviewMoveRefusesWhileTheDocumentIsStillThere(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "docs/old/a.md", cmdDoc)
	writeFile(t, e.dir, "docs/new/a.md", cmdDoc)
	seedReview(t, e, "docs/old/a.md", "c1")

	w := e.do(e.h.ReviewMove, http.MethodPost, "/review/move?path=docs/old/a.md", `{"to":"docs/new/a.md"}`, true)
	require.Equal(t, http.StatusConflict, w.Code)

	stored, err := e.h.deps.Reviews.Get("docs/old/a.md", "")
	require.NoError(t, err)
	require.NotNil(t, stored)
	moved, err := e.h.deps.Reviews.Get("docs/new/a.md", "")
	require.NoError(t, err)
	require.Nil(t, moved)
	require.Empty(t, e.changed)
}

func TestReviewMoveWithNothingToMoveBroadcastsNothing(t *testing.T) {
	e := newCmdEnv(t)
	writeFile(t, e.dir, "docs/new/a.md", cmdDoc)

	w := e.do(e.h.ReviewMove, http.MethodPost, "/review/move?path=docs/old/a.md", `{"to":"docs/new/a.md"}`, true)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "null", w.Body.String())
	require.Empty(t, e.changed)
}

func TestReviewMoveRejectsABadRequest(t *testing.T) {
	e := newCmdEnv(t)
	seedReview(t, e, "a.md", "c1")
	for name, tc := range map[string]struct{ target, body string }{
		"no path":            {"/review/move", `{"to":"b.md"}`},
		"no to":              {"/review/move?path=a.md", `{}`},
		"to is path":         {"/review/move?path=a.md", `{"to":"a.md"}`},
		"to leaves the root": {"/review/move?path=a.md", `{"to":"../b.md"}`},
		"to is git's":        {"/review/move?path=a.md", `{"to":".git/b.md"}`},
		"path leaves":        {"/review/move?path=../a.md", `{"to":"b.md"}`},
		"malformed":          {"/review/move?path=a.md", `{`},
	} {
		t.Run(name, func(t *testing.T) {
			w := e.do(e.h.ReviewMove, http.MethodPost, tc.target, tc.body, true)
			require.Equal(t, http.StatusBadRequest, w.Code, "body: %s", w.Body.String())
		})
	}
	stored, err := e.h.deps.Reviews.Get("a.md", "")
	require.NoError(t, err)
	require.NotNil(t, stored, "a refused move leaves the review where it was")
	require.Empty(t, e.changed)
}
