package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

func TestContentJSONForText(t *testing.T) {
	e := newTestEnv(t, false)
	writeFile(t, e.dir, "a.md", "# hello\n")

	w := e.do(e.h.Content, http.MethodGet, "/content?path=a.md", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "application/json", w.Header().Get("Content-Type"))
	var c model.FileContent
	decode(t, w, &c)
	require.Equal(t, "a.md", c.Path)
	require.Equal(t, "utf-8", c.Encoding)
	require.Equal(t, "# hello\n", c.Content)
}

func TestContentRawImageByExtension(t *testing.T) {
	e := newTestEnv(t, false)
	// A real PNG header byte sequence; content is arbitrary for the test.
	pngBytes := "\x89PNG\r\n\x1a\nFAKEPNGDATA"
	writeFile(t, e.dir, "img.png", pngBytes)

	w := e.do(e.h.Content, http.MethodGet, "/content?path=img.png", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "image/png", w.Header().Get("Content-Type"))
	// Raw bytes returned verbatim, NOT wrapped in JSON.
	require.Equal(t, pngBytes, w.Body.String())
}

func TestContentImageExtensionCaseInsensitive(t *testing.T) {
	e := newTestEnv(t, false)
	writeFile(t, e.dir, "PIC.JPG", "jpegbytes")

	w := e.do(e.h.Content, http.MethodGet, "/content?path=PIC.JPG", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "image/jpeg", w.Header().Get("Content-Type"))
	require.Equal(t, "jpegbytes", w.Body.String())
}

func TestContentMissingPath400Detail(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.Content, http.MethodGet, "/content", "", true)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "detail")
}

func TestContentBadPath400Detail(t *testing.T) {
	e := newTestEnv(t, false)
	// Traversal ⇒ fs validation error ⇒ 400 {"detail":…}.
	w := e.do(e.h.Content, http.MethodGet, "/content?path=../escape.md", "", true)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "detail")
	require.NotContains(t, env, "error")
}

func TestContentImageBadPath400Detail(t *testing.T) {
	e := newTestEnv(t, false)
	// Image-extension traversal must also be rejected with a detail 400.
	w := e.do(e.h.Content, http.MethodGet, "/content?path=../secret.png", "", true)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "detail")
}

func TestContentImageDotGitRejected(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.Content, http.MethodGet, "/content?path=.git/logo.png", "", true)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "detail")
}

func TestContentVantageDirRejected(t *testing.T) {
	e := newTestEnv(t, false)
	writeFile(t, e.dir, ".vantage/inbox/x.jsonl", `{"secret":"payload"}`)
	writeFile(t, e.dir, ".vantage/pic.png", "\x89PNGdata")

	// .vantage is hidden from the tree and from search, so serving it by direct
	// path made a "hidden" directory fetchable — and openable as a document to
	// annotate — by anyone who typed the URL. Both branches of /content, the
	// JSON one and the raw-image one, must refuse it; the image branch has its
	// own validator that previously only knew about .git.
	for _, path := range []string{".vantage/inbox/x.jsonl", ".vantage/pic.png", ".vantage"} {
		w := e.do(e.h.Content, http.MethodGet, "/content?path="+path, "", true)
		require.Equal(t, http.StatusBadRequest, w.Code, "path %s", path)
		var env map[string]string
		decode(t, w, &env)
		require.Contains(t, env, "detail")
	}
}

func TestContentImageMissingFile404(t *testing.T) {
	e := newTestEnv(t, false)
	// Valid path, no such file: 404 with {"error":…}.
	w := e.do(e.h.Content, http.MethodGet, "/content?path=missing.png", "", true)
	require.Equal(t, http.StatusNotFound, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "error")
}

func TestTreeListsEntries(t *testing.T) {
	e := newTestEnv(t, false)
	writeFile(t, e.dir, "a.md", "# a\n")
	writeFile(t, e.dir, "sub/b.md", "# b\n")

	w := e.do(e.h.Tree, http.MethodGet, "/tree?path=.", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var nodes []model.FileNode
	decode(t, w, &nodes)

	names := map[string]bool{}
	for _, n := range nodes {
		names[n.Name] = true
	}
	require.True(t, names["a.md"])
	require.True(t, names["sub"])
}

func TestTreeDefaultPathIsDot(t *testing.T) {
	e := newTestEnv(t, false)
	writeFile(t, e.dir, "a.md", "# a\n")

	// No path param ⇒ defaults to ".".
	w := e.do(e.h.Tree, http.MethodGet, "/tree", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var nodes []model.FileNode
	decode(t, w, &nodes)
	require.NotEmpty(t, nodes)
}

func TestTreeBadPath400Detail(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.Tree, http.MethodGet, "/tree?path=/etc", "", true)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "detail")
	require.NotContains(t, env, "error")
}

func TestFilesAllSingleRepoSentinel(t *testing.T) {
	e := newTestEnv(t, false)
	writeFile(t, e.dir, "a.md", "# a\n")
	writeFile(t, e.dir, "sub/b.md", "# b\n")

	w := e.do(e.h.FilesAll, http.MethodGet, "/files/all", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var files []model.RepoFile
	decode(t, w, &files)
	require.NotEmpty(t, files)
	for _, f := range files {
		require.Equal(t, "", f.Repo) // single-repo ⇒ empty repo name
		require.NotEmpty(t, f.Path)
	}
}

func TestFilesAllEmptyWhenNoServices(t *testing.T) {
	e := newTestEnv(t, false)
	// No RepoServices in context (daemon mode without server override) ⇒ [].
	w := e.do(e.h.FilesAll, http.MethodGet, "/files/all", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `[]`, w.Body.String())
}

func TestRecentAllTagsRepo(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# a\n")
	commitAll(t, e.dir, "add a")

	w := e.do(e.h.RecentAll, http.MethodGet, "/recent/all", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var items []RecentAllItem
	decode(t, w, &items)
	require.NotEmpty(t, items)
	for _, it := range items {
		require.Equal(t, "", it.Repo)
		require.NotEmpty(t, it.Path)
	}
}

func TestRecentAllItemHasRepoAndFileKeys(t *testing.T) {
	// The flattened element must carry both "repo" and the RecentFile keys.
	item := RecentAllItem{
		Repo:       "myrepo",
		RecentFile: model.RecentFile{Path: "a.md"},
	}
	b, err := json.Marshal(item)
	require.NoError(t, err)
	var m map[string]any
	require.NoError(t, json.Unmarshal(b, &m))
	require.Contains(t, m, "repo")
	require.Contains(t, m, "path")
	require.Contains(t, m, "date")
	require.Equal(t, "myrepo", m["repo"])
}
