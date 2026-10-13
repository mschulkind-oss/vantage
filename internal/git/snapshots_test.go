package git

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func commitSnapshot(t *testing.T, dir, message string) string {
	t.Helper()
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", message)
	return strings.TrimSpace(runGit(t, dir, "rev-parse", "HEAD"))
}

func TestPlanningSnapshotsDistinguishesVerifiedRootAndStageTransition(t *testing.T) {
	repo := initRepo(t)
	writeFile(t, repo, "docs/a.md", "---\nstage: SKETCH\n---\n")
	root := commitSnapshot(t, repo, "add planning document")
	writeFile(t, repo, "docs/a.md", "---\nstage: DECIDED\n---\n")
	transition := commitSnapshot(t, repo, "change saved stage")

	result := NewService(repo, Options{}).PlanningSnapshots()
	require.Equal(t, "complete", result.Status)
	require.False(t, result.Truncated)
	require.Len(t, result.Snapshots, 2)
	require.Equal(t, transition, result.Snapshots[0].CommitHexsha)
	require.Equal(t, "---\nstage: SKETCH\n---\n", result.Snapshots[0].Before)
	require.Equal(t, "---\nstage: DECIDED\n---\n", result.Snapshots[0].After)
	require.Equal(t, root, result.Snapshots[1].CommitHexsha)
	require.False(t, result.Snapshots[1].BeforeExists, "verified root has an empty prior tree")
}

func TestPlanningSnapshotsDoesNotTreatShallowBoundaryAsRoot(t *testing.T) {
	repo := initRepo(t)
	writeFile(t, repo, "docs/a.md", "---\nstage: SKETCH\n---\n")
	commitSnapshot(t, repo, "first")
	writeFile(t, repo, "docs/a.md", "---\nstage: DECIDED\n---\n")
	shallow := commitSnapshot(t, repo, "second")
	gitDir := strings.TrimSpace(runGit(t, repo, "rev-parse", "--git-dir"))
	require.NoError(t, os.WriteFile(filepath.Join(repo, gitDir, "shallow"), []byte(shallow+"\n"), 0o644))

	result := NewService(repo, Options{}).PlanningSnapshots()
	require.Equal(t, "partial", result.Status)
	require.True(t, result.Truncated)
	require.Contains(t, result.Reason, "shallow boundary")
	require.Empty(t, result.Snapshots)
}

func TestPlanningSnapshotsReportsUnavailableForNonGitRepository(t *testing.T) {
	dir := t.TempDir()
	result := NewService(dir, Options{}).PlanningSnapshots()
	require.Equal(t, "unavailable", result.Status)
	require.NotEmpty(t, result.Reason)
	require.NotNil(t, result.Snapshots)
	require.Empty(t, result.Snapshots)
}

func TestPlanningSnapshotsBoundsBlobAndTotalBytes(t *testing.T) {
	repo := initRepo(t)
	writeFile(t, repo, "docs/large.md", strings.Repeat("x", planningBlobLimit+1))
	for i := 0; i < 45; i++ {
		writeFile(t, repo, filepath.Join("docs", strings.Repeat("a", i)+"-source.md"), "---\nstage: SKETCH\n---\n"+strings.Repeat("x", planningBlobLimit-128))
	}
	commitSnapshot(t, repo, "bounded sources")

	result := NewService(repo, Options{}).PlanningSnapshots()
	require.Equal(t, "partial", result.Status)
	require.True(t, result.Truncated)
	for _, pair := range result.Snapshots {
		require.LessOrEqual(t, len(pair.Before)+len(pair.After), planningBlobLimit*2)
		require.LessOrEqual(t, len(pair.Before), planningBlobLimit)
		require.LessOrEqual(t, len(pair.After), planningBlobLimit)
	}
	var total int
	for _, pair := range result.Snapshots {
		total += len(pair.Before) + len(pair.After)
	}
	require.LessOrEqual(t, total, planningTextLimit)
	require.Less(t, len(result.Snapshots), 45, "the total source-text cap should stop the batch")
}

func TestPlanningSnapshotsReportsOversizedBlobAsPartial(t *testing.T) {
	repo := initRepo(t)
	writeFile(t, repo, "docs/large.md", strings.Repeat("x", planningBlobLimit+1))
	commitSnapshot(t, repo, "add oversized source")

	result := NewService(repo, Options{}).PlanningSnapshots()
	require.Equal(t, "partial", result.Status)
	require.True(t, result.Truncated)
	require.Empty(t, result.Snapshots)
	require.Contains(t, result.Reason, "exceeded 64 KiB")
}

func TestPlanningSnapshotsCapsCommitCount(t *testing.T) {
	repo := initRepo(t)
	writeFile(t, repo, "docs/a.md", "---\nstage: SKETCH\n---\n")
	commitSnapshot(t, repo, "initial")
	for i := 0; i < planningCommitLimit+1; i++ {
		writeFile(t, repo, "docs/a.md", "---\nstage: stage-"+strconv.Itoa(i)+"\n---\n")
		commitSnapshot(t, repo, "stage update")
	}

	result := NewService(repo, Options{}).PlanningSnapshots()
	require.Equal(t, "partial", result.Status)
	require.Equal(t, planningCommitLimit, result.CommitsExamined)
	require.Contains(t, result.Reason, "50-commit inspection limit")
	require.Len(t, result.Snapshots, planningCommitLimit)
}

func TestPlanningSnapshotsCapsPairsDeterministically(t *testing.T) {
	repo := initRepo(t)
	for i := 0; i < planningPairLimit+1; i++ {
		writeFile(t, repo, filepath.Join("docs", strings.Repeat("a", 3)+string(rune('a'+i%26))+"-"+strings.Repeat("x", i)+".md"), "---\nstage: SKETCH\n---\n")
	}
	commitSnapshot(t, repo, "many files")
	result := NewService(repo, Options{}).PlanningSnapshots()
	require.Equal(t, "partial", result.Status)
	require.Len(t, result.Snapshots, planningPairLimit)
	paths := make([]string, 0, len(result.Snapshots))
	for _, pair := range result.Snapshots {
		paths = append(paths, pair.Path)
	}
	require.True(t, sort.StringsAreSorted(paths))
}
