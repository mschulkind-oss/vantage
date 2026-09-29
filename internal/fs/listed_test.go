package fs

import (
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"slices"
	"sort"
	"syscall"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
	"github.com/mschulkind-oss/vantage/internal/ignore"
)

// candidatesFixture is internal/repoconfig/testdata/planning-candidates.json: a
// tree, and what ListAllFiles lists in it. vantage-check's candidate walk reads
// the same file, so the server's listing and the checker's mirror of it are held
// to one answer.
type candidatesFixture struct {
	Tree   map[string]string `json:"tree"`
	Listed []string          `json:"listed"`
}

func loadCandidatesFixture(t *testing.T) candidatesFixture {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "repoconfig", "testdata", "planning-candidates.json"))
	require.NoError(t, err)
	var f candidatesFixture
	require.NoError(t, json.Unmarshal(data, &f))
	require.NotEmpty(t, f.Tree)
	require.NotEmpty(t, f.Listed)
	return f
}

// isolateUserIgnore points the user ignore file at an empty directory, so the
// developer's own ~/.config/vantage/ignore cannot change what is listed.
func isolateUserIgnore(t *testing.T) {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	ignore.ClearCache()
	t.Cleanup(ignore.ClearCache)
}

// materialize writes a fixture tree under a fresh, symlink-resolved directory.
func materialize(t *testing.T, tree map[string]string) string {
	t.Helper()
	root := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	for rel, content := range tree {
		writeFile(t, root, filepath.FromSlash(rel), content)
	}
	return root
}

// fixtureService is the listing the server builds: the default excluded
// directories and the ignore files, as `vantage serve` runs with no flags.
func fixtureService(root string) *FileSystemService {
	return New(Config{RootPath: root, ExcludeDirs: config.DefaultExcludeDirs, UseIgnoreFiles: true})
}

// probes is every path in the tree, every directory above one, and spellings
// of them the listing never yields.
func probes(tree map[string]string) []string {
	seen := map[string]bool{}
	for rel := range tree {
		for p := rel; p != "." && p != "/"; p = path.Dir(p) {
			seen[p] = true
		}
	}
	for _, extra := range []string{
		"", ".", "/", "/README.md", "./README.md", "README.md/", "docs//design/a.md",
		"docs/design/", "docs/../README.md", "../README.md", "missing.md",
		"docs/missing.md", "missing/a.md",
	} {
		seen[extra] = true
	}
	out := make([]string, 0, len(seen))
	for p := range seen {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

func TestListAllFilesMatchesTheCandidatesFixture(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	isolateUserIgnore(t)
	f := loadCandidatesFixture(t)

	svc := fixtureService(materialize(t, f.Tree))
	require.Equal(t, f.Listed, svc.ListAllFiles())
}

// IsListed is the listing's rules for one path, so on every path the fixture can
// name — and on the spellings of them the listing never produces — it has to
// give the listing's own answer.
func TestIsListedAgreesWithTheListingOnEveryPath(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	isolateUserIgnore(t)
	f := loadCandidatesFixture(t)

	svc := fixtureService(materialize(t, f.Tree))
	listed := svc.ListAllFiles()
	for _, p := range probes(f.Tree) {
		require.Equal(t, slices.Contains(listed, p), svc.IsListed(p), "IsListed(%q)", p)
	}

	// The cases the fixture exists for, spelled out so a regenerated fixture that
	// lost one is noticed here rather than passing vacuously.
	require.False(t, svc.IsListed(".github/x.md"), "a hidden directory is pruned")
	require.False(t, svc.IsListed("node_modules/pkg/README.md"), "a default-excluded directory is pruned")
	require.False(t, svc.IsListed("linked/doc.md"), "a linked worktree is pruned")
	require.False(t, svc.IsListed("docs/y.skip.md"), "a .vantageignore match is skipped")
	require.True(t, svc.IsListed("docs/keep.skip.md"), "and a negation restores it")
	require.True(t, svc.IsListed("docs/NOTES.MD"), "the extension is matched case-insensitively")
	require.True(t, svc.IsListed(".hidden.md"), "only hidden directories are pruned")
}

// A JSON tree cannot hold a symlink, so this is the fixture's missing row: the
// walk takes neither a symlinked file nor anything under a symlinked directory,
// even one that stays inside the repository.
func TestIsListedAgreesWithTheListingOnSymlinks(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	isolateUserIgnore(t)
	root := materialize(t, map[string]string{"real/a.md": "# A\n", "b.md": "# B\n"})
	require.NoError(t, os.Symlink(filepath.Join(root, "b.md"), filepath.Join(root, "link.md")))
	require.NoError(t, os.Symlink(filepath.Join(root, "real"), filepath.Join(root, "linkdir")))

	svc := fixtureService(root)
	listed := svc.ListAllFiles()
	require.Equal(t, []string{"b.md", "real/a.md"}, listed)
	for _, p := range []string{"b.md", "real/a.md", "link.md", "linkdir/a.md", "linkdir"} {
		require.Equal(t, slices.Contains(listed, p), svc.IsListed(p), "IsListed(%q)", p)
	}
}

// A file that exists but is neither a directory nor a symlink — a named pipe
// here — is listed, because the walk looks only at the name and the type. Being
// listed says nothing about whether it can be read; the planning endpoint
// decides that.
func TestIsListedAgreesWithTheListingOnANamedPipe(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	isolateUserIgnore(t)
	root := materialize(t, map[string]string{"a.md": "# A\n"})
	if err := syscall.Mkfifo(filepath.Join(root, "pipe.md"), 0o644); err != nil {
		t.Skipf("cannot make a named pipe here: %v", err)
	}

	svc := fixtureService(root)
	require.Equal(t, []string{"a.md", "pipe.md"}, svc.ListAllFiles())
	require.True(t, svc.IsListed("pipe.md"))
}

// A directory the walk cannot read contributes nothing to the listing, and
// IsListed has to say the same of the files inside it.
func TestIsListedAgreesWithTheListingOnAnUnreadableDirectory(t *testing.T) {
	t.Cleanup(ClearMarkdownDirCache)
	isolateUserIgnore(t)
	root := materialize(t, map[string]string{"a.md": "# A\n", "locked/b.md": "# B\n"})
	locked := filepath.Join(root, "locked")
	require.NoError(t, os.Chmod(locked, 0o311)) // search, but no read
	t.Cleanup(func() { _ = os.Chmod(locked, 0o755) })
	if _, err := os.ReadDir(locked); err == nil {
		t.Skip("directory permissions are not enforced for this user")
	}

	svc := fixtureService(root)
	require.Equal(t, []string{"a.md"}, svc.ListAllFiles())
	require.False(t, svc.IsListed("locked/b.md"))
}
