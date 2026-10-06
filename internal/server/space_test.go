package server

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// putSpace writes id as root's .vantage/space, as vantage-check writes it.
func putSpace(t *testing.T, root, id string) {
	t.Helper()
	dir := filepath.Join(root, ".vantage")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "space"), []byte(id+"\n"), 0o644))
}

// spaceAnswer is GET /api/spaces/{id}'s body, through the whole router.
func spaceAnswer(t *testing.T, h http.Handler, id string) string {
	t.Helper()
	rec := doGET(t, h, "/api/spaces/"+id)
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	require.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	return rec.Body.String()
}

// treeOf lists every path under root but .git, so a test can say a lookup
// wrote nothing.
func treeOf(t *testing.T, root string) []string {
	t.Helper()
	var out []string
	require.NoError(t, filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && d.Name() == ".git" {
			return filepath.SkipDir
		}
		rel, err := filepath.Rel(root, path)
		require.NoError(t, err)
		out = append(out, rel)
		return nil
	}))
	return out
}

// In daemon mode a space id names the project whose checkout holds it, and an
// id no served checkout holds is answered null.
func TestDaemonAnswersWhichProjectHoldsASpaceID(t *testing.T) {
	srv, roots := daemonServer(t)
	h := srv.Handler()
	putSpace(t, roots["beta"], "qrstuvwxyz234567")
	putSpace(t, roots["alpha"], "abcdefghijklmnop")

	require.JSONEq(t, `{"repo":"beta"}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
	require.JSONEq(t, `{"repo":"alpha"}`, spaceAnswer(t, h, "abcdefghijklmnop"))
	require.JSONEq(t, `{"repo":null}`, spaceAnswer(t, h, "2222222222222222"))

	// Global: there is no /r/{repo} form, and the legacy-mode refusal that
	// answers a repo-scoped route at /api in daemon mode does not apply to it.
	rec := doGET(t, h, "/api/r/alpha/spaces/abcdefghijklmnop")
	require.Equal(t, http.StatusNotFound, rec.Code)
}

// In single-project mode the answer is whether this server's one project holds
// it: the single-repo sentinel "", or null.
func TestSingleRepoAnswersWhetherItHoldsASpaceID(t *testing.T) {
	srv, root := singleRepoServer(t)
	h := srv.Handler()

	require.JSONEq(t, `{"repo":null}`, spaceAnswer(t, h, "abcdefghijklmnop"))
	putSpace(t, root, "abcdefghijklmnop")
	require.JSONEq(t, `{"repo":""}`, spaceAnswer(t, h, "abcdefghijklmnop"))
	require.JSONEq(t, `{"repo":null}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
}

// The file is read again when it changes: a new id is found at once, and the
// old one is no longer answered.
func TestASpaceIDIsReadAgainWhenTheFileChanges(t *testing.T) {
	srv, roots := daemonServer(t)
	h := srv.Handler()
	putSpace(t, roots["alpha"], "abcdefghijklmnop")
	require.JSONEq(t, `{"repo":"alpha"}`, spaceAnswer(t, h, "abcdefghijklmnop"))

	path := filepath.Join(roots["alpha"], ".vantage", "space")
	before, err := os.Stat(path)
	require.NoError(t, err)
	putSpace(t, roots["alpha"], "qrstuvwxyz234567")
	// The same size, so the time has to differ, which a coarse clock may not
	// arrange by itself.
	stamp := before.ModTime().Add(time.Second)
	require.NoError(t, os.Chtimes(path, stamp, stamp))

	require.JSONEq(t, `{"repo":"alpha"}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
	require.JSONEq(t, `{"repo":null}`, spaceAnswer(t, h, "abcdefghijklmnop"))

	require.NoError(t, os.Remove(path))
	require.JSONEq(t, `{"repo":null}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
}

// A path segment that is no space id is refused before any checkout is looked
// at, whatever the checkouts hold.
func TestASpaceLookupRefusesWhatIsNoSpaceID(t *testing.T) {
	srv, roots := daemonServer(t)
	h := srv.Handler()
	putSpace(t, roots["alpha"], "abcdefghijklmnop")

	for _, id := range []string{
		"ABCDEFGHIJKLMNOP",
		"abcdefghijklmno",
		"abcdefghijklmnopq",
		"abcdefghijklmn01",
		"..%2F..%2Fetc",
		"abcdefghijklmnop%0A",
	} {
		rec := doGET(t, h, "/api/spaces/"+id)
		require.Equalf(t, http.StatusBadRequest, rec.Code, "%q: %s", id, rec.Body.String())
		require.JSONEq(t, `{"error":"Not a space id"}`, rec.Body.String())
	}
}

// Answering reads and never writes: a checkout with no .vantage still has
// none, and one with a malformed file keeps it as it was.
func TestASpaceLookupWritesNothing(t *testing.T) {
	srv, roots := daemonServer(t)
	h := srv.Handler()
	putSpace(t, roots["beta"], "not a space id")
	alphaBefore := treeOf(t, roots["alpha"])
	betaBefore := treeOf(t, roots["beta"])

	for _, id := range []string{"abcdefghijklmnop", "qrstuvwxyz234567"} {
		require.JSONEq(t, `{"repo":null}`, spaceAnswer(t, h, id))
	}

	require.Equal(t, alphaBefore, treeOf(t, roots["alpha"]))
	require.NotContains(t, treeOf(t, roots["alpha"]), ".vantage")
	require.Equal(t, betaBefore, treeOf(t, roots["beta"]))
	data, err := os.ReadFile(filepath.Join(roots["beta"], ".vantage", "space"))
	require.NoError(t, err)
	require.Equal(t, "not a space id\n", string(data))
}
