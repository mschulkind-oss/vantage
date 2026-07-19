package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/gitenv"
	"github.com/mschulkind-oss/vantage/web"
)

// initRepo creates a temp git repo with one committed markdown file and returns
// its root. Tests that exercise the git-backed routes need a real repo because
// the git service shells out to the git binary.
func initRepo(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()

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

// isolateReviewDir points $HOME at a temp dir BEFORE NewServer resolves
// config.ReviewDir, so review-writing tests never touch the real store.
func isolateReviewDir(t *testing.T) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
}

func TestReviewCommandRoutesMountedPerRepo(t *testing.T) {
	isolateReviewDir(t)
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
	isolateReviewDir(t)
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
