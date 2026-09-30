package review

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// A review whose document's folder was renamed: the viewer follows the
// document to its new path and asks the store to file the review there.

func reviewWith(path string, ids []string, nonces ...string) *model.ReviewData {
	rd := model.NewReviewData(path)
	for _, id := range ids {
		rd.Comments = append(rd.Comments, model.NewReviewComment(id, "comment "+id, 1717000000))
	}
	rd.Nonces = nonces
	return rd
}

func commentIDs(rd *model.ReviewData) []string {
	ids := []string{}
	for _, c := range rd.Comments {
		ids = append(ids, c.ID)
	}
	return ids
}

func TestMoveFilesTheReviewUnderTheDocumentsNewPath(t *testing.T) {
	s := NewStore(t.TempDir())
	require.NoError(t, s.Save("docs/old/a.md", "r", reviewWith("docs/old/a.md", []string{"c1", "c2"}, "n1")))

	got, moved, err := s.Move("docs/old/a.md", "docs/new/a.md", "r")
	require.NoError(t, err)
	require.True(t, moved)
	require.Equal(t, "docs/new/a.md", got.FilePath)
	require.Equal(t, []string{"c1", "c2"}, commentIDs(got))
	require.Equal(t, []string{"n1"}, got.Nonces)

	stored, err := s.Get("docs/new/a.md", "r")
	require.NoError(t, err)
	require.Equal(t, got, stored)
	gone, err := s.Get("docs/old/a.md", "r")
	require.NoError(t, err)
	require.Nil(t, gone, "the old path no longer has a review")
	require.NoFileExists(t, filepath.Join(s.Dir(), "r__docs__old__a.md.json"))
}

func TestMoveWithNoReviewAtTheOldPathChangesNothing(t *testing.T) {
	s := NewStore(t.TempDir())

	got, moved, err := s.Move("docs/old/a.md", "docs/new/a.md", "")
	require.NoError(t, err)
	require.False(t, moved)
	require.Nil(t, got)

	// A second viewer following the same document finds the review already
	// moved, and is answered with it.
	require.NoError(t, s.Save("docs/new/a.md", "", reviewWith("docs/new/a.md", []string{"c1"})))
	got, moved, err = s.Move("docs/old/a.md", "docs/new/a.md", "")
	require.NoError(t, err)
	require.False(t, moved)
	require.Equal(t, []string{"c1"}, commentIDs(got))
}

// A review can already be filed under the new path: the document was there
// once before and had one. Neither review's comments nor its record of the
// responses already applied may be lost.
func TestMoveIntoAPathThatHasAReviewKeepsBoth(t *testing.T) {
	s := NewStore(t.TempDir())
	require.NoError(t, s.Save("new.md", "", reviewWith("new.md", []string{"c0", "c1"}, "n0", "n1")))
	require.NoError(t, s.Save("old.md", "", reviewWith("old.md", []string{"c1", "c2"}, "n1", "n2")))

	got, moved, err := s.Move("old.md", "new.md", "")
	require.NoError(t, err)
	require.True(t, moved)
	require.Equal(t, "new.md", got.FilePath)
	require.Equal(t, []string{"c0", "c1", "c2"}, commentIDs(got))
	require.Equal(t, "comment c1", got.Comments[1].Comment)
	require.Equal(t, []string{"n0", "n1", "n2"}, got.Nonces)
	gone, err := s.Get("old.md", "")
	require.NoError(t, err)
	require.Nil(t, gone)
}

func TestMoveKeepsTheNewestNoncesWithinTheCap(t *testing.T) {
	s := NewStore(t.TempDir())
	nonces := func(prefix string, n int) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("%s%03d", prefix, i)
		}
		return out
	}
	require.NoError(t, s.Save("new.md", "", reviewWith("new.md", nil, nonces("a", maxNonces)...)))
	require.NoError(t, s.Save("old.md", "", reviewWith("old.md", nil, nonces("b", 3)...)))

	got, _, err := s.Move("old.md", "new.md", "")
	require.NoError(t, err)
	require.Len(t, got.Nonces, maxNonces)
	require.Equal(t, "b002", got.Nonces[maxNonces-1])
	require.Equal(t, "a003", got.Nonces[0])
}

// `a/b.md` and `a__b.md` flatten to one review file. Moving between them must
// not delete the review it has just written.
func TestMoveBetweenPathsSharingAFileNameKeepsTheReview(t *testing.T) {
	s := NewStore(t.TempDir())
	require.Equal(t, s.reviewFile("a/b.md", ""), s.reviewFile("a__b.md", ""))
	require.NoError(t, s.Save("a/b.md", "", reviewWith("a/b.md", []string{"c1"})))

	_, moved, err := s.Move("a/b.md", "a__b.md", "")
	require.NoError(t, err)
	require.True(t, moved)
	got, err := s.Get("a__b.md", "")
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Equal(t, "a__b.md", got.FilePath)
	require.Equal(t, []string{"c1"}, commentIDs(got))
}

// Move holds two files' locks at once. Two paths sharing a shard take it once,
// and two moves the opposite way round each other take theirs in the same
// order, so neither deadlocks (the test would time out).
func TestMoveTakesBothLocksWithoutDeadlock(t *testing.T) {
	s := NewStore(t.TempDir())

	same, other := collidingReviewPaths(t, s)
	require.Equal(t, s.shard(same, ""), s.shard(other, ""))
	require.NoError(t, s.Save(same, "", reviewWith(same, []string{"c1"})))
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _, _ = s.Move(same, other, "")
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("a move between two paths sharing a lock shard deadlocked")
	}

	x, y := "x.md", "y.md"
	for s.shard(x, "") == s.shard(y, "") {
		y = "y" + y
	}
	require.NoError(t, s.Save(x, "", reviewWith(x, []string{"cx"})))
	require.NoError(t, s.Save(y, "", reviewWith(y, []string{"cy"})))
	var wg sync.WaitGroup
	finished := make(chan struct{})
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _, _, _ = s.Move(x, y, "") }()
		go func() { defer wg.Done(); _, _, _ = s.Move(y, x, "") }()
	}
	go func() { wg.Wait(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("two moves in opposite directions deadlocked")
	}
	// Whichever way the last one went, both comments are filed together.
	a, err := s.Get(x, "")
	require.NoError(t, err)
	b, err := s.Get(y, "")
	require.NoError(t, err)
	require.True(t, (a == nil) != (b == nil), "the review is filed under exactly one of the two paths")
	both := a
	if both == nil {
		both = b
	}
	require.ElementsMatch(t, []string{"cx", "cy"}, commentIDs(both))
}
