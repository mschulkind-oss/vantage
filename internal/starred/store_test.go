package starred

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
)

// newTestStore returns a Store over a fresh temp dir, with a frozen clock so
// StarredAt is assertable.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s := NewStore("/repo/root", filepath.Join(t.TempDir(), dirName, "s.json"))
	s.now = func() time.Time { return time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC) }
	return s
}

func TestListWithNoFileIsEmpty(t *testing.T) {
	got, err := newTestStore(t).List()
	require.NoError(t, err)
	require.Empty(t, got)
	require.NotNil(t, got, "an empty list must marshal as [] rather than null")
}

func TestAddThenList(t *testing.T) {
	s := newTestStore(t)

	entries, err := s.Add(Entry{Path: "docs/a.md"})
	require.NoError(t, err)
	require.Len(t, entries, 1)
	require.Equal(t, "docs/a.md", entries[0].Path)
	require.Equal(t, "", entries[0].Repo)
	require.False(t, entries[0].StarredAt.IsZero(), "Add must stamp StarredAt")

	// A second Store over the same file sees it — this is the persistence the
	// feature exists for, minus the process restart.
	again, err := NewStore(s.root, s.path).List()
	require.NoError(t, err)
	require.Equal(t, entries, again)
}

// Add is the toggle's "on" half and browsers race each other, so starring twice
// must converge rather than duplicate.
func TestAddIsIdempotentAndKeepsTheOriginalTime(t *testing.T) {
	s := newTestStore(t)

	first, err := s.Add(Entry{Path: "docs/a.md", IsDir: false})
	require.NoError(t, err)
	original := first[0].StarredAt

	s.now = func() time.Time { return original.Add(time.Hour) }
	second, err := s.Add(Entry{Path: "docs/a.md", IsDir: true})
	require.NoError(t, err)

	require.Len(t, second, 1, "starring twice must leave one bookmark")
	require.Equal(t, original, second[0].StarredAt, "re-starring must not restamp")
	require.True(t, second[0].IsDir, "re-starring refreshes IsDir, which is how a stale kind heals")
}

// The repo name is part of the identity: two repos may hold the same path.
func TestEntriesAreKeyedByRepoAndPath(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Add(Entry{Repo: "alpha", Path: "a.md"})
	require.NoError(t, err)
	entries, err := s.Add(Entry{Repo: "beta", Path: "a.md"})
	require.NoError(t, err)
	require.Len(t, entries, 2)
}

func TestRemove(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Add(Entry{Path: "a.md"})
	require.NoError(t, err)
	_, err = s.Add(Entry{Path: "b.md"})
	require.NoError(t, err)

	entries, removed, err := s.Remove("", "a.md")
	require.NoError(t, err)
	require.True(t, removed)
	require.Len(t, entries, 1)
	require.Equal(t, "b.md", entries[0].Path)
}

// A miss is not an error: the handler turns the false into a 404.
func TestRemoveReportsAMiss(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Add(Entry{Path: "a.md"})
	require.NoError(t, err)

	entries, removed, err := s.Remove("", "nope.md")
	require.NoError(t, err)
	require.False(t, removed)
	require.Len(t, entries, 1, "a miss must leave the list alone")
}

func TestAddRejectsAnInvalidEntry(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Add(Entry{Path: "../escape"})
	require.ErrorIs(t, err, ErrInvalid)
	require.NoFileExists(t, s.path, "a rejected bookmark must not create the store file")
}

// One bad file must not break the endpoint, so a corrupt store reads as empty.
func TestCorruptFileIsTreatedAsEmpty(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(s.path), 0o755))
	require.NoError(t, os.WriteFile(s.path, []byte("{not json"), 0o644))

	got, err := s.List()
	require.NoError(t, err)
	require.Empty(t, got)
}

// A 64-bit hash collision is negligible but not impossible, and the file can be
// hand-edited. Either way it must never show another project's bookmarks.
// A file with no root was not written by this package — the format has never
// had a version without one — so it is a hand-edited file and gets the same
// treatment as a foreign one.
func TestRootlessFileIsTreatedAsEmpty(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(s.path), 0o755))
	require.NoError(t, os.WriteFile(s.path, []byte(`{"entries":[{"repo":"","path":"a.md"}]}`), 0o644))

	got, err := s.List()
	require.NoError(t, err)
	require.Empty(t, got)
}

func TestForeignRootIsTreatedAsEmpty(t *testing.T) {
	s := newTestStore(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(s.path), 0o755))
	raw, err := json.Marshal(file{Root: "/some/other/project", Entries: []Entry{{Path: "secret.md"}}})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(s.path, raw, 0o644))

	got, err := s.List()
	require.NoError(t, err)
	require.Empty(t, got, "a file belonging to another root must never be merged")
}

func TestMaxEntries(t *testing.T) {
	s := newTestStore(t)
	for i := range MaxEntries {
		_, err := s.Add(Entry{Path: fmt.Sprintf("doc-%03d.md", i)})
		require.NoError(t, err)
	}

	_, err := s.Add(Entry{Path: "one-too-many.md"})
	require.ErrorIs(t, err, ErrTooMany)

	// Re-starring something already stored adds nothing, so it must still work
	// at the cap — otherwise the list would lock up entirely.
	entries, err := s.Add(Entry{Path: "doc-000.md", IsDir: true})
	require.NoError(t, err)
	require.Len(t, entries, MaxEntries)
}

// A reader must never observe a half-written file, and a completed write must
// leave nothing behind.
func TestSaveLeavesNoTempFiles(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Add(Entry{Path: "a.md"})
	require.NoError(t, err)

	names, err := filepath.Glob(filepath.Join(filepath.Dir(s.path), "*.tmp"))
	require.NoError(t, err)
	require.Empty(t, names)
}

// The lock is released on the happy path; if it were not, the next mutation
// would block for lockWait and then fail.
func TestLockIsReleasedBetweenMutations(t *testing.T) {
	s := newTestStore(t)
	for i := range 3 {
		_, err := s.Add(Entry{Path: fmt.Sprintf("%d.md", i)})
		require.NoError(t, err)
	}
	_, _, err := s.Remove("", "0.md")
	require.NoError(t, err)
	require.NoFileExists(t, s.path+".lock")
}

func TestFileNameIsStableAndPerRoot(t *testing.T) {
	a := FileName("/home/me/project")
	require.Equal(t, a, FileName("/home/me/project"), "the same root must always hash the same")
	require.NotEqual(t, a, FileName("/home/me/other"))

	require.Regexp(t, regexp.MustCompile(`^starred[/\\][A-Za-z0-9._-]+-[0-9a-f]{16}\.json$`), a)
	// The readable half is the point of the name.
	require.Contains(t, a, "project-")
}

// The slug has to come from the NORMALIZED root, not the raw one. On darwin
// ~/Docs and ~/docs are one directory, so two spellings must not produce two
// files — and a version that slugged the raw string produces exactly that, with
// the same hash on both, while every other test still passes.
func TestFileNameSlugFollowsRootNormalisation(t *testing.T) {
	for _, goos := range []string{"darwin", "windows"} {
		t.Run(goos, func(t *testing.T) {
			require.Equal(t,
				fileName(goos, "/home/me/Docs"),
				fileName(goos, "/home/me/docs"),
				"one directory must not get two bookmark files")
		})
	}

	// Linux folds nothing, so there the two are genuinely different projects and
	// must keep different files.
	require.NotEqual(t, fileName("linux", "/home/me/Docs"), fileName("linux", "/home/me/docs"))

	// And the exported entry point agrees with the seam for this host.
	require.Equal(t, fileName(runtime.GOOS, "/home/me/Docs"), FileName("/home/me/Docs"))
}

// A root's last segment is arbitrary text: it can hold spaces, separators,
// non-ASCII, or be absent entirely. The name it produces must still be a legal,
// bounded filename on every platform.
func TestRootSlugIsAlwaysAUsableFilename(t *testing.T) {
	name := regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	cases := []string{
		"/home/me/my docs",
		"/home/me/Ünïcode-Dir",
		"/home/me/a:b*c?d",
		"/",
		"/home/me/...",
		"/home/me/" + strings.Repeat("x", 300),
		"/home/me/nul",
		"relative",
	}
	seen := map[string]bool{}
	for _, root := range cases {
		got := FileName(root)
		base := filepath.Base(got)
		require.False(t, seen[base], "two roots produced one filename: %q", base)
		seen[base] = true

		slug := strings.TrimSuffix(base, ".json")
		slug = slug[:strings.LastIndex(slug, "-")]
		require.Regexp(t, name, slug, "root %q produced an unusable slug", root)
		require.LessOrEqual(t, len(slug), slugMax, "root %q produced an unbounded slug", root)
		require.True(t, utf8.ValidString(slug), "root %q produced invalid UTF-8", root)
		// The hash is never dropped: it is the collision defence, and it is what
		// keeps a reserved device name like "nul" resolving to a file.
		require.Regexp(t, regexp.MustCompile(`-[0-9a-f]{16}\.json$`), base)
	}
}

// "/" has no segment to name, but it is still a root somebody can serve.
func TestRootSlugFallsBackWhenNothingSurvives(t *testing.T) {
	require.Contains(t, FileName("/"), "root-")
	require.NotEqual(t, FileName("/"), FileName("/home/me/..."))
}

func TestRootKey(t *testing.T) {
	t.Run("serve mode keys on the resolved target", func(t *testing.T) {
		cfg := config.Defaults()
		cfg.TargetRepo = "/srv/docs"
		got, err := RootKey(cfg)
		require.NoError(t, err)
		require.Equal(t, "/srv/docs", got)
	})

	// A daemon under systemctl runs in "/", so its working directory is not a
	// usable key — every daemon on the box would share one file.
	t.Run("daemon mode keys on the config file", func(t *testing.T) {
		cfg := config.Defaults()
		cfg.MultiRepo = true
		cfg.TargetRepo = "/"
		cfg.ConfigPath = "/home/me/.config/vantage/config.toml"
		got, err := RootKey(cfg)
		require.NoError(t, err)
		require.Equal(t, "/home/me/.config/vantage/config.toml", got)
	})

	t.Run("a daemon without a config file falls back to the target", func(t *testing.T) {
		cfg := config.Defaults()
		cfg.MultiRepo = true
		cfg.TargetRepo = "/srv"
		got, err := RootKey(cfg)
		require.NoError(t, err)
		require.Equal(t, "/srv", got)
	})

	t.Run("nil config", func(t *testing.T) {
		_, err := RootKey(nil)
		require.Error(t, err)
	})
}

// DefaultStore must land in the DATA dir, beside the review store — a bookmark
// is content the user made, not a setting they wrote.
//
// The expected path is derived from os.UserHomeDir rather than from the HOME
// this sets, because those are the same variable only on unix — on windows
// UserHomeDir reads USERPROFILE and the assertion would be testing the wrong
// thing.
//
// Both XDG variables are cleared, and XDG_DATA_HOME is the load-bearing one:
// the data path is deliberately literal, so a developer or CI machine that
// exports it must not move the store. Set to a junk value rather than emptied,
// since an empty variable is not the same as one pointing somewhere real.
func TestDefaultStoreUsesTheUserDataDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir) // what os.UserHomeDir reads on windows
	t.Setenv("XDG_CONFIG_HOME", "/somewhere/else")
	t.Setenv("XDG_DATA_HOME", "/somewhere/else")

	home, err := os.UserHomeDir()
	require.NoError(t, err)

	s, err := DefaultStore("/srv/docs")
	require.NoError(t, err)
	require.Equal(t,
		filepath.Join(home, ".local", "share", "vantage", FileName("/srv/docs")),
		s.Path())
	// The trap this replaces: it used to be ~/.config/vantage/…, which is where
	// settings live and where dotfile managers sync.
	require.NotContains(t, s.Path(), filepath.Join(".config", "vantage"))
}

// The bookmark store and the review store must stay in one place, since they are
// the same species of state. A future change that moved one should have to
// notice it is separating them.
func TestBookmarksLiveBesideTheReviews(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)

	s, err := DefaultStore("/srv/docs")
	require.NoError(t, err)
	reviews, err := config.ReviewDir()
	require.NoError(t, err)

	require.Equal(t, filepath.Dir(reviews), filepath.Dir(filepath.Dir(s.Path())))
}

// On a case-insensitive filesystem the same directory reaches us as several
// different strings, and each one must find the same bookmarks.
func TestRootCaseFoldingFollowsThePlatform(t *testing.T) {
	cases := []struct {
		goos       string
		a, b       string
		sameFolder bool
	}{
		{"darwin", "/Users/me/Docs", "/Users/me/docs", true},
		{"windows", `C:\Users\me\Docs`, `c:\users\me\docs`, true},
		// ext4 and friends are case-sensitive: these are two real directories,
		// and folding them together would merge two projects' bookmarks.
		{"linux", "/home/me/Docs", "/home/me/docs", false},
	}

	for _, c := range cases {
		t.Run(c.goos, func(t *testing.T) {
			same := normalizeRoot(c.goos, c.a) == normalizeRoot(c.goos, c.b)
			require.Equal(t, c.sameFolder, same)
		})
	}
}

// The same path typed with different case must reach one list, not two — on
// this host, whichever it is.
func TestStoreIdentityIsStableAcrossCaseOnThisPlatform(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "Project")
	lower := filepath.Join(dir, "project")

	// Whether these are the same directory is the filesystem's call, and
	// FileName has to agree with it.
	sameDir := normalizeRoot(runtime.GOOS, root) == normalizeRoot(runtime.GOOS, lower)
	require.Equal(t, sameDir, FileName(root) == FileName(lower))

	if !sameDir {
		return
	}

	// And a Store built from either spelling reads the other's entries rather
	// than rejecting them as a foreign root.
	path := filepath.Join(dir, FileName(root))
	a := NewStore(root, path)
	_, err := a.Add(Entry{Path: "a.md"})
	require.NoError(t, err)

	got, err := NewStore(lower, path).List()
	require.NoError(t, err)
	require.Len(t, got, 1)
}

// The mutex has to hold under -race: every Add is a read-modify-write of one
// file, so an unsynchronized one silently drops bookmarks.
func TestConcurrentAddsWithinOneProcess(t *testing.T) {
	s := newTestStore(t)

	var wg sync.WaitGroup
	for i := range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Add(Entry{Path: fmt.Sprintf("doc-%02d.md", i)})
			require.NoError(t, err)
		}()
	}
	wg.Wait()

	got, err := s.List()
	require.NoError(t, err)
	require.Len(t, got, 50)
}

// The retry exists for Windows sharing violations; what matters everywhere is
// that it still reports a failure that never clears, and promptly.
func TestRenameWithRetryGivesUp(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "does-not-exist")
	dst := filepath.Join(dir, "dst")

	start := time.Now()
	err := renameWithRetry(missing, dst)

	require.Error(t, err)
	require.Less(t, time.Since(start), time.Second, "the retry window must stay short")
}

func TestRenameWithRetryReplacesAnExistingFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	dst := filepath.Join(dir, "dst")
	require.NoError(t, os.WriteFile(src, []byte("new"), 0o644))
	require.NoError(t, os.WriteFile(dst, []byte("old"), 0o644))

	require.NoError(t, renameWithRetry(src, dst))

	got, err := os.ReadFile(dst)
	require.NoError(t, err)
	require.Equal(t, "new", string(got))
	require.NoFileExists(t, src)
}

// Overwriting an existing store is the common path — every toggle after the
// first one does it — so it gets its own case rather than being implied.
func TestSaveOverwritesAnExistingStore(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Add(Entry{Path: "a.md"})
	require.NoError(t, err)
	_, err = s.Add(Entry{Path: "b.md"})
	require.NoError(t, err)

	got, err := NewStore(s.root, s.path).List()
	require.NoError(t, err)
	require.Len(t, got, 2)
}
