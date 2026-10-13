package api

import (
	"net/http"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

func TestGitPlanningSnapshotsNonGitIsExplicitlyUnavailable(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.GitPlanningSnapshots, http.MethodGet, "/git/planning-snapshots", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var result model.PlanningSnapshots
	decode(t, w, &result)
	require.Equal(t, "unavailable", result.Status)
	require.NotEmpty(t, result.Reason)
	require.NotNil(t, result.Snapshots)
	require.Empty(t, result.Snapshots)
}

func TestGitPlanningSnapshotsReturnsBoundedSnapshotShape(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "---\nstage: SKETCH\n---\n")
	commitAll(t, e.dir, "add a")
	w := e.do(e.h.GitPlanningSnapshots, http.MethodGet, "/git/planning-snapshots", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var result model.PlanningSnapshots
	decode(t, w, &result)
	require.Equal(t, "complete", result.Status)
	require.Len(t, result.Snapshots, 1)
	require.Equal(t, "a.md", result.Snapshots[0].Path)
	require.False(t, result.Snapshots[0].BeforeExists)
	require.True(t, result.Snapshots[0].AfterExists)
}
