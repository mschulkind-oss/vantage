package git

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestRecentsFromLogGolden feeds captured "git log" text (the recents 4-field
// format that DROPS %ae) directly to the parser, asserting NUL-field handling,
// %ct epoch→UTC conversion, the "Unknown" author fallback, and that only
// existing matching files survive.
func TestRecentsFromLogGolden(t *testing.T) {
	dir := t.TempDir()
	// The parser stats files relative to repoPath, so create the ones it should
	// keep. "missing.md" is intentionally absent so it is dropped.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "alpha.md"), []byte("a\n"), 0o644))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "docs"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "docs", "beta.md"), []byte("b\n"), 0o644))

	svc := &GitService{
		repoPath:    dir,
		workingDir:  dir,
		excludeDirs: map[string]struct{}{},
	}

	// Recents log format: %H%x00%an%x00%ct%x00%s then --name-only paths.
	// Note: exactly FOUR NUL fields (no %ae). 1700000000 == 2023-11-14 22:13:20 UTC.
	const nul = "\x00"
	logOut := "" +
		"abc123" + nul + "Alice" + nul + "1700000000" + nul + "first subject\n" +
		"alpha.md\n" +
		"missing.md\n" +
		"\n" +
		"def456" + nul + "" + nul + "1700000100" + nul + "second subject\n" +
		"docs/beta.md\n" +
		"notes.txt\n"

	seen := map[string]struct{}{}
	got := svc.recentsFromLog(logOut, []string{".md"}, true, nil, seen)

	byPath := map[string]struct {
		hexsha, author, message string
		date                    time.Time
		untracked               bool
	}{}
	for _, rf := range got {
		byPath[rf.Path] = struct {
			hexsha, author, message string
			date                    time.Time
			untracked               bool
		}{rf.Hexsha, rf.AuthorName, rf.Message, rf.Date, rf.Untracked}
	}

	require.Len(t, got, 2, "only existing .md files are kept (missing.md and notes.txt dropped)")

	a := byPath["alpha.md"]
	require.Equal(t, "abc123", a.hexsha)
	require.Equal(t, "Alice", a.author)
	require.Equal(t, "first subject", a.message)
	require.False(t, a.untracked)

	b := byPath["docs/beta.md"]
	require.Equal(t, "def456", b.hexsha)
	require.Equal(t, "Unknown", b.author, "empty author falls back to Unknown")
	require.Equal(t, "second subject", b.message)

	// The recents date for tracked files is the file's on-disk mtime (UTC), not
	// the commit's %ct — matching the recent-files contract.
	alphaInfo, err := os.Stat(filepath.Join(dir, "alpha.md"))
	require.NoError(t, err)
	require.True(t, byPath["alpha.md"].date.Equal(alphaInfo.ModTime().UTC()))
	require.Equal(t, time.UTC, byPath["alpha.md"].date.Location())
}

// TestEpochToTime checks the %ct epoch parsing used across the log formats.
func TestEpochToTime(t *testing.T) {
	t.Parallel()
	require.True(t, epochToTime("1700000000").Equal(time.Unix(1700000000, 0).UTC()))
	require.Equal(t, time.UTC, epochToTime("1700000000").Location())
	require.True(t, epochToTime("not-a-number").IsZero(), "garbage epoch yields the zero time")
}
