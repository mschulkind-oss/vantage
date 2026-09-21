package starred

import (
	"crypto/rand"
	"encoding/hex"
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

// newLockToken returns a value no other holder will produce, written into the
// lock file so ownership can be checked rather than assumed. Randomness alone
// is enough here — this identifies one acquisition, not one process, and a pid
// is neither unique across containers nor stable across a reused pid.
func newLockToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("starred: generating lock token: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

// acquireFileLock takes the cross-process lock guarding s.path and returns its
// release func. The returned func is always safe to call.
func (s *Store) acquireFileLock() (func(), error) {
	lockPath := s.path + ".lock"
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		return nil, err
	}

	token, err := newLockToken()
	if err != nil {
		return nil, err
	}

	deadline := time.Now().Add(lockWait)
	for {
		f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			_, writeErr := f.WriteString(token)
			closeErr := f.Close()
			if writeErr != nil || closeErr != nil {
				// An unidentifiable lock is worse than none: nothing could ever
				// prove it is stale-but-ours, so drop it and report the failure
				// rather than leaving it to be broken on a timer.
				_ = os.Remove(lockPath)
				return nil, errors.Join(writeErr, closeErr)
			}
			return func() { releaseLock(lockPath, token) }, nil
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

// releaseLock removes lockPath only while token still owns it.
//
// Deleting by pathname alone is what makes a stale-break unsafe: a holder that
// was paused past lockStale — a stopped process, a suspended laptop — comes
// back to find its lock already broken and another writer inside, and a blind
// Remove would delete *that* writer's lock and let a third in alongside it.
// Comparing first means a lock lost to a stale-break is simply left alone.
func releaseLock(lockPath, token string) {
	held, err := os.ReadFile(lockPath)
	if err != nil {
		// Already gone (broken as stale, or removed by hand): nothing to undo.
		if !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("starred: could not read lock on release", "path", lockPath, "error", err)
		}
		return
	}
	if string(held) != token {
		slog.Warn("starred: lock was taken over while held; leaving it to its new owner",
			"path", lockPath)
		return
	}
	if err := os.Remove(lockPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		slog.Warn("starred: could not remove lock", "path", lockPath, "error", err)
	}
}

// breakStaleLock removes lockPath when it is older than lockStale, reporting
// whether it did. A lock that vanished on its own also counts: the next
// exclusive create will win.
//
// The token is re-read immediately before the delete, so a lock replaced
// between the staleness check and the removal is left to its new owner rather
// than deleted out from under it.
func breakStaleLock(lockPath string) bool {
	info, err := os.Stat(lockPath)
	if err != nil {
		return errors.Is(err, fs.ErrNotExist)
	}
	age := time.Since(info.ModTime())
	if age < lockStale {
		return false
	}

	before, err := os.ReadFile(lockPath)
	if err != nil {
		return errors.Is(err, fs.ErrNotExist)
	}
	after, err := os.ReadFile(lockPath)
	if err != nil {
		return errors.Is(err, fs.ErrNotExist)
	}
	if string(before) != string(after) {
		return false
	}

	slog.Warn("starred: breaking stale lock", "path", lockPath, "age", age)
	return os.Remove(lockPath) == nil
}
