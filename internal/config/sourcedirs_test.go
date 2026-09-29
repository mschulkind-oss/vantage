package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/stretchr/testify/require"
)

var editTime = time.Date(2026, 9, 29, 12, 34, 56, 0, time.UTC)

// sourceDirsFixture isolates HOME and makes two real directories under it.
func sourceDirsFixture(t *testing.T) (home, cfgPath string) {
	t.Helper()
	home = t.TempDir()
	if resolved, err := filepath.EvalSymlinks(home); err == nil {
		home = resolved
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	for _, d := range []string{"code", "work", "projects"} {
		require.NoError(t, os.MkdirAll(filepath.Join(home, d), 0o755))
	}
	return home, filepath.Join(home, ".config", "vantage", "config.toml")
}

func readString(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	require.NoError(t, err)
	return string(b)
}

func decodedSourceDirs(t *testing.T, p string) []string {
	t.Helper()
	var f struct {
		SourceDirs []string `toml:"source_dirs"`
	}
	_, err := toml.DecodeFile(p, &f)
	require.NoError(t, err)
	return f.SourceDirs
}

func TestAddSourceDirsCreatesAMissingConfig(t *testing.T) {
	home, cfgPath := sourceDirsFixture(t)
	edit, err := AddSourceDirs(cfgPath, []string{"~/code", filepath.Join(home, "work")}, editTime)
	require.NoError(t, err)
	require.True(t, edit.Created)
	require.Equal(t, []string{"~/code", "~/work"}, edit.Added)
	require.Empty(t, edit.Backup)
	require.Equal(t, []string{"~/code", "~/work"}, decodedSourceDirs(t, cfgPath))

	cfg, err := LoadDaemonFile(cfgPath)
	require.NoError(t, err)
	require.Equal(t, []string{filepath.Join(home, "code"), filepath.Join(home, "work")}, cfg.SourceDirs)
	// The port is written down: a daemon whose port is only the default moves
	// to the next free one when it is busy, and a service that moves is one
	// neither `serve`'s tip nor install-service finds again.
	require.True(t, cfg.PortExplicit)
	require.Equal(t, Defaults().Port, cfg.Port)
}

func TestAddSourceDirsResolvesRelativePathsAndRejectsMissingOnes(t *testing.T) {
	home, cfgPath := sourceDirsFixture(t)
	t.Chdir(home)
	edit, err := AddSourceDirs(cfgPath, []string{"code"}, editTime)
	require.NoError(t, err)
	require.Equal(t, []string{"~/code"}, edit.Added)

	_, err = AddSourceDirs(cfgPath, []string{"~/nope"}, editTime)
	require.ErrorContains(t, err, "not a directory")
	require.Equal(t, []string{"~/code"}, decodedSourceDirs(t, cfgPath), "a failed edit writes nothing")
}

func TestAddSourceDirsAppendsInPlaceKeepingEverythingElse(t *testing.T) {
	cases := []struct {
		name, before, after string
	}{
		{
			name:   "one-line array",
			before: "# my config\nport = 8123 # keep me\nsource_dirs = [\"~/code\"] # scanned\n\n[[repos]]\nname = \"n\"\npath = \"/n\"\n",
			after:  "# my config\nport = 8123 # keep me\nsource_dirs = [\"~/code\", \"~/work\"] # scanned\n\n[[repos]]\nname = \"n\"\npath = \"/n\"\n",
		},
		{
			name:   "empty array",
			before: "source_dirs = []\n",
			after:  "source_dirs = [\"~/work\"]\n",
		},
		{
			name:   "one-line array with a trailing comma",
			before: "source_dirs = ['~/code',]\n",
			after:  "source_dirs = ['~/code', \"~/work\"]\n",
		},
		{
			name:   "multi-line array with comments",
			before: "source_dirs = [\n    \"~/code\", # clones\n    # \"~/old\",\n    '~/projects' # others\n]\nhost = \"127.0.0.1\"\n",
			after:  "source_dirs = [\n    \"~/code\", # clones\n    # \"~/old\",\n    '~/projects', # others\n    \"~/work\",\n]\nhost = \"127.0.0.1\"\n",
		},
		{
			name:   "no key: inserted above the first table and its comments",
			before: "# Server settings\nport = 8000\n\n# Repositories to serve\n# (one per block)\n[[repos]]\nname = \"n\"\npath = \"/n\"\n",
			after:  "# Server settings\nport = 8000\n\nsource_dirs = [\"~/work\"]\n\n# Repositories to serve\n# (one per block)\n[[repos]]\nname = \"n\"\npath = \"/n\"\n",
		},
		{
			name:   "no key and no tables",
			before: "port = 8000",
			after:  "port = 8000\n\nsource_dirs = [\"~/work\"]\n",
		},
		{
			name:   "a key of the same name inside a table is another key",
			before: "port = 1\n[other]\nsource_dirs = [\"x\"]\n",
			after:  "port = 1\nsource_dirs = [\"~/work\"]\n\n[other]\nsource_dirs = [\"x\"]\n",
		},
		{
			name:   "brackets and hashes inside strings are not syntax",
			before: "theme = \"a # [b]\"\nsource_dirs = [\"~/code\"]\nnote = '''\n[not a table]\n'''\n",
			after:  "theme = \"a # [b]\"\nsource_dirs = [\"~/code\", \"~/work\"]\nnote = '''\n[not a table]\n'''\n",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, cfgPath := sourceDirsFixture(t)
			require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
			require.NoError(t, os.WriteFile(cfgPath, []byte(tc.before), 0o600))

			edit, err := AddSourceDirs(cfgPath, []string{"~/work"}, editTime)
			require.NoError(t, err)
			require.Equal(t, []string{"~/work"}, edit.Added)
			require.Empty(t, edit.Backup, "an in-place edit needs no backup")
			require.Equal(t, tc.after, readString(t, cfgPath))

			info, err := os.Stat(cfgPath)
			require.NoError(t, err)
			require.Equal(t, os.FileMode(0o600), info.Mode().Perm(), "the file keeps its permissions")
		})
	}
}

func TestAddSourceDirsSkipsWhatIsAlreadyThere(t *testing.T) {
	home, cfgPath := sourceDirsFixture(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	body := "source_dirs = [\"" + filepath.Join(home, "code") + "\", \"~/work/\"]\n"
	require.NoError(t, os.WriteFile(cfgPath, []byte(body), 0o644))

	edit, err := AddSourceDirs(cfgPath, []string{"~/code", "~/work", "~/code"}, editTime)
	require.NoError(t, err)
	require.False(t, edit.Changed())
	require.Equal(t, []string{filepath.Join(home, "code"), "~/work/"}, edit.Present)
	require.Equal(t, body, readString(t, cfgPath), "nothing to add, nothing written")

	edit, err = AddSourceDirs(cfgPath, []string{"~/projects", "~/projects"}, editTime)
	require.NoError(t, err)
	require.Equal(t, []string{"~/projects"}, edit.Added, "a directory named twice is added once")
}

// A key the edit cannot rewrite in place still gets its entry — after the
// original, comments and all, is kept beside it.
func TestAddSourceDirsBacksUpBeforeARewrite(t *testing.T) {
	home, cfgPath := sourceDirsFixture(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	original := "# hand-written\n\"source_dirs\" = [\"~/code\"]\nport = 8123\n\n[[repos]]\nname = \"n\"\npath = \"/n\"\n"
	require.NoError(t, os.WriteFile(cfgPath, []byte(original), 0o644))

	edit, err := AddSourceDirs(cfgPath, []string{"~/work"}, editTime)
	require.NoError(t, err)
	require.Equal(t, cfgPath+".bak-20260929-123456", edit.Backup)
	require.Equal(t, original, readString(t, edit.Backup))
	require.Contains(t, readString(t, cfgPath), "config.toml.bak-20260929-123456")

	cfg, err := LoadDaemonFile(cfgPath)
	require.NoError(t, err)
	require.Equal(t, []string{filepath.Join(home, "code"), filepath.Join(home, "work")}, cfg.SourceDirs)
	require.Equal(t, 8123, cfg.Port)
	require.Len(t, cfg.Repos, 1)
	require.Equal(t, "n", cfg.Repos[0].Name)
}

// A config kept in a dotfiles repository is a link to it. The edit goes to the
// file behind the link, and the link stays one: replacing the link with a file
// would leave the dotfile without the entry and, since the daemon keys its
// bookmarks on the resolved path, hand it a new, empty bookmark list.
func TestAddSourceDirsEditsTheFileBehindALink(t *testing.T) {
	home, cfgPath := sourceDirsFixture(t)
	dotfiles := filepath.Join(home, "dotfiles")
	require.NoError(t, os.MkdirAll(dotfiles, 0o755))
	real := filepath.Join(dotfiles, "vantage.toml")
	require.NoError(t, os.WriteFile(real, []byte("# dotfile\nport = 8123\n"), 0o644))
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	require.NoError(t, os.Symlink(real, cfgPath))
	before, err := LoadDaemonFile(cfgPath)
	require.NoError(t, err)

	edit, err := AddSourceDirs(cfgPath, []string{"~/code"}, editTime)
	require.NoError(t, err)
	require.Equal(t, cfgPath, edit.Path)
	require.Equal(t, real, edit.Target)
	info, err := os.Lstat(cfgPath)
	require.NoError(t, err)
	require.NotZero(t, info.Mode()&os.ModeSymlink, "the link is still a link")
	require.Equal(t, "# dotfile\nport = 8123\n\nsource_dirs = [\"~/code\"]\n", readString(t, real))
	after, err := LoadDaemonFile(cfgPath)
	require.NoError(t, err)
	require.Equal(t, before.ConfigPath, after.ConfigPath, "the daemon's identity, and its bookmarks, stay put")
	entries, err := os.ReadDir(filepath.Dir(cfgPath))
	require.NoError(t, err)
	require.Len(t, entries, 1, "no temp file left beside the link")

	// A rewrite's backup goes beside the file it copies.
	require.NoError(t, os.WriteFile(real, []byte("\"source_dirs\" = [\"~/code\"]\n"), 0o644))
	edit, err = AddSourceDirs(cfgPath, []string{"~/work"}, editTime)
	require.NoError(t, err)
	require.Equal(t, real+".bak-20260929-123456", edit.Backup)
	info, err = os.Lstat(cfgPath)
	require.NoError(t, err)
	require.NotZero(t, info.Mode()&os.ModeSymlink)

	// A link whose target does not exist yet has it created.
	require.NoError(t, os.Remove(cfgPath))
	pending := filepath.Join(dotfiles, "new.toml")
	require.NoError(t, os.Symlink(pending, cfgPath))
	edit, err = AddSourceDirs(cfgPath, []string{"~/code"}, editTime)
	require.NoError(t, err)
	require.True(t, edit.Created)
	require.Equal(t, pending, edit.Target)
	require.Equal(t, []string{"~/code"}, decodedSourceDirs(t, pending))
	info, err = os.Lstat(cfgPath)
	require.NoError(t, err)
	require.NotZero(t, info.Mode()&os.ModeSymlink)
}

// A config the user cannot write — made read-only, or a link into a
// read-only store such as /nix/store — is refused, naming the file, rather
// than replaced: rename(2) asks only the directory, so replacing it would
// have worked, and undone what they did on purpose.
func TestAddSourceDirsRefusesAFileItCannotWrite(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root writes any file, so there is no unwritable config to refuse")
	}
	home, cfgPath := sourceDirsFixture(t)
	store := filepath.Join(home, "store")
	require.NoError(t, os.MkdirAll(store, 0o755))
	real := filepath.Join(store, "vantage.toml")
	require.NoError(t, os.WriteFile(real, []byte("port = 8123\n"), 0o444))
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	require.NoError(t, os.Symlink(real, cfgPath))

	_, err := AddSourceDirs(cfgPath, []string{"~/code"}, editTime)
	require.ErrorContains(t, err, real)
	require.ErrorContains(t, err, "add source_dirs there by hand")
	require.Equal(t, "port = 8123\n", readString(t, real))
	info, err := os.Lstat(cfgPath)
	require.NoError(t, err)
	require.NotZero(t, info.Mode()&os.ModeSymlink)
}

func TestAddSourceDirsRefusesAMalformedConfig(t *testing.T) {
	_, cfgPath := sourceDirsFixture(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	for _, body := range []string{"source_dirs = \"~/code\"\n", "port = = 1\n"} {
		require.NoError(t, os.WriteFile(cfgPath, []byte(body), 0o644))
		_, err := AddSourceDirs(cfgPath, []string{"~/work"}, editTime)
		require.Error(t, err, body)
		require.Equal(t, body, readString(t, cfgPath))
		matches, _ := filepath.Glob(cfgPath + ".bak-*")
		require.Empty(t, matches)
	}
}

func TestAppendSourceDirsTextRefusesAnUneditableArray(t *testing.T) {
	_, err := appendSourceDirsText([]byte("source_dirs = [\n  \"~/a\",\n  \"~/b\"]\n"), []string{"~/c"})
	require.ErrorIs(t, err, errNoInPlaceEdit)
}

// The file `vantage init-config` writes is the config most people have: every
// comment in it survives, and the commented-out example is left alone.
func TestAddSourceDirsEditsTheInitConfigTemplateInPlace(t *testing.T) {
	_, cfgPath := sourceDirsFixture(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	require.NoError(t, os.WriteFile(cfgPath, []byte(ExampleConfig), 0o644))

	edit, err := AddSourceDirs(cfgPath, []string{"~/code"}, editTime)
	require.NoError(t, err)
	require.Empty(t, edit.Backup)
	after := readString(t, cfgPath)
	require.Equal(t, []string{"~/code"}, decodedSourceDirs(t, cfgPath))
	require.Contains(t, after, "# source_dirs = [\"~/code\", \"~/projects\"]")
	require.Contains(t, after, "\n\nsource_dirs = [\"~/code\"]\n\n[[repos]]\nname = \"example\"\n")
	require.Equal(t, len(ExampleConfig)+len("source_dirs = [\"~/code\"]\n\n"), len(after), "nothing else changed")
}
