package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/gitenv"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/repoconfig"
	"github.com/mschulkind-oss/vantage/web"
)

// initRepo creates a temp git repo with one committed markdown file and returns
// its root. Tests that exercise the git-backed routes need a real repo because
// the git service shells out to the git binary.
func initRepo(t *testing.T, files map[string]string) string {
	t.Helper()
	return initRepoAt(t, t.TempDir(), files)
}

// initRepoAt is initRepo at a caller-chosen path, for the discovery tests: a
// repository has to be created *inside* a source dir to be discovered there,
// which a fresh t.TempDir() cannot be.
func initRepoAt(t *testing.T, root string, files map[string]string) string {
	t.Helper()
	require.NoError(t, os.MkdirAll(root, 0o755))

	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = append(gitenv.Scrubbed(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
			"GIT_CONFIG_NOSYSTEM=1",
		)
		out, err := cmd.CombinedOutput()
		require.NoErrorf(t, err, "git %v: %s", args, out)
	}

	run("init", "-q")
	run("config", "user.email", "test@example.com")
	run("config", "user.name", "Test")

	for name, content := range files {
		full := filepath.Join(root, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
	}
	if len(files) > 0 {
		run("add", "-A")
		run("commit", "-q", "-m", "init")
	}
	return root
}

// singleRepoServer builds a single-repo Server rooted at a fresh git repo.
func singleRepoServer(t *testing.T) (*Server, string) {
	t.Helper()
	isolateUserDirs(t)
	root := initRepo(t, map[string]string{"doc.md": "# Title\n\nbody\n"})

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())

	srv, err := NewServer(cfg)
	require.NoError(t, err)
	return srv, root
}

// daemonServer builds a daemon (multi-repo) Server with two named git repos.
func daemonServer(t *testing.T) (*Server, map[string]string) {
	t.Helper()
	isolateUserDirs(t)
	rootA := initRepo(t, map[string]string{"a.md": "# A\n"})
	rootB := initRepo(t, map[string]string{"b.md": "# B\n"})

	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.Repos = []config.RepoConfig{
		{Name: "alpha", Path: rootA},
		{Name: "beta", Path: rootB},
	}
	require.NoError(t, cfg.Resolve())

	srv, err := NewServer(cfg)
	require.NoError(t, err)
	return srv, map[string]string{"alpha": rootA, "beta": rootB}
}

// discoveryServer builds a daemon Server whose repositories all come from one
// source dir — the shape `source_dirs = ["~/code"]` produces — with "alpha"
// already in it at startup. It returns the server and that source dir, so a
// test can create a second repository in it and watch the daemon pick it up.
// The refresh loop is retuned to a test-scale period; production runs it at
// [defaultRefreshInterval].
func discoveryServer(t *testing.T) (*Server, string) {
	t.Helper()
	isolateUserDirs(t)
	sourceDir := t.TempDir()
	initRepoAt(t, filepath.Join(sourceDir, "alpha"), map[string]string{"a.md": "# A\n"})

	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.SourceDirs = []string{sourceDir}
	require.NoError(t, cfg.Resolve())
	// LoadDaemonFile runs this one startup scan; the loop is what this file is
	// about, so the fixture has to start from the same place production does.
	require.Len(t, cfg.DiscoverReposFromSourceDirs(), 1)

	srv, err := NewServer(cfg)
	require.NoError(t, err)
	srv.refreshInterval = 20 * time.Millisecond
	return srv, cfg.SourceDirs[0]
}

// repoNames returns the names GET /api/repos currently reports.
func repoNames(t *testing.T, h http.Handler) []string {
	t.Helper()
	rec := doGET(t, h, "/api/repos")
	require.Equal(t, http.StatusOK, rec.Code)
	var infos []model.RepoInfo
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &infos))
	out := make([]string, 0, len(infos))
	for _, i := range infos {
		out = append(out, i.Name)
	}
	return out
}

// waitFor polls cond on the test goroutine — where the require calls inside it
// belong — until it holds or the deadline passes.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func doGET(t *testing.T, h http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHealth(t *testing.T) {
	srv, _ := singleRepoServer(t)
	rec := doGET(t, srv.Handler(), "/api/health")
	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{"status":"ok"}`, rec.Body.String())
}

func TestReposSingleRepoSentinel(t *testing.T) {
	// R4: single-repo mode MUST return exactly [{"name":""}]. Anything else
	// (including []) makes the frontend route as multi-repo.
	srv, _ := singleRepoServer(t)
	rec := doGET(t, srv.Handler(), "/api/repos")
	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `[{"name":"","last_activity":null}]`, rec.Body.String())
}

func TestTreeSingleRepoLegacyAndMulti(t *testing.T) {
	srv, _ := singleRepoServer(t)
	h := srv.Handler()

	// Legacy route works in single-repo mode and lists the committed file.
	rec := doGET(t, h, "/api/tree?path=.")
	require.Equal(t, http.StatusOK, rec.Code)
	var nodes []map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &nodes))
	require.NotEmpty(t, nodes, "tree should list the committed doc.md")

	found := false
	for _, n := range nodes {
		if n["path"] == "doc.md" {
			found = true
		}
	}
	require.True(t, found, "doc.md should appear in the tree listing")

	// A named /r/{repo}/tree request 404s in single-repo mode (only "" exists).
	rec = doGET(t, h, "/api/r/whatever/tree?path=.")
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestDaemonLegacyRoutes404(t *testing.T) {
	srv, _ := daemonServer(t)
	h := srv.Handler()

	for _, path := range []string{
		"/api/tree?path=.",
		"/api/git/history?path=a.md",
		"/api/files",
		"/api/version",
		"/api/info",
	} {
		rec := doGET(t, h, path)
		require.Equalf(t, http.StatusNotFound, rec.Code, "legacy %s must 404 in daemon mode", path)
	}
}

func TestDaemonRepoResolvesAndUnknown404(t *testing.T) {
	srv, _ := daemonServer(t)
	h := srv.Handler()

	// Known repo resolves: its committed file appears.
	rec := doGET(t, h, "/api/r/alpha/tree?path=.")
	require.Equal(t, http.StatusOK, rec.Code)
	var nodes []map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &nodes))
	found := false
	for _, n := range nodes {
		if n["path"] == "a.md" {
			found = true
		}
	}
	require.True(t, found, "a.md should appear under repo alpha")

	// The other repo also resolves independently.
	rec = doGET(t, h, "/api/r/beta/tree?path=.")
	require.Equal(t, http.StatusOK, rec.Code)

	// Unknown repo 404s.
	rec = doGET(t, h, "/api/r/ghost/tree?path=.")
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestDaemonReposFanOut(t *testing.T) {
	srv, _ := daemonServer(t)
	// Warm the activity cache so last_activity is populated from the commits.
	srv.warmActivity(context.Background())

	rec := doGET(t, srv.Handler(), "/api/repos")
	require.Equal(t, http.StatusOK, rec.Code)

	var repos []map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &repos))
	require.Len(t, repos, 2)
	require.Equal(t, "alpha", repos[0]["name"])
	require.Equal(t, "beta", repos[1]["name"])
	// Each repo has a commit, so last_activity must be a non-null RFC3339 string.
	require.NotNil(t, repos[0]["last_activity"])
	require.IsType(t, "", repos[0]["last_activity"])
}

func TestDaemonFilesAllFanOut(t *testing.T) {
	srv, _ := daemonServer(t)
	rec := doGET(t, srv.Handler(), "/api/files/all")
	require.Equal(t, http.StatusOK, rec.Code)

	var files []map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &files))

	got := map[string]string{}
	for _, f := range files {
		got[f["repo"]] = f["path"]
	}
	require.Equal(t, "a.md", got["alpha"])
	require.Equal(t, "b.md", got["beta"])
}

func TestDaemonRecentAllFanOutAndLimit(t *testing.T) {
	srv, _ := daemonServer(t)
	h := srv.Handler()

	rec := doGET(t, h, "/api/recent/all")
	require.Equal(t, http.StatusOK, rec.Code)
	var items []map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &items))
	require.GreaterOrEqual(t, len(items), 2, "both repos' markdown should appear in recents")

	// limit is clamped and honored across the merged set.
	rec = doGET(t, h, "/api/recent/all?limit=1")
	require.Equal(t, http.StatusOK, rec.Code)
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &items))
	require.Len(t, items, 1)
}

func TestDaemonPerfDiagnosticsShape(t *testing.T) {
	srv, _ := daemonServer(t)
	rec := doGET(t, srv.Handler(), "/api/perf/diagnostics?include_shape=true")
	require.Equal(t, http.StatusOK, rec.Code)

	var diag map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &diag))
	shape, ok := diag["repo_shape"].(map[string]any)
	require.True(t, ok, "repo_shape must be present with include_shape=true")
	require.Contains(t, shape, "repo_1")
	require.Contains(t, shape, "repo_2")
}

func TestSPAFallbackServesIndex(t *testing.T) {
	if _, err := web.IndexHTML(); err != nil {
		t.Skip("frontend bundle not embedded; run 'just build' (CI bundles before tests)")
	}
	srv, _ := singleRepoServer(t)
	rec := doGET(t, srv.Handler(), "/some/client/route")
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Header().Get("Content-Type"), "text/html")
	require.Contains(t, rec.Body.String(), "<html")
}

func TestUnknownAPIRoute404(t *testing.T) {
	srv, _ := singleRepoServer(t)
	rec := doGET(t, srv.Handler(), "/api/does-not-exist")
	require.Equal(t, http.StatusNotFound, rec.Code)
	require.Contains(t, rec.Header().Get("Content-Type"), "application/json")
}

func TestSecurityHeaders(t *testing.T) {
	srv, _ := singleRepoServer(t)
	rec := doGET(t, srv.Handler(), "/api/health")
	require.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	require.Equal(t, "DENY", rec.Header().Get("X-Frame-Options"))
	require.Equal(t, "strict-origin-when-cross-origin", rec.Header().Get("Referrer-Policy"))
}

// doJSON sends a JSON-bodied request through the assembled router.
func doJSON(t *testing.T, h http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// isolateUserDirs points $HOME at a temp dir BEFORE NewServer resolves the
// per-user paths under it, so a test never reads or writes the developer's real
// ~/.local/share/vantage/reviews or ~/.local/share/vantage/starred.
//
// Every server constructor in this file calls it, so a test gets the isolation
// by building a server rather than by remembering to ask for it. It was named
// isolateReviewDir while reviews were the only thing under $HOME.
//
// USERPROFILE is set alongside HOME because that is the one os.UserHomeDir
// reads on windows — setting only HOME would leave a windows run writing into
// the developer's real profile while looking isolated.
func isolateUserDirs(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
}

func TestReviewCommandRoutesMountedPerRepo(t *testing.T) {
	srv, _ := daemonServer(t)
	h := srv.Handler()

	// Create a comment in alpha through the multi mounting, exercising the
	// {id}-less command route end to end (chi resolve middleware included).
	rec := doJSON(t, h, http.MethodPost, "/api/r/alpha/review/comments?path=a.md",
		`{"id":"c1","comment":"tighten","anchor":{"source_line":1,"block_text_hash":"x","selection_offset":0,"selection_length":0},"created_at":1717000000}`)
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

	// The review landed keyed by the alpha repo name…
	stored, err := srv.reviews.Get("a.md", "alpha")
	require.NoError(t, err)
	require.NotNil(t, stored)
	require.Len(t, stored.Comments, 1)
	// …and captured the anchored block of alpha's committed a.md.
	require.Equal(t, "# a", stored.Comments[0].CapturedBlock)

	// beta is untouched: same path, different repo, separate review.
	other, err := srv.reviews.Get("a.md", "beta")
	require.NoError(t, err)
	require.Nil(t, other)

	// An {id} command resolves through the multi mounting too.
	rec = doJSON(t, h, http.MethodPatch, "/api/r/alpha/review/comments/c1?path=a.md", `{"resolved":true}`)
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	stored, err = srv.reviews.Get("a.md", "alpha")
	require.NoError(t, err)
	require.True(t, stored.Comments[0].Resolved)

	// Legacy command routes are disabled in daemon mode, like every repo route.
	rec = doJSON(t, h, http.MethodPost, "/api/review/comments?path=a.md", `{"id":"c2","comment":"x"}`)
	require.Equal(t, http.StatusNotFound, rec.Code)

	// Unknown repo 404s before the handler runs.
	rec = doJSON(t, h, http.MethodPost, "/api/r/ghost/review/comments?path=a.md", `{"id":"c2","comment":"x"}`)
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestReviewChangedBroadcastReachesWebSocket(t *testing.T) {
	srv, _ := singleRepoServer(t)

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+ts.URL[len("http"):]+"/api/ws", nil)
	require.NoError(t, err)
	defer ws.Close(websocket.StatusNormalClosure, "")

	// First frame is the hello.
	_, data, err := ws.Read(ctx)
	require.NoError(t, err)
	var hello map[string]any
	require.NoError(t, json.Unmarshal(data, &hello))
	require.Equal(t, "hello", hello["type"])

	// A successful command must push review_changed through the live hub.
	resp, err := http.Post(ts.URL+"/api/review/comments?path=doc.md", "application/json",
		strings.NewReader(`{"id":"c1","comment":"tighten","created_at":1717000000}`))
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	_, data, err = ws.Read(ctx)
	require.NoError(t, err)
	// Repo is the explicit single-repo sentinel "", not an omitted key.
	require.JSONEq(t, `{"type":"review_changed","repo":"","path":"doc.md"}`, string(data))
}

func TestRunAndShutdown(t *testing.T) {
	srv, _ := singleRepoServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx) }()

	cancel()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after context cancel")
	}
	require.NoError(t, srv.Shutdown(context.Background()))
}

// A repository that appears under a source dir after startup used to stay
// invisible until the daemon was restarted: LoadDaemonFile ran the only scan
// there ever was.
func TestSourceDirRepoIsServedWithoutRestart(t *testing.T) {
	srv, sourceDir := discoveryServer(t)
	h := srv.Handler()
	require.Equal(t, []string{"alpha"}, repoNames(t, h))

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx) }()

	initRepoAt(t, filepath.Join(sourceDir, "beta"), map[string]string{"b.md": "# B\n"})

	waitFor(t, "the new repository to be discovered", func() bool {
		return slices.Contains(repoNames(t, h), "beta")
	})

	// Listed is not enough: the discovered repo has to resolve as a repo, which
	// means its own services were built and registered, not just its name.
	rec := doGET(t, h, "/api/r/beta/tree?path=.")
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "b.md")

	cancel()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after context cancel")
	}
	require.NoError(t, srv.Shutdown(context.Background()))
}

// Discovery that only the server knows about leaves every open browser showing
// a stale project list until someone reloads it, which is the same "restart
// something" complaint one level up.
func TestReposChangedBroadcastReachesWebSocket(t *testing.T) {
	srv, sourceDir := discoveryServer(t)

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	runCtx, stop := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- srv.Run(runCtx) }()
	defer func() {
		stop()
		<-done
		require.NoError(t, srv.Shutdown(context.Background()))
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+ts.URL[len("http"):]+"/api/ws", nil)
	require.NoError(t, err)
	defer ws.Close(websocket.StatusNormalClosure, "")

	// First frame is the hello.
	_, data, err := ws.Read(ctx)
	require.NoError(t, err)
	var hello map[string]any
	require.NoError(t, json.Unmarshal(data, &hello))
	require.Equal(t, "hello", hello["type"])

	initRepoAt(t, filepath.Join(sourceDir, "beta"), map[string]string{"b.md": "# B\n"})

	// Skip any files_changed a watcher emits while the repo is being created;
	// the push under test is the one that names the new repository.
	for {
		_, data, err = ws.Read(ctx)
		require.NoError(t, err)
		var msg map[string]any
		require.NoError(t, json.Unmarshal(data, &msg))
		if msg["type"] != "repos_changed" {
			continue
		}
		require.JSONEq(t, `{"type":"repos_changed","added":["beta"],"removed":[]}`, string(data))
		return
	}
}

func TestDiscoverReposAddsEachRepoOnce(t *testing.T) {
	srv, sourceDir := discoveryServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// The startup scan already saw alpha, so a pass with nothing new adds
	// nothing — otherwise every pass would re-register every repository.
	require.Empty(t, srv.discoverRepos(ctx))

	initRepoAt(t, filepath.Join(sourceDir, "beta"), map[string]string{"b.md": "# B\n"})
	require.Equal(t, []string{"beta"}, srv.discoverRepos(ctx))
	require.Empty(t, srv.discoverRepos(ctx))
}

func TestRetireReposDropsOnlyWhatIsGone(t *testing.T) {
	srv, sourceDir := discoveryServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// An explicitly configured repo is never retired, whatever happens to its
	// directory: the user asserted it should be served.
	configured := initRepo(t, map[string]string{"c.md": "# C\n"})
	srv.cfg.Repos = append(srv.cfg.Repos, config.RepoConfig{Name: "configured", Path: configured})
	srv.register("configured", configured)

	initRepoAt(t, filepath.Join(sourceDir, "beta"), map[string]string{"b.md": "# B\n"})
	require.Equal(t, []string{"beta"}, srv.discoverRepos(ctx))
	require.Empty(t, srv.retireRepos(), "nothing is missing yet")

	require.NoError(t, os.RemoveAll(filepath.Join(sourceDir, "beta")))
	require.NoError(t, os.RemoveAll(configured))

	require.Equal(t, []string{"beta"}, srv.retireRepos())
	require.Empty(t, srv.retireRepos(), "and not again once it is gone")

	names := repoNames(t, srv.Handler())
	require.NotContains(t, names, "beta")
	require.Contains(t, names, "configured")

	// A repo that stops being a git repo is gone by the same test that admitted
	// it, even though its directory is still there.
	require.NoError(t, os.RemoveAll(filepath.Join(sourceDir, "alpha", ".git")))
	require.Equal(t, []string{"alpha"}, srv.retireRepos())
}

// Ordering inside one reconciliation pass: the name a departing repository gives
// up is available to one arriving in the same pass. Discovering first would name
// the arrival "foo-2" — permanently, since nothing renames a repo later — and
// leave "foo" unused.
func TestRetiringFreesTheNameForANewcomer(t *testing.T) {
	isolateUserDirs(t)
	srcA, srcB := t.TempDir(), t.TempDir()
	initRepoAt(t, filepath.Join(srcA, "foo"), map[string]string{"a.md": "# A\n"})

	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.SourceDirs = []string{srcA, srcB}
	require.NoError(t, cfg.Resolve())
	require.Len(t, cfg.DiscoverReposFromSourceDirs(), 1)

	srv, err := NewServer(cfg)
	require.NoError(t, err)
	// Stop the watchers before the test's TempDirs are cleaned up: the
	// newcomer discovered below gets a watcher of its own, and on macOS
	// (kqueue) a live watcher holds the watched directories open, so
	// RemoveAll racing it fails the cleanup with EBADF. Every other test
	// in this file shuts the server down; this one forgot.
	defer func() { require.NoError(t, srv.Shutdown(context.Background())) }()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Same basename, different directory, inside one refresh window.
	require.NoError(t, os.RemoveAll(filepath.Join(srcA, "foo")))
	initRepoAt(t, filepath.Join(srcB, "foo"), map[string]string{"b.md": "# B\n"})

	require.Equal(t, []string{"foo"}, srv.retireRepos())
	require.Equal(t, []string{"foo"}, srv.discoverRepos(ctx))
	require.Equal(t, []string{"foo"}, repoNames(t, srv.Handler()))

	rec := doGET(t, srv.Handler(), "/api/r/foo/tree?path=.")
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "b.md", "the name now serves the new directory")
}

// The round trip the whole design rests on: a repository can leave and come
// back, and the browser watching it is told both times.
func TestRetiredRepoIsServedAgainWhenItReturns(t *testing.T) {
	srv, sourceDir := discoveryServer(t)
	h := srv.Handler()
	beta := filepath.Join(sourceDir, "beta")

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx) }()
	defer func() {
		cancel()
		<-done
		require.NoError(t, srv.Shutdown(context.Background()))
	}()

	initRepoAt(t, beta, map[string]string{"b.md": "# B\n"})
	waitFor(t, "beta to be served", func() bool {
		return slices.Contains(repoNames(t, h), "beta")
	})

	require.NoError(t, os.RemoveAll(beta))
	waitFor(t, "beta to be retired", func() bool {
		return !slices.Contains(repoNames(t, h), "beta")
	})
	// Retired means gone from the routing too, which is what makes the browser
	// show its "repository not found" page rather than a hung request.
	require.Equal(t, http.StatusNotFound, doGET(t, h, "/api/r/beta/tree?path=.").Code)

	initRepoAt(t, beta, map[string]string{"b.md": "# B again\n"})
	waitFor(t, "beta to come back", func() bool {
		return slices.Contains(repoNames(t, h), "beta")
	})
	rec := doGET(t, h, "/api/r/beta/content?path=b.md")
	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), "B again")
}

// Single-repo mode has no source dirs to scan, and its lone repository is keyed
// by the empty-name sentinel — a discovery pass that ran there would register a
// second repo under a name the sentinel routing cannot express.
func TestDiscoverReposIsDaemonOnly(t *testing.T) {
	srv, _ := singleRepoServer(t)
	srv.cfg.SourceDirs = []string{t.TempDir()}
	require.Empty(t, srv.discoverRepos(context.Background()))
	require.Equal(t, []string{""}, repoNames(t, srv.Handler()))
}

// jsEncodeURIComponent mirrors the browser's encodeURIComponent, which is what
// the frontend builds every /api/r/{repo}/… URL with. url.PathEscape is not a
// substitute: it leaves the sub-delims literal, which is precisely the class of
// character this test is about, so using it would make the test vacuous.
func jsEncodeURIComponent(s string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
	var b strings.Builder
	for _, by := range []byte(s) {
		if strings.IndexByte(unreserved, by) >= 0 {
			b.WriteByte(by)
			continue
		}
		fmt.Fprintf(&b, "%%%02X", by)
	}
	return b.String()
}

func TestRepoRouteResolvesAwkwardNames(t *testing.T) {
	// Repo names come from an explicit config name or a discovered directory
	// basename, neither of which is validated or slugified. Go leaves the
	// sub-delims literal in a URL path, so encodeURIComponent's escaping of them
	// survives into chi.URLParam and missed the map — the repo listed in the
	// sidebar and 404'd on every request against it.
	names := []string{"a+b", "at@x", "a&b", "re:po", "a=b", "a,b", "a;b", "a$b", "my repo", "café", "plain-repo_1.2"}

	cfg := config.Defaults()
	cfg.MultiRepo = true
	for _, name := range names {
		cfg.Repos = append(cfg.Repos, config.RepoConfig{
			Name: name,
			Path: initRepo(t, map[string]string{"doc.md": "# D\n"}),
		})
	}
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)
	h := srv.Handler()

	for _, name := range names {
		rec := doGET(t, h, "/api/r/"+jsEncodeURIComponent(name)+"/tree?path=.")
		require.Equal(t, http.StatusOK, rec.Code, "repo %q -> %s", name, jsEncodeURIComponent(name))
	}

	// A genuinely unknown repo still 404s, decoded or not.
	rec := doGET(t, h, "/api/r/"+jsEncodeURIComponent("no&such")+"/tree?path=.")
	require.Equal(t, http.StatusNotFound, rec.Code)
}

// --- Bookmarks ------------------------------------------------------------

// starredPaths returns the paths GET /api/starred currently reports.
func starredPaths(t *testing.T, h http.Handler) []string {
	t.Helper()
	rec := doGET(t, h, "/api/starred")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

	var body struct {
		Entries []struct {
			Repo string `json:"repo"`
			Path string `json:"path"`
		} `json:"entries"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))

	out := make([]string, 0, len(body.Entries))
	for _, e := range body.Entries {
		if e.Repo == "" {
			out = append(out, e.Path)
			continue
		}
		out = append(out, e.Repo+"/"+e.Path)
	}
	return out
}

// Bookmarks are keyed by the invocation, so unlike every other path-taking
// route they mount once and have no "/r/{repo}" form — in either mode.
func TestStarredRoutesAreGlobalInBothModes(t *testing.T) {
	t.Run("single repo", func(t *testing.T) {
		srv, _ := singleRepoServer(t)
		h := srv.Handler()

		rec := doJSON(t, h, http.MethodPost, "/api/starred", `{"repo":"","path":"doc.md"}`)
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		require.Equal(t, []string{"doc.md"}, starredPaths(t, h))
	})

	t.Run("daemon", func(t *testing.T) {
		srv, _ := daemonServer(t)
		h := srv.Handler()

		// The global route works even though every legacy repo route 404s here.
		rec := doJSON(t, h, http.MethodPost, "/api/starred", `{"repo":"alpha","path":"a.md"}`)
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

		// And there is deliberately no repo-scoped mounting to find.
		rec = doJSON(t, h, http.MethodPost, "/api/r/alpha/starred", `{"repo":"alpha","path":"a.md"}`)
		require.Equal(t, http.StatusNotFound, rec.Code,
			"/starred is ScopeGlobal; a /r/{repo} form would key bookmarks by repo, which they are not")
	})
}

// One list spans every served repository, which is the whole reason the store
// is keyed by the invocation rather than by repo.
func TestDaemonBookmarksSpanRepos(t *testing.T) {
	srv, _ := daemonServer(t)
	h := srv.Handler()

	for _, body := range []string{
		`{"repo":"alpha","path":"a.md"}`,
		`{"repo":"beta","path":"b.md"}`,
	} {
		rec := doJSON(t, h, http.MethodPost, "/api/starred", body)
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	}

	require.Equal(t, []string{"alpha/a.md", "beta/b.md"}, starredPaths(t, h))
}

// The acceptance criterion for "relaunching vantage in the same directory
// restores them": a second Server over the same config and home sees the first
// one's bookmarks, with no shared process state between them.
func TestBookmarksSurviveAServerRestart(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home) // what os.UserHomeDir reads on windows
	root := initRepo(t, map[string]string{"doc.md": "# Title\n"})

	newServerAt := func(t *testing.T) http.Handler {
		t.Helper()
		cfg := config.Defaults()
		cfg.TargetRepo = root
		require.NoError(t, cfg.Resolve())
		srv, err := NewServer(cfg)
		require.NoError(t, err)
		return srv.Handler()
	}

	first := newServerAt(t)
	rec := doJSON(t, first, http.MethodPost, "/api/starred", `{"repo":"","path":"doc.md"}`)
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

	second := newServerAt(t)
	require.Equal(t, []string{"doc.md"}, starredPaths(t, second),
		"a fresh process at the same root must see the bookmarks the last one left")
}

// A different root is a different list — bookmarks do not leak between projects.
func TestBookmarksAreScopedToTheirRoot(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home) // what os.UserHomeDir reads on windows

	handlerFor := func(t *testing.T, root string) http.Handler {
		t.Helper()
		cfg := config.Defaults()
		cfg.TargetRepo = root
		require.NoError(t, cfg.Resolve())
		srv, err := NewServer(cfg)
		require.NoError(t, err)
		return srv.Handler()
	}

	a := handlerFor(t, initRepo(t, map[string]string{"doc.md": "# A\n"}))
	b := handlerFor(t, initRepo(t, map[string]string{"doc.md": "# B\n"}))

	rec := doJSON(t, a, http.MethodPost, "/api/starred", `{"repo":"","path":"doc.md"}`)
	require.Equal(t, http.StatusOK, rec.Code)

	require.Equal(t, []string{"doc.md"}, starredPaths(t, a))
	require.Empty(t, starredPaths(t, b), "another root must start empty")
}

// The push is what keeps several open browsers in sync, so it has to reach a
// real socket rather than merely be wired.
func TestStarredChangedBroadcastReachesWebSocket(t *testing.T) {
	srv, _ := singleRepoServer(t)

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+ts.URL[len("http"):]+"/api/ws", nil)
	require.NoError(t, err)
	defer ws.Close(websocket.StatusNormalClosure, "")

	// First frame is the hello.
	_, data, err := ws.Read(ctx)
	require.NoError(t, err)
	var hello map[string]any
	require.NoError(t, json.Unmarshal(data, &hello))
	require.Equal(t, "hello", hello["type"])

	resp, err := http.Post(ts.URL+"/api/starred", "application/json",
		strings.NewReader(`{"repo":"","path":"doc.md"}`))
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	_, data, err = ws.Read(ctx)
	require.NoError(t, err)
	require.JSONEq(t, `{"type":"starred_changed"}`, string(data))
}

// starredRows returns the /starred list as "repo/path=source" strings, so a test
// can assert where each row came from as well as which rows there are.
func starredRows(t *testing.T, h http.Handler) []string {
	t.Helper()
	rec := doGET(t, h, "/api/starred")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

	var body struct {
		Entries []struct {
			Repo   string `json:"repo"`
			Path   string `json:"path"`
			Source string `json:"source"`
		} `json:"entries"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))

	out := make([]string, 0, len(body.Entries))
	for _, e := range body.Entries {
		out = append(out, path.Join(e.Repo, e.Path)+"="+e.Source)
	}
	return out
}

// writeRepoConfig puts a .vantage.toml at a repository root.
func writeRepoConfig(t *testing.T, root, body string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(root, ".vantage.toml"), []byte(body), 0o644))
	repoconfig.ClearCache()
	t.Cleanup(repoconfig.ClearCache)
}

// A repository promotes its own documents into Starred, end to end: the config
// file the checker also reads, through the server, into the response the viewer
// renders.
func TestRepositoryPromotesItsOwnDocuments(t *testing.T) {
	isolateUserDirs(t)
	root := initRepo(t, map[string]string{
		"roadmap.md":  "# Roadmap\n",
		"docs/a.md":   "# A\n",
		"docs/b.md":   "# B\n",
		"other/c.md":  "# C\n",
		".vantage.md": "# not config\n",
	})
	writeRepoConfig(t, root, "[check]\nstrict = true\n\n[starred]\npromote = [\"roadmap.md\", \"docs/*.md\"]\n")

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)
	h := srv.Handler()

	require.Equal(t,
		[]string{"docs/a.md=repo", "docs/b.md=repo", "roadmap.md=repo"},
		starredRows(t, h),
		"the literal and the pattern both promote, and nothing else does")
}

// The reader's own bookmark wins a collision: it is the only row with an honest
// timestamp and the only one they can remove.
func TestAUsersBookmarkBeatsAPromotionOfTheSameDocument(t *testing.T) {
	isolateUserDirs(t)
	root := initRepo(t, map[string]string{"roadmap.md": "# Roadmap\n"})
	writeRepoConfig(t, root, "[starred]\npromote = [\"roadmap.md\"]\n")

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)
	h := srv.Handler()

	require.Equal(t, []string{"roadmap.md=repo"}, starredRows(t, h))

	rec := doJSON(t, h, http.MethodPost, "/api/starred", `{"repo":"","path":"roadmap.md"}`)
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

	require.Equal(t, []string{"roadmap.md=user"}, starredRows(t, h),
		"one row, and it is the reader's own")
}

// A repository with a broken config is served as if it had none. Failing here
// would let one contributor's typo take out every other repository on a daemon.
func TestABrokenRepositoryConfigIsIgnoredNotFatal(t *testing.T) {
	isolateUserDirs(t)
	root := initRepo(t, map[string]string{"doc.md": "# Doc\n"})
	writeRepoConfig(t, root, "[starred]\npromotes = [\"doc.md\"]\n")

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err, "a bad repository config must not fail startup")

	require.Empty(t, starredRows(t, srv.Handler()))
}

// In daemon mode each repository promotes only its own, and every row says which
// repository it belongs to.
func TestDaemonPromotesPerRepository(t *testing.T) {
	isolateUserDirs(t)
	rootA := initRepo(t, map[string]string{"a.md": "# A\n"})
	rootB := initRepo(t, map[string]string{"b.md": "# B\n"})
	writeRepoConfig(t, rootA, "[starred]\npromote = [\"a.md\"]\n")
	writeRepoConfig(t, rootB, "[starred]\npromote = [\"b.md\"]\n")

	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.Repos = []config.RepoConfig{{Name: "alpha", Path: rootA}, {Name: "beta", Path: rootB}}
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)

	require.Equal(t, []string{"alpha/a.md=repo", "beta/b.md=repo"},
		starredRows(t, srv.Handler()))
}

// A promotion pointing out of the tree is refused. Unlike a bookmark, which is
// deliberately never validated against the filesystem, a promoted path has no
// round-trip to protect and is config-driven rather than typed by the reader.
func TestPromotionCannotEscapeTheRepository(t *testing.T) {
	isolateUserDirs(t)
	root := initRepo(t, map[string]string{"doc.md": "# Doc\n"})
	writeRepoConfig(t, root, "[starred]\npromote = [\"../escape.md\", \"doc.md\"]\n")

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)

	require.Equal(t, []string{"doc.md=repo"}, starredRows(t, srv.Handler()),
		"the escaping line is dropped and the rest still promotes")
}

// writeUserConfig puts a `[starred]` list in the reader's own config. The caller
// must have run isolateUserDirs first, or this writes into a real home.
func writeUserConfig(t *testing.T, body string) {
	t.Helper()
	home, err := os.UserHomeDir()
	require.NoError(t, err)
	dir := filepath.Join(home, ".config", "vantage")
	require.NoError(t, os.MkdirAll(dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "config.toml"), []byte(body), 0o644))
}

// "Always star my roadmap" — the reader's own list, applied in whatever project
// they open, in serve mode, which has never read a config file before.
func TestTheUsersOwnListPromotesInServeMode(t *testing.T) {
	isolateUserDirs(t)
	t.Setenv("XDG_CONFIG_HOME", "")
	writeUserConfig(t, "[starred]\npromote = [\"roadmap.md\", \"ROADMAP.md\"]\n")

	root := initRepo(t, map[string]string{"roadmap.md": "# Roadmap\n", "doc.md": "# Doc\n"})
	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)

	require.Equal(t, []string{"roadmap.md=user-config"}, starredRows(t, srv.Handler()),
		"the one the project has is promoted; the one it does not have is not")
}

// Their list travels with them, so it applies to every repository a daemon
// serves — and only where the document actually exists.
func TestTheUsersOwnListAppliesToEveryRepository(t *testing.T) {
	isolateUserDirs(t)
	t.Setenv("XDG_CONFIG_HOME", "")
	writeUserConfig(t, "[starred]\npromote = [\"roadmap.md\"]\n")

	withRoadmap := initRepo(t, map[string]string{"roadmap.md": "# A\n"})
	without := initRepo(t, map[string]string{"b.md": "# B\n"})

	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.Repos = []config.RepoConfig{
		{Name: "alpha", Path: withRoadmap},
		{Name: "beta", Path: without},
	}
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)

	require.Equal(t, []string{"alpha/roadmap.md=user-config"},
		starredRows(t, srv.Handler()),
		"no phantom row in the project that has no roadmap")
}

// The two promotion lists union; only a collision has a winner, and there the
// reader's own config beats the repository's.
func TestUserAndRepositoryPromotionsUnion(t *testing.T) {
	isolateUserDirs(t)
	t.Setenv("XDG_CONFIG_HOME", "")
	writeUserConfig(t, "[starred]\npromote = [\"roadmap.md\"]\n")

	root := initRepo(t, map[string]string{
		"roadmap.md":     "# Roadmap\n",
		"docs/design.md": "# Design\n",
	})
	writeRepoConfig(t, root, "[starred]\npromote = [\"roadmap.md\", \"docs/design.md\"]\n")

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)

	require.Equal(t,
		[]string{"docs/design.md=repo", "roadmap.md=user-config"},
		starredRows(t, srv.Handler()),
		"both lists contribute; the shared row is labelled with the reader's own")
}

// repoThemeDefaults is the repo_defaults half of GET /api/themes.
func repoThemeDefaults(t *testing.T, h http.Handler) map[string]string {
	t.Helper()
	rec := doGET(t, h, "/api/themes")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())

	var body struct {
		RepoDefaults map[string]string `json:"repo_defaults"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.NotNil(t, body.RepoDefaults, "the field marshals as {} rather than null")
	return body.RepoDefaults
}

// captureWarnings points a server's logger at a buffer, so a test can assert on
// what it told the operator and not only on what it served.
func captureWarnings(srv *Server) *strings.Builder {
	var buf strings.Builder
	srv.logger = slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn}))
	return &buf
}

// A repository offers a theme, keyed by "" in single-repo mode — the same
// sentinel every other repo-keyed value on the wire uses.
func TestARepositoryOffersADefaultTheme(t *testing.T) {
	isolateUserDirs(t)
	root := initRepo(t, map[string]string{"doc.md": "# Doc\n"})
	// Top-level keys come before the first table header or TOML puts them inside
	// it, which is why the theme leads and `[check]` follows.
	writeRepoConfig(t, root, "theme = \"catppuccin\"\n\n[check]\nstrict = true\n")

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)

	require.Equal(t, map[string]string{"": "catppuccin"},
		repoThemeDefaults(t, srv.Handler()))
}

// In daemon mode each repository speaks only for itself, and one that names no
// theme is absent rather than present and empty: the frontend asks whether a key
// is there.
func TestDaemonReportsEachRepositorysOfferedTheme(t *testing.T) {
	isolateUserDirs(t)
	rootA := initRepo(t, map[string]string{"a.md": "# A\n"})
	rootB := initRepo(t, map[string]string{"b.md": "# B\n"})
	rootC := initRepo(t, map[string]string{"c.md": "# C\n"})
	writeRepoConfig(t, rootA, "theme = \"catppuccin\"\n")
	writeRepoConfig(t, rootB, "theme = \"lila\"\n")
	writeRepoConfig(t, rootC, "[starred]\npromote = [\"c.md\"]\n")

	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.Repos = []config.RepoConfig{
		{Name: "alpha", Path: rootA},
		{Name: "beta", Path: rootB},
		{Name: "gamma", Path: rootC},
	}
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)

	require.Equal(t, map[string]string{"alpha": "catppuccin", "beta": "lila"},
		repoThemeDefaults(t, srv.Handler()))
}

// One contributor's typo must not decide what every other repository on a daemon
// is coloured in, so a broken config is warned about and stepped over.
func TestABrokenRepositoryConfigDoesNotHideAnothersTheme(t *testing.T) {
	isolateUserDirs(t)
	broken := initRepo(t, map[string]string{"a.md": "# A\n"})
	good := initRepo(t, map[string]string{"b.md": "# B\n"})
	writeRepoConfig(t, broken, "[starred]\npromotes = [\"a.md\"]\n")
	writeRepoConfig(t, good, "theme = \"lila\"\n")

	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.Repos = []config.RepoConfig{
		{Name: "alpha", Path: broken},
		{Name: "beta", Path: good},
	}
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err, "a bad repository config must not fail startup")
	logged := captureWarnings(srv)

	require.Equal(t, map[string]string{"beta": "lila"}, repoThemeDefaults(t, srv.Handler()))
	require.Contains(t, logged.String(), "alpha", "the warning names the repository")
}

// A theme id outside the charset the /themes routes serve under can never resolve
// to a stylesheet, so it is dropped here rather than stored by a browser that then
// requests a permanent 404.
// The reader's own `theme` is held to the same charset as a repository's offer.
// Passing an id nothing can resolve through to the browser buys silence: no
// theme applies and no line anywhere says why.
func TestAnUnusableConfiguredThemeIsDropped(t *testing.T) {
	isolateUserDirs(t)
	writeUserConfig(t, "theme = \"Catppuccin\"\n")
	root := initRepo(t, map[string]string{"doc.md": "# Doc\n"})

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)

	rec := doGET(t, srv.Handler(), "/api/themes")
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	var body struct {
		Default string `json:"default"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Empty(t, body.Default, "an id outside the charset never reaches the browser")
}

func TestAnUnusableRepositoryThemeIsDropped(t *testing.T) {
	for name, id := range map[string]string{
		"traversal": "../../etc/passwd",
		"a path":    "themes/mine",
		"uppercase": "Catppuccin",
		"dotted":    "mine.css",
		"a space":   "my theme",
		"leading -": "-mine",
		"too long":  strings.Repeat("x", 65),
	} {
		t.Run(name, func(t *testing.T) {
			isolateUserDirs(t)
			root := initRepo(t, map[string]string{"doc.md": "# Doc\n"})
			writeRepoConfig(t, root, "theme = \""+id+"\"\n")

			cfg := config.Defaults()
			cfg.TargetRepo = root
			require.NoError(t, cfg.Resolve())
			srv, err := NewServer(cfg)
			require.NoError(t, err)
			logged := captureWarnings(srv)

			require.Empty(t, repoThemeDefaults(t, srv.Handler()))
			require.Contains(t, logged.String(), "ignoring repository theme",
				"a dropped theme is reported, not silently discarded")
		})
	}
}
