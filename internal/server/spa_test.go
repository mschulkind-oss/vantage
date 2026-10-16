package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"
)

// A restored tab must not reuse HTML pointing to a previous binary's hashed
// assets. Test routes independently of whether a frontend bundle is embedded.
func TestSPAPagesAreNotCached(t *testing.T) {
	h := (&Server{}).spaHandler()
	for _, target := range []string{"/", "/index.html", "/project/doc.md", "/.vantage/planning/project?filter=path:doc.md"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(method+target, func(t *testing.T) {
				r := httptest.NewRequest(method, target, nil)
				r.Header.Set("Accept", "text/html")
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				require.Equal(t, http.StatusOK, w.Code)
				require.Contains(t, w.Header().Get("Content-Type"), "text/html")
				require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
				if method == http.MethodHead {
					require.Empty(t, w.Body.String())
				}
			})
		}
	}
}

func TestMissingBundleAssetsAreNotSPAPages(t *testing.T) {
	h := (&Server{}).spaHandler()
	for _, target := range []string{"/assets/index-old.js", "/assets/index-old.css", "/assets/font-old.woff2"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(method+target, func(t *testing.T) {
				r := httptest.NewRequest(method, target, nil)
				r.Header.Set("Accept", "*/*")
				w := httptest.NewRecorder()
				h.ServeHTTP(w, r)
				require.Equal(t, http.StatusNotFound, w.Code)
				require.NotContains(t, w.Header().Get("Content-Type"), "text/html")
				require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
				require.NotContains(t, w.Body.String(), "<html")
			})
		}
	}
}

// "assets" can also be a repository or folder name; document navigations
// still need the viewer, not an asset 404.
func TestBrowserCanNavigateToAnAssetsFolder(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/assets/notes.md", nil)
	r.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
	w := httptest.NewRecorder()
	(&Server{}).spaHandler().ServeHTTP(w, r)
	require.Equal(t, http.StatusOK, w.Code)
	require.Contains(t, w.Header().Get("Content-Type"), "text/html")
}

func TestStaticHTMLIsNotCached(t *testing.T) {
	dist := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><html>current</html>")}}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/index.html", nil)
	require.True(t, serveStaticAsset(w, r, dist, "index.html"))
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	require.Contains(t, w.Body.String(), "current")
}

func TestExistingBundleAssetsKeepTheirContentType(t *testing.T) {
	dist := fstest.MapFS{
		"assets/index-current.js":  {Data: []byte("console.log('current');")},
		"assets/index-current.css": {Data: []byte("body { color: red; }")},
	}
	for rel, contentType := range map[string]string{"assets/index-current.js": "javascript", "assets/index-current.css": "text/css"} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/"+rel, nil)
		require.True(t, serveStaticAsset(w, r, dist, rel))
		require.Equal(t, http.StatusOK, w.Code)
		require.Contains(t, w.Header().Get("Content-Type"), contentType)
		require.Equal(t, string(dist[rel].Data), w.Body.String())
	}
}
