package live

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestWatcherStatsLifetime confirms Stats reports the watcher's lifetime
// counters, including the watched-directory count and the per-reason drops, and
// that a heartbeat does not zero them (the heartbeat logs only the interval
// delta).
func TestWatcherStatsLifetime(t *testing.T) {
	w := &Watcher{
		logger:          quietLogger(),
		dirs:            map[string]struct{}{"docs": {}, "docs/guide": {}},
		watchFailedDirs: 2,
	}
	w.stats = watcherStats{
		eventsTotal:    5,
		kept:           3,
		droppedExt:     1,
		droppedIgnore:  4,
		droppedSameFP:  2,
		droppedStale:   6,
		droppedAttrib:  7,
		droppedOutside: 8,
	}

	w.logHeartbeat()

	got := w.Stats()
	require.Equal(t, 1, got.Repos, "one watcher serves one repository")
	require.Equal(t, 3, got.WatchedDirs, "two registered dirs plus the root")
	require.Equal(t, 2, got.WatchFailedDirs)
	require.Equal(t, 5, got.EventsTotal, "heartbeat must not reset the lifetime events")
	require.Equal(t, 3, got.Kept)
	require.Equal(t, 1, got.DroppedExt)
	require.Equal(t, 4, got.DroppedIgnore)
	require.Equal(t, 8, got.DroppedOutside)
	require.Equal(t, 2, got.DroppedSameFP)
	require.Equal(t, 6, got.DroppedStale)
	require.Equal(t, 7, got.DroppedAttrib)
}
