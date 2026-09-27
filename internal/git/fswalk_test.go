package git

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
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
