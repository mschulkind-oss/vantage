package fs

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/git"
	"github.com/mschulkind-oss/vantage/internal/model"
)

// jsonMarshal marshals v and returns the JSON as a string for substring asserts.
func jsonMarshal(v any) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

// gitEnv is a deterministic environment for git invocations in tests.
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

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = gitEnv()
	out, err := cmd.CombinedOutput()
	require.NoErrorf(t, err, "git %v: %s", args, out)
}

// initRepo makes an empty git repo in a fresh temp dir, skipping when git is
// unavailable. It returns the dir's resolved path so it matches the service's
// internal (EvalSymlinks'd) root on platforms with a symlinked TMPDIR.
func initRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git binary not available")
	}
	dir := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		dir = resolved
	}
	runGit(t, dir, "-c", "init.defaultBranch=main", "init")
	return dir
}

func writeFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	full := filepath.Join(dir, rel)
	require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
	require.NoError(t, os.WriteFile(full, []byte(content), 0o644))
}

// newSvc builds a service rooted at dir with default options.
func newSvc(dir string) *FileSystemService {
	return New(Config{RootPath: dir})
}

func TestValidatePathRejections(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		dir = resolved
	}
	svc := newSvc(dir)

	tests := []struct {
		name string
		path string
	}{
		{"empty", ""},
		{"null byte", "a\x00b"},
		{"absolute", "/etc/passwd"},
		{"dot-git segment", "docs/.git/config"},
		{"dot-git leading", ".git/HEAD"},
		{"traversal", "../secret"},
		{"traversal nested", "docs/../../secret"},
		{"backslash dot-git", "docs\\.git\\config"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.ListDirectory(tc.path, Options{})
			require.Error(t, err)
			require.ErrorIs(t, err, ErrInvalidPath)
			var pe *PathError
			require.ErrorAs(t, err, &pe)
			require.NotEmpty(t, pe.Detail, "PathError carries a detail message for HTTP 400")
		})
	}
}

func TestValidatePathAccepts(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "docs/readme.md", "# hi\n")

	svc := newSvc(dir)
	// "." resolves to the root and lists fine.
	nodes, err := svc.ListDirectory(".", Options{})
	require.NoError(t, err)
	require.NotEmpty(t, nodes)

	// A normal subdir lists fine.
	nodes, err = svc.ListDirectory("docs", Options{})
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Equal(t, "readme.md", nodes[0].Name)
}

func TestListDirectoryDirsFirstCaseSensitive(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	// Files and dirs whose names exercise case-sensitive ordering: uppercase
	// sorts before lowercase under a byte comparison.
	writeFile(t, dir, "Zebra/inner.md", "z\n")
	writeFile(t, dir, "alpha/inner.md", "a\n")
	writeFile(t, dir, "Beta.md", "b\n")
	writeFile(t, dir, "apple.md", "a\n")

	svc := newSvc(dir)
	nodes, err := svc.ListDirectory(".", Options{})
	require.NoError(t, err)

	var names []string
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	// Dirs first (Zebra, alpha — case-sensitive: 'Z'<'a'), then files
	// (Beta.md, apple.md — 'B'<'a').
	require.Equal(t, []string{"Zebra", "alpha", "Beta.md", "apple.md"}, names)
	require.True(t, nodes[0].IsDir)
	require.True(t, nodes[1].IsDir)
	require.False(t, nodes[2].IsDir)
}

func TestListDirectoryHasMarkdown(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "withmd/sub/deep.md", "md\n")
	writeFile(t, dir, "nomd/sub/notes.txt", "txt\n")

	svc := newSvc(dir)
	nodes, err := svc.ListDirectory(".", Options{})
	require.NoError(t, err)

	byName := map[string]model.FileNode{}
	for _, n := range nodes {
		byName[n.Name] = n
	}
	require.Contains(t, byName, "withmd")
	require.Contains(t, byName, "nomd")
	require.True(t, byName["withmd"].HasMarkdown, "dir with a nested .md reports has_markdown")
	require.False(t, byName["nomd"].HasMarkdown, "dir with no .md reports has_markdown false")
}

func TestHasMarkdownSerializesFalse(t *testing.T) {
	// has_markdown is non-omitempty: a false value must serialize as the key.
	n := model.FileNode{Name: "nomd", Path: "nomd", IsDir: true, HasMarkdown: false}
	b, err := jsonMarshal(n)
	require.NoError(t, err)
	require.Contains(t, b, `"has_markdown":false`)
}

func TestReadFileUTF8(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "doc.md", "# Héllo\n")

	svc := newSvc(dir)
	fc, err := svc.ReadFile("doc.md")
	require.NoError(t, err)
	require.Equal(t, "utf-8", fc.Encoding)
	require.Equal(t, "# Héllo\n", fc.Content)
	require.Equal(t, "doc.md", fc.Path)
}

func TestReadFileBinaryEmptyContent(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	// Invalid UTF-8 bytes.
	full := filepath.Join(dir, "blob.bin")
	require.NoError(t, os.WriteFile(full, []byte{0xff, 0xfe, 0x00, 0x80}, 0o644))

	svc := newSvc(dir)
	fc, err := svc.ReadFile("blob.bin")
	require.NoError(t, err)
	require.Equal(t, "binary", fc.Encoding)
	require.Empty(t, fc.Content, "binary files return empty content")
	require.Equal(t, "blob.bin", fc.Path)
}

func TestReadFileRejections(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "adir/x.md", "x\n")

	svc := newSvc(dir)

	// Validation error → PathError.
	_, err := svc.ReadFile("../escape")
	require.ErrorIs(t, err, ErrInvalidPath)

	// A directory is not a file → PathError.
	_, err = svc.ReadFile("adir")
	require.ErrorIs(t, err, ErrInvalidPath)

	// Missing file → PathError.
	_, err = svc.ReadFile("does-not-exist.md")
	require.ErrorIs(t, err, ErrInvalidPath)
}

func TestSymlinkRelativeTarget(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "real.md", "real\n")
	// Symlink inside the root pointing at another in-root file.
	require.NoError(t, os.Symlink(filepath.Join(dir, "real.md"), filepath.Join(dir, "link.md")))

	svc := newSvc(dir)
	nodes, err := svc.ListDirectory(".", Options{})
	require.NoError(t, err)

	byName := map[string]model.FileNode{}
	for _, n := range nodes {
		byName[n.Name] = n
	}
	link, ok := byName["link.md"]
	require.True(t, ok)
	require.True(t, link.IsSymlink)
	require.Equal(t, "real.md", link.SymlinkTarget, "in-root symlink target is the repo-relative path")
}

func TestSymlinkBrokenTargetNull(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	// Broken symlink: target does not exist.
	require.NoError(t, os.Symlink(filepath.Join(dir, "missing.md"), filepath.Join(dir, "broken.md")))
	// External symlink: target is outside the root.
	external := t.TempDir()
	writeFile(t, external, "outside.md", "out\n")
	require.NoError(t, os.Symlink(filepath.Join(external, "outside.md"), filepath.Join(dir, "external.md")))

	svc := newSvc(dir)
	nodes, err := svc.ListDirectory(".", Options{})
	require.NoError(t, err)

	byName := map[string]model.FileNode{}
	for _, n := range nodes {
		byName[n.Name] = n
	}

	broken, ok := byName["broken.md"]
	require.True(t, ok, "broken .md symlink is still surfaced")
	require.True(t, broken.IsSymlink)
	require.Empty(t, broken.SymlinkTarget, "broken symlink target serializes as null (empty)")

	ext, ok := byName["external.md"]
	require.True(t, ok, "external symlink is surfaced")
	require.True(t, ext.IsSymlink)
	require.Empty(t, ext.SymlinkTarget, "external symlink target serializes as null (empty)")

	// SymlinkTarget is omitempty: an empty value must be absent from JSON.
	js, err := jsonMarshal(broken)
	require.NoError(t, err)
	require.NotContains(t, js, "symlink_target")
}

func TestSymlinkTargetOmittedFromJSON(t *testing.T) {
	// A node with a target serializes the key; one without omits it.
	with := model.FileNode{Name: "l", Path: "l", IsSymlink: true, SymlinkTarget: "real.md"}
	js, err := jsonMarshal(with)
	require.NoError(t, err)
	require.Contains(t, js, `"symlink_target":"real.md"`)
}

func TestContainsChangesRollup(t *testing.T) {
	t.Cleanup(func() {
		ClearMarkdownDirCache()
		git.ClearStatusCache()
	})
	git.ClearStatusCache()

	dir := initRepo(t)
	writeFile(t, dir, "committed.md", "v1\n")
	writeFile(t, dir, "docs/nested.md", "v1\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "initial")

	// Modify a file inside docs/ (uncommitted) → docs/ should roll up
	// "contains_changes". Modify a top-level file → its node gets "modified".
	writeFile(t, dir, "docs/nested.md", "v1\nchanged\n")
	writeFile(t, dir, "committed.md", "v1\nchanged\n")

	svc := newSvc(dir)
	nodes, err := svc.ListDirectory(".", Options{IncludeGit: true})
	require.NoError(t, err)

	byName := map[string]model.FileNode{}
	for _, n := range nodes {
		byName[n.Name] = n
	}

	docs, ok := byName["docs"]
	require.True(t, ok)
	require.Equal(t, "contains_changes", docs.GitStatus, "dir with a changed descendant rolls up contains_changes")

	committed, ok := byName["committed.md"]
	require.True(t, ok)
	require.Equal(t, "modified", committed.GitStatus, "changed file carries its own status")

	// last_commit is populated for committed entries under include_git.
	require.NotNil(t, committed.LastCommit, "include_git populates last_commit")
	require.Equal(t, "initial", committed.LastCommit.Message)
}

func TestGitStatusOmittedWithoutIncludeGit(t *testing.T) {
	t.Cleanup(func() {
		ClearMarkdownDirCache()
		git.ClearStatusCache()
	})
	git.ClearStatusCache()

	dir := initRepo(t)
	writeFile(t, dir, "a.md", "v1\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "initial")
	writeFile(t, dir, "a.md", "v1\nchanged\n")

	svc := newSvc(dir)
	nodes, err := svc.ListDirectory(".", Options{IncludeGit: false})
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Empty(t, nodes[0].GitStatus, "git status is not annotated without include_git")
	require.Nil(t, nodes[0].LastCommit, "last_commit is not populated without include_git")

	// git_status is omitempty: an empty value must be absent from JSON.
	js, err := jsonMarshal(nodes[0])
	require.NoError(t, err)
	require.NotContains(t, js, "git_status")
}

func TestListAllFilesMarkdownOnlySortedRelative(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "z.md", "z\n")
	writeFile(t, dir, "docs/a.md", "a\n")
	writeFile(t, dir, "docs/sub/b.md", "b\n")
	writeFile(t, dir, "notes.txt", "ignored\n")

	svc := newSvc(dir)
	files := svc.ListAllFiles()
	require.Equal(t, []string{"docs/a.md", "docs/sub/b.md", "z.md"}, files)
}

func TestListAllFilesPrunesHiddenAndExcluded(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "keep.md", "k\n")
	writeFile(t, dir, ".hidden/secret.md", "s\n")
	writeFile(t, dir, "node_modules/dep.md", "d\n")

	svc := New(Config{RootPath: dir, ExcludeDirs: []string{"node_modules"}})
	files := svc.ListAllFiles()
	require.Equal(t, []string{"keep.md"}, files)
}

func TestListDirectoryExcludeAndHidden(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "visible.md", "v\n")
	writeFile(t, dir, ".dotfile.md", "h\n")
	writeFile(t, dir, "node_modules/x.md", "n\n")

	svc := New(Config{RootPath: dir, ExcludeDirs: []string{"node_modules", ".git"}})

	// Default: hidden hidden, excluded excluded.
	nodes, err := svc.ListDirectory(".", Options{})
	require.NoError(t, err)
	var names []string
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	require.Equal(t, []string{"visible.md"}, names)

	// ShowHidden surfaces the dotfile but node_modules stays excluded.
	nodes, err = svc.ListDirectory(".", Options{ShowHidden: true})
	require.NoError(t, err)
	names = nil
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	require.ElementsMatch(t, []string{"visible.md", ".dotfile.md"}, names)
}

func TestNonMarkdownFilesHidden(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "doc.md", "d\n")
	writeFile(t, dir, "image.png", "fake\n")
	writeFile(t, dir, "script.js", "//\n")

	svc := newSvc(dir)
	nodes, err := svc.ListDirectory(".", Options{})
	require.NoError(t, err)
	require.Len(t, nodes, 1, "only markdown files (and dirs) are surfaced")
	require.Equal(t, "doc.md", nodes[0].Name)
}

func TestListDirectoryNotADirectory(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	dir := initRepo(t)
	writeFile(t, dir, "file.md", "x\n")

	svc := newSvc(dir)
	_, err := svc.ListDirectory("file.md", Options{})
	require.ErrorIs(t, err, ErrInvalidPath)
}
