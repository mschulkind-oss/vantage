package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/fs"
	"github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/mschulkind-oss/vantage/internal/review"
	"github.com/stretchr/testify/require"
)

// testEnv bundles a handler set wired to a temp repo, ready for httptest calls.
type testEnv struct {
	h    *Handlers
	git  *git.GitService
	fs   *fs.FileSystemService
	repo string // repo name attached to RepoServices ("" = single-repo)
	dir  string // repo root on disk
}

// newTestEnv builds a Handlers over a fresh temp directory. initGit controls
// whether the directory is initialized as a git repo with one commit.
func newTestEnv(t *testing.T, initGit bool) *testEnv {
	t.Helper()
	dir := t.TempDir()

	if initGit {
		runGit(t, dir, "init", "-q")
		runGit(t, dir, "config", "user.email", "test@example.com")
		runGit(t, dir, "config", "user.name", "Test")
		runGit(t, dir, "config", "commit.gpgsign", "false")
	}

	gitSvc := git.NewService(dir, git.Options{})
	fsSvc := fs.New(fs.Config{RootPath: dir})

	h := NewHandlers(Deps{
		Reviews: review.NewStore(t.TempDir()),
		Perf:    perf.NewStore(),
		Config:  config.Defaults(),
	})

	return &testEnv{h: h, git: gitSvc, fs: fsSvc, repo: "", dir: dir}
}

// runGit runs a git command in dir, failing the test on error.
func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoErrorf(t, err, "git %s: %s", strings.Join(args, " "), out)
	return string(out)
}

// writeFile writes content to rel within the repo, creating parent dirs.
func writeFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	full := filepath.Join(dir, rel)
	require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
	require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
}

// commitAll stages and commits everything, returning the new commit's full SHA.
func commitAll(t *testing.T, dir, msg string) string {
	t.Helper()
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", msg)
	return strings.TrimSpace(runGit(t, dir, "rev-parse", "HEAD"))
}

// do executes handler against an httptest request with the env's RepoServices
// attached to the context (unless attach is false), returning the recorder.
func (e *testEnv) do(handler http.HandlerFunc, method, target string, body string, attach bool) *httptest.ResponseRecorder {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	if attach {
		ctx := WithRepoServices(r.Context(), RepoServices{Repo: e.repo, Git: e.git, FS: e.fs})
		r = r.WithContext(ctx)
	}
	w := httptest.NewRecorder()
	handler(w, r)
	return w
}

// decode unmarshals the recorder body into v.
func decode(t *testing.T, w *httptest.ResponseRecorder, v any) {
	t.Helper()
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), v), "body: %s", w.Body.String())
}

func TestRoutesTableShapes(t *testing.T) {
	e := newTestEnv(t, false)
	routes := e.h.Routes()
	require.NotEmpty(t, routes)

	// /api/ws must never appear in the table (live owns it).
	for _, rt := range routes {
		require.NotEqual(t, "/ws", rt.Pattern, "ws route must not be in the table")
		require.NotEmpty(t, rt.Method)
		require.True(t, strings.HasPrefix(rt.Pattern, "/"), "pattern %q must start with /", rt.Pattern)
		require.NotNil(t, rt.Handler)
	}

	// Spot-check scopes: /repos is global, /git/history is repo-scoped.
	scopeOf := func(pattern, method string) Scope {
		for _, rt := range routes {
			if rt.Pattern == pattern && rt.Method == method {
				return rt.Scope
			}
		}
		t.Fatalf("route %s %s not found", method, pattern)
		return 0
	}
	require.Equal(t, ScopeGlobal, scopeOf("/repos", http.MethodGet))
	require.Equal(t, ScopeGlobal, scopeOf("/health", http.MethodGet))
	require.Equal(t, ScopeGlobal, scopeOf("/perf/diagnostics", http.MethodGet))
	require.Equal(t, ScopeRepo, scopeOf("/git/history", http.MethodGet))
	require.Equal(t, ScopeRepo, scopeOf("/tree", http.MethodGet))
	require.Equal(t, ScopeRepo, scopeOf("/review", http.MethodGet))
	require.Equal(t, ScopeRepo, scopeOf("/review", http.MethodPut))
	require.Equal(t, ScopeRepo, scopeOf("/review", http.MethodDelete))
}

func TestReposSentinel(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.Repos, http.MethodGet, "/repos", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	// Must be EXACTLY [{"name":""}] — the single-repo mode-detection sentinel.
	require.JSONEq(t, `[{"name":"","last_activity":null}]`, w.Body.String())
}

func TestHealth(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.Health, http.MethodGet, "/health", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"status":"ok"}`, w.Body.String())
}

func TestRepoRequired400WhenNoServices(t *testing.T) {
	e := newTestEnv(t, false)
	// Repo-scoped handlers reached without RepoServices in context ⇒ 400 with
	// the {"error":…} envelope (multi-repo mode requires a {repo}).
	for _, tc := range []struct {
		name    string
		handler http.HandlerFunc
		method  string
		target  string
	}{
		{"history", e.h.GitHistory, http.MethodGet, "/git/history?path=a.md"},
		{"tree", e.h.Tree, http.MethodGet, "/tree"},
		{"version", e.h.Version, http.MethodGet, "/version"},
		{"review", e.h.ReviewGet, http.MethodGet, "/review?path=a.md"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := e.do(tc.handler, tc.method, tc.target, "", false)
			require.Equal(t, http.StatusBadRequest, w.Code)
			var env map[string]string
			decode(t, w, &env)
			require.Contains(t, env, "error")
			require.NotContains(t, env, "detail")
		})
	}
}
