package static

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestSchemePaths mirrors the URL-rewriting cases in
// frontend/src/lib/staticMode.test.ts. The frontend rewrites a live "/api/…"
// URL to a relative "./api/…" file path; the builder must write the file at the
// matching output-relative path (the frontend's "./" prefix is just the
// document-relative form of the same path). Any divergence here silently 404s
// the no-backend site (risk R2), so these cases are kept in lockstep with the
// frontend test.
func TestSchemePaths(t *testing.T) {
	tests := []struct {
		name string
		got  string
		want string
	}{
		// Simple endpoints (staticMode.test.ts: simple endpoints).
		{"repos", SimpleEndpointPath("repos"), "api/repos.json"},
		{"info", SimpleEndpointPath("info"), "api/info.json"},
		{"files", SimpleEndpointPath("files"), "api/files.json"},
		{"health", SimpleEndpointPath("health"), "api/health.json"},

		// Tree endpoint: root "." → _, other dirs verbatim.
		{"tree root", TreePath("."), "api/tree/_.json"},
		{"tree root empty", TreePath(""), "api/tree/_.json"},
		{"tree docs", TreePath("docs"), "api/tree/docs.json"},
		{"tree nested", TreePath("docs/design"), "api/tree/docs/design.json"},

		// Content endpoint: path keeps its own extension.
		{"content md", ContentPath("README.md"), "api/content/README.md.json"},
		{"content nested", ContentPath("docs/guide.md"), "api/content/docs/guide.md.json"},

		// Git history.
		{"history", HistoryPath("README.md"), "api/git/history/README.md.json"},

		// Git recent (limit dropped → single file).
		{"recent", RecentPath(), "api/git/recent.json"},

		// Git status.
		{"status", StatusPath("README.md"), "api/git/status/README.md.json"},

		// Git diff: path/commit.
		{"diff", DiffPath("README.md", "abc123"), "api/git/diff/README.md/abc123.json"},
		{"diff nested", DiffPath("docs/guide.md", "deadbeef"), "api/git/diff/docs/guide.md/deadbeef.json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, tt.got)
		})
	}
}

// TestStaticSentinelPath covers the parity-only sentinel document, which the
// frontend reads from index.html rather than over HTTP but which the builder
// emits for offline inspection.
func TestStaticSentinelPath(t *testing.T) {
	require.Equal(t, "api/static.json", StaticSentinelPath())
}

// TestStripRepoPrefix mirrors the frontend's /api/r/{repo} → /api rewrite: a
// leading "r/<repo>/" segment is dropped (static mode is single-repo). The
// builder never emits repo-scoped paths, but the function is part of the R2
// contract surface so it is verified here too.
func TestStripRepoPrefix(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"strips repo segment", "r/myrepo/content/README.md.json", "content/README.md.json"},
		{"strips repo only", "r/myrepo", "myrepo"},
		{"no prefix passthrough", "content/README.md.json", "content/README.md.json"},
		{"empty passthrough", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, StripRepoPrefix(tt.in))
		})
	}
}
