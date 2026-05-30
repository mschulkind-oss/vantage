package api

import (
	"net/http"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/perf"
	"github.com/stretchr/testify/require"
)

func TestPerfDiagnosticsShapeAndMeta(t *testing.T) {
	e := newTestEnv(t, false)
	// Record a couple of timings so the report has content.
	e.h.deps.Perf.Record(perf.CategoryGit, "get_history", 12.3)
	e.h.deps.Perf.Record(perf.CategoryFS, "read_file", 4.5)

	w := e.do(e.h.PerfDiagnostics, http.MethodGet, "/perf/diagnostics", "", false)
	require.Equal(t, http.StatusOK, w.Code)

	var diag perf.Diagnostics
	decode(t, w, &diag)

	// Meta provenance is stamped by the handler (Diagnostics leaves it blank).
	require.NotEmpty(t, diag.Meta.AppVersion)
	require.NotEmpty(t, diag.Meta.GitSha)
	require.NotEmpty(t, diag.Meta.CollectedAt)
	require.GreaterOrEqual(t, diag.Meta.BufferMax, 1)

	// Service timings land in services.by_operation, not requests.by_endpoint.
	require.Contains(t, diag.Services.ByOperation, "get_history")
	require.Contains(t, diag.Services.ByOperation, "read_file")

	// No shape attached without include_shape.
	require.Nil(t, diag.RepoShape)
}

func TestPerfDiagnosticsWithShape(t *testing.T) {
	e := newTestEnv(t, false)
	writeFile(t, e.dir, "a.md", "# a\n")

	w := e.do(e.h.PerfDiagnostics, http.MethodGet, "/perf/diagnostics?include_shape=true", "", true)
	require.Equal(t, http.StatusOK, w.Code)

	var diag perf.Diagnostics
	decode(t, w, &diag)
	require.Contains(t, diag.RepoShape, "repo_1")
	require.GreaterOrEqual(t, diag.RepoShape["repo_1"].TotalFiles, 1)
}

func TestPerfResetClears(t *testing.T) {
	e := newTestEnv(t, false)
	e.h.deps.Perf.Record(perf.CategoryGit, "op", 1.0)

	w := e.do(e.h.PerfReset, http.MethodPost, "/perf/reset", "", false)
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"status":"cleared"}`, w.Body.String())

	diag := e.h.deps.Perf.Diagnostics()
	require.Equal(t, 0, diag.Services.Total)
	require.Equal(t, 0, diag.Requests.Total)
}
