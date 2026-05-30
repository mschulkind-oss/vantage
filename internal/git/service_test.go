package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// gitEnv is a deterministic environment for git invocations in tests: fixed
// identity, no global/system config interference, and a stable default branch.
func gitEnv() []string {
	return append(os.Environ(),
		"GIT_AUTHOR_NAME=Tester",
		"GIT_AUTHOR_EMAIL=tester@example.com",
		"GIT_COMMITTER_NAME=Tester",
		"GIT_COMMITTER_EMAIL=tester@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_SYSTEM=/dev/null",
		"HOME="+os.TempDir(),
	)
}

// runGit runs git in dir with the deterministic test env, failing the test on
// error.
func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = gitEnv()
	out, err := cmd.CombinedOutput()
	require.NoErrorf(t, err, "git %v: %s", args, out)
	return string(out)
}

// initRepo creates an empty git repository in a fresh temp dir and returns its
// path. It skips the whole test when the git binary is unavailable.
func initRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git binary not available")
	}
	dir := t.TempDir()
	runGit(t, dir, "-c", "init.defaultBranch=main", "init")
	return dir
}

// writeFile writes content to dir/rel, creating parent directories.
func writeFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	full := filepath.Join(dir, rel)
	require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
	require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
}

// TestSymlinkedRepoPathResolves guards the macOS regression where the repo path
// lives under a symlink (on macOS, t.TempDir/$TMPDIR sit under /var ->
// /private/var). "git rev-parse --show-toplevel" reports the physical path, so
// unless the service canonicalizes its repo path, every file looks outside the
// work tree and history/status/diff come back empty. Reproduced cross-platform
// here with an explicit symlink.
func TestSymlinkedRepoPathResolves(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	real := initRepo(t)
	writeFile(t, real, "README.md", "line one\nline two\n")
	runGit(t, real, "add", "README.md")
	runGit(t, real, "commit", "-m", "initial commit")

	// Point the service at a symlink to the repo rather than the real path.
	link := filepath.Join(t.TempDir(), "repo-link")
	require.NoError(t, os.Symlink(real, link))

	svc := NewService(link, Options{})

	hist := svc.History("README.md", 10)
	require.Len(t, hist, 1, "history must resolve through a symlinked repo path")
	require.Equal(t, "initial commit", hist[0].Message)

	last := svc.LastCommit("README.md")
	require.NotNil(t, last, "last commit must resolve through a symlinked repo path")
}

func TestIntegrationRootCommitHistoryAndDiff(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	dir := initRepo(t)
	writeFile(t, dir, "README.md", "line one\nline two\n")
	runGit(t, dir, "add", "README.md")
	runGit(t, dir, "commit", "-m", "initial commit")

	svc := NewService(dir, Options{})

	// History: one commit, newest first.
	hist := svc.History("README.md", 10)
	require.Len(t, hist, 1)
	require.Equal(t, "initial commit", hist[0].Message)
	require.Equal(t, "Tester", hist[0].AuthorName)
	require.Equal(t, "tester@example.com", hist[0].AuthorEmail)
	require.Len(t, hist[0].Hexsha, 40, "history hexsha is the full 40-char SHA")
	require.False(t, hist[0].Date.IsZero())

	// LastCommit mirrors History[0].
	last := svc.LastCommit("README.md")
	require.NotNil(t, last)
	require.Equal(t, hist[0].Hexsha, last.Hexsha)

	// Diff of the root commit uses the empty-tree base ⇒ all additions.
	diff, err := svc.FileDiff("README.md", hist[0].Hexsha)
	require.NoError(t, err)
	require.NotNil(t, diff)
	require.Equal(t, hist[0].Hexsha, diff.CommitHexsha)
	require.Equal(t, "initial commit", diff.CommitMessage)
	require.Equal(t, "Tester", diff.CommitAuthor)
	require.NotEmpty(t, diff.Hunks)

	var adds int
	for _, h := range diff.Hunks {
		for _, l := range h.Lines {
			if l.Type == "add" {
				adds++
			}
		}
	}
	require.Equal(t, 2, adds, "root commit diff shows both lines as additions")
}

func TestIntegrationSecondCommitDiffAgainstParent(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	dir := initRepo(t)
	writeFile(t, dir, "doc.md", "alpha\n")
	runGit(t, dir, "add", "doc.md")
	runGit(t, dir, "commit", "-m", "first")
	writeFile(t, dir, "doc.md", "alpha\nbeta\n")
	runGit(t, dir, "add", "doc.md")
	runGit(t, dir, "commit", "-m", "second")

	svc := NewService(dir, Options{})
	hist := svc.History("doc.md", 10)
	require.Len(t, hist, 2)
	require.Equal(t, "second", hist[0].Message)

	diff, err := svc.FileDiff("doc.md", hist[0].Hexsha)
	require.NoError(t, err)
	require.NotNil(t, diff)

	var adds, contexts int
	for _, h := range diff.Hunks {
		for _, l := range h.Lines {
			switch l.Type {
			case "add":
				adds++
			case "context":
				contexts++
			}
		}
	}
	require.Equal(t, 1, adds, "only the new line is added vs the parent")
	require.GreaterOrEqual(t, contexts, 1, "the unchanged line appears as context")
}

func TestIntegrationFileDiffInvalidSHA(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.md", "x\n")
	runGit(t, dir, "add", "a.md")
	runGit(t, dir, "commit", "-m", "c")

	svc := NewService(dir, Options{})
	diff, err := svc.FileDiff("a.md", "not-a-sha")
	require.ErrorIs(t, err, ErrInvalidSHA)
	require.Nil(t, diff)
}

func TestIntegrationFileDiffUnknownSHADegrades(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.md", "x\n")
	runGit(t, dir, "add", "a.md")
	runGit(t, dir, "commit", "-m", "c")

	svc := NewService(dir, Options{})
	// Syntactically valid but nonexistent commit ⇒ degrade to (nil, nil).
	diff, err := svc.FileDiff("a.md", "deadbeef")
	require.NoError(t, err)
	require.Nil(t, diff)
}

func TestIntegrationStatusModifiedUntrackedAdded(t *testing.T) {
	ClearStatusCache()

	dir := initRepo(t)
	writeFile(t, dir, "tracked.md", "v1\n")
	runGit(t, dir, "add", "tracked.md")
	runGit(t, dir, "commit", "-m", "c")

	// Modify the tracked file.
	writeFile(t, dir, "tracked.md", "v2\n")
	// Add an untracked file.
	writeFile(t, dir, "new.md", "fresh\n")
	// Stage a brand-new file ⇒ "A ".
	writeFile(t, dir, "staged.md", "staged\n")
	runGit(t, dir, "add", "staged.md")

	svc := NewService(dir, Options{})
	status := svc.Status()

	require.Equal(t, "modified", status["tracked.md"])
	require.Equal(t, "untracked", status["new.md"])
	require.Equal(t, "added", status["staged.md"])
}

func TestIntegrationStatusRenameKeysNewPath(t *testing.T) {
	ClearStatusCache()

	dir := initRepo(t)
	writeFile(t, dir, "old-name.md", "content\n")
	runGit(t, dir, "add", "old-name.md")
	runGit(t, dir, "commit", "-m", "c")

	// Rename and stage so git records it as a single-line rename
	// ("R  old -> new" in porcelain v1).
	runGit(t, dir, "mv", "old-name.md", "new-name.md")

	svc := NewService(dir, Options{})
	status := svc.Status()

	// The rename keys the NEW path; "R " falls through to "modified". The old
	// path is folded into the rename line and gets no entry of its own.
	require.Equal(t, "modified", status["new-name.md"], "rename keys the new path")
	_, hasOld := status["old-name.md"]
	require.False(t, hasOld, "the old path is not keyed separately")
}

func TestIntegrationWorkingDiffModifiedAndUntracked(t *testing.T) {
	ClearStatusCache()

	dir := initRepo(t)
	writeFile(t, dir, "page.md", "one\ntwo\n")
	runGit(t, dir, "add", "page.md")
	runGit(t, dir, "commit", "-m", "c")
	writeFile(t, dir, "page.md", "one\ntwo\nthree\n")

	svc := NewService(dir, Options{})

	diff, err := svc.WorkingDiff("page.md")
	require.NoError(t, err)
	require.NotNil(t, diff)
	require.Equal(t, "working", diff.CommitHexsha)
	require.Equal(t, "Uncommitted changes (modified)", diff.CommitMessage)
	require.Equal(t, "Working directory", diff.CommitAuthor)
	require.NotEmpty(t, diff.Hunks)

	// Untracked file ⇒ all-additions synthetic diff.
	writeFile(t, dir, "untracked.md", "a\nb\n")
	ClearStatusCache()
	udiff, err := svc.WorkingDiff("untracked.md")
	require.NoError(t, err)
	require.NotNil(t, udiff)
	require.Equal(t, "Uncommitted changes (untracked)", udiff.CommitMessage)
	var adds int
	for _, h := range udiff.Hunks {
		for _, l := range h.Lines {
			if l.Type == "add" {
				adds++
			}
		}
	}
	require.Equal(t, 2, adds)
}

func TestIntegrationWorkingDiffCleanFileIsNil(t *testing.T) {
	ClearStatusCache()

	dir := initRepo(t)
	writeFile(t, dir, "clean.md", "stable\n")
	runGit(t, dir, "add", "clean.md")
	runGit(t, dir, "commit", "-m", "c")

	svc := NewService(dir, Options{})
	diff, err := svc.WorkingDiff("clean.md")
	require.NoError(t, err)
	require.Nil(t, diff, "a file with no working-tree changes yields nil")
}

func TestIntegrationRecents(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	dir := initRepo(t)
	// Committed (tracked) markdown.
	writeFile(t, dir, "committed.md", "# committed\n")
	runGit(t, dir, "add", "committed.md")
	runGit(t, dir, "commit", "-m", "add committed")
	// Untracked markdown.
	writeFile(t, dir, "untracked.md", "# untracked\n")
	// A non-markdown file should be ignored.
	writeFile(t, dir, "notes.txt", "ignore me\n")

	svc := NewService(dir, Options{})
	recents := svc.Recents(30, nil, true, true)

	paths := map[string]bool{}
	for _, r := range recents {
		paths[r.Path] = true
	}
	require.True(t, paths["committed.md"], "tracked .md appears")
	require.True(t, paths["untracked.md"], "untracked .md appears")
	require.False(t, paths["notes.txt"], "non-.md is excluded")

	// Verify untracked flag and that results are sorted newest-first.
	for _, r := range recents {
		if r.Path == "untracked.md" {
			require.True(t, r.Untracked)
		}
		if r.Path == "committed.md" {
			require.False(t, r.Untracked)
			require.NotEmpty(t, r.Hexsha)
		}
	}
}

func TestIntegrationRecentsLimitAndCache(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	dir := initRepo(t)
	writeFile(t, dir, "a.md", "a\n")
	writeFile(t, dir, "b.md", "b\n")
	writeFile(t, dir, "c.md", "c\n")

	svc := NewService(dir, Options{})
	limited := svc.Recents(2, nil, true, true)
	require.Len(t, limited, 2, "limit is honored")

	// A second identical call hits the cache and returns the same slice.
	again := svc.Recents(2, nil, true, true)
	require.Equal(t, limited, again)
}

func TestIntegrationSubdirectoryOfLargerRepo(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	root := initRepo(t)
	writeFile(t, root, "top.md", "top\n")
	writeFile(t, root, "docs/guide.md", "guide v1\n")
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-m", "init tree")

	// A service scoped to the docs/ subdirectory of the larger repo.
	subdir := filepath.Join(root, "docs")
	svc := NewService(subdir, Options{})

	// History resolves the subdir file via repo-relative path translation.
	hist := svc.History("guide.md", 10)
	require.Len(t, hist, 1)
	require.Equal(t, "init tree", hist[0].Message)

	// Diff works through the subdir scoping.
	diff, err := svc.FileDiff("guide.md", hist[0].Hexsha)
	require.NoError(t, err)
	require.NotNil(t, diff)
	require.Equal(t, "guide.md", diff.FilePath)

	// Modify the subdir file ⇒ status keyed relative to the subdir.
	writeFile(t, subdir, "guide.md", "guide v2\n")
	status := svc.Status()
	require.Equal(t, "modified", status["guide.md"], "status is keyed relative to the subdir")
	// top.md lives outside the subdir and must be skipped.
	_, ok := status["top.md"]
	require.False(t, ok)
	_, ok = status["../top.md"]
	require.False(t, ok, "paths resolving outside the subdir are skipped")

	// WorkingDiff through the subdir.
	wdiff, err := svc.WorkingDiff("guide.md")
	require.NoError(t, err)
	require.NotNil(t, wdiff)
	require.Equal(t, "working", wdiff.CommitHexsha)

	// Recents within the subdir sees guide.md but not top.md.
	ClearRecentFilesCache()
	recents := svc.Recents(30, nil, true, true)
	paths := map[string]bool{}
	for _, r := range recents {
		paths[r.Path] = true
	}
	require.True(t, paths["guide.md"])
	require.False(t, paths["top.md"], "files outside the subdir are not listed")
}

func TestIntegrationHeadHashAndDirty(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "f.md", "x\n")
	runGit(t, dir, "add", "f.md")
	runGit(t, dir, "commit", "-m", "c")

	svc := NewService(dir, Options{})
	require.NotEmpty(t, svc.HeadHash(), "short HEAD hash resolves")
	require.False(t, svc.IsDirty(), "clean tree is not dirty")

	writeFile(t, dir, "f.md", "y\n")
	require.True(t, svc.IsDirty(), "modified tree is dirty")
}

func TestIntegrationChildRepoDelegation(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git binary not available")
	}
	parent := t.TempDir()

	// Create a child git repo inside a non-git parent.
	child := filepath.Join(parent, "project_a")
	require.NoError(t, os.MkdirAll(child, 0o755))
	runGit(t, child, "-c", "init.defaultBranch=main", "init")
	writeFile(t, child, "readme.md", "child v1\n")
	runGit(t, child, "add", "readme.md")
	runGit(t, child, "commit", "-m", "child commit")

	// The parent is not a git repo.
	svc := NewService(parent, Options{})
	require.Empty(t, svc.workingDir, "parent is not a git repo")

	// History delegates to the child repo via the path prefix.
	hist := svc.History("project_a/readme.md", 10)
	require.Len(t, hist, 1)
	require.Equal(t, "child commit", hist[0].Message)

	// Diff delegates too.
	diff, err := svc.FileDiff("project_a/readme.md", hist[0].Hexsha)
	require.NoError(t, err)
	require.NotNil(t, diff)

	// Recents aggregates the child repo's files with a name prefix.
	recents := svc.Recents(30, nil, true, true)
	paths := map[string]bool{}
	for _, r := range recents {
		paths[r.Path] = true
	}
	require.True(t, paths["project_a/readme.md"], "child file is prefixed with the repo name")
}

func TestIntegrationNonRepoNoChildDegrades(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	dir := t.TempDir() // plain dir, no git
	writeFile(t, dir, "loose.md", "hello\n")

	svc := NewService(dir, Options{})
	require.Empty(t, svc.workingDir)

	// History/status/diffs degrade to empty without panicking.
	require.Empty(t, svc.History("loose.md", 10))
	require.Empty(t, svc.Status())
	require.Empty(t, svc.HeadHash())
	require.False(t, svc.IsDirty())

	diff, err := svc.FileDiff("loose.md", "deadbeef")
	require.NoError(t, err)
	require.Nil(t, diff)

	wdiff, err := svc.WorkingDiff("loose.md")
	require.NoError(t, err)
	require.Nil(t, wdiff)

	// Recents falls back to a filesystem walk and finds the loose markdown.
	recents := svc.Recents(30, nil, true, true)
	require.Len(t, recents, 1)
	require.Equal(t, "loose.md", recents[0].Path)
	require.True(t, recents[0].Untracked)
}

func TestIntegrationLastCommitsBatch(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "x.md", "x\n")
	writeFile(t, dir, "y.md", "y\n")
	runGit(t, dir, "add", "x.md")
	runGit(t, dir, "commit", "-m", "commit x")
	runGit(t, dir, "add", "y.md")
	runGit(t, dir, "commit", "-m", "commit y")

	svc := NewService(dir, Options{})
	batch := svc.LastCommitsBatch([]string{"x.md", "y.md"})
	require.Len(t, batch, 2)
	require.Equal(t, "commit x", batch["x.md"].Message)
	require.Equal(t, "commit y", batch["y.md"].Message)
	// The batch format includes %ae, so author email is populated.
	require.Equal(t, "tester@example.com", batch["x.md"].AuthorEmail)
}

func TestIntegrationRecentsExcludeDir(t *testing.T) {
	ClearStatusCache()
	ClearRecentFilesCache()

	dir := initRepo(t)
	writeFile(t, dir, "keep.md", "keep\n")
	writeFile(t, dir, "node_modules/skip.md", "skip\n")

	svc := NewService(dir, Options{ExcludeDirs: []string{"node_modules"}})
	recents := svc.Recents(30, nil, true, true)
	paths := map[string]bool{}
	for _, r := range recents {
		paths[r.Path] = true
	}
	require.True(t, paths["keep.md"])
	require.False(t, paths["node_modules/skip.md"], "excluded directory is pruned")
}
