package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/repoconfig"
)

// planningEnv is a testEnv whose requests carry the repository's config, which
// the planning endpoint reads and every older route ignores.
type planningEnv struct {
	*testEnv
	cfg *repoconfig.Config
}

func newPlanningEnv(t *testing.T, files map[string]string) *planningEnv {
	t.Helper()
	e := newTestEnv(t, false)
	for rel, content := range files {
		writeFile(t, e.dir, rel, content)
	}
	return &planningEnv{testEnv: e, cfg: repoconfig.New(e.dir)}
}

func (e *planningEnv) get(target string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, target, nil)
	r = r.WithContext(WithRepoServices(r.Context(),
		RepoServices{Repo: e.repo, Git: e.git, FS: e.fs, Config: e.cfg}))
	w := httptest.NewRecorder()
	e.h.PlanningSources(w, r)
	return w
}

// planningBatch is the batch body, decoded.
type planningBatch struct {
	Config         repoconfig.Planning `json:"config"`
	CandidateCount int                 `json:"candidate_count"`
	Refused        bool                `json:"refused"`
	Files          []struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	} `json:"files"`
	Skipped    []json.RawMessage `json:"skipped"`
	Unreadable []json.RawMessage `json:"unreadable"`
}

func (b planningBatch) paths() []string {
	out := []string{}
	for _, f := range b.Files {
		out = append(out, f.Path)
	}
	return out
}

func TestPlanningSourcesIsARepoScopedGET(t *testing.T) {
	e := newTestEnv(t, false)
	for _, rt := range e.h.Routes() {
		if rt.Pattern == "/planning/sources" {
			require.Equal(t, http.MethodGet, rt.Method)
			require.Equal(t, ScopeRepo, rt.Scope, "each repository has its own index")
			return
		}
	}
	t.Fatal("GET /planning/sources is not in the route table")
}

func TestPlanningSourcesWithoutARepoIs400(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.PlanningSources, http.MethodGet, "/planning/sources", "", false)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

// The contract's shape: snake_case, the effective config, and lists that are
// `[]` and never `null` — a static host's SPA fallback answers this URL with
// HTML, so the viewer refuses anything that is not exactly this shape.
func TestPlanningBatchHasTheContractsShape(t *testing.T) {
	e := newPlanningEnv(t, nil)
	w := e.get("/planning/sources")
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "application/json", w.Header().Get("Content-Type"))
	require.JSONEq(t, `{
		"config": {"roadmap": "roadmap.md", "include": ["**/*.md"], "exclude": [],
			"max_file_bytes": 1048576, "max_candidates": 5000, "stages": null},
		"candidate_count": 0, "refused": false,
		"files": [], "skipped": [], "unreadable": []
	}`, w.Body.String())
}

func TestPlanningBatchAppliesTheRepositorysTable(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"roadmap.md":             "# Roadmap\n",
		"docs/design/a.md":       "---\nstage: DESIGN\n---\n",
		"docs/gallery/status.md": "---\nstatus: accepted\n---\n",
		"docs/huge.md":           strings.Repeat("x", 100),
		"docs/latin1.md":         "caf\xe9\n",
		".vantage.toml": "[planning]\nexclude = [\"docs/gallery/**\"]\nmax-file-bytes = 64\n\n" +
			"[planning.stages]\nDESIGN = \"open\"\nDECIDED = \"ready\"\n",
	})

	w := e.get("/planning/sources")
	require.Equal(t, http.StatusOK, w.Code)
	var b planningBatch
	decode(t, w, &b)

	require.Equal(t, []string{"docs/gallery/**"}, b.Config.Exclude)
	require.Equal(t, int64(64), b.Config.MaxFileBytes)
	require.Equal(t, map[string]string{"DESIGN": "open", "DECIDED": "ready"}, b.Config.Stages)
	require.Equal(t, 4, b.CandidateCount, "the gallery is excluded")
	require.Equal(t, []string{"docs/design/a.md", "roadmap.md"}, b.paths())
	require.Len(t, b.Skipped, 1)
	require.JSONEq(t, `{"path":"docs/huge.md","size":100}`, string(b.Skipped[0]))
	require.Len(t, b.Unreadable, 1)
	require.JSONEq(t, `{"path":"docs/latin1.md","reason":"not UTF-8"}`, string(b.Unreadable[0]))
}

func TestPlanningBatchPastTheLimitIsRefused(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"a.md": "# A\n", "b.md": "# B\n",
		".vantage.toml": "[planning]\nmax-candidates = 1\n",
	})
	var b planningBatch
	decode(t, e.get("/planning/sources"), &b)
	require.True(t, b.Refused)
	require.Equal(t, 2, b.CandidateCount)
	require.Empty(t, b.Files)
	require.NotNil(t, b.Files, "still [] on the wire")
}

// A table the server refuses is logged, and the index is served with the
// defaults rather than not at all: the exclusions are lost, not the index.
func TestABadPlanningTableServesTheDefaultsAndSaysSo(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"docs/gallery/status.md": "---\nstatus: accepted\n---\n",
		".vantage.toml":          "[planning]\nexclude = [\"docs/gallery/**\"]\nroadmaps = \"x.md\"\n",
	})
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	w := e.get("/planning/sources")
	require.Equal(t, http.StatusOK, w.Code)
	var b planningBatch
	decode(t, w, &b)
	require.Equal(t, repoconfig.DefaultPlanning(), b.Config)
	require.Equal(t, []string{"docs/gallery/status.md"}, b.paths())
	require.Contains(t, logs.String(), "planning.roadmaps")
	require.Contains(t, logs.String(), filepath.Join(e.dir, ".vantage.toml"))
}

// The rescan a `.vantage.toml` push causes lands inside the config's reload
// throttle. The endpoint must see the edit anyway, or the rescan is served the
// table from before it and nothing asks again.
func TestThePlanningEndpointSeesAConfigEditAtOnce(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"a.md": "# A\n", "docs/b.md": "# B\n",
		".vantage.toml": "[planning]\nexclude = []\n",
	})
	var b planningBatch
	decode(t, e.get("/planning/sources"), &b)
	require.Equal(t, []string{"a.md", "docs/b.md"}, b.paths())

	writeFile(t, e.dir, ".vantage.toml", "[planning]\nexclude = [\"docs/**\"]\n")
	decode(t, e.get("/planning/sources"), &b)
	require.Equal(t, []string{"a.md"}, b.paths())
}

// Without a config to read, a repository is served the defaults.
func TestPlanningSourcesWithNoConfigServesTheDefaults(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"a.md": "# A\n"})
	e.cfg = nil
	var b planningBatch
	decode(t, e.get("/planning/sources"), &b)
	require.Equal(t, repoconfig.DefaultPlanning(), b.Config)
	require.Equal(t, []string{"a.md"}, b.paths())
}

func TestPlanningSinglePathAnswersEachKind(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{
		"docs/x.md":                        "---\nstatus: draft\n---\n",
		"docs/huge.md":                     strings.Repeat("x", 100),
		"docs/bad.md":                      "caf\xe9\n",
		".github/pull_request_template.md": "---\nstatus: draft\n---\n",
		".vantage.toml":                    "[planning]\nmax-file-bytes = 64\n",
	})
	for target, want := range map[string]string{
		"/planning/sources?path=docs/x.md":                        `{"path":"docs/x.md","kind":"file","content":"---\nstatus: draft\n---\n"}`,
		"/planning/sources?path=docs/huge.md":                     `{"path":"docs/huge.md","kind":"skipped","size":100}`,
		"/planning/sources?path=docs/bad.md":                      `{"path":"docs/bad.md","kind":"unreadable","reason":"not UTF-8"}`,
		"/planning/sources?path=.github/pull_request_template.md": `{"path":".github/pull_request_template.md","kind":"absent"}`,
		"/planning/sources?path=docs/missing.md":                  `{"path":"docs/missing.md","kind":"absent"}`,
		"/planning/sources?path=..%2Fetc%2Fpasswd.md":             `{"path":"../etc/passwd.md","kind":"absent"}`,
	} {
		w := e.get(target)
		require.Equal(t, http.StatusOK, w.Code, target)
		require.JSONEq(t, want, w.Body.String(), target)
	}
}

func TestPlanningSinglePathRequiresAPath(t *testing.T) {
	e := newPlanningEnv(t, nil)
	w := e.get("/planning/sources?path=")
	require.Equal(t, http.StatusBadRequest, w.Code)
	require.Contains(t, w.Body.String(), "detail")
}

// A file that exists and cannot be read is `unreadable`, never `absent`: the
// planning page lists the one and cannot see the other.
func TestPlanningSinglePathReportsALockedFileUnreadable(t *testing.T) {
	e := newPlanningEnv(t, map[string]string{"locked.md": "# Locked\n"})
	full := filepath.Join(e.dir, "locked.md")
	require.NoError(t, os.Chmod(full, 0o000))
	t.Cleanup(func() { _ = os.Chmod(full, 0o644) })
	if _, err := os.ReadFile(full); err == nil {
		t.Skip("file modes are not enforced for this user")
	}

	w := e.get("/planning/sources?path=locked.md")
	require.JSONEq(t, `{"path":"locked.md","kind":"unreadable","reason":"permission denied"}`, w.Body.String())
}
