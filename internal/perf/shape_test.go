package perf

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// writeFile creates a file (and parent dirs) with empty content for shape tests.
func writeFile(t *testing.T, root, rel string) {
	t.Helper()
	p := filepath.Join(root, rel)
	require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o755))
	require.NoError(t, os.WriteFile(p, []byte("x"), 0o644))
}

// TestCollectRepoShape builds a small tree, walks it, and checks counts, depth,
// extension distribution, and that excluded and dot directories are pruned.
func TestCollectRepoShape(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "a.md")
	writeFile(t, root, "b.go")
	writeFile(t, root, "Makefile") // no extension
	writeFile(t, root, "sub/c.md")
	writeFile(t, root, "sub/deep/d.go")
	// Excluded and dot dirs must be pruned entirely.
	writeFile(t, root, "node_modules/pkg/index.js")
	writeFile(t, root, ".git/config")

	exclude := map[string]struct{}{"node_modules": {}}
	shape := CollectRepoShape(root, exclude)

	require.Equal(t, 5, shape.TotalFiles, "pruned dirs contribute no files")
	// Dirs counted: root, sub, sub/deep => 3 (node_modules and .git pruned).
	require.Equal(t, 3, shape.TotalDirs)
	require.Equal(t, 2, shape.MaxDepth, "sub/deep is depth 2")

	require.Equal(t, 2, shape.ExtensionDistribution[".md"])
	require.Equal(t, 2, shape.ExtensionDistribution[".go"])
	require.Equal(t, 1, shape.ExtensionDistribution["(no ext)"])
	require.NotContains(t, shape.ExtensionDistribution, ".js", "node_modules pruned")

	require.GreaterOrEqual(t, shape.DirEntryCount.Max, 1)
	require.GreaterOrEqual(t, shape.WalkMs, 0.0)
}

// TestCollectRepoShapeEmpty confirms an empty tree yields zeroed percentiles and
// only the root directory.
func TestCollectRepoShapeEmpty(t *testing.T) {
	root := t.TempDir()
	shape := CollectRepoShape(root, nil)
	require.Equal(t, 0, shape.TotalFiles)
	require.Equal(t, 1, shape.TotalDirs, "the root dir itself is counted")
	require.Equal(t, 0, shape.MaxDepth)
	require.Equal(t, DirEntryCount{}, shape.DirEntryCount)
}

// TestTopExtensionsCap confirms the extension distribution is capped at
// maxExtensions, keeping the highest-count entries.
func TestTopExtensionsCap(t *testing.T) {
	counts := make(map[string]int)
	for i := 0; i < maxExtensions+5; i++ {
		ext := "." + string(rune('a'+i))
		counts[ext] = i + 1 // strictly increasing counts
	}
	top := topExtensions(counts)
	require.Len(t, top, maxExtensions)
	// The five lowest-count extensions (.a..e) must be dropped.
	require.NotContains(t, top, ".a")
	require.Contains(t, top, "."+string(rune('a'+maxExtensions+4)))
}

// TestDirDepth pins the relative-path depth calculation.
func TestDirDepth(t *testing.T) {
	require.Equal(t, 0, dirDepth("."))
	require.Equal(t, 1, dirDepth("a"))
	require.Equal(t, 2, dirDepth("a/b"))
	require.Equal(t, 3, dirDepth("a/b/c"))
}
