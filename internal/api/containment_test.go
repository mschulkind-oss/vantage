package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestNoEndpointLeaksOutsideTheRoot sweeps every path-taking endpoint with the
// two shapes that escape a repository root — a planted symlink and plain "../"
// traversal — and asserts none of them ever puts out-of-root file content in a
// response body.
//
// It is deliberately a table over endpoints rather than a test per bug. The
// symlink hole was found in /content and turned out to be open in
// /git/diff/working too, by a different route with its own validation gap; a
// test shaped like "the one we know about" would have missed the second. Add a
// row here whenever an endpoint learns to take a path.
func TestNoEndpointLeaksOutsideTheRoot(t *testing.T) {
	e := newTestEnv(t, true)

	outside := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(outside); err == nil {
		outside = resolved
	}
	const canary = "OUT-OF-ROOT-CANARY"
	for _, name := range []string{"secret.md", "secret.png"} {
		require.NoError(t, os.WriteFile(filepath.Join(outside, name), []byte(canary+"\n"), 0o600))
	}

	writeFile(t, e.dir, "real.md", "# real\n")
	commitAll(t, e.dir, "init")

	// Planted symlinks, left untracked — the state an attacker's branch or an
	// untrusted clone arrives in.
	require.NoError(t, os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(e.dir, "link.md")))
	require.NoError(t, os.Symlink(filepath.Join(outside, "secret.png"), filepath.Join(e.dir, "link.png")))
	require.NoError(t, os.Symlink(outside, filepath.Join(e.dir, "linkdir")))

	up := "../" + filepath.Base(outside) + "/secret.md"

	cases := []struct {
		name string
		h    http.HandlerFunc
		url  string
	}{
		{"content via symlinked file", e.h.Content, "/content?path=link.md"},
		{"content via symlinked dir", e.h.Content, "/content?path=linkdir/secret.md"},
		{"content raw-image branch", e.h.Content, "/content?path=link.png"},
		{"content image via symlinked dir", e.h.Content, "/content?path=linkdir/secret.png"},
		{"content via traversal", e.h.Content, "/content?path=" + up},
		{"working diff via symlink", e.h.GitWorkingDiff, "/git/diff/working?path=link.md"},
		{"working diff via traversal", e.h.GitWorkingDiff, "/git/diff/working?path=" + up},
		{"history via symlink", e.h.GitHistory, "/git/history?path=link.md"},
		{"history via traversal", e.h.GitHistory, "/git/history?path=" + up},
		{"status via traversal", e.h.GitStatus, "/git/status?path=" + up},
		{"review via traversal", e.h.ReviewGet, "/review?path=" + up},
		{"tree via symlinked dir", e.h.Tree, "/tree?path=linkdir"},
		{"tree via traversal", e.h.Tree, "/tree?path=.."},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := e.do(c.h, http.MethodGet, c.url, "", true)
			require.NotContains(t, w.Body.String(), canary,
				"%s disclosed a file outside the repository root", c.url)
			// Filenames outside the root are disclosure too, even when the
			// contents stay unreadable.
			require.False(t, strings.Contains(w.Body.String(), "secret.md") && w.Code == http.StatusOK,
				"%s enumerated a filename outside the repository root", c.url)
		})
	}
}
