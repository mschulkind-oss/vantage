package review

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/model"
)

func TestReviewFileFlattening(t *testing.T) {
	s := NewStore("/base")
	cases := []struct {
		name     string
		path     string
		repo     string
		wantBase string
	}{
		{"simple", "notes.md", "", "notes.md.json"},
		{"nested", "docs/design/spec.md", "", "docs__design__spec.md.json"},
		{"with-repo", "docs/spec.md", "myrepo", "myrepo__docs__spec.md.json"},
		{"backslashes", `docs\win\spec.md`, "", "docs__win__spec.md.json"},
		{"mixed-separators", `a/b\c.md`, "r", "r__a__b__c.md.json"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := s.reviewFile(tc.path, tc.repo)
			require.Equal(t, filepath.Join("/base", tc.wantBase), got)
		})
	}
}

func TestGetMissingFileReturnsNil(t *testing.T) {
	s := NewStore(t.TempDir())
	got, err := s.Get("does-not-exist.md", "")
	require.NoError(t, err)
	require.Nil(t, got)
}

func TestGetCorruptFileReturnsNil(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	// Write a file whose name matches reviewFile but with invalid JSON.
	p := s.reviewFile("broken.md", "")
	require.NoError(t, os.WriteFile(p, []byte("{not valid json"), 0o644))

	got, err := s.Get("broken.md", "")
	require.NoError(t, err)
	require.Nil(t, got, "a corrupt file must read as absent")
}

func TestSaveThenGetRoundTrips(t *testing.T) {
	s := NewStore(t.TempDir())
	data := model.NewReviewData("a/b.md")
	data.Comments = append(data.Comments, model.NewReviewComment("id-123", "looks good", 1700000000.5))

	require.NoError(t, s.Save("a/b.md", "", data))

	got, err := s.Get("a/b.md", "")
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Equal(t, "a/b.md", got.FilePath)
	require.Len(t, got.Comments, 1)
	require.Equal(t, "id-123", got.Comments[0].ID)
	require.Equal(t, 1700000000.5, got.Comments[0].CreatedAt)
}

func TestSaveIsAtomicNoTempLeftBehind(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	require.NoError(t, s.Save("x.md", "", model.NewReviewData("x.md")))

	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, e := range entries {
		require.NotContains(t, e.Name(), ".tmp", "no temp file should survive a successful save")
	}
	require.FileExists(t, s.reviewFile("x.md", ""))
}

func TestSaveCreatesBaseDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "reviews")
	s := NewStore(dir)
	require.NoError(t, s.Save("x.md", "", model.NewReviewData("x.md")))
	require.DirExists(t, dir)
}

func TestDelete(t *testing.T) {
	s := NewStore(t.TempDir())

	deleted, err := s.Delete("absent.md", "")
	require.NoError(t, err)
	require.False(t, deleted, "deleting a missing review reports false")

	require.NoError(t, s.Save("present.md", "", model.NewReviewData("present.md")))
	deleted, err = s.Delete("present.md", "")
	require.NoError(t, err)
	require.True(t, deleted)

	got, err := s.Get("present.md", "")
	require.NoError(t, err)
	require.Nil(t, got)
}

func TestDefaultStoreUsesLiteralPath(t *testing.T) {
	s := DefaultStore()
	// The default must be the literal ~/.local/share/vantage/reviews, not an
	// XDG-resolved path — that is an on-disk upgrade contract.
	require.True(t, filepath.IsAbs(s.Dir()) || s.Dir() == filepath.Join(".local", "share", "vantage", "reviews"))
	require.Contains(t, s.Dir(), filepath.Join(".local", "share", "vantage", "reviews"))
}
