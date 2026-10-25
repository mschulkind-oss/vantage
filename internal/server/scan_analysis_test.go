package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/git"
	"testing"

	"github.com/stretchr/testify/require"
)

// Analysis evidence is project-local, unlike the intentionally anonymized perf
// endpoint. Mounting must use the same project-resolution fences as recents.
func TestScanAnalysisRepositoryScope(t *testing.T) {
	single, _ := singleRepoServer(t)
	daemon, roots := daemonServer(t)
	for _, tc := range []struct {
		name   string
		server *Server
		url    string
		want   int
	}{
		{"single legacy", single, "/api/git/scan-analysis", http.StatusOK},
		{"single named rejected", single, "/api/r/alpha/git/scan-analysis", http.StatusNotFound},
		{"daemon alpha", daemon, "/api/r/alpha/git/scan-analysis", http.StatusOK},
		{"daemon beta", daemon, "/api/r/beta/git/scan-analysis", http.StatusOK},
		{"daemon legacy rejected", daemon, "/api/git/scan-analysis", http.StatusNotFound},
		{"daemon unknown rejected", daemon, "/api/r/missing/git/scan-analysis", http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			tc.server.router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tc.url, nil))
			require.Equal(t, tc.want, response.Code, response.Body.String())
			if tc.want == http.StatusOK {
				require.JSONEq(t, `{"evidence":null,"diagnostic":null}`, response.Body.String())
			}
			for _, root := range roots {
				require.NotContains(t, response.Body.String(), root)
			}
		})
	}
	// Diagnostics must not grow the path-bearing response onto the global report.
	response := httptest.NewRecorder()
	daemon.router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/perf/diagnostics", nil))
	require.Equal(t, http.StatusOK, response.Code)
	require.NotContains(t, response.Body.String(), `"directories"`)
	require.NotContains(t, response.Body.String(), `"recommendations"`)
	for _, root := range roots {
		require.NotContains(t, response.Body.String(), root)
	}
}

func TestScanAnalysisEncodedProjectAndTimeoutEvidence(t *testing.T) {
	isolateUserDirs(t)
	root := initRepo(t, map[string]string{"doc.md": "# document\n"})
	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.WalkTimeout = time.Nanosecond
	const name = "notes@work + %#"
	cfg.Repos = []config.RepoConfig{{Name: name, Path: root}}
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)
	git.ClearRecentFilesCache()
	t.Cleanup(git.ClearRecentFilesCache)
	base := "/api/r/" + url.PathEscape(name)
	response := doGET(t, srv.Handler(), base+"/git/recent?show_gitignored=true")
	require.Equal(t, http.StatusOK, response.Code)
	response = doGET(t, srv.Handler(), base+"/git/scan-analysis")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), `"timedOut":true`)
	require.Contains(t, response.Body.String(), `"gitignored":true`)
	require.NotContains(t, response.Body.String(), root)
	// Evidence reads never start the deeper diagnostic.
	require.Contains(t, response.Body.String(), `"diagnostic":null`)
	require.Len(t, degradedList(t, srv.Handler()), 1)
	// A later successful normal scan clears this warning even though its
	// captured timing/settings metadata differ from the earlier timeout.
	srv.repoByName(name).git = git.NewService(root, git.Options{
		WalkTimeout: time.Second,
		OnWalk:      func(report git.WalkReport) { srv.walkFinished(name, report) },
	})
	git.ClearRecentFilesCache()
	response = doGET(t, srv.Handler(), base+"/git/recent?show_gitignored=true")
	require.Equal(t, http.StatusOK, response.Code)
	require.Empty(t, degradedList(t, srv.Handler()))
}

func TestScanAnalysisDiagnosticSelectsOnlyResolvedProject(t *testing.T) {
	srv, roots := daemonServer(t)
	for name, root := range roots {
		directory := filepath.Join(root, name+"-only")
		require.NoError(t, os.Mkdir(directory, 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(directory, "sample.md"), []byte("# untracked\n"), 0o644))
	}
	response := httptest.NewRecorder()
	srv.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/r/beta/git/scan-analysis", nil))
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), "beta-only")
	require.NotContains(t, response.Body.String(), "alpha-only")
	for _, root := range roots {
		require.NotContains(t, response.Body.String(), root)
	}
	for _, endpoint := range []string{"/api/git/scan-analysis", "/api/r/missing/git/scan-analysis"} {
		response = httptest.NewRecorder()
		srv.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, endpoint, nil))
		require.Equal(t, http.StatusNotFound, response.Code)
	}
	response = doGET(t, srv.Handler(), "/api/perf/diagnostics?include_shape=true")
	require.Equal(t, http.StatusOK, response.Code)
	require.False(t, strings.Contains(response.Body.String(), "beta-only"))
	require.False(t, strings.Contains(response.Body.String(), "alpha-only"))
	require.NotContains(t, response.Body.String(), `"directories"`)
	require.NotContains(t, response.Body.String(), `"recommendations"`)
}

// A successful process exit does not make malformed or unbounded Git output a
// complete comparison. This also exercises wrappers that write startup text.
func TestScanAnalysisMalformedComparisonIsPartial(t *testing.T) {
	for _, tc := range []struct{ name, output string }{
		{"unterminated", `printf 'unterminated.md'`},
		{"oversized", `printf '%070000d.md\000' 0`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, _ := singleRepoServer(t)
			actualGit, err := exec.LookPath("git")
			require.NoError(t, err)
			bin := t.TempDir()
			script := fmt.Sprintf("#!/bin/sh\ncase \"$*\" in *ls-files*) %s ;; *) exec %q \"$@\" ;; esac\n", tc.output, actualGit)
			require.NoError(t, os.WriteFile(filepath.Join(bin, "git"), []byte(script), 0o755))
			t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
			response := httptest.NewRecorder()
			srv.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/git/scan-analysis", nil))
			require.Equal(t, http.StatusOK, response.Code)
			var result struct {
				Diagnostic struct {
					Partial    bool
					Comparison struct{ Status string }
				}
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
			require.True(t, result.Diagnostic.Partial, "malformed output cannot prove coverage")
			require.Equal(t, "partial", result.Diagnostic.Comparison.Status)
		})
	}
}
