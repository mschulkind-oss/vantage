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
