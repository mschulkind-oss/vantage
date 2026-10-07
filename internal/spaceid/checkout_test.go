package spaceid

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// putFile writes text at path, making its directory.
func putFile(t *testing.T, path, text string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte(text), 0o644))
}

// addWorktree lays out a linked worktree of the main checkout main at
// worktree, as `git worktree add` leaves one: an administrative directory
// .git/worktrees/<name> holding gitdir, which names the worktree's .git file,
// and commondir; and the worktree's .git file naming that directory back.
// relative writes both paths relative, as git does with
// worktree.useRelativePaths.
func addWorktree(t *testing.T, main, name, worktree string, relative bool) {
	t.Helper()
	admin := filepath.Join(main, ".git", "worktrees", name)
	putFile(t, filepath.Join(admin, "commondir"), "../..\n")
	putFile(t, filepath.Join(admin, "HEAD"), "ref: refs/heads/"+name+"\n")
	forward := filepath.Join(worktree, ".git")
	back := admin
	if relative {
		var err error
		forward, err = filepath.Rel(admin, forward)
		require.NoError(t, err)
		back, err = filepath.Rel(worktree, admin)
		require.NoError(t, err)
	}
	putFile(t, filepath.Join(admin, "gitdir"), forward+"\n")
	putFile(t, filepath.Join(worktree, ".git"), "gitdir: "+back+"\n")
}

// mainCheckout is a main checkout's .git, with config holding config.
func mainCheckout(t *testing.T, config string) string {
	t.Helper()
	root := t.TempDir()
	putFile(t, filepath.Join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
	putFile(t, filepath.Join(root, ".git", "config"), config)
	return root
}

const nonBare = "[core]\n\trepositoryformatversion = 0\n\tbare = false\n"

// A checkout holds its own id. A main checkout holds its linked worktrees'
// ids too, since vantage-check makes a worktree's id in the worktree: a
// Vantage serving only the main checkout then opens it for a link made in a
// worktree of it.
func TestACheckoutHoldsItsOwnIDAndItsWorktreesIDs(t *testing.T) {
	main := mainCheckout(t, nonBare)
	writeSpace(t, main, "abcdefghijklmnop\n")
	worktree := filepath.Join(t.TempDir(), "feature")
	addWorktree(t, main, "feature", worktree, false)
	writeSpace(t, worktree, "qrstuvwxyz234567\n")
	relative := filepath.Join(t.TempDir(), "fix")
	addWorktree(t, main, "fix", relative, true)
	writeSpace(t, relative, "2222222222222222\n")

	c := NewCheckout(main)
	require.Equal(t, filepath.Join(main, ".vantage", "space"), c.Path())
	require.Equal(t, Own, c.Holds("abcdefghijklmnop"))
	require.Equal(t, ThroughWorktree, c.Holds("qrstuvwxyz234567"))
	require.Equal(t, ThroughWorktree, c.Holds("2222222222222222"))
	require.Equal(t, NotHeld, c.Holds("3333333333333333"))

	// The worktree, served itself, holds its own id and not its main
	// checkout's.
	w := NewCheckout(worktree)
	require.Equal(t, Own, w.Holds("qrstuvwxyz234567"))
	require.Equal(t, NotHeld, w.Holds("abcdefghijklmnop"))
	require.Equal(t, NotHeld, w.Holds("2222222222222222"))

	// A worktree's id made after the first lookup is found, and one removed
	// is not held to.
	later := filepath.Join(t.TempDir(), "later")
	addWorktree(t, main, "later", later, false)
	require.Equal(t, NotHeld, c.Holds("4444444444444444"))
	writeSpace(t, later, "4444444444444444\n")
	require.Equal(t, ThroughWorktree, c.Holds("4444444444444444"))
	require.NoError(t, os.RemoveAll(filepath.Join(main, ".git", "worktrees", "later")))
	require.Equal(t, NotHeld, c.Holds("4444444444444444"))
}

// What is not a linked worktree of this checkout holds nothing through it.
func TestOnlyThisCheckoutsOwnWorktreesCount(t *testing.T) {
	t.Run("a main checkout copied whole, whose worktrees are the original's", func(t *testing.T) {
		main := mainCheckout(t, nonBare)
		worktree := filepath.Join(t.TempDir(), "feature")
		addWorktree(t, main, "feature", worktree, false)
		writeSpace(t, worktree, "qrstuvwxyz234567\n")
		copied := t.TempDir()
		require.NoError(t, os.CopyFS(copied, os.DirFS(main)))

		require.Equal(t, ThroughWorktree, NewCheckout(main).Holds("qrstuvwxyz234567"))
		require.Equal(t, NotHeld, NewCheckout(copied).Holds("qrstuvwxyz234567"))
	})

	// `git clone --bare url proj/.git` and worktrees under proj: proj is no
	// checkout, and its worktrees are not its.
	t.Run("a bare repository kept as a folder's .git", func(t *testing.T) {
		for _, config := range []string{
			"[core]\n\tbare = true\n",
			"[Core]\n\tBare = yes ; a comment\n",
			"[core]\n\tbare\n",
		} {
			proj := mainCheckout(t, config)
			worktree := filepath.Join(proj, "main")
			addWorktree(t, proj, "main", worktree, false)
			writeSpace(t, worktree, "qrstuvwxyz234567\n")
			require.Equalf(t, NotHeld, NewCheckout(proj).Holds("qrstuvwxyz234567"), "%q", config)
			// The worktree, served itself, is a checkout of its own.
			require.Equal(t, Own, NewCheckout(worktree).Holds("qrstuvwxyz234567"))
		}
	})

	t.Run("a gitdir that names nothing, or no .git directory at all", func(t *testing.T) {
		main := mainCheckout(t, nonBare)
		putFile(t, filepath.Join(main, ".git", "worktrees", "gone", "gitdir"), "/nowhere/at/all/.git\n")
		require.Equal(t, NotHeld, NewCheckout(main).Holds("qrstuvwxyz234567"))

		plain := t.TempDir()
		writeSpace(t, plain, "abcdefghijklmnop\n")
		require.Equal(t, Own, NewCheckout(plain).Holds("abcdefghijklmnop"))
	})
}

// IsBare reads a git config the way both readers do, which the fixture holds
// them to.
func TestIsBareReadsEveryConfigAsTheFixtureSays(t *testing.T) {
	for _, tc := range loadSpaceFiles(t).Configs {
		dir := t.TempDir()
		putFile(t, filepath.Join(dir, "config"), tc.Text)
		require.Equalf(t, tc.Bare, isBare(dir), "%q", tc.Text)
	}
}
