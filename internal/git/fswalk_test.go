package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

func TestIsWorktree(t *testing.T) {
	dir := t.TempDir()

	// Plain dir (no .git)
	plain := filepath.Join(dir, "plain")
	require.NoError(t, os.MkdirAll(plain, 0o755))
	require.False(t, IsWorktree(plain))

	// Standard git repo (.git is a directory)
	repo := filepath.Join(dir, "repo")
	require.NoError(t, os.MkdirAll(filepath.Join(repo, ".git"), 0o755))
	require.False(t, IsWorktree(repo))

	// Linked git worktree (.git is a file with gitdir:)
	worktree := filepath.Join(dir, "worktree")
	require.NoError(t, os.MkdirAll(worktree, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: /path/to/main/.git/worktrees/wt\n"), 0o644))
	require.True(t, IsWorktree(worktree))

	// File named .git with arbitrary non-git content
	notGitdir := filepath.Join(dir, "notgitdir")
	require.NoError(t, os.MkdirAll(notGitdir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(notGitdir, ".git"), []byte("just a regular file\n"), 0o644))
	require.False(t, IsWorktree(notGitdir))

	// Nonexistent directory
	require.False(t, IsWorktree(filepath.Join(dir, "does-not-exist")))
}

func TestDirHasGitRequiresDirectory(t *testing.T) {
	dir := t.TempDir()

	// Normal repo (.git dir)
	repo := filepath.Join(dir, "repo")
	require.NoError(t, os.MkdirAll(filepath.Join(repo, ".git"), 0o755))
	require.True(t, dirHasGit(repo))

	// Worktree (.git file)
	worktree := filepath.Join(dir, "worktree")
	require.NoError(t, os.MkdirAll(worktree, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: /main/.git/worktrees/wt\n"), 0o644))
	require.False(t, dirHasGit(worktree), "linked worktrees must not be identified as child git repos")
}

func TestDiscoverChildReposSkipsWorktrees(t *testing.T) {
	parent := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		parent = resolved
	}

	// Normal repo
	repo := filepath.Join(parent, "repo")
	require.NoError(t, os.MkdirAll(filepath.Join(repo, ".git"), 0o755))

	// Worktree
	worktree := filepath.Join(parent, "worktree")
	require.NoError(t, os.MkdirAll(worktree, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: /main/.git/worktrees/wt\n"), 0o644))

	svc := NewService(parent, Options{})
	children := svc.discoverChildRepos()

	require.Equal(t, []string{repo}, children, "discoverChildRepos must skip linked worktrees")
}

func TestWalkSubdirSkipsWorktrees(t *testing.T) {
	parent := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		parent = resolved
	}
	subdir := filepath.Join(parent, "sub")
	require.NoError(t, os.MkdirAll(subdir, 0o755))
	writeFile(t, parent, "sub/normal.md", "# Normal\n")

	// Nested worktree inside subdir
	wt := filepath.Join(subdir, "nested-wt")
	require.NoError(t, os.MkdirAll(wt, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(wt, ".git"), []byte("gitdir: /main/.git/worktrees/nested\n"), 0o644))
	writeFile(t, parent, "sub/nested-wt/duplicate.md", "# Duplicate\n")

	svc := NewService(parent, Options{})
	var collected []string
	svc.walkSubdir(subdir, []string{".md"}, func(rel string) {
		collected = append(collected, rel)
	})

	require.Equal(t, []string{"sub/normal.md"}, collected, "nested worktrees must be pruned from walkSubdir")
}

func TestIsRepoBoundary(t *testing.T) {
	dir := t.TempDir()
	repo := filepath.Join(dir, "repo")
	require.NoError(t, os.MkdirAll(filepath.Join(repo, ".git"), 0o755))
	worktree := filepath.Join(dir, "worktree")
	require.NoError(t, os.MkdirAll(worktree, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: /main/.git/worktrees/wt\n"), 0o644))
	plain := filepath.Join(dir, "plain")
	require.NoError(t, os.MkdirAll(plain, 0o755))

	require.True(t, IsRepoBoundary(repo))
	require.True(t, IsRepoBoundary(worktree))
	require.False(t, IsRepoBoundary(plain))
	require.False(t, IsRepoBoundary(filepath.Join(dir, "missing")))
}

// looseParent builds a directory that is not a repository and holds one
// committed child repository, loose Markdown beside it, and a repository nested
// two levels down inside a plain folder.
func looseParent(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git binary not available")
	}
	parent := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		parent = resolved
	}
	alpha := filepath.Join(parent, "alpha")
	require.NoError(t, os.MkdirAll(alpha, 0o755))
	runGit(t, alpha, "-c", "init.defaultBranch=main", "init")
	writeFile(t, alpha, "README.md", "# alpha\n")
	runGit(t, alpha, "add", "README.md")
	runGit(t, alpha, "commit", "-m", "alpha")

	writeFile(t, parent, "notes.md", "# notes\n")
	writeFile(t, parent, "drafts/idea.md", "# idea\n")
	require.NoError(t, os.MkdirAll(filepath.Join(parent, "drafts", "old", ".git"), 0o755))
	writeFile(t, parent, "drafts/old/inside.md", "# inside\n")
	return parent
}

func recentPaths(rf []model.RecentFile) []string {
	out := make([]string, 0, len(rf))
	for _, r := range rf {
		out = append(out, r.Path)
	}
	return out
}

// A service that stops at repositories is the one for the Markdown beside a set
// of clones: each clone is a project of its own, so none of its files and none
// of its history may leak into this one.
func TestStopAtReposKeepsChildRepositoriesOut(t *testing.T) {
	ClearRecentFilesCache()
	t.Cleanup(ClearRecentFilesCache)
	parent := looseParent(t)

	delegating := NewService(parent, Options{})
	require.Contains(t, recentPaths(delegating.Recents(50, nil, true, true)), "alpha/README.md",
		"control: a plain parent delegates to its child repository")
	require.NotEmpty(t, delegating.History("alpha/README.md", 5))

	ClearRecentFilesCache()
	svc := NewService(parent, Options{StopAtRepos: true})
	require.False(t, svc.InWorkTree())
	require.ElementsMatch(t, []string{"notes.md", "drafts/idea.md"}, recentPaths(svc.Recents(50, nil, true, true)))
	require.Empty(t, svc.History("alpha/README.md", 5))
	require.Nil(t, svc.LastCommit("alpha/README.md"))
	require.Empty(t, svc.LastCommitsBatch([]string{"alpha/README.md"}))
}

// A checkout whose .git is a file — a linked worktree, or a repository made
// with --separate-git-dir — sitting right beside the clones is a boundary as
// much as a clone is. looseMarkdown hands each top-level directory to the walk
// as a root of its own, so the root is where the check has to happen: missing
// it listed every document inside the worktree in recents, and the same
// project then refused to open them.
func TestStopAtReposKeepsTopLevelWorktreesOut(t *testing.T) {
	ClearRecentFilesCache()
	t.Cleanup(ClearRecentFilesCache)
	parent := looseParent(t)
	runGit(t, filepath.Join(parent, "alpha"), "worktree", "add", "-q", "-b", "wt", filepath.Join(parent, "wt"))
	writeFile(t, parent, "wt/inworktree.md", "# in the worktree\n")
	sep := filepath.Join(parent, "sep")
	runGit(t, parent, "-c", "init.defaultBranch=main", "init", "-q", "--separate-git-dir="+filepath.Join(t.TempDir(), "sep.git"), sep)
	writeFile(t, parent, "sep/separate.md", "# separate\n")

	svc := NewService(parent, Options{StopAtRepos: true})
	require.ElementsMatch(t, []string{"notes.md", "drafts/idea.md"}, recentPaths(svc.Recents(50, nil, true, true)))

	// Every mode skips linked worktrees (194e4f3), so a parent served as one
	// project does not list them either — only the real clone is delegated to.
	ClearRecentFilesCache()
	got := recentPaths(NewService(parent, Options{}).Recents(50, nil, true, true))
	require.Contains(t, got, "alpha/README.md")
	require.NotContains(t, got, "wt/inworktree.md")
	require.NotContains(t, got, "wt/README.md")
	require.NotContains(t, got, "sep/separate.md")
}

func TestInWorkTree(t *testing.T) {
	repo := initRepo(t)
	require.True(t, NewService(repo, Options{}).InWorkTree())
	sub := filepath.Join(repo, "docs")
	require.NoError(t, os.MkdirAll(sub, 0o755))
	require.True(t, NewService(sub, Options{}).InWorkTree(), "a subdirectory of a repository is inside its work tree")
	require.False(t, NewService(t.TempDir(), Options{}).InWorkTree())
}
