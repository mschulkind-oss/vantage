package config

import (
	"errors"
	"io"
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
			// The indent is the first item line's whitespace, not everything
			// before the first thing after "[" — which here is a comment.
			name:   "multi-line array with a comment after its bracket",
			before: "source_dirs = [ # my clones\n  \"~/code\",\n]\nport = 8123 # keep\n",
			after:  "source_dirs = [ # my clones\n  \"~/code\",\n  \"~/work\",\n]\nport = 8123 # keep\n",
		},
		{
			name:   "multi-line array whose first item shares its bracket's line",
			before: "source_dirs = [\"~/code\",\n    \"~/projects\",\n]\nport = 8123 # keep\n",
			after:  "source_dirs = [\"~/code\",\n    \"~/projects\",\n    \"~/work\",\n]\nport = 8123 # keep\n",
		},
		{
			name:   "multi-line array with every item on its bracket's line",
			before: "source_dirs = [\"~/code\",\n]\n",
			after:  "source_dirs = [\"~/code\",\n  \"~/work\",\n]\n",
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

// The round trip is the one check between a bad text edit and a corrupt
// config: when the edited text does not decode to the same settings plus the
// new entries, the edit is not written, the original is backed up, and the
// file is rewritten from its decoded values instead.
func TestAddSourceDirsBacksUpWhenTheEditFailsItsRoundTrip(t *testing.T) {
	home, cfgPath := sourceDirsFixture(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	original := "# mine\nport = 8123\nsource_dirs = [\"~/code\"]\n"
	require.NoError(t, os.WriteFile(cfgPath, []byte(original), 0o644))
	for _, bad := range []string{
		"# mine\nport = 8123\nsource_dirs = [\"~/code\",\nsource_dirs = [ \"~/work\",\n]\n", // does not parse
		"# mine\nport = 9999\nsource_dirs = [\"~/code\", \"~/work\"]\n",                     // changes another key
		"# mine\nport = 8123\nsource_dirs = [\"~/code\"]\n",                                 // loses the entry
	} {
		editText := editSourceDirsText
		editSourceDirsText = func([]byte, []string) ([]byte, error) { return []byte(bad), nil }
		edit, err := AddSourceDirs(cfgPath, []string{"~/work"}, editTime)
		editSourceDirsText = editText
		require.NoError(t, err, bad)
		require.Equal(t, cfgPath+".bak-20260929-123456", edit.Backup, bad)
		require.Equal(t, original, readString(t, edit.Backup), bad)
		cfg, err := LoadDaemonFile(cfgPath)
		require.NoError(t, err, bad)
		require.Equal(t, 8123, cfg.Port, bad)
		require.Equal(t, []string{filepath.Join(home, "code"), filepath.Join(home, "work")}, cfg.SourceDirs, bad)
		require.NoError(t, os.WriteFile(cfgPath, []byte(original), 0o644))
		require.NoError(t, os.Remove(edit.Backup))
	}
}

// install-service checks that the edited config would start the daemon, and it
// checks the candidate before it replaces anything: a refused edit leaves the
// file exactly as it was, or absent when there was none, so a mistaken run
// leaves no entry behind for the next one to keep without a word.
func TestAddSourceDirsWritesNothingItsCheckRefuses(t *testing.T) {
	_, cfgPath := sourceDirsFixture(t)
	refuse := errors.New("would not start the daemon")
	var checked []string
	check := func(candidate string) error {
		checked = append(checked, decodedSourceDirs(t, candidate)...)
		return refuse
	}

	_, err := AddSourceDirsChecked(cfgPath, []string{"~/code"}, editTime, check)
	require.ErrorIs(t, err, refuse)
	require.Equal(t, []string{"~/code"}, checked, "the check reads the candidate")
	require.NoFileExists(t, cfgPath, "no config is left behind")

	original := "# mine\n\"source_dirs\" = [\"~/work\"]\n"
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	require.NoError(t, os.WriteFile(cfgPath, []byte(original), 0o644))
	_, err = AddSourceDirsChecked(cfgPath, []string{"~/code"}, editTime, check)
	require.ErrorIs(t, err, refuse)
	require.Equal(t, original, readString(t, cfgPath))
	entries, err := os.ReadDir(filepath.Dir(cfgPath))
	require.NoError(t, err)
	require.Len(t, entries, 1, "no backup, and no temp file, for an edit never made")

	edit, err := AddSourceDirsChecked(cfgPath, []string{"~/code"}, editTime, func(string) error { return nil })
	require.NoError(t, err)
	require.NotEmpty(t, edit.Backup, "an accepted rewrite is backed up as before")
	require.Equal(t, []string{"~/work", "~/code"}, decodedSourceDirs(t, cfgPath))
}

// A directory's name can hold any byte but "/" and NUL. Go's quoting writes
// \a and \v, which TOML does not have, so a created config with such a name
// did not parse; an existing one fell back to a rewrite for nothing. Each is
// now spelled the way TOML spells it, in the created file and in the edited
// one alike.
func TestAddSourceDirsWritesControlCharactersAsTOML(t *testing.T) {
	home, cfgPath := sourceDirsFixture(t)
	var names []string
	for _, name := range []string{"vt\vhere", "bell\ahere", "tab\there", "del\x7fhere", `quote"back\slash`} {
		require.NoError(t, os.MkdirAll(filepath.Join(home, name), 0o755))
		names = append(names, filepath.Join(home, name))
	}

	edit, err := AddSourceDirs(cfgPath, names[:2], editTime)
	require.NoError(t, err)
	require.True(t, edit.Created)
	cfg, err := LoadDaemonFile(cfgPath)
	require.NoError(t, err, readString(t, cfgPath))
	require.Equal(t, names[:2], cfg.SourceDirs)

	for _, layout := range []string{"source_dirs = [\"~/code\"]\n", "source_dirs = [\n  \"~/code\",\n]\n", "# none yet\n"} {
		require.NoError(t, os.WriteFile(cfgPath, []byte(layout), 0o644))
		edit, err = AddSourceDirs(cfgPath, names, editTime)
		require.NoError(t, err)
		require.Empty(t, edit.Backup, "edited in place: %q", layout)
		cfg, err = LoadDaemonFile(cfgPath)
		require.NoError(t, err, readString(t, cfgPath))
		require.Subset(t, cfg.SourceDirs, names, layout)
	}
}

// A name that is not UTF-8 has no TOML spelling at all: TOML's \xHH is a code
// point, not a byte, so writing one would name another directory.
func TestAddSourceDirsRefusesANameTOMLCannotHold(t *testing.T) {
	home, cfgPath := sourceDirsFixture(t)
	bad := filepath.Join(home, "bad\xffbyte")
	require.NoError(t, os.MkdirAll(bad, 0o755))
	_, err := AddSourceDirs(cfgPath, []string{bad}, editTime)
	require.ErrorContains(t, err, "not valid UTF-8")
	require.NoFileExists(t, cfgPath)
}

// A rewrite from decoded values is only as faithful as the encoder, and
// BurntSushi's moves a local time through the time zone. So the rewrite is
// proved the way an in-place edit is, and one that would change another
// setting is refused, leaving the file as it was, rather than written.
func TestAddSourceDirsRefusesARewriteThatChangesAnotherSetting(t *testing.T) {
	_, cfgPath := sourceDirsFixture(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	original := "\"source_dirs\" = [\"~/code\"]\nport = 8123\n"
	require.NoError(t, os.WriteFile(cfgPath, []byte(original), 0o644))

	encode := encodeSettings
	encodeSettings = func(w io.Writer, v map[string]any) error {
		unfaithful := map[string]any{}
		for k, val := range v {
			unfaithful[k] = val
		}
		unfaithful["port"] = int64(9999)
		return encode(w, unfaithful)
	}
	defer func() { encodeSettings = encode }()
	_, err := AddSourceDirs(cfgPath, []string{"~/work"}, editTime)
	require.ErrorContains(t, err, "add source_dirs to it by hand")
	require.Equal(t, original, readString(t, cfgPath))
	backups, _ := filepath.Glob(cfgPath + ".bak-*")
	require.Empty(t, backups)
}

// NaN is not equal to itself, so a config holding one failed every round trip
// and every edit of it fell back to a rewrite. Settings compare NaN as NaN.
func TestAddSourceDirsComparesNaNAsItself(t *testing.T) {
	_, cfgPath := sourceDirsFixture(t)
	require.NoError(t, os.MkdirAll(filepath.Dir(cfgPath), 0o755))
	require.NoError(t, os.WriteFile(cfgPath, []byte("x = nan\nsource_dirs = [\"~/code\"]\n"), 0o644))
	edit, err := AddSourceDirs(cfgPath, []string{"~/work"}, editTime)
	require.NoError(t, err)
	require.Empty(t, edit.Backup, "edited in place")
	require.Equal(t, "x = nan\nsource_dirs = [\"~/code\", \"~/work\"]\n", readString(t, cfgPath))

	require.NoError(t, os.WriteFile(cfgPath, []byte("x = nan\n\"source_dirs\" = [\"~/code\"]\n"), 0o644))
	edit, err = AddSourceDirs(cfgPath, []string{"~/work"}, editTime)
	require.NoError(t, err, "a rewrite keeps the NaN, and is not refused for it")
	require.NotEmpty(t, edit.Backup)
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
