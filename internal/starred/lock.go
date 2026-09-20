package starred

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// The lock file exists because the Store's mutex does not cross processes.
//
// Two vantage instances serving the same root both read-modify-write one file,
// and os.Rename makes each write atomic without making the surrounding
// read-modify-write atomic: A reads, B reads, A writes, B writes, and A's
// bookmark is gone with nothing reported. An exclusive create is the cheapest
// thing that closes that window without a platform-specific file.
const (
	// lockWait bounds how long a caller spins for the lock before giving up.
	// A bookmark toggle is a single small file rewrite, so a holder that has
	// not finished within this is not merely slow.
	lockWait = 2 * time.Second
	// lockPoll is the retry interval while waiting.
	lockPoll = 20 * time.Millisecond
	// lockStale is how old a lock file must be before it is assumed to belong
	// to a crashed process and broken. Without this, one kill -9 would disable
	// bookmarks until the file is removed by hand.
	lockStale = 30 * time.Second
)

// acquireFileLock takes the cross-process lock guarding s.path and returns its
// release func. The returned func is always safe to call.
func (s *Store) acquireFileLock() (func(), error) {
	lockPath := s.path + ".lock"
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return nil, err
	}

	deadline := time.Now().Add(lockWait)
	for {
		f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			_ = f.Close()
			return func() { _ = os.Remove(lockPath) }, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, err
		}

		if breakStaleLock(lockPath) {
			continue
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("starred: bookmarks are locked by another process (%s)", lockPath)
		}
		time.Sleep(lockPoll)
	}
}

// breakStaleLock removes lockPath when it is older than lockStale, reporting
// whether it did. A lock that vanished on its own also counts: the next
// exclusive create will win.
func breakStaleLock(lockPath string) bool {
	info, err := os.Stat(lockPath)
	if err != nil {
		return errors.Is(err, fs.ErrNotExist)
	}
	if time.Since(info.ModTime()) < lockStale {
		return false
	}
	slog.Warn("starred: breaking stale lock", "path", lockPath, "age", time.Since(info.ModTime()))
	return os.Remove(lockPath) == nil
}
