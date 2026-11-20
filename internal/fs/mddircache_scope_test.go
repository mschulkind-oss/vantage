package fs

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// A change under one root alters which of its own directories hold Markdown
// and no other's: a directory's walk stops at a repository nested in it. In
// daemon mode every served repository shares the cache, and dropping all of it
// for one repository's write sent every other repository's tree back to disk.
func TestClearMarkdownDirCacheUnderKeepsOtherRoots(t *testing.T) {
	ClearMarkdownDirCache()
	t.Cleanup(ClearMarkdownDirCache)
	alpha, beta := t.TempDir(), t.TempDir()
	alphaRoot, betaRoot := resolveRoot(alpha), resolveRoot(beta)
	for _, dir := range []string{
		alphaRoot,
		filepath.Join(alphaRoot, "docs"),
		betaRoot,
		filepath.Join(betaRoot, "docs"),
		alphaRoot + "-sibling", // a name alpha's is a prefix of, not a directory in it
	} {
		markdownDirCache.set(dir, true)
	}

	// Named as the watcher names its root, before symlinks are resolved: on
	// macOS t.TempDir lies under /var, which is one.
	ClearMarkdownDirCacheUnder(alpha)

	cached := func(dir string) bool { _, ok := markdownDirCache.get(dir); return ok }
	require.False(t, cached(alphaRoot))
	require.False(t, cached(filepath.Join(alphaRoot, "docs")))
	require.True(t, cached(betaRoot))
	require.True(t, cached(filepath.Join(betaRoot, "docs")))
	require.True(t, cached(alphaRoot+"-sibling"))
}
