package pathsafe

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// newRoot returns a resolved temp dir to act as a repository root, plus a
// resolved temp dir standing outside it.
func newRoot(t *testing.T) (string, string) {
	t.Helper()
	resolve := func(p string) string {
		if r, err := filepath.EvalSymlinks(p); err == nil {
			return r
		}
		return p
	}
	return resolve(t.TempDir()), resolve(t.TempDir())
}

func TestResolveLexicalRejections(t *testing.T) {
	root, _ := newRoot(t)

	tests := []struct {
		name string
		path string
		want string
	}{
		{"empty", "", "Invalid path"},
		{"NUL byte", "doc\x00.md", "Invalid path"},
		{"absolute", "/etc/passwd", "Absolute paths not allowed"},
		{"dot-git segment", ".git/config", "Access to .git directory is not allowed"},
		{"nested dot-git", "docs/.git/config", "Access to .git directory is not allowed"},
		{"backslash dot-git", `docs\.git\config`, "Access to .git directory is not allowed"},
		{"dot-vantage", ".vantage/state.json", "Access to .vantage directory is not allowed"},
		{"traversal", "../secret.md", "Path traversal detected"},
		{"traversal mid-path", "docs/../../secret.md", "Path traversal detected"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Resolve(root, tc.path)
			require.ErrorIs(t, err, ErrInvalid)
			var pe *Error
			require.ErrorAs(t, err, &pe)
			require.Equal(t, tc.want, pe.Detail)
		})
	}
}

func TestResolveAcceptsPathsInsideRoot(t *testing.T) {
	root, _ := newRoot(t)
	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "docs", "a.md"), []byte("x"), 0o644))

	got, err := Resolve(root, "docs/a.md")
	require.NoError(t, err)
	require.Equal(t, filepath.Join(root, "docs", "a.md"), got)
}

// A path that does not exist has to survive: the caller distinguishes "missing"
// from "refused", and turning every missing file into a traversal rejection
// would change a 404 into a 400 across the API.
func TestResolveAllowsMissingPath(t *testing.T) {
	root, _ := newRoot(t)

	got, err := Resolve(root, "not-here.md")
	require.NoError(t, err)
	require.Equal(t, filepath.Join(root, "not-here.md"), got)

	// Missing intermediate directories too.
	got, err = Resolve(root, "nope/deeper/not-here.md")
	require.NoError(t, err)
	require.Equal(t, filepath.Join(root, "nope", "deeper", "not-here.md"), got)
}

// The whole point of the package: lexically innocent, physically outside.
func TestResolveRejectsSymlinkEscapingRoot(t *testing.T) {
	root, outside := newRoot(t)
	secret := filepath.Join(outside, "secret.md")
	require.NoError(t, os.WriteFile(secret, []byte("canary"), 0o600))
	require.NoError(t, os.Symlink(secret, filepath.Join(root, "link.md")))

	_, err := Resolve(root, "link.md")
	require.ErrorIs(t, err, ErrInvalid)
}

// A symlinked directory carries every path that rides through it.
func TestResolveRejectsSymlinkedDirEscapingRoot(t *testing.T) {
	root, outside := newRoot(t)
	require.NoError(t, os.WriteFile(filepath.Join(outside, "secret.md"), []byte("canary"), 0o600))
	require.NoError(t, os.Symlink(outside, filepath.Join(root, "linkdir")))

	_, err := Resolve(root, "linkdir/secret.md")
	require.ErrorIs(t, err, ErrInvalid)

	// Including a path that does not exist beyond the link, which must not slip
	// through the nearest-existing-ancestor walk.
	_, err = Resolve(root, "linkdir/missing.md")
	require.ErrorIs(t, err, ErrInvalid)
}

// A link that lands outside and comes back is still outside at no point that
// matters — but a link chain that stays inside must be admitted.
func TestResolveAllowsSymlinkInsideRoot(t *testing.T) {
	root, _ := newRoot(t)
	real := filepath.Join(root, "real.md")
	require.NoError(t, os.WriteFile(real, []byte("x"), 0o644))
	require.NoError(t, os.Symlink(real, filepath.Join(root, "one.md")))
	require.NoError(t, os.Symlink(filepath.Join(root, "one.md"), filepath.Join(root, "two.md")))

	for _, p := range []string{"one.md", "two.md"} {
		got, err := Resolve(root, p)
		require.NoError(t, err, p)
		require.Equal(t, filepath.Join(root, p), got, "the caller's spelling is preserved")
	}
}

// Containment must be proved, not assumed: a broken link resolves to nowhere,
// so it cannot be shown to stay inside and is refused.
func TestResolveRejectsBrokenSymlink(t *testing.T) {
	root, outside := newRoot(t)
	require.NoError(t, os.Symlink(filepath.Join(outside, "never-existed.md"), filepath.Join(root, "broken.md")))

	_, err := Resolve(root, "broken.md")
	require.ErrorIs(t, err, ErrInvalid)
}

// The root itself is a legitimate target (a listing of ".").
func TestResolveAllowsRootItself(t *testing.T) {
	root, _ := newRoot(t)

	got, err := Resolve(root, ".")
	require.NoError(t, err)
	require.Equal(t, root, got)
}

// A root reached through a symlink must not make everything under it look
// external: the root is resolved before comparison.
func TestResolveHandlesSymlinkedRoot(t *testing.T) {
	realRoot, other := newRoot(t)
	require.NoError(t, os.WriteFile(filepath.Join(realRoot, "a.md"), []byte("x"), 0o644))
	linkedRoot := filepath.Join(other, "root-link")
	require.NoError(t, os.Symlink(realRoot, linkedRoot))

	got, err := Resolve(linkedRoot, "a.md")
	require.NoError(t, err)
	require.Equal(t, filepath.Join(linkedRoot, "a.md"), got)
}
