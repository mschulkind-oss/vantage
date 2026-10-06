package spaceid

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// spaceFiles is testdata/space-files.json, which vantage-check's suite reads
// too, so the two readers of a .vantage/space give one answer for every text.
type spaceFiles struct {
	Files []struct {
		Text string  `json:"text"`
		ID   *string `json:"id"`
	} `json:"files"`
	IDs []struct {
		ID    string `json:"id"`
		Valid bool   `json:"valid"`
	} `json:"ids"`
}

func loadSpaceFiles(t *testing.T) spaceFiles {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "space-files.json"))
	require.NoError(t, err)
	var fixture spaceFiles
	require.NoError(t, json.Unmarshal(data, &fixture))
	require.NotEmpty(t, fixture.Files)
	require.NotEmpty(t, fixture.IDs)
	return fixture
}

func TestParseReadsEveryFileAsTheFixtureSays(t *testing.T) {
	for _, tc := range loadSpaceFiles(t).Files {
		id, ok := Parse([]byte(tc.Text))
		if tc.ID == nil {
			require.Falsef(t, ok, "%q holds no space id, yet Parse read %q", tc.Text, id)
			continue
		}
		require.Truef(t, ok, "%q holds %q", tc.Text, *tc.ID)
		require.Equal(t, *tc.ID, id)
	}
}

func TestValidAcceptsExactlyTheFixturesIDs(t *testing.T) {
	for _, tc := range loadSpaceFiles(t).IDs {
		require.Equalf(t, tc.Valid, Valid(tc.ID), "%q", tc.ID)
	}
	require.Len(t, "abcdefghijklmnop", Length)
	require.Equal(t, ".vantage/space", FileRel)
}

// writeSpace writes text as root's .vantage/space, making .vantage.
func writeSpace(t *testing.T, root, text string) string {
	t.Helper()
	path := filepath.Join(root, ".vantage", "space")
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte(text), 0o644))
	return path
}

func TestIDIsFalseWithNoFile(t *testing.T) {
	root := t.TempDir()
	f := New(root)
	_, ok := f.ID()
	require.False(t, ok)
	require.Equal(t, filepath.Join(root, ".vantage", "space"), f.Path())
	// Looking made nothing: there is still no .vantage at all.
	_, err := os.Lstat(filepath.Join(root, ".vantage"))
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestIDFollowsTheFileAsItChanges(t *testing.T) {
	root := t.TempDir()
	f := New(root)
	path := writeSpace(t, root, "abcdefghijklmnop\n")

	id, ok := f.ID()
	require.True(t, ok)
	require.Equal(t, "abcdefghijklmnop", id)

	// Rewritten in place with an id of the same length: the size and the
	// inode are the same, so the modification time is what says it changed.
	// It is set, rather than left to the clock, so a coarse one cannot make
	// the two writes look like one.
	before, err := os.Stat(path)
	require.NoError(t, err)
	stamp := before.ModTime().Add(time.Second)
	require.NoError(t, os.WriteFile(path, []byte("qrstuvwxyz234567\n"), 0o644))
	require.NoError(t, os.Chtimes(path, stamp, stamp))
	id, ok = f.ID()
	require.True(t, ok)
	require.Equal(t, "qrstuvwxyz234567", id)

	// Replaced by a rename, as an atomic writer does, with the same size and
	// the same modification time: only the inode differs, and that is enough.
	next := filepath.Join(root, ".vantage", "next")
	require.NoError(t, os.WriteFile(next, []byte("2222222222222222\n"), 0o644))
	require.NoError(t, os.Chtimes(next, stamp, stamp))
	require.NoError(t, os.Rename(next, path))
	id, ok = f.ID()
	require.True(t, ok)
	require.Equal(t, "2222222222222222", id)

	// Made malformed, then removed: no id either way.
	require.NoError(t, os.WriteFile(path, []byte("not an id\n"), 0o644))
	_, ok = f.ID()
	require.False(t, ok)
	require.NoError(t, os.Remove(path))
	_, ok = f.ID()
	require.False(t, ok)

	// And back.
	writeSpace(t, root, "abcdefghijklmnop\n")
	id, ok = f.ID()
	require.True(t, ok)
	require.Equal(t, "abcdefghijklmnop", id)
}

func TestIDReadsOnlyWhenTheFileChanged(t *testing.T) {
	reads := 0
	t.Cleanup(func() { read = readSmall })
	read = func(path string) ([]byte, error) {
		reads++
		return readSmall(path)
	}

	root := t.TempDir()
	f := New(root)
	path := writeSpace(t, root, "abcdefghijklmnop\n")
	for range 3 {
		id, ok := f.ID()
		require.True(t, ok)
		require.Equal(t, "abcdefghijklmnop", id)
	}
	require.Equal(t, 1, reads, "an unchanged file is answered from what was read")

	// A file that holds no id is cached as holding none, and read once too.
	require.NoError(t, os.WriteFile(path, []byte("no id here\n"), 0o644))
	for range 3 {
		_, ok := f.ID()
		require.False(t, ok)
	}
	require.Equal(t, 2, reads)
}

func TestIDRefusesWhatCannotBeASpaceFile(t *testing.T) {
	t.Run("a symlink, not followed", func(t *testing.T) {
		root := t.TempDir()
		target := filepath.Join(t.TempDir(), "elsewhere")
		require.NoError(t, os.WriteFile(target, []byte("abcdefghijklmnop\n"), 0o644))
		require.NoError(t, os.MkdirAll(filepath.Join(root, ".vantage"), 0o755))
		require.NoError(t, os.Symlink(target, filepath.Join(root, ".vantage", "space")))
		_, ok := New(root).ID()
		require.False(t, ok)
	})
	t.Run("a directory", func(t *testing.T) {
		root := t.TempDir()
		require.NoError(t, os.MkdirAll(filepath.Join(root, ".vantage", "space"), 0o755))
		_, ok := New(root).ID()
		require.False(t, ok)
	})
	t.Run("a file larger than any id", func(t *testing.T) {
		root := t.TempDir()
		// An id, then padding past the cap: it is not opened, let alone read.
		text := "abcdefghijklmnop\n"
		for len(text) <= maxFileBytes {
			text += "\n"
		}
		writeSpace(t, root, text)
		_, ok := New(root).ID()
		require.False(t, ok)
	})
}
