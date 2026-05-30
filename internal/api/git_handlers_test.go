package api

import (
	"net/http"
	"testing"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

func TestGitHistoryDegradesToEmpty(t *testing.T) {
	// A non-git directory: history must be [] at HTTP 200, never an error.
	e := newTestEnv(t, false)
	writeFile(t, e.dir, "a.md", "# hi\n")

	w := e.do(e.h.GitHistory, http.MethodGet, "/git/history?path=a.md", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "[]", w.Body.String())
}

func TestGitHistoryReturnsCommits(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	sha := commitAll(t, e.dir, "add a")

	w := e.do(e.h.GitHistory, http.MethodGet, "/git/history?path=a.md", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var commits []model.GitCommit
	decode(t, w, &commits)
	require.Len(t, commits, 1)
	require.Equal(t, sha, commits[0].Hexsha)
}

func TestGitHistoryMissingPath400(t *testing.T) {
	e := newTestEnv(t, true)
	w := e.do(e.h.GitHistory, http.MethodGet, "/git/history", "", true)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGitStatusNullsWhenClean(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	sha := commitAll(t, e.dir, "add a")

	w := e.do(e.h.GitStatus, http.MethodGet, "/git/status?path=a.md", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	// A clean committed file: git_status is the literal null, last_commit is the
	// real commit (keys always present).
	require.Contains(t, w.Body.String(), `"git_status":null`)
	var fs model.FileStatus
	decode(t, w, &fs)
	require.Nil(t, fs.GitStatus)
	require.NotNil(t, fs.LastCommit)
	require.Equal(t, sha, fs.LastCommit.Hexsha)
}

func TestGitStatusReportsModified(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	commitAll(t, e.dir, "add a")
	writeFile(t, e.dir, "a.md", "# changed\n")
	e.git.Status() // populate; cache is per-repoPath

	w := e.do(e.h.GitStatus, http.MethodGet, "/git/status?path=a.md", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var fs model.FileStatus
	decode(t, w, &fs)
	require.NotNil(t, fs.GitStatus)
	require.Equal(t, "modified", *fs.GitStatus)
}

func TestGitDiffBadSHA400(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	commitAll(t, e.dir, "add a")

	// Non-hex commit ⇒ 400 with {"error":…} envelope.
	w := e.do(e.h.GitDiff, http.MethodGet, "/git/diff?path=a.md&commit=not-a-sha", "", true)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "error")
	require.NotContains(t, env, "detail")
}

func TestGitDiffNotFound404(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	commitAll(t, e.dir, "add a")
	writeFile(t, e.dir, "b.md", "# other\n")
	other := commitAll(t, e.dir, "add b")

	// Valid SHA that does not touch a.md ⇒ nil diff ⇒ 404.
	w := e.do(e.h.GitDiff, http.MethodGet, "/git/diff?path=a.md&commit="+other, "", true)
	require.Equal(t, http.StatusNotFound, w.Code)
	var env map[string]string
	decode(t, w, &env)
	require.Contains(t, env, "error")
}

func TestGitDiffReturnsHunks(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	sha := commitAll(t, e.dir, "add a")

	w := e.do(e.h.GitDiff, http.MethodGet, "/git/diff?path=a.md&commit="+sha, "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var diff model.FileDiff
	decode(t, w, &diff)
	require.Equal(t, sha, diff.CommitHexsha)
	require.NotEmpty(t, diff.Hunks)
}

func TestGitWorkingDiff404WhenClean(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	commitAll(t, e.dir, "add a")

	w := e.do(e.h.GitWorkingDiff, http.MethodGet, "/git/diff/working?path=a.md", "", true)
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestGitWorkingDiffSentinel(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	commitAll(t, e.dir, "add a")
	writeFile(t, e.dir, "a.md", "# hi\nmore\n")

	w := e.do(e.h.GitWorkingDiff, http.MethodGet, "/git/diff/working?path=a.md", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var diff model.FileDiff
	decode(t, w, &diff)
	require.Equal(t, "working", diff.CommitHexsha)
	require.Equal(t, "Working directory", diff.CommitAuthor)
	require.Contains(t, diff.CommitMessage, "Uncommitted changes")
}

func TestGitRecentClampAndDefaults(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	commitAll(t, e.dir, "add a")

	w := e.do(e.h.GitRecent, http.MethodGet, "/git/recent", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var recents []model.RecentFile
	decode(t, w, &recents)
	require.NotEmpty(t, recents)

	// Degrades to empty in a non-git dir, still HTTP 200.
	e2 := newTestEnv(t, false)
	w2 := e2.do(e2.h.GitRecent, http.MethodGet, "/git/recent?limit=5", "", true)
	require.Equal(t, http.StatusOK, w2.Code)
	require.Equal(t, "[]", w2.Body.String())
}

func TestVersionUnknownWhenNoGit(t *testing.T) {
	e := newTestEnv(t, false)
	w := e.do(e.h.Version, http.MethodGet, "/version", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var v model.VersionInfo
	decode(t, w, &v)
	require.Equal(t, "unknown", v.CommitHash)
	require.False(t, v.IsDirty)
}

func TestVersionReportsHeadAndDirty(t *testing.T) {
	e := newTestEnv(t, true)
	writeFile(t, e.dir, "a.md", "# hi\n")
	commitAll(t, e.dir, "add a")
	writeFile(t, e.dir, "a.md", "# changed\n")

	w := e.do(e.h.Version, http.MethodGet, "/version", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var v model.VersionInfo
	decode(t, w, &v)
	require.NotEqual(t, "unknown", v.CommitHash)
	require.True(t, v.IsDirty)
}

func TestInfoNameAndRoot(t *testing.T) {
	e := newTestEnv(t, true)
	w := e.do(e.h.Info, http.MethodGet, "/info", "", true)
	require.Equal(t, http.StatusOK, w.Code)
	var info model.RepoInfoResponse
	decode(t, w, &info)
	require.NotEmpty(t, info.Name)
	require.NotEmpty(t, info.RootPath)
}
