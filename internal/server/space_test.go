package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mschulkind-oss/vantage/internal/config"
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

// addWorktree lays out a linked worktree of the main checkout main at
// worktree, as `git worktree add` leaves one: .git/worktrees/<name> holding
// gitdir, naming the worktree's .git file, and commondir; the worktree's .git
// file naming that directory back; and the main checkout's files, as its
// branch would hold them.
func addWorktree(t *testing.T, main, name, worktree string) {
	t.Helper()
	admin := filepath.Join(main, ".git", "worktrees", name)
	require.NoError(t, os.MkdirAll(admin, 0o755))
	head, err := os.ReadFile(filepath.Join(main, ".git", "HEAD"))
	require.NoError(t, err)
	for file, text := range map[string]string{
		"commondir": "../..\n",
		"gitdir":    filepath.Join(worktree, ".git") + "\n",
		"HEAD":      string(head),
	} {
		require.NoError(t, os.WriteFile(filepath.Join(admin, file), []byte(text), 0o644))
	}
	require.NoError(t, os.MkdirAll(worktree, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: "+admin+"\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(worktree, "a.md"), []byte("# A\n"), 0o644))
}

// daemonOf builds a daemon Server serving roots, by name, in the order given.
func daemonOf(t *testing.T, roots ...[2]string) *Server {
	t.Helper()
	cfg := config.Defaults()
	cfg.MultiRepo = true
	for _, r := range roots {
		cfg.Repos = append(cfg.Repos, config.RepoConfig{Name: r[0], Path: r[1]})
	}
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)
	return srv
}

// singleOf builds a single-project Server serving root.
func singleOf(t *testing.T, root string) *Server {
	t.Helper()
	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)
	return srv
}

// vantage-check makes a linked worktree's id in the worktree itself, so the
// link names the checkout it was made in. A Vantage serving that worktree
// finds it in the worktree's own file, and one serving only the main
// checkout finds it through the main checkout's .git/worktrees, so the link
// opens a project either way; served both, the worktree's own project wins.
func TestASpaceIDMadeInALinkedWorktreeOpensWhicheverCheckoutIsServed(t *testing.T) {
	isolateUserDirs(t)
	main := initRepo(t, map[string]string{"a.md": "# A\n"})
	worktree := filepath.Join(t.TempDir(), "main-feature")
	addWorktree(t, main, "main-feature", worktree)
	putSpace(t, worktree, "qrstuvwxyz234567")
	putSpace(t, main, "abcdefghijklmnop")

	// Plain `vantage` in the worktree: single-project mode, serving it.
	h := singleOf(t, worktree).Handler()
	require.JSONEq(t, `{"repo":""}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
	require.JSONEq(t, `{"repo":null}`, spaceAnswer(t, h, "abcdefghijklmnop"))

	// Only the main checkout served, in either mode.
	h = singleOf(t, main).Handler()
	require.JSONEq(t, `{"repo":""}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
	require.JSONEq(t, `{"repo":""}`, spaceAnswer(t, h, "abcdefghijklmnop"))
	other := initRepo(t, map[string]string{"b.md": "# B\n"})
	h = daemonOf(t, [2]string{"other", other}, [2]string{"proj", main}).Handler()
	require.JSONEq(t, `{"repo":"proj"}`, spaceAnswer(t, h, "qrstuvwxyz234567"))

	// Both served: each id opens the checkout it was made in, whichever is
	// registered first.
	for _, order := range [][2][2]string{
		{{"proj", main}, {"proj-feature", worktree}},
		{{"proj-feature", worktree}, {"proj", main}},
	} {
		h = daemonOf(t, order[0], order[1]).Handler()
		require.JSONEq(t, `{"repo":"proj-feature"}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
		require.JSONEq(t, `{"repo":"proj"}`, spaceAnswer(t, h, "abcdefghijklmnop"))
	}
}

// A bare repository kept as a folder's .git (`git clone --bare url
// proj/.git`, worktrees under proj): proj is no checkout, so a link made in
// one of its worktrees does not open it, whose paths would all sit under the
// worktree's folder.
func TestABareRepositorysFolderDoesNotAnswerForItsWorktrees(t *testing.T) {
	isolateUserDirs(t)
	proj := initRepo(t, map[string]string{"a.md": "# A\n"})
	worktree := filepath.Join(proj, "main")
	addWorktree(t, proj, "main", worktree)
	putSpace(t, worktree, "qrstuvwxyz234567")
	h := daemonOf(t, [2]string{"proj", proj}).Handler()
	require.JSONEq(t, `{"repo":"proj"}`, spaceAnswer(t, h, "qrstuvwxyz234567"))

	config := filepath.Join(proj, ".git", "config")
	text, err := os.ReadFile(config)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(config, []byte(strings.ReplaceAll(string(text), "bare = false", "bare = true")), 0o644))
	require.JSONEq(t, `{"repo":null}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
}

// Two projects holding one id, a checkout copied whole with its .vantage,
// name none of them: the answer lists both, so the page can say so instead
// of opening one that may be the wrong one, and the log says it once.
func TestTwoProjectsHoldingOneSpaceIDAreBothNamed(t *testing.T) {
	isolateUserDirs(t)
	alpha := initRepo(t, map[string]string{"a.md": "# A\n"})
	beta := initRepo(t, map[string]string{"b.md": "# B\n"})
	copied := initRepo(t, map[string]string{"a.md": "# A\n"})
	putSpace(t, alpha, "abcdefghijklmnop")
	putSpace(t, copied, "abcdefghijklmnop")
	putSpace(t, beta, "qrstuvwxyz234567")
	srv := daemonOf(t, [2]string{"alpha", alpha}, [2]string{"beta", beta}, [2]string{"alpha-copy", copied})
	logs := captureWarnings(srv)
	h := srv.Handler()

	for range 3 {
		require.JSONEq(t, `{"repo":null,"repos":["alpha","alpha-copy"]}`, spaceAnswer(t, h, "abcdefghijklmnop"))
	}
	require.JSONEq(t, `{"repo":"beta"}`, spaceAnswer(t, h, "qrstuvwxyz234567"))
	require.Equal(t, 1, strings.Count(logs.String(), "hold one space id"), logs.String())

	// Removed from the copy, as the page tells the reader to, the id names
	// the original again; made again elsewhere, the clash is said again.
	require.NoError(t, os.Remove(filepath.Join(copied, ".vantage", "space")))
	require.JSONEq(t, `{"repo":"alpha"}`, spaceAnswer(t, h, "abcdefghijklmnop"))
	putSpace(t, beta, "abcdefghijklmnop")
	stamp := time.Now().Add(time.Second)
	require.NoError(t, os.Chtimes(filepath.Join(beta, ".vantage", "space"), stamp, stamp))
	require.JSONEq(t, `{"repo":null,"repos":["alpha","beta"]}`, spaceAnswer(t, h, "abcdefghijklmnop"))
	require.Equal(t, 2, strings.Count(logs.String(), "hold one space id"), logs.String())
}
