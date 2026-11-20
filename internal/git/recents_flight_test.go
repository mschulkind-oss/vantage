package git

import (
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/stretchr/testify/require"
)

// Every open tab refetches the recent files on each push, and a walk can take
// seconds, so callers asking for the same list at once share one walk instead
// of each running their own: six tabs ran six identical `git ls-files` walks.
func TestRecentsCallersAtOnceShareOneWalk(t *testing.T) {
	c := newRecentsCache(time.Minute)
	key := recentsKey{repoPath: "/r", limit: 30}
	release := make(chan struct{})
	var walks atomic.Int32
	compute := func() []model.RecentFile {
		walks.Add(1)
		<-release
		return []model.RecentFile{{Path: "a.md"}}
	}

	first := make(chan recentsSource)
	go func() { _, src := c.load(key, compute); first <- src }()
	waitForFlight(t, c, key)

	var wg sync.WaitGroup
	sources := make([]recentsSource, 5)
	for i := range sources {
		wg.Go(func() {
			data, src := c.load(key, compute)
			require.Equal(t, "a.md", data[0].Path)
			sources[i] = src
		})
	}
	waitForWaiters(t)
	close(release)
	wg.Wait()

	require.Equal(t, recentsWalked, <-first)
	require.Equal(t, int32(1), walks.Load())
	for _, src := range sources {
		require.Contains(t, []recentsSource{recentsJoined, recentsHit}, src)
	}
	_, src := c.load(key, compute)
	require.Equal(t, recentsHit, src, "the shared walk's list is cached")
}

// A walk that began before its repository's list was dropped may have read the
// state the drop was for: a caller after the drop starts a walk of its own,
// and the earlier walk's list is not cached.
func TestRecentsWalkBeforeAClearIsNeitherJoinedNorCached(t *testing.T) {
	c := newRecentsCache(time.Minute)
	key := recentsKey{repoPath: "/r", limit: 30}
	release := make(chan struct{})
	stale := make(chan []model.RecentFile)
	go func() {
		data, _ := c.load(key, func() []model.RecentFile {
			<-release
			return []model.RecentFile{{Path: "old.md"}}
		})
		stale <- data
	}()
	waitForFlight(t, c, key)

	c.clearRepo("/r")
	data, src := c.load(key, func() []model.RecentFile { return []model.RecentFile{{Path: "new.md"}} })
	require.Equal(t, recentsWalked, src)
	require.Equal(t, "new.md", data[0].Path)

	close(release)
	require.Equal(t, "old.md", (<-stale)[0].Path)
	data, src = c.load(key, func() []model.RecentFile { t.Fatal("walked again"); return nil })
	require.Equal(t, recentsHit, src)
	require.Equal(t, "new.md", data[0].Path, "the walk from before the drop did not overwrite it")
}

func waitForFlight(t *testing.T, c *recentsCache, key recentsKey) {
	t.Helper()
	require.Eventually(t, func() bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.flights[key] != nil
	}, 5*time.Second, time.Millisecond)
}

// waitForWaiters gives the joining goroutines a moment to block on the flight.
// One that is late finds the list cached instead, which the test accepts: what
// it asserts is one walk either way.
func waitForWaiters(t *testing.T) {
	t.Helper()
	time.Sleep(20 * time.Millisecond)
}

// A walk sorts every file it finds before it keeps limit of them, so a longer
// list's first files are a shorter one's: the activity warm, which asks for one
// file, reads the sidebar's thirty when their filters match, instead of walking
// the repository again for it.
func TestRecentsShorterListIsReadFromALongerOne(t *testing.T) {
	c := newRecentsCache(time.Minute)
	thirty := recentsKey{repoPath: "/r", limit: 30, showHidden: true}
	three := []model.RecentFile{{Path: "a.md"}, {Path: "b.md"}, {Path: "c.md"}}
	c.load(thirty, func() []model.RecentFile { return three })

	one := thirty
	one.limit = 1
	data, src := c.load(one, func() []model.RecentFile { t.Fatal("walked again"); return nil })
	require.Equal(t, recentsHit, src)
	require.Equal(t, []model.RecentFile{{Path: "a.md"}}, data)

	// Other filters are another list, and so is a longer one.
	other := one
	other.showGitignored = true
	_, src = c.load(other, func() []model.RecentFile { return nil })
	require.Equal(t, recentsWalked, src)
	more := thirty
	more.limit = 50
	_, src = c.load(more, func() []model.RecentFile { return nil })
	require.Equal(t, recentsWalked, src)
}

// A push changes its own repository's status, and the watcher clears that
// alone: in daemon mode every served repository shares the cache.
func TestClearStatusCacheOfKeepsOtherRepositories(t *testing.T) {
	ClearStatusCache()
	t.Cleanup(ClearStatusCache)
	alpha, beta := canonicalRepoPath(t.TempDir()), canonicalRepoPath(t.TempDir())
	for _, key := range []string{alpha, filepath.Join(alpha, "child"), beta, alpha + "-sibling"} {
		statusCache.set(key, map[string]string{})
	}

	ClearStatusCacheOf(alpha)

	cached := func(key string) bool { _, ok := statusCache.get(key); return ok }
	require.False(t, cached(alpha))
	require.False(t, cached(filepath.Join(alpha, "child")))
	require.True(t, cached(beta))
	require.True(t, cached(alpha+"-sibling"))
}
