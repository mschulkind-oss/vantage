package server

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
)

// planningFiles returns the paths a planning batch served and the exclude list
// of the config it was served under.
func planningFiles(t *testing.T, h http.Handler, target string) (paths, exclude []string) {
	t.Helper()
	rec := doGET(t, h, target)
	require.Equal(t, http.StatusOK, rec.Code, "body: %s", rec.Body.String())
	var body struct {
		Config struct {
			Exclude []string `json:"exclude"`
		} `json:"config"`
		Files []struct {
			Path string `json:"path"`
		} `json:"files"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	paths = []string{}
	for _, f := range body.Files {
		paths = append(paths, f.Path)
	}
	return paths, body.Config.Exclude
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

// isolatePlanningDirs is isolateUserDirs plus the XDG override, so neither the
// developer's user ignore file nor their config can change what is listed.
func isolatePlanningDirs(t *testing.T) {
	t.Helper()
	isolateUserDirs(t)
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
}

// Single-repo mode serves the endpoint at the legacy path, under the
// repository's own `[planning]` table.
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

	paths, exclude := planningFiles(t, h, "/api/planning/sources")
	require.Equal(t, []string{"docs/design/a.md", "roadmap.md"}, paths)
	require.Equal(t, []string{"docs/gallery/**"}, exclude)
	require.Equal(t, "absent", planningKind(t, h, "/api/planning/sources?path=docs/gallery/status.md"))
	require.Equal(t, "file", planningKind(t, h, "/api/planning/sources?path=docs/design/a.md"))
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

	paths, _ := planningFiles(t, h, "/api/r/alpha/planning/sources")
	require.Equal(t, []string{"a.md"}, paths)
	paths, _ = planningFiles(t, h, "/api/r/beta/planning/sources")
	require.Equal(t, []string{"docs/y.md"}, paths)

	require.Equal(t, "absent", planningKind(t, h, "/api/r/alpha/planning/sources?path=docs/x.md"))
	require.Equal(t, "file", planningKind(t, h, "/api/r/beta/planning/sources?path=docs/y.md"))

	require.Equal(t, http.StatusNotFound, doGET(t, h, "/api/planning/sources").Code,
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
	paths, exclude := planningFiles(t, h, "/api/r/beta/planning/sources")
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
