package api

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/mschulkind-oss/vantage/internal/review"
)

// starredList is the shape every bookmark route answers with.
type starredList struct {
	Entries []struct {
		Repo      string `json:"repo"`
		Path      string `json:"path"`
		IsDir     bool   `json:"is_dir"`
		StarredAt string `json:"starred_at"`
		Source    string `json:"source"`
	} `json:"entries"`
}

// star POSTs a bookmark. attach is false throughout this file on purpose: these
// routes are global, and working without a resolved repository in context is
// exactly what distinguishes them from every other path-taking route.
func (e *testEnv) star(t *testing.T, body string) *starredList {
	t.Helper()
	w := e.do(e.h.StarredAdd, http.MethodPost, "/starred", body, false)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	var got starredList
	decode(t, w, &got)
	return &got
}

// Every row on the wire says where it came from. The viewer keys the star's
// meaning on it, so a response without it would render every promoted document as
// one the reader had chosen.
func TestStarredRowsAreLabelledAsTheUsers(t *testing.T) {
	e := newTestEnv(t, false)

	added := e.star(t, `{"repo":"","path":"docs/a.md","is_dir":false}`)
	require.Len(t, added.Entries, 1)
	require.Equal(t, "user", added.Entries[0].Source, "the mutation response is labelled too")

	w := e.do(e.h.StarredList, http.MethodGet, "/starred", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	var got starredList
	decode(t, w, &got)
	require.Len(t, got.Entries, 1)
	require.Equal(t, "user", got.Entries[0].Source)

	// Flat, beside the other keys rather than nested under one: a nested shape
	// would have been a breaking change to every reader of this response.
	require.Contains(t, w.Body.String(), `"source":"user"`)
	require.NotContains(t, w.Body.String(), `"entry":`)
}

func TestStarredListIsEmptyNotNull(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.StarredList, http.MethodGet, "/starred", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"entries":[]}`, w.Body.String())
}

func TestStarredAddThenList(t *testing.T) {
	e := newTestEnv(t, false)

	added := e.star(t, `{"repo":"","path":"docs/a.md","is_dir":false}`)
	require.Len(t, added.Entries, 1)
	require.Equal(t, "docs/a.md", added.Entries[0].Path)
	require.NotEmpty(t, added.Entries[0].StarredAt)
	require.Equal(t, 1, *e.starredPushes, "a successful add must push exactly once")

	w := e.do(e.h.StarredList, http.MethodGet, "/starred", "", false)
	var listed starredList
	decode(t, w, &listed)
	require.Equal(t, added.Entries, listed.Entries, "the mutation response must match a later GET")
}

// The response always carries the whole list, so the client never has to merge
// a delta or refetch after mutating.
func TestStarredMutationsReturnTheFullList(t *testing.T) {
	e := newTestEnv(t, false)
	e.star(t, `{"repo":"","path":"a.md"}`)
	second := e.star(t, `{"repo":"","path":"b.md"}`)
	require.Len(t, second.Entries, 2)
}

func TestStarredAddIsIdempotent(t *testing.T) {
	e := newTestEnv(t, false)
	e.star(t, `{"repo":"","path":"docs/a.md"}`)
	again := e.star(t, `{"repo":"","path":"docs/a.md"}`)
	require.Len(t, again.Entries, 1, "starring twice must leave one bookmark")
}

func TestStarredAddRejectsBadShape(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"no path", `{"repo":"","path":""}`},
		{"the repository root", `{"repo":"","path":"."}`},
		{"absolute", `{"repo":"","path":"/etc/passwd"}`},
		{"traversal", `{"repo":"","path":"a/../../b"}`},
		{"the .vantage dir", `{"repo":"","path":".vantage/inbox"}`},
		{"the .git dir", `{"repo":"","path":"a/.git/config"}`},
		{"a repo with a separator", `{"repo":"a/b","path":"a.md"}`},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newTestEnv(t, false)
			w := e.do(e.h.StarredAdd, http.MethodPost, "/starred", c.body, false)
			require.Equal(t, http.StatusBadRequest, w.Code)

			// Bookmarks use the repo-wide {"error":…} envelope; {"detail":…} is
			// reserved for filesystem path validation.
			var env map[string]string
			decode(t, w, &env)
			require.Contains(t, env, "error")
			require.NotContains(t, env, "detail")

			require.Equal(t, 0, *e.starredPushes, "a rejected add must not push")
		})
	}
}

func TestStarredAddMalformedBody(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.StarredAdd, http.MethodPost, "/starred", `{not json`, false)
	require.Equal(t, http.StatusBadRequest, w.Code)
	require.Equal(t, 0, *e.starredPushes)
}

func TestStarredDelete(t *testing.T) {
	e := newTestEnv(t, false)
	e.star(t, `{"repo":"","path":"a.md"}`)
	e.star(t, `{"repo":"","path":"b.md"}`)
	*e.starredPushes = 0

	w := e.do(e.h.StarredDelete, http.MethodDelete, "/starred?path=a.md", "", false)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	var got starredList
	decode(t, w, &got)
	require.Len(t, got.Entries, 1)
	require.Equal(t, "b.md", got.Entries[0].Path)
	require.Equal(t, 1, *e.starredPushes)
}

// An absent repo= and an empty one are both the single-repo sentinel, so the
// viewer can delete without special-casing which mode it is in.
func TestStarredDeleteTreatsAbsentRepoAsTheSentinel(t *testing.T) {
	e := newTestEnv(t, false)
	e.star(t, `{"repo":"","path":"a.md"}`)

	w := e.do(e.h.StarredDelete, http.MethodDelete, "/starred?repo=&path=a.md", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	var got starredList
	decode(t, w, &got)
	require.Empty(t, got.Entries)
}

func TestStarredDeleteScopesToItsRepo(t *testing.T) {
	e := newTestEnv(t, false)
	e.star(t, `{"repo":"alpha","path":"a.md"}`)
	e.star(t, `{"repo":"beta","path":"a.md"}`)

	w := e.do(e.h.StarredDelete, http.MethodDelete, "/starred?repo=alpha&path=a.md", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	var got starredList
	decode(t, w, &got)
	require.Len(t, got.Entries, 1)
	require.Equal(t, "beta", got.Entries[0].Repo)
}

func TestStarredDeleteMissIs404(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.StarredDelete, http.MethodDelete, "/starred?path=gone.md", "", false)
	require.Equal(t, http.StatusNotFound, w.Code)
	require.Equal(t, 0, *e.starredPushes, "a miss must not push")
}

func TestStarredDeleteRequiresPath(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.StarredDelete, http.MethodDelete, "/starred", "", false)
	require.Equal(t, http.StatusBadRequest, w.Code)

	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "error")
}

// A path with characters that must survive the query string round trip.
func TestStarredHandlesAwkwardPaths(t *testing.T) {
	e := newTestEnv(t, false)
	const p = "docs/diseño & co/a b.md"
	e.star(t, `{"repo":"","path":"docs/diseño & co/a b.md"}`)

	w := e.do(e.h.StarredDelete, http.MethodDelete,
		"/starred?path="+url.QueryEscape(p), "", false)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	var got starredList
	decode(t, w, &got)
	require.Empty(t, got.Entries)
}

// A server that could not resolve the user config dir leaves the store nil.
// Bookmarks then say so instead of panicking, and everything else keeps working.
func TestStarredUnavailableWithoutAStore(t *testing.T) {
	pushes := 0
	h := NewHandlers(Deps{
		Reviews:        review.NewStore(t.TempDir()),
		Perf:           perf.NewStore(),
		Config:         config.Defaults(),
		StarredChanged: func() { pushes++ },
	})
	e := &testEnv{h: h}

	for _, c := range []struct {
		name    string
		handler http.HandlerFunc
		method  string
		target  string
		body    string
	}{
		{"list", h.StarredList, http.MethodGet, "/starred", ""},
		{"add", h.StarredAdd, http.MethodPost, "/starred", `{"path":"a.md"}`},
		{"delete", h.StarredDelete, http.MethodDelete, "/starred?path=a.md", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			w := e.do(c.handler, c.method, c.target, c.body, false)
			require.Equal(t, http.StatusServiceUnavailable, w.Code)
		})
	}
	require.Equal(t, 0, pushes)
}

// The push hook is optional, the same contract ReviewChanged has.
func TestStarredChangedNilIsSafe(t *testing.T) {
	e := newTestEnv(t, false)
	e.h.deps.StarredChanged = nil
	w := e.do(e.h.StarredAdd, http.MethodPost, "/starred", `{"path":"a.md"}`, false)
	require.Equal(t, http.StatusOK, w.Code)
}
