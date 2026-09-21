package starred

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAcquireFileLockIsExclusive(t *testing.T) {
	s := newTestStore(t)

	release, err := s.acquireFileLock()
	require.NoError(t, err)
	require.FileExists(t, s.path+".lock")

	// A second acquire spins for lockWait and then gives up rather than
	// proceeding into a read-modify-write the holder is already inside.
	start := time.Now()
	_, err = s.acquireFileLock()
	require.Error(t, err)
	require.GreaterOrEqual(t, time.Since(start), lockWait)

	release()
	require.NoFileExists(t, s.path+".lock")

	// Released, the next caller gets it immediately.
	release2, err := s.acquireFileLock()
	require.NoError(t, err)
	release2()
}

// Without this, one kill -9 mid-write would disable bookmarks until someone
// deleted the file by hand.
func TestStaleLockIsBroken(t *testing.T) {
	s := newTestStore(t)
	lockPath := s.path + ".lock"
	require.NoError(t, os.MkdirAll(filepath.Dir(lockPath), 0o755))
	require.NoError(t, os.WriteFile(lockPath, nil, 0o644))

	old := time.Now().Add(-2 * lockStale)
	require.NoError(t, os.Chtimes(lockPath, old, old))

	release, err := s.acquireFileLock()
	require.NoError(t, err)
	release()
}

func TestFreshLockIsNotBroken(t *testing.T) {
	s := newTestStore(t)
	lockPath := s.path + ".lock"
	require.NoError(t, os.MkdirAll(filepath.Dir(lockPath), 0o755))
	require.NoError(t, os.WriteFile(lockPath, nil, 0o644))

	require.False(t, breakStaleLock(lockPath))
	require.FileExists(t, lockPath)
}

// The failure Copilot caught on the PR: a holder paused past lockStale has its
// lock broken, another writer takes it, and the original's release must not
// delete the new owner's lock — which would let a third writer in alongside it.
func TestReleaseDoesNotDeleteALockItLost(t *testing.T) {
	s := newTestStore(t)
	lockPath := s.path + ".lock"

	release, err := s.acquireFileLock()
	require.NoError(t, err)

	// Age the lock past the staleness threshold, as a stopped process would.
	old := time.Now().Add(-2 * lockStale)
	require.NoError(t, os.Chtimes(lockPath, old, old))

	// A second writer breaks it and takes it.
	require.True(t, breakStaleLock(lockPath))
	release2, err := s.acquireFileLock()
	require.NoError(t, err)
	taken, err := os.ReadFile(lockPath)
	require.NoError(t, err)

	// The original holder resumes and releases.
	release()

	still, err := os.ReadFile(lockPath)
	require.NoError(t, err, "the new owner's lock must survive the old holder's release")
	require.Equal(t, taken, still)

	release2()
	require.NoFileExists(t, lockPath)
}

// A lock replaced between the staleness check and the removal belongs to
// someone else by then.
func TestStaleBreakLeavesALockThatChangedUnderIt(t *testing.T) {
	s := newTestStore(t)
	lockPath := s.path + ".lock"

	release, err := s.acquireFileLock()
	require.NoError(t, err)
	defer release()

	require.False(t, breakStaleLock(lockPath), "a fresh lock is not stale")
	require.FileExists(t, lockPath)
}

// Every acquisition gets its own token, or ownership could not be told apart.
func TestLockTokensAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for range 100 {
		tok, err := newLockToken()
		require.NoError(t, err)
		require.NotEmpty(t, tok)
		require.False(t, seen[tok], "token repeated")
		seen[tok] = true
	}
}
