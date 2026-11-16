//go:build unix

package live

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/review"
)

// Deliveries must not wait behind an unrelated filesystem read in the main
// watcher loop. A FIFO at the git index holds that loop in its fingerprint
// read; opening its writer proves that the reader has reached the FIFO.
func TestWatcherConsumesInboxWhileEventLoopIsBlocked(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".git"), 0o755))
	store := review.NewStore(t.TempDir())
	seedReviewedDoc(t, store, root, "repoX", "a.md", "c1a2b3c4deadbeef")
	m := NewManager(quietLogger(), nil)
	c := m.newTestConn(32)
	w, err := NewWatcher(root, "repoX", m, store, false, quietLogger())
	require.NoError(t, err)
	stop := startWatcher(t, w)
	defer stop()

	// A content push proves initial watch registration is finished.
	require.Eventually(t, func() bool {
		require.NoError(t, os.WriteFile(filepath.Join(root, "probe.md"), []byte(time.Now().String()), 0o644))
		select {
		case <-c.send:
			return true
		default:
			return false
		}
	}, 5*time.Second, 150*time.Millisecond)

	index := filepath.Join(root, ".git", "index")
	require.NoError(t, syscall.Mkfifo(index, 0o600))
	var writer *os.File
	require.Eventually(t, func() bool {
		writer, err = os.OpenFile(index, os.O_WRONLY|syscall.O_NONBLOCK, 0)
		return err == nil
	}, 3*time.Second, 10*time.Millisecond)
	// Closing supplies EOF and lets the event loop finish before stop joins it.
	defer func() {
		_ = os.Remove(index)
		_ = writer.Close()
	}()

	// Create the inbox after the loop stalls: it has no watch registered, so
	// merely moving consumption to another fsnotify callback is insufficient.
	inbox := review.InboxDir(root)
	require.NoError(t, os.MkdirAll(inbox, 0o755))
	name := filepath.Join(inbox, "planning.jsonl")
	require.NoError(t, os.WriteFile(name+".writing", []byte(`{"path":"a.md","id":"c1a2b3c4","summary":"recorded","nonce":"stalled-loop"}`+"\n"), 0o644))
	require.NoError(t, os.Rename(name+".writing", name))
	require.Eventually(t, func() bool {
		data, getErr := store.Get("a.md", "repoX")
		return getErr == nil && len(data.Comments[0].Reactions) == 1
	}, 8*time.Second, 20*time.Millisecond, "inbox consumption must survive a stalled or missing filesystem watch")
	_, err = os.Stat(name)
	require.ErrorIs(t, err, os.ErrNotExist)
}
