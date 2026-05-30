package perf

import (
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// maxExtensions caps how many extensions appear in a shape's
// extension_distribution, keeping the report bounded for large trees.
const maxExtensions = 20

// CollectRepoShape walks repoPath and returns anonymized structural statistics:
// file and directory counts, maximum depth, the extension distribution, and
// per-directory entry-count percentiles. It never records file names or content.
//
// Directories whose base name is in excludeDirs or begins with "." are pruned
// from the walk (and not counted). excludeDirs is passed in rather than imported
// so this package stays free of config dependencies; callers pass
// config.DefaultExcludeDirs.
func CollectRepoShape(repoPath string, excludeDirs map[string]struct{}) RepoShape {
	start := time.Now()

	var totalFiles, totalDirs, maxDepth int
	extCounts := make(map[string]int)
	var dirSizes []int

	// entriesByDir accumulates the child count for each directory as its
	// entries are visited, so we can report per-directory entry counts without
	// a second pass or a per-dir ReadDir.
	entriesByDir := make(map[string]int)

	root := filepath.Clean(repoPath)

	walkErr := fs.WalkDir(os.DirFS(root), ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip unreadable entries rather than aborting the whole walk; a
			// partial shape is more useful than none.
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		if d.IsDir() {
			base := d.Name()
			if path != "." {
				if _, skip := excludeDirs[base]; skip || strings.HasPrefix(base, ".") {
					return fs.SkipDir
				}
			}
			totalDirs++
			if _, ok := entriesByDir[path]; !ok {
				entriesByDir[path] = 0
			}
			depth := dirDepth(path)
			if depth > maxDepth {
				maxDepth = depth
			}
			// Count this directory as an entry of its parent.
			if path != "." {
				entriesByDir[parentDir(path)]++
			}
			return nil
		}

		// Regular file (or symlink/other): count it and its extension, and
		// register it as an entry of its parent directory.
		totalFiles++
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext == "" {
			ext = "(no ext)"
		}
		extCounts[ext]++
		entriesByDir[parentDir(path)]++
		return nil
	})
	if walkErr != nil {
		slog.Warn("perf repo-shape walk error",
			slog.String("path", repoPath),
			slog.Any("err", walkErr))
	}

	for _, n := range entriesByDir {
		dirSizes = append(dirSizes, n)
	}
	sort.Ints(dirSizes)

	elapsedMs := float64(time.Since(start).Microseconds()) / 1000
	slog.Info("perf repo-shape walked",
		slog.Int("files", totalFiles),
		slog.Int("dirs", totalDirs),
		slog.Int("max_depth", maxDepth),
		slog.Float64("walk_ms", elapsedMs))

	return RepoShape{
		TotalFiles:            totalFiles,
		TotalDirs:             totalDirs,
		MaxDepth:              maxDepth,
		ExtensionDistribution: topExtensions(extCounts),
		DirEntryCount:         dirEntryPercentiles(dirSizes),
		WalkMs:                round1(elapsedMs),
	}
}

// dirDepth returns the depth of a slash-separated walk path relative to the
// root. The root itself (".") is depth 0; "a" is depth 1; "a/b" is depth 2.
func dirDepth(path string) int {
	if path == "." {
		return 0
	}
	return strings.Count(path, "/") + 1
}

// parentDir returns the parent of a slash-separated walk path, with the root's
// children parented to ".".
func parentDir(path string) string {
	i := strings.LastIndex(path, "/")
	if i < 0 {
		return "."
	}
	return path[:i]
}

// topExtensions returns at most maxExtensions extensions, keeping those with the
// highest counts. Ties are broken by extension name for deterministic output.
func topExtensions(counts map[string]int) map[string]int {
	type kv struct {
		ext   string
		count int
	}
	pairs := make([]kv, 0, len(counts))
	for ext, c := range counts {
		pairs = append(pairs, kv{ext, c})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].count != pairs[j].count {
			return pairs[i].count > pairs[j].count
		}
		return pairs[i].ext < pairs[j].ext
	})
	if len(pairs) > maxExtensions {
		pairs = pairs[:maxExtensions]
	}
	out := make(map[string]int, len(pairs))
	for _, p := range pairs {
		out[p.ext] = p.count
	}
	return out
}

// dirEntryPercentiles computes p50/p95/max over a sorted slice of per-directory
// entry counts using the same truncated-index nearest-rank rule as the timing
// percentiles. An empty input yields all zeroes.
func dirEntryPercentiles(sorted []int) DirEntryCount {
	n := len(sorted)
	if n == 0 {
		return DirEntryCount{}
	}
	return DirEntryCount{
		P50: sorted[int(float64(n)*0.50)],
		P95: sorted[min(int(float64(n)*0.95), n-1)],
		Max: sorted[n-1],
	}
}
