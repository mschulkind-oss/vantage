package static

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/web"
)

// testLogger returns a slog logger that discards output, keeping test runs
// quiet while still exercising the builder's logging calls.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// requireEmbeddedFrontend skips a test when no frontend bundle is embedded
// (web/dist holds only the .gitkeep sentinel). CI bundles the frontend before
// running tests, so these run for real there; locally, run `just build` first.
func requireEmbeddedFrontend(t *testing.T) {
	t.Helper()
	if _, err := web.IndexHTML(); err != nil {
		t.Skip("frontend bundle not embedded; run 'just build'")
	}
}

// gitAvailable reports whether a git binary is on PATH. Git-dependent
// assertions are skipped gracefully when it is absent (the build itself never
// requires git — its probes degrade to empty results).
func gitAvailable() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

// writeFile writes content to path under dir, creating parent directories.
func writeFile(t *testing.T, dir, rel, content string) {
	t.Helper()
	p := filepath.Join(dir, filepath.FromSlash(rel))
	require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o755))
	require.NoError(t, os.WriteFile(p, []byte(content), 0o644))
}

// initRepo turns dir into a committed git repo containing the given files, so
// history/status/diff data is non-empty. It returns the HEAD commit SHA. Tests
// that call it must guard on gitAvailable().
func initRepo(t *testing.T, dir string) string {
	t.Helper()
	run := func(args ...string) string {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		out, err := cmd.CombinedOutput()
		require.NoErrorf(t, err, "git %v: %s", args, out)
		return string(out)
	}
	run("init")
	run("add", ".")
	run("commit", "-m", "initial")
	return strings.TrimSpace(run("rev-parse", "HEAD"))
}

// TestBuildEmitsExpectedFileSet builds a tiny markdown repo and asserts the
// scheme files the frontend will request all exist with valid JSON.
func TestBuildEmitsExpectedFileSet(t *testing.T) {
	requireEmbeddedFrontend(t)
	src := t.TempDir()
	out := t.TempDir()
	writeFile(t, src, "README.md", "# Readme\n")
	writeFile(t, src, "docs/guide.md", "# Guide\n")
	writeFile(t, src, "notes.txt", "not markdown\n") // excluded from markdown listings

	require.NoError(t, Build(Config{Source: src, Output: out, RepoName: "demo"}))

	// Frontend assets copied.
	require.FileExists(t, filepath.Join(out, "index.html"))
	require.FileExists(t, filepath.Join(out, "404.html"))

	// SPA host config.
	require.FileExists(t, filepath.Join(out, "_redirects"))
	require.FileExists(t, filepath.Join(out, "_headers"))

	// Query-less endpoints + recents (always present).
	for _, rel := range []string{
		StaticSentinelPath(),
		SimpleEndpointPath("repos"),
		SimpleEndpointPath("info"),
		SimpleEndpointPath("health"),
		SimpleEndpointPath("files"),
		RecentPath(),
		TreePath("."),
		TreePath("docs"),
	} {
		require.FileExistsf(t, filepath.Join(out, filepath.FromSlash(rel)), "expected %s", rel)
	}

	// Per-markdown-file content/history/status (always present even w/o git).
	for _, f := range []string{"README.md", "docs/guide.md"} {
		require.FileExistsf(t, filepath.Join(out, filepath.FromSlash(ContentPath(f))), "content %s", f)
		require.FileExistsf(t, filepath.Join(out, filepath.FromSlash(HistoryPath(f))), "history %s", f)
		require.FileExistsf(t, filepath.Join(out, filepath.FromSlash(StatusPath(f))), "status %s", f)
	}

	// Non-markdown file gets no content file.
	require.NoFileExists(t, filepath.Join(out, filepath.FromSlash(ContentPath("notes.txt"))))

	// files.json holds exactly the markdown paths, sorted.
	var files []string
	readJSON(t, filepath.Join(out, filepath.FromSlash(SimpleEndpointPath("files"))), &files)
	require.Equal(t, []string{"README.md", "docs/guide.md"}, files)

	// repos.json is the single-repo sentinel.
	var repos []map[string]any
	readJSON(t, filepath.Join(out, filepath.FromSlash(SimpleEndpointPath("repos"))), &repos)
	require.Len(t, repos, 1)
	require.Equal(t, "", repos[0]["name"])

	// content/README.md.json round-trips to the source body.
	var content map[string]any
	readJSON(t, filepath.Join(out, filepath.FromSlash(ContentPath("README.md"))), &content)
	require.Equal(t, "# Readme\n", content["content"])
	require.Equal(t, "utf-8", content["encoding"])
}

// TestBuildEmptyStatusAndDiffAreNull asserts that a clean file (no git repo, so
// every git probe degrades to empty) writes a literal JSON null status file —
// the top-level-null contract that gives static mode a 200 instead of a 404.
func TestBuildEmptyStatusAndDiffAreNull(t *testing.T) {
	src := t.TempDir()
	out := t.TempDir()
	writeFile(t, src, "README.md", "# Readme\n")

	require.NoError(t, Build(Config{Source: src, Output: out}))

	raw, err := os.ReadFile(filepath.Join(out, filepath.FromSlash(StatusPath("README.md"))))
	require.NoError(t, err)
	require.Equal(t, "null", string(raw), "empty status must serialize as literal null")

	// History of a non-git file is an empty array (not null), so no diff files
	// are emitted; that is the absence of a 404-able diff, which is fine.
	var hist []any
	readJSON(t, filepath.Join(out, filepath.FromSlash(HistoryPath("README.md"))), &hist)
	require.Empty(t, hist)
}

// TestBuildWithGitProducesDiffs exercises the git-dependent path: a committed
// repo yields history, a non-null status, and a per-commit diff file. Skipped
// when git is unavailable.
func TestBuildWithGitProducesDiffs(t *testing.T) {
	if !gitAvailable() {
		t.Skip("git not available")
	}
	src := t.TempDir()
	out := t.TempDir()
	writeFile(t, src, "README.md", "# Readme\nline two\n")
	head := initRepo(t, src)

	require.NoError(t, Build(Config{Source: src, Output: out}))

	// History is non-empty and includes HEAD.
	var hist []map[string]any
	readJSON(t, filepath.Join(out, filepath.FromSlash(HistoryPath("README.md"))), &hist)
	require.NotEmpty(t, hist)
	require.Equal(t, head, hist[0]["hexsha"])

	// Status is a non-null object (file has a last commit).
	raw, err := os.ReadFile(filepath.Join(out, filepath.FromSlash(StatusPath("README.md"))))
	require.NoError(t, err)
	require.NotEqual(t, "null", string(raw))

	// A per-commit diff file exists at the scheme path for HEAD.
	require.FileExists(t, filepath.Join(out, filepath.FromSlash(DiffPath("README.md", head))))
}

// TestInjectStaticModeTransforms verifies the index.html patch in isolation:
// the sentinel is injected, root-relative assets become document-relative, and
// any <base> tag is stripped. It writes a crafted index.html (the embedded
// placeholder has no assets or base tag) and calls injectStaticMode directly.
func TestInjectStaticModeTransforms(t *testing.T) {
	out := t.TempDir()
	const html = `<!doctype html>
<html>
  <head>
    <base href="/app/" />
    <link rel="stylesheet" href="/assets/index-abc.css" />
    <script type="module" src="/assets/index-abc.js"></script>
  </head>
  <body></body>
</html>`
	require.NoError(t, os.WriteFile(filepath.Join(out, "index.html"), []byte(html), 0o644))

	require.NoError(t, injectStaticMode(out, testLogger()))

	patched, err := os.ReadFile(filepath.Join(out, "index.html"))
	require.NoError(t, err)
	got := string(patched)

	require.Contains(t, got, sentinelScript, "sentinel script injected")
	require.Contains(t, got, `href="./assets/index-abc.css"`, "css rewritten to relative")
	require.Contains(t, got, `src="./assets/index-abc.js"`, "js rewritten to relative")
	require.NotContains(t, got, "<base", "base tag stripped")
	require.NotContains(t, got, `href="/assets`, "no root-relative assets remain")

	// 404.html mirrors the patched index.html.
	fallback, err := os.ReadFile(filepath.Join(out, "404.html"))
	require.NoError(t, err)
	require.Equal(t, got, string(fallback))
}

// TestInjectStaticModeEmbeddedSentinel confirms the sentinel injection works on
// the actual embedded bundle's index.html (the full Build path).
func TestInjectStaticModeEmbeddedSentinel(t *testing.T) {
	requireEmbeddedFrontend(t)
	src := t.TempDir()
	out := t.TempDir()
	writeFile(t, src, "README.md", "# Readme\n")

	require.NoError(t, Build(Config{Source: src, Output: out}))

	raw, err := os.ReadFile(filepath.Join(out, "index.html"))
	require.NoError(t, err)
	require.Contains(t, string(raw), "window.__VANTAGE_STATIC__")
}

// TestInjectStaticModeIdempotent confirms a second injection does not duplicate
// the sentinel script.
func TestInjectStaticModeIdempotent(t *testing.T) {
	out := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(out, "index.html"),
		[]byte("<!doctype html><html><head></head><body></body></html>"), 0o644))

	require.NoError(t, injectStaticMode(out, testLogger()))
	require.NoError(t, injectStaticMode(out, testLogger()))

	raw, err := os.ReadFile(filepath.Join(out, "index.html"))
	require.NoError(t, err)
	require.Equal(t, 1, strings.Count(string(raw), "window.__VANTAGE_STATIC__"))
}

// readJSON decodes the JSON file at path into v.
func readJSON(t *testing.T, path string, v any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, v))
}
