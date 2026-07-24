package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDefaults(t *testing.T) {
	c := Defaults()
	require.False(t, c.MultiRepo)
	require.Equal(t, ".", c.TargetRepo)
	require.Equal(t, []string{"127.0.0.1"}, c.Host)
	require.Equal(t, 8000, c.Port)
	require.Equal(t, DefaultExcludeDirs, c.ExcludeDirs)
	require.False(t, c.ExcludeDirsSet)
	require.True(t, c.ShowHidden)
	require.Nil(t, c.WalkMaxDepth)
	require.Equal(t, 30*time.Second, c.WalkTimeout)
	require.True(t, c.UseIgnoreFiles)
	require.Equal(t, "INFO", c.LogLevel)

	// Mutating the returned slice must not corrupt the package default.
	c.ExcludeDirs[0] = "MUTATED"
	require.Equal(t, ".git", DefaultExcludeDirs[0])
}

func TestApplyEnvResolvesConfig(t *testing.T) {
	repo := t.TempDir()
	t.Setenv("TARGET_REPO", repo)
	t.Setenv("HOST", "127.0.0.1, 0.0.0.0 ,localhost")
	t.Setenv("ALLOWED_ORIGINS", "nichis-mac-studio, example.test ")
	t.Setenv("PORT", "9100")
	t.Setenv("SHOW_HIDDEN", "false")
	t.Setenv("WALK_MAX_DEPTH", "7")
	t.Setenv("WALK_TIMEOUT", "12.5")
	t.Setenv("USE_IGNORE_FILES", "false")
	t.Setenv("VANTAGE_LOG_LEVEL", "DEBUG")

	c := Defaults()
	require.NoError(t, c.ApplyEnv())
	require.NoError(t, c.Resolve())

	wantRepo, err := filepath.EvalSymlinks(repo)
	require.NoError(t, err)
	require.Equal(t, wantRepo, c.TargetRepo)
	require.Equal(t, []string{"127.0.0.1", "0.0.0.0", "localhost"}, c.Host)
	require.Equal(t, []string{"nichis-mac-studio", "example.test"}, c.AllowedOrigins)
	require.Equal(t, 9100, c.Port)
	require.False(t, c.ShowHidden)
	require.NotNil(t, c.WalkMaxDepth)
	require.Equal(t, 7, *c.WalkMaxDepth)
	require.Equal(t, 12500*time.Millisecond, c.WalkTimeout)
	require.False(t, c.UseIgnoreFiles)
	require.Equal(t, "DEBUG", c.LogLevel)
}

func TestApplyEnvLeavesDefaultsWhenUnset(t *testing.T) {
	// No env vars set: defaults survive untouched.
	c := Defaults()
	require.NoError(t, c.ApplyEnv())
	require.Equal(t, []string{"127.0.0.1"}, c.Host)
	require.Equal(t, 8000, c.Port)
	require.True(t, c.ShowHidden)
	require.False(t, c.ExcludeDirsSet)
	require.Equal(t, DefaultExcludeDirs, c.ExcludeDirs)
}

func TestApplyEnvBadNumbers(t *testing.T) {
	t.Run("port", func(t *testing.T) {
		t.Setenv("PORT", "not-a-number")
		require.Error(t, Defaults().ApplyEnv())
	})
	t.Run("walk_timeout", func(t *testing.T) {
		t.Setenv("WALK_TIMEOUT", "soon")
		require.Error(t, Defaults().ApplyEnv())
	})
}

func TestExcludeDirsAbsentKeepsDefaults(t *testing.T) {
	c := Defaults()
	require.NoError(t, c.ApplyEnv()) // EXCLUDE_DIRS unset
	require.False(t, c.ExcludeDirsSet)
	require.Equal(t, DefaultExcludeDirs, c.ExcludeDirs)
}

func TestExcludeDirsPresentReplaces(t *testing.T) {
	t.Run("non-empty", func(t *testing.T) {
		t.Setenv("EXCLUDE_DIRS", "node_modules, vendor ,.cache")
		c := Defaults()
		require.NoError(t, c.ApplyEnv())
		require.True(t, c.ExcludeDirsSet)
		require.Equal(t, []string{"node_modules", "vendor", ".cache"}, c.ExcludeDirs)
	})
	t.Run("empty-replaces-with-nothing", func(t *testing.T) {
		t.Setenv("EXCLUDE_DIRS", "")
		c := Defaults()
		require.NoError(t, c.ApplyEnv())
		require.True(t, c.ExcludeDirsSet)
		// Present-but-empty means "exclude nothing", not "use defaults".
		require.Equal(t, []string{}, c.ExcludeDirs)
	})
}

// writeTOML writes a daemon config file into a temp dir and returns its path.
func writeTOML(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.toml")
	require.NoError(t, os.WriteFile(path, []byte(body), 0o644))
	return path
}

func TestLoadDaemonFileResolvesConfig(t *testing.T) {
	repoA := t.TempDir()
	repoB := t.TempDir()
	readRoot := t.TempDir()

	body := `
host = ["127.0.0.1", "0.0.0.0"]
allowed_origins = ["nichis-mac-studio", "example.test"]
port = 8080
show_hidden = false
walk_max_depth = 5
walk_timeout = 45.0
use_ignore_files = false
log_level = "WARNING"

[[repos]]
name = "a"
path = "` + repoA + `"
allowed_read_roots = ["` + readRoot + `"]

[[repos]]
name = "b"
path = "` + repoB + `"
`
	c, err := LoadDaemonFile(writeTOML(t, body))
	require.NoError(t, err)

	require.True(t, c.MultiRepo)
	require.Equal(t, []string{"127.0.0.1", "0.0.0.0"}, c.Host)
	require.Equal(t, []string{"nichis-mac-studio", "example.test"}, c.AllowedOrigins)
	require.Equal(t, 8080, c.Port)
	require.False(t, c.ShowHidden)
	require.NotNil(t, c.WalkMaxDepth)
	require.Equal(t, 5, *c.WalkMaxDepth)
	require.Equal(t, 45*time.Second, c.WalkTimeout)
	require.False(t, c.UseIgnoreFiles)
	require.Equal(t, "WARNING", c.LogLevel)

	require.Len(t, c.Repos, 2)
	require.Equal(t, "a", c.Repos[0].Name)
	wantA, _ := filepath.EvalSymlinks(repoA)
	require.Equal(t, wantA, c.Repos[0].Path)
	wantRoot, _ := filepath.EvalSymlinks(readRoot)
	require.Equal(t, []string{wantRoot}, c.Repos[0].AllowedReadRoots)

	require.Empty(t, c.Validate())
}

func TestLoadDaemonFileHostScalar(t *testing.T) {
	repo := t.TempDir()
	body := `
host = "0.0.0.0"
allowed_origins = "nichis-mac-studio"
[[repos]]
name = "a"
path = "` + repo + `"
`
	c, err := LoadDaemonFile(writeTOML(t, body))
	require.NoError(t, err)
	require.Equal(t, []string{"0.0.0.0"}, c.Host)
	require.Equal(t, []string{"nichis-mac-studio"}, c.AllowedOrigins)
}

func TestLoadDaemonFileDefaultsWhenKeysAbsent(t *testing.T) {
	repo := t.TempDir()
	body := `
[[repos]]
name = "a"
path = "` + repo + `"
`
	c, err := LoadDaemonFile(writeTOML(t, body))
	require.NoError(t, err)
	// Absent keys fall through to defaults.
	require.Equal(t, []string{"127.0.0.1"}, c.Host)
	require.Empty(t, c.AllowedOrigins)
	require.Equal(t, 8000, c.Port)
	require.True(t, c.ShowHidden)
	require.True(t, c.UseIgnoreFiles)
	require.Equal(t, "INFO", c.LogLevel)
	require.Equal(t, 30*time.Second, c.WalkTimeout)
	require.False(t, c.ExcludeDirsSet)
	require.Equal(t, DefaultExcludeDirs, c.ExcludeDirs)
}

func TestLoadDaemonFileExcludeDirsSemantics(t *testing.T) {
	repo := t.TempDir()
	t.Run("absent-keeps-defaults", func(t *testing.T) {
		body := "[[repos]]\nname = \"a\"\npath = \"" + repo + "\"\n"
		c, err := LoadDaemonFile(writeTOML(t, body))
		require.NoError(t, err)
		require.False(t, c.ExcludeDirsSet)
		require.Equal(t, DefaultExcludeDirs, c.ExcludeDirs)
	})
	t.Run("present-replaces", func(t *testing.T) {
		body := "exclude_dirs = [\"vendor\", \"target\"]\n[[repos]]\nname = \"a\"\npath = \"" + repo + "\"\n"
		c, err := LoadDaemonFile(writeTOML(t, body))
		require.NoError(t, err)
		require.True(t, c.ExcludeDirsSet)
		require.Equal(t, []string{"vendor", "target"}, c.ExcludeDirs)
	})
	t.Run("present-empty-replaces-with-nothing", func(t *testing.T) {
		body := "exclude_dirs = []\n[[repos]]\nname = \"a\"\npath = \"" + repo + "\"\n"
		c, err := LoadDaemonFile(writeTOML(t, body))
		require.NoError(t, err)
		require.True(t, c.ExcludeDirsSet)
		require.Equal(t, []string{}, c.ExcludeDirs)
	})
}

func TestLoadDaemonFileWalkTimeoutSubSecond(t *testing.T) {
	repo := t.TempDir()
	body := "walk_timeout = 2.5\n[[repos]]\nname = \"a\"\npath = \"" + repo + "\"\n"
	c, err := LoadDaemonFile(writeTOML(t, body))
	require.NoError(t, err)
	require.Equal(t, 2500*time.Millisecond, c.WalkTimeout)
}

func TestLoadDaemonFileMissing(t *testing.T) {
	_, err := LoadDaemonFile(filepath.Join(t.TempDir(), "nope.toml"))
	require.Error(t, err)
}

func TestDiscoverReposFromSourceDirs(t *testing.T) {
	src := t.TempDir()
	// Two git repos, one plain dir, one hidden dir, one worktree (.git file).
	mkGitRepo(t, filepath.Join(src, "alpha"))
	mkGitRepo(t, filepath.Join(src, "beta"))
	require.NoError(t, os.MkdirAll(filepath.Join(src, "plain"), 0o755))
	require.NoError(t, os.MkdirAll(filepath.Join(src, ".hidden"), 0o755))
	worktree := filepath.Join(src, "gamma")
	require.NoError(t, os.MkdirAll(worktree, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: /elsewhere\n"), 0o644))

	c := Defaults()
	c.MultiRepo = true
	c.SourceDirs = []string{src}
	require.NoError(t, c.Resolve())
	added := c.DiscoverReposFromSourceDirs()

	names := repoNames(added)
	require.ElementsMatch(t, []string{"alpha", "beta", "gamma"}, names)
	require.Len(t, c.Repos, 3)
}

func TestDiscoverReposSkipsExistingAndDedupesNames(t *testing.T) {
	src := t.TempDir()
	mkGitRepo(t, filepath.Join(src, "alpha"))
	mkGitRepo(t, filepath.Join(src, "beta"))

	alphaResolved, _ := filepath.EvalSymlinks(filepath.Join(src, "alpha"))

	c := Defaults()
	c.MultiRepo = true
	c.SourceDirs = []string{src}
	// Pre-configure alpha by path (should be skipped) and a name collision
	// "beta" pointing elsewhere (discovered beta becomes "beta-2").
	other := t.TempDir()
	c.Repos = []RepoConfig{
		{Name: "explicit-alpha", Path: alphaResolved},
		{Name: "beta", Path: other},
	}
	require.NoError(t, c.Resolve())
	added := c.DiscoverReposFromSourceDirs()

	names := repoNames(added)
	// alpha skipped (path already present); beta discovered under "beta-2".
	require.ElementsMatch(t, []string{"beta-2"}, names)
}

func TestValidateErrorClasses(t *testing.T) {
	t.Run("no-repos", func(t *testing.T) {
		c := Defaults()
		c.MultiRepo = true
		c.Repos = nil
		errs := c.Validate()
		require.Len(t, errs, 1)
		require.Contains(t, errs[0], "No repositories configured")
	})

	t.Run("duplicate-names", func(t *testing.T) {
		repo := t.TempDir()
		c := Defaults()
		c.MultiRepo = true
		c.Repos = []RepoConfig{
			{Name: "dup", Path: repo},
			{Name: "dup", Path: repo},
		}
		errs := c.Validate()
		require.Contains(t, joinAll(errs), "Duplicate repository name: dup")
	})

	t.Run("bad-repo-path", func(t *testing.T) {
		c := Defaults()
		c.MultiRepo = true
		missing := filepath.Join(t.TempDir(), "gone")
		c.Repos = []RepoConfig{{Name: "x", Path: missing}}
		errs := c.Validate()
		require.Contains(t, joinAll(errs), "Repository path does not exist: "+missing)
	})

	t.Run("repo-path-is-file", func(t *testing.T) {
		file := filepath.Join(t.TempDir(), "a-file")
		require.NoError(t, os.WriteFile(file, []byte("x"), 0o644))
		c := Defaults()
		c.MultiRepo = true
		c.Repos = []RepoConfig{{Name: "x", Path: file}}
		errs := c.Validate()
		require.Contains(t, joinAll(errs), "Repository path is not a directory: "+file)
	})

	t.Run("bad-read-root", func(t *testing.T) {
		repo := t.TempDir()
		missing := filepath.Join(t.TempDir(), "noroot")
		c := Defaults()
		c.MultiRepo = true
		c.Repos = []RepoConfig{{Name: "x", Path: repo, AllowedReadRoots: []string{missing}}}
		errs := c.Validate()
		require.Contains(t, joinAll(errs), "Allowed read root does not exist for repo 'x': "+missing)
	})

	t.Run("clean", func(t *testing.T) {
		repo := t.TempDir()
		c := Defaults()
		c.MultiRepo = true
		c.Repos = []RepoConfig{{Name: "ok", Path: repo}}
		require.Empty(t, c.Validate())
	})
}

func TestGetRepo(t *testing.T) {
	c := Defaults()
	c.Repos = []RepoConfig{{Name: "a", Path: "/x"}, {Name: "b", Path: "/y"}}
	require.NotNil(t, c.GetRepo("b"))
	require.Equal(t, "/y", c.GetRepo("b").Path)
	require.Nil(t, c.GetRepo("missing"))
}

func TestHostNormalization(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"single", "127.0.0.1", []string{"127.0.0.1"}},
		{"trim", "  127.0.0.1  ", []string{"127.0.0.1"}},
		{"comma-list", "127.0.0.1,0.0.0.0", []string{"127.0.0.1", "0.0.0.0"}},
		{"spaces-around-commas", "127.0.0.1 , ::1 , localhost", []string{"127.0.0.1", "::1", "localhost"}},
		{"drops-empties", "127.0.0.1,,0.0.0.0,", []string{"127.0.0.1", "0.0.0.0"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, normalizeHosts(tc.in))
		})
	}
}

func TestParseSeconds(t *testing.T) {
	cases := []struct {
		in   string
		want time.Duration
		ok   bool
	}{
		{"30", 30 * time.Second, true},
		{"30.0", 30 * time.Second, true},
		{"2.5", 2500 * time.Millisecond, true},
		{" 5 ", 5 * time.Second, true},
		{"nope", 0, false},
	}
	for _, tc := range cases {
		got, err := parseSeconds(tc.in)
		if !tc.ok {
			require.Error(t, err, tc.in)
			continue
		}
		require.NoError(t, err, tc.in)
		require.Equal(t, tc.want, got, tc.in)
	}
}

func TestReviewDirIsLiteralPath(t *testing.T) {
	// REVIEW_DIR must be ~/.local/share/vantage/reviews regardless of XDG.
	t.Setenv("XDG_DATA_HOME", "/somewhere/else")
	dir, err := ReviewDir()
	require.NoError(t, err)
	home, err := os.UserHomeDir()
	require.NoError(t, err)
	require.Equal(t, filepath.Join(home, ".local", "share", "vantage", "reviews"), dir)
}

func TestDefaultConfigPath(t *testing.T) {
	p, err := DefaultConfigPath()
	require.NoError(t, err)
	require.Equal(t, "config.toml", filepath.Base(p))
	require.Equal(t, "vantage", filepath.Base(filepath.Dir(p)))
}

func TestExampleConfigEmbedded(t *testing.T) {
	require.NotEmpty(t, ExampleConfig)
	require.Contains(t, ExampleConfig, "[[repos]]")
	// Must decode as valid daemon TOML.
	c := Defaults()
	require.NotNil(t, c)
}

func TestSortedExcludeDirsIsStableCopy(t *testing.T) {
	in := []string{"z", "a", "m"}
	out := sortedExcludeDirs(in)
	require.Equal(t, []string{"a", "m", "z"}, out)
	require.Equal(t, []string{"z", "a", "m"}, in, "input must not be mutated")
}

// --- test helpers ---

// mkGitRepo creates dir with a .git subdirectory so discovery treats it as a
// repository, without invoking the git binary.
func mkGitRepo(t *testing.T, dir string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, ".git"), 0o755))
}

func repoNames(repos []RepoConfig) []string {
	out := make([]string, len(repos))
	for i, r := range repos {
		out[i] = r.Name
	}
	return out
}

func joinAll(ss []string) string {
	out := ""
	for _, s := range ss {
		out += s + "\n"
	}
	return out
}
