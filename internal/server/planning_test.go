package server

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/model"
)

// planningFiles returns the paths a cold planning stream sent the text of and
// the exclude list of the config it was served under. The request asks for
// gzip, as every browser does, so the answer is read through the whole
// middleware stack as a browser would get it.
func planningFiles(t *testing.T, h http.Handler, target string) (paths, exclude []string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, target, strings.NewReader(`{}`))
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	require.Equal(t, "application/x-ndjson", rec.Header().Get("Content-Type"))
	require.Equal(t, "gzip", rec.Header().Get("Content-Encoding"))

	zr, err := gzip.NewReader(rec.Body)
	require.NoError(t, err)
	plain, err := io.ReadAll(zr)
	require.NoError(t, err)
	lines := strings.Split(strings.TrimSuffix(string(plain), "\n"), "\n")
	paths = []string{}
	for i, raw := range lines {
		var line struct {
			Kind   string `json:"kind"`
			Path   string `json:"path"`
			Config struct {
				Exclude []string `json:"exclude"`
			} `json:"config"`
		}
		require.NoError(t, json.Unmarshal([]byte(raw), &line), "line: %q", raw)
		switch {
		case i == 0:
			require.Equal(t, "header", line.Kind)
			exclude = line.Config.Exclude
		case i == len(lines)-1:
			require.Equal(t, "end", line.Kind)
		case line.Kind == "file":
			paths = append(paths, line.Path)
		}
	}
	return paths, exclude
}

// planningKind returns the kind the single-path mode answers for target.
func planningKind(t *testing.T, h http.Handler, target string) string {
	t.Helper()
	rec := doGET(t, h, target)
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	var entry struct {
		Kind string `json:"kind"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &entry))
	return entry.Kind
}

// requireBatchGone checks that target, the old batch's URL, answers 410 Gone
// through the whole stack, with the detail an old tab's reader can act on. A
// route that fell through to the SPA would answer index.html at 200, which the
// old viewer reads as a server that is not Vantage.
func requireBatchGone(t *testing.T, h http.Handler, target string) {
	t.Helper()
	rec := doGET(t, h, target)
	require.Equal(t, http.StatusGone, rec.Code, "body: %s", rec.Body.String())
	require.JSONEq(t, `{"detail":"The planning index moved to a stream; reload the page."}`, rec.Body.String())
}

// isolatePlanningDirs is isolateUserDirs plus the XDG override, so neither the
// developer's user ignore file nor their config can change what is listed.
func isolatePlanningDirs(t *testing.T) {
	t.Helper()
	isolateUserDirs(t)
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
}

// Single-repo mode serves the endpoints at the legacy paths, under the
// repository's own `[planning]` table, and the old batch's URL is gone.
func TestTheRepositoryServesItsPlanningSources(t *testing.T) {
	isolatePlanningDirs(t)
	root := initRepo(t, map[string]string{
		"roadmap.md":             "# Roadmap\n",
		"docs/design/a.md":       "---\nstage: DESIGN\n---\n",
		"docs/gallery/status.md": "---\nstatus: accepted\n---\n",
	})
	writeRepoConfig(t, root, "[check]\nstrict = true\n\n[planning]\nexclude = [\"docs/gallery/**\"]\n")

	cfg := config.Defaults()
	cfg.TargetRepo = root
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)
	h := srv.Handler()

	paths, exclude := planningFiles(t, h, "/api/planning/stream")
	require.Equal(t, []string{"docs/design/a.md", "roadmap.md"}, paths)
	require.Equal(t, []string{"docs/gallery/**"}, exclude)
	require.Equal(t, "absent", planningKind(t, h, "/api/planning/sources?path=docs/gallery/status.md"))
	require.Equal(t, "file", planningKind(t, h, "/api/planning/sources?path=docs/design/a.md"))
	requireBatchGone(t, h, "/api/planning/sources")
}

// In daemon mode each repository is served under its own table. A handler that
// reached for a config some other way than through the resolved repository
// would serve one repository's exclusions for another.
func TestDaemonServesEachRepositorysPlanningSourcesUnderItsOwnTable(t *testing.T) {
	isolatePlanningDirs(t)
	rootA := initRepo(t, map[string]string{"a.md": "# A\n", "docs/x.md": "# X\n"})
	rootB := initRepo(t, map[string]string{"b.md": "# B\n", "docs/y.md": "# Y\n"})
	writeRepoConfig(t, rootA, "[planning]\nexclude = [\"docs/**\"]\n")
	writeRepoConfig(t, rootB, "[planning]\ninclude = [\"docs/**\"]\n")

	cfg := config.Defaults()
	cfg.MultiRepo = true
	cfg.Repos = []config.RepoConfig{{Name: "alpha", Path: rootA}, {Name: "beta", Path: rootB}}
	require.NoError(t, cfg.Resolve())
	srv, err := NewServer(cfg)
	require.NoError(t, err)
	h := srv.Handler()

	paths, _ := planningFiles(t, h, "/api/r/alpha/planning/stream")
	require.Equal(t, []string{"a.md"}, paths)
	paths, _ = planningFiles(t, h, "/api/r/beta/planning/stream")
	require.Equal(t, []string{"docs/y.md"}, paths)

	require.Equal(t, "absent", planningKind(t, h, "/api/r/alpha/planning/sources?path=docs/x.md"))
	require.Equal(t, "file", planningKind(t, h, "/api/r/beta/planning/sources?path=docs/y.md"))
	requireBatchGone(t, h, "/api/r/alpha/planning/sources")

	require.Equal(t, http.StatusNotFound, doJSON(t, h, http.MethodPost, "/api/planning/stream", `{}`).Code,
		"legacy repo routes are disabled in daemon mode")
}

// A repository discovered after startup enters s.repos by the one path every
// repository takes, and its config has to come with it. The repoServices.cfg
// comment warns about exactly this: wiring the config anywhere else is correct
// at startup and leaves every discovered repository without one.
func TestADiscoveredRepositoryServesItsPlanningSourcesUnderItsOwnTable(t *testing.T) {
	srv, sourceDir := discoveryServer(t)
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	h := srv.Handler()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx) }()

	root := initRepoAt(t, filepath.Join(sourceDir, "beta"), map[string]string{
		"b.md": "# B\n", "docs/y.md": "# Y\n",
	})
	writeRepoConfig(t, root, "[planning]\nexclude = [\"docs/**\"]\n")

	waitFor(t, "the new repository to be discovered", func() bool {
		return slices.Contains(repoNames(t, h), "beta")
	})
	paths, exclude := planningFiles(t, h, "/api/r/beta/planning/stream")
	require.Equal(t, []string{"b.md"}, paths)
	require.Equal(t, []string{"docs/**"}, exclude)

	cancel()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after context cancel")
	}
	require.NoError(t, srv.Shutdown(context.Background()))
}

// The reviews request answers from each repository's own reviews: the store is
// one directory for the whole daemon and keys every review by repository, so a
// handler that took the name from anywhere but the resolved repository would
// hand one repository's comments to another.
func TestDaemonAnswersEachRepositorysReviews(t *testing.T) {
	srv, _ := daemonServer(t)
	h := srv.Handler()
	require.NoError(t, srv.reviews.Save("a.md", "alpha", model.NewReviewData("a.md")))

	reviewed := func(target string) []string {
		t.Helper()
		rec := doJSON(t, h, http.MethodPost, target, `{"paths":["a.md","b.md"]}`)
		require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
		var body struct {
			Reviews []struct {
				Path string `json:"path"`
			} `json:"reviews"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		paths := []string{}
		for _, r := range body.Reviews {
			paths = append(paths, r.Path)
		}
		return paths
	}
	require.Equal(t, []string{"a.md"}, reviewed("/api/r/alpha/planning/reviews"))
	require.Equal(t, []string{}, reviewed("/api/r/beta/planning/reviews"))
	require.Equal(t, http.StatusNotFound,
		doJSON(t, h, http.MethodPost, "/api/planning/reviews", `{"paths":["a.md"]}`).Code,
		"legacy repo routes are disabled in daemon mode")
}
