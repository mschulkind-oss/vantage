package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/gitenv"
	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/server"
)

// isolateHome points every user-level path at a fresh temp dir, so nothing a
// test does touches the real ~/.config, ~/.local or ~/Library.
func isolateHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(home); err == nil {
		home = resolved
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	return home
}

// runGit runs git in dir with the repo-location variables scrubbed. Every git
// call in these tests must go through it: under the pre-commit hook git exports
// GIT_DIR and GIT_INDEX_FILE, and an unscrubbed `git worktree add` once created
// a branch in the outer repository and overwrote its index.
func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git binary not available")
	}
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(gitenv.Scrubbed(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1",
	)
	out, err := cmd.CombinedOutput()
	require.NoErrorf(t, err, "git %v: %s", args, out)
}

// gitRepo initializes a repository at dir holding files, committed.
func gitRepo(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(dir, 0o755))
	runGit(t, dir, "-c", "init.defaultBranch=main", "init", "-q")
	writeFiles(t, dir, files)
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "init")
}

func writeFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for rel, content := range files {
		full := filepath.Join(dir, rel)
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
	}
}

// clonesDir builds the small fixture the design note's reproduction used: a
// directory named "code" (not a repository) holding three tiny clones, each
// with a gitignored generated/ folder, and one loose notes.md.
func clonesDir(t *testing.T) string {
	t.Helper()
	parent := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		parent = resolved
	}
	code := filepath.Join(parent, "code")
	for _, name := range []string{"alpha", "beta", "gamma"} {
		gitRepo(t, filepath.Join(code, name), map[string]string{
			"README.md":     "# " + name + "\n",
			"docs/guide.md": "# guide\n",
			".gitignore":    "generated/\n",
		})
		writeFiles(t, filepath.Join(code, name), map[string]string{"generated/out.md": "# generated\n"})
	}
	writeFiles(t, code, map[string]string{"notes.md": "# notes\n"})
	return code
}

func resolvedServeConfig(t *testing.T, target string) *config.Config {
	t.Helper()
	cfg := config.Defaults()
	cfg.TargetRepo = target
	require.NoError(t, cfg.Resolve())
	return cfg
}

func TestSplitClonesDirectoryServesEachCloneAndTheLooseMarkdown(t *testing.T) {
	code := clonesDir(t)
	cfg := resolvedServeConfig(t, code)

	plan, ok := splitClonesDirectory(cfg)
	require.True(t, ok)
	require.Equal(t, &clonesPlan{Dir: code, Repos: 3, Loose: "code"}, plan)

	require.True(t, cfg.MultiRepo)
	require.Equal(t, []string{code}, cfg.SourceDirs, "the rescan that finds new clones runs over the same directory")
	require.Equal(t, []config.RepoConfig{
		{Name: "code", Path: code, Loose: true},
		{Name: "alpha", Path: filepath.Join(code, "alpha"), Discovered: true},
		{Name: "beta", Path: filepath.Join(code, "beta"), Discovered: true},
		{Name: "gamma", Path: filepath.Join(code, "gamma"), Discovered: true},
	}, cfg.Repos)
	require.Empty(t, cfg.Validate())
}

func TestSplitClonesDirectoryOmitsTheLooseProjectWithoutLooseMarkdown(t *testing.T) {
	code := clonesDir(t)
	require.NoError(t, os.Remove(filepath.Join(code, "notes.md")))
	// Markdown only inside a repository nested in a plain folder is not loose.
	gitRepo(t, filepath.Join(code, "archive", "old"), map[string]string{"old.md": "# old\n"})
	writeFiles(t, code, map[string]string{"archive/readme.txt": "not markdown\n"})
	cfg := resolvedServeConfig(t, code)

	plan, ok := splitClonesDirectory(cfg)
	require.True(t, ok)
	require.Equal(t, "", plan.Loose)
	require.Equal(t, 3, plan.Repos, "discovery is one level deep, like the daemon's")
	for _, rc := range cfg.Repos {
		require.False(t, rc.Loose)
	}
}

func TestSplitClonesDirectoryLeavesOtherPathsAsOneProject(t *testing.T) {
	t.Run("a directory inside a repository", func(t *testing.T) {
		outer := t.TempDir()
		gitRepo(t, outer, map[string]string{"README.md": "# outer\n"})
		// A vendored clone below a repository does not make it a set of clones.
		gitRepo(t, filepath.Join(outer, "vendor", "lib"), map[string]string{"lib.md": "# lib\n"})
		for _, target := range []string{outer, filepath.Join(outer, "vendor")} {
			cfg := resolvedServeConfig(t, target)
			_, ok := splitClonesDirectory(cfg)
			require.False(t, ok, target)
			require.False(t, cfg.MultiRepo)
		}
	})
	t.Run("a directory with no repository among its children", func(t *testing.T) {
		dir := t.TempDir()
		writeFiles(t, dir, map[string]string{"notes.md": "# n\n", "deep/er/x.md": "# x\n"})
		gitRepo(t, filepath.Join(dir, "deep", "er", "repo"), map[string]string{"r.md": "# r\n"})
		cfg := resolvedServeConfig(t, dir)
		_, ok := splitClonesDirectory(cfg)
		require.False(t, ok, "only immediate children count")
	})
	t.Run("a hidden child repository", func(t *testing.T) {
		dir := t.TempDir()
		gitRepo(t, filepath.Join(dir, ".dotfiles"), map[string]string{"x.md": "# x\n"})
		cfg := resolvedServeConfig(t, dir)
		_, ok := splitClonesDirectory(cfg)
		require.False(t, ok, "discovery skips hidden directories, so detection does too")
	})
	t.Run("a file", func(t *testing.T) {
		dir := t.TempDir()
		writeFiles(t, dir, map[string]string{"notes.md": "# n\n"})
		cfg := resolvedServeConfig(t, filepath.Join(dir, "notes.md"))
		_, ok := splitClonesDirectory(cfg)
		require.False(t, ok)
	})
}

func TestPlanServeOneProjectKeepsTheSingleProject(t *testing.T) {
	code := clonesDir(t)
	cfg := resolvedServeConfig(t, code)
	require.Nil(t, planServe(cfg, true))
	require.False(t, cfg.MultiRepo)
	require.Empty(t, cfg.Repos)
	require.Equal(t, code, cfg.TargetRepo)

	require.NotNil(t, planServe(cfg, false))
	require.True(t, cfg.MultiRepo)
}

// A linked worktree counts as a repository for detection — its parent is not
// one project — but it is not served as one, in this mode or the daemon's (see
// docs/design/serve-clones-directory.md §2.1).
func TestSplitClonesDirectoryCountsALinkedWorktreeWithoutServingIt(t *testing.T) {
	parent := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		parent = resolved
	}
	code := filepath.Join(parent, "code")
	main := filepath.Join(parent, "elsewhere", "main")
	gitRepo(t, main, map[string]string{"README.md": "# main\n"})
	require.NoError(t, os.MkdirAll(code, 0o755))
	wt := filepath.Join(code, "feature")
	runGit(t, main, "worktree", "add", "-q", "-b", "feature", wt)
	writeFiles(t, code, map[string]string{"notes.md": "# notes\n"})

	cfg := resolvedServeConfig(t, code)
	plan, ok := splitClonesDirectory(cfg)
	require.True(t, ok, "a worktree child means the directory holds repositories")
	require.Equal(t, 0, plan.Repos)
	require.Equal(t, []config.RepoConfig{{Name: "code", Path: code, Loose: true}}, cfg.Repos)

	// With nothing else to serve, the directory itself is served, still
	// stopping at the worktree.
	require.NoError(t, os.Remove(filepath.Join(code, "notes.md")))
	cfg = resolvedServeConfig(t, code)
	plan, ok = splitClonesDirectory(cfg)
	require.True(t, ok)
	require.Equal(t, "code", plan.Loose)
	require.Len(t, cfg.Repos, 1)

	// Alongside a real clone, only the clone is a project.
	gitRepo(t, filepath.Join(code, "alpha"), map[string]string{"a.md": "# a\n"})
	cfg = resolvedServeConfig(t, code)
	plan, ok = splitClonesDirectory(cfg)
	require.True(t, ok)
	require.Equal(t, 1, plan.Repos)
	require.Equal(t, []string{"alpha"}, repoNamesOf(cfg))
}

func TestSplitClonesDirectoryNamesACollidingCloneWithASuffix(t *testing.T) {
	parent := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		parent = resolved
	}
	code := filepath.Join(parent, "code")
	gitRepo(t, filepath.Join(code, "code"), map[string]string{"a.md": "# a\n"})
	gitRepo(t, filepath.Join(code, "zeta"), map[string]string{"z.md": "# z\n"})
	writeFiles(t, code, map[string]string{"notes.md": "# notes\n"})

	cfg := resolvedServeConfig(t, code)
	_, ok := splitClonesDirectory(cfg)
	require.True(t, ok)
	require.Equal(t, []string{"code", "code-2", "zeta"}, repoNamesOf(cfg))
}

func repoNamesOf(cfg *config.Config) []string {
	out := make([]string, 0, len(cfg.Repos))
	for _, r := range cfg.Repos {
		out = append(out, r.Name)
	}
	return out
}

func TestClonesPlanDescribe(t *testing.T) {
	home := "/home/matt"
	cases := []struct {
		plan clonesPlan
		want string
	}{
		{
			clonesPlan{Dir: "/home/matt/code", Repos: 23, Loose: "code"},
			`~/code holds 23 git repositories; serving each as its own project (plus "code" for the Markdown outside them). Use --one-project to serve it as a single project.`,
		},
		{
			clonesPlan{Dir: "/home/matt/code", Repos: 23},
			`~/code holds 23 git repositories; serving each as its own project. Use --one-project to serve it as a single project.`,
		},
		{
			clonesPlan{Dir: "/srv/code", Repos: 1},
			`/srv/code holds 1 git repository; serving it as its own project. Use --one-project to serve it as a single project.`,
		},
		{
			clonesPlan{Dir: "/home/matt/trees", Loose: "trees"},
			`~/trees holds only linked worktrees, which Vantage does not serve as projects; serving the Markdown outside them as "trees". Use --one-project to serve it as a single project.`,
		},
	}
	for _, c := range cases {
		require.Equal(t, c.want, c.plan.describe(home))
	}
	require.Equal(t, "~", tildePath(home, home))
	require.Equal(t, "/home/mattress/x", tildePath("/home/mattress/x", home))
	require.Equal(t, "/x", tildePath("/x", ""))
}

func getJSON(t *testing.T, h http.Handler, target string, into any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	require.Equalf(t, http.StatusOK, rec.Code, "%s: %s", target, rec.Body.String())
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), into))
}

func treeNames(t *testing.T, h http.Handler, target string) []string {
	t.Helper()
	var nodes []model.FileNode
	getJSON(t, h, target, &nodes)
	out := make([]string, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, n.Name)
	}
	return out
}

// End to end over the server's routes: the split fixes what serving the same
// directory as one project got wrong (docs/design/serve-clones-directory.md §1).
func TestServedClonesDirectoryGivesEachCloneItsOwnProject(t *testing.T) {
	isolateHome(t)
	code := clonesDir(t)
	cfg := resolvedServeConfig(t, code)
	require.NotNil(t, planServe(cfg, false))

	srv, err := server.NewServer(cfg)
	require.NoError(t, err)
	h := srv.Handler()

	var repos []model.RepoInfo
	getJSON(t, h, "/api/repos", &repos)
	require.Len(t, repos, 4)
	require.Equal(t, model.RepoInfo{Name: "code", Pinned: true}, repos[0], "the loose project is listed first and pinned")
	for _, r := range repos[1:] {
		require.False(t, r.Pinned)
	}

	// The loose project shows only what is outside every clone.
	require.Equal(t, []string{"notes.md"}, treeNames(t, h, "/api/r/code/tree?path=."))
	var files []model.RepoFile
	getJSON(t, h, "/api/files/all", &files)
	byRepo := map[string][]string{}
	for _, f := range files {
		byRepo[f.Repo] = append(byRepo[f.Repo], f.Path)
	}
	require.Equal(t, []string{"notes.md"}, byRepo["code"])
	require.ElementsMatch(t, []string{"README.md", "docs/guide.md", "generated/out.md"}, byRepo["alpha"])

	// A clone's own .gitignore applies again, now that it is a repository root.
	require.ElementsMatch(t, []string{"docs", "README.md"}, treeNames(t, h, "/api/r/alpha/tree?path=.&show_gitignored=false"))

	// Working-copy status reaches the clone's files.
	require.NoError(t, os.WriteFile(filepath.Join(code, "alpha", "README.md"), []byte("# changed\n"), 0o644))
	var status model.FileStatus
	getJSON(t, h, "/api/r/alpha/git/status?path=README.md", &status)
	require.NotNil(t, status.GitStatus)
	require.Equal(t, "modified", *status.GitStatus)

	// And a clone's document is not reachable through the loose project.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/r/code/content?path=alpha/README.md", nil))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestServeHelpDescribesTheSplitAndTheTip(t *testing.T) {
	cmd, _, err := newRootCmd().Find([]string{"serve"})
	require.NoError(t, err)
	require.NotNil(t, cmd.Flags().Lookup("one-project"))
	for _, want := range []string{"directory of clones", "--one-project", "VANTAGE_NO_TIPS=1", "tips = false"} {
		require.Contains(t, cmd.Long, want)
	}
}
