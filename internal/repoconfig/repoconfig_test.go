package repoconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// write puts a config file in a fresh repository root and returns the root.
//
// The fixture is written with this package's real FileName, which is safe *here*
// because nothing walks up out of a temp directory looking for one. Fixtures that
// live in the repository tree must never be called that: `vantage-check` finds
// `.vantage.toml` by walking up from any document below it, so a committed one
// would silently retune the documentation gate.
func write(t *testing.T, body string) string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, FileName), []byte(body), 0o644))
	return root
}

func TestParseReadsTheStarredTable(t *testing.T) {
	s, err := Parse([]byte("[starred]\npromote = [\"roadmap.md\", \"docs/*.md\"]\n"))
	require.NoError(t, err)
	require.Equal(t, []string{"roadmap.md", "docs/*.md"}, s.Starred.Promote)
	require.False(t, s.IsZero())
}

// The theme a repository offers is a top-level key, so a file that says only
// that is still a file the server acts on.
func TestParseReadsTheThemeKey(t *testing.T) {
	s, err := Parse([]byte("theme = \"catppuccin\"\n"))
	require.NoError(t, err)
	require.Equal(t, "catppuccin", s.Theme)
	require.False(t, s.IsZero(),
		"a repository offering a theme and nothing else must not read as empty")
}

// TOML puts a bare key after a table header *inside* that table, so a theme
// written below `[check]` is `check.theme` and not ours at all. That trap is
// pinned here because it is the mistake a reader of this file will make, and
// because the other reader of the file is what catches it: `vantage-check`
// polices its own table's keys, so `check.theme` fails a run loudly rather than
// doing nothing.
func TestAThemeUnderTheCheckersTableIsNotOurs(t *testing.T) {
	s, err := Parse([]byte("[check]\nstrict = true\ntheme = \"catppuccin\"\n"))
	require.NoError(t, err, "another tool's keys are not ours to reject")
	require.Empty(t, s.Theme)
}

// Guessing at a shape that does not exist has to be an error rather than a key
// that quietly does nothing, which is the discipline the `[starred]` table holds.
// Here it is the decoder's type check that says so, not the unknown-key branch,
// because `theme` is a scalar the decoder consumes either way.
func TestParseRejectsAThemeTable(t *testing.T) {
	for name, body := range map[string]string{
		"table":  "[theme]\nname = \"catppuccin\"\n",
		"dotted": "theme.name = \"catppuccin\"\n",
	} {
		t.Run(name, func(t *testing.T) {
			s, err := Parse([]byte(body))
			require.Error(t, err)
			require.True(t, s.IsZero(), "a rejected file must yield nothing, not half")
		})
	}
}

// The whole point of sharing the file: the checker's table is not ours to read,
// and it is not ours to reject either.
func TestParseReadsPastTheCheckersTable(t *testing.T) {
	s, err := Parse([]byte("[check]\nstrict = true\n\n[check.rules]\n\"link/x\" = \"off\"\n"))
	require.NoError(t, err)
	require.True(t, s.IsZero())
}

// Nor another tool's.
func TestParseReadsPastAnotherToolsTable(t *testing.T) {
	s, err := Parse([]byte("[tool.ruff]\nline-length = 100\n\n[starred]\npromote = [\"a.md\"]\n"))
	require.NoError(t, err)
	require.Equal(t, []string{"a.md"}, s.Starred.Promote)
}

// Inside our own table, a typo is an error. `promotes = [...]` doing nothing at
// all with no way to find out is the silence this package exists to break.
func TestParseRejectsAnUnknownKeyInOurTable(t *testing.T) {
	_, err := Parse([]byte("[starred]\npromotes = [\"roadmap.md\"]\n"))
	require.Error(t, err)
	require.Contains(t, err.Error(), "unknown key")
	require.Contains(t, err.Error(), "starred.promotes")
}

func TestParseRejectsBadSyntaxAndTypes(t *testing.T) {
	for name, body := range map[string]string{
		"syntax":         "[starred\npromote = []\n",
		"wrong type":     "[starred]\npromote = \"roadmap.md\"\n",
		"duplicate key":  "[starred]\npromote = [\"a\"]\npromote = [\"b\"]\n",
		"element type":   "[starred]\npromote = [1, 2]\n",
		"table not list": "[starred]\n[starred.promote]\na = 1\n",
		"theme type":     "theme = 7\n",
		"theme list":     "theme = [\"catppuccin\"]\n",
	} {
		t.Run(name, func(t *testing.T) {
			s, err := Parse([]byte(body))
			require.Error(t, err)
			require.True(t, s.IsZero(), "a rejected file must yield nothing, not half")
		})
	}
}

func TestMissingFileIsNotAnError(t *testing.T) {
	c := New(t.TempDir())
	s, err := c.Settings()
	require.NoError(t, err)
	require.True(t, s.IsZero())
}

func TestSettingsSurfacesTheParseError(t *testing.T) {
	c := New(write(t, "[starred]\npromotes = [\"a.md\"]\n"))
	s, err := c.Settings()
	require.Error(t, err)
	require.True(t, s.IsZero(),
		"a repository with a bad config is served as if it had none")
}

// A directory, a symlink, or a device where the config should be. os.ReadFile
// would follow the symlink and read whatever it points at.
func TestReadRefusesWhatIsNotARegularFile(t *testing.T) {
	t.Run("directory", func(t *testing.T) {
		root := t.TempDir()
		require.NoError(t, os.MkdirAll(filepath.Join(root, FileName), 0o755))
		_, err := New(root).Settings()
		require.Error(t, err)
		require.Contains(t, err.Error(), "not a regular file")
	})

	t.Run("symlink", func(t *testing.T) {
		root := t.TempDir()
		secret := filepath.Join(t.TempDir(), "secret.toml")
		require.NoError(t, os.WriteFile(secret, []byte("[starred]\npromote = [\"leaked.md\"]\n"), 0o600))
		require.NoError(t, os.Symlink(secret, filepath.Join(root, FileName)))

		s, err := New(root).Settings()
		require.Error(t, err)
		require.Contains(t, err.Error(), "not a regular file")
		require.True(t, s.IsZero(), "a symlinked config must not be read through")
	})
}

func TestReadRefusesAnOversizedFile(t *testing.T) {
	root := t.TempDir()
	body := "[starred]\npromote = [\"" + strings.Repeat("x", maxSize) + "\"]\n"
	require.NoError(t, os.WriteFile(filepath.Join(root, FileName), []byte(body), 0o644))

	_, err := New(root).Settings()
	require.Error(t, err)
	require.Contains(t, err.Error(), "larger than")
}

// The throttle exists so /starred does not stat once per repository per request.
// It has to be a throttle and not a cache: an edit must land eventually.
func TestReloadIsThrottledThenPicksTheEditUp(t *testing.T) {
	root := write(t, "[starred]\npromote = [\"first.md\"]\n")
	c := New(root)

	clock := time.Unix(1700000000, 0)
	c.now = func() time.Time { return clock }

	s, err := c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"first.md"}, s.Starred.Promote)

	require.NoError(t, os.WriteFile(filepath.Join(root, FileName),
		[]byte("[starred]\npromote = [\"second.md\"]\n"), 0o644))

	// Inside the interval: the edit is not looked for.
	s, err = c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"first.md"}, s.Starred.Promote)

	clock = clock.Add(reloadInterval + time.Second)
	s, err = c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"second.md"}, s.Starred.Promote)
}

// A file that appears after the server started, and one that is deleted.
func TestReloadNoticesTheFileAppearingAndVanishing(t *testing.T) {
	root := t.TempDir()
	c := New(root)
	clock := time.Unix(1700000000, 0)
	c.now = func() time.Time { return clock }

	s, err := c.Settings()
	require.NoError(t, err)
	require.True(t, s.IsZero())

	path := filepath.Join(root, FileName)
	require.NoError(t, os.WriteFile(path, []byte("[starred]\npromote = [\"a.md\"]\n"), 0o644))
	clock = clock.Add(reloadInterval + time.Second)
	s, err = c.Settings()
	require.NoError(t, err)
	require.Equal(t, []string{"a.md"}, s.Starred.Promote)

	require.NoError(t, os.Remove(path))
	clock = clock.Add(reloadInterval + time.Second)
	s, err = c.Settings()
	require.NoError(t, err)
	require.True(t, s.IsZero(), "removing the file must clear what it said")
}

// An edit that keeps the same mtime — a coarse-timestamped filesystem, or two
// writes inside one tick — must still be noticed when the length changes.
func TestReloadNoticesASameMtimeEdit(t *testing.T) {
	root := write(t, "[starred]\npromote = [\"a.md\"]\n")
	path := filepath.Join(root, FileName)
	c := New(root)
	clock := time.Unix(1700000000, 0)
	c.now = func() time.Time { return clock }

	_, err := c.Settings()
	require.NoError(t, err)

	info, err := os.Stat(path)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte("[starred]\npromote = [\"a.md\", \"b.md\"]\n"), 0o644))
	require.NoError(t, os.Chtimes(path, info.ModTime(), info.ModTime()))

	clock = clock.Add(reloadInterval + time.Second)
	s, err := c.Settings()
	require.NoError(t, err)
	require.Len(t, s.Starred.Promote, 2)
}

func TestGetCachesPerRootAndClearCacheDrops(t *testing.T) {
	t.Cleanup(ClearCache)
	root := t.TempDir()

	a := Get(root)
	require.Same(t, a, Get(root), "the throttle is per-Config, so it must be shared")
	require.Same(t, a, Get(root+string(filepath.Separator)+"."), "keyed by the cleaned path")
	require.NotSame(t, a, Get(t.TempDir()))

	ClearCache()
	require.NotSame(t, a, Get(root))
}

func TestPathNamesTheSharedFile(t *testing.T) {
	root := t.TempDir()
	require.Equal(t, filepath.Join(root, ".vantage.toml"), New(root).Path())
}

// The Go half of the shared-file conformance check. Its sibling lives in
// packages/vantage-check/test/config.test.ts and parses the same bytes.
//
// One fixture rather than two copies, because the property under test is that the
// two readers agree about one file. Two fixtures would let them drift apart while
// both suites stayed green, which is exactly the failure sharing a file invites.
func TestSharedFixtureIsReadableByThisReader(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "shared-config.toml"))
	require.NoError(t, err)

	s, err := Parse(data)
	require.NoError(t, err, "the checker's own sections must not make this file unreadable")
	require.Equal(t, []string{"roadmap.md", "docs/design/*.md"}, s.Starred.Promote)
}
