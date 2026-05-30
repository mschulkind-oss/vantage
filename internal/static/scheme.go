package static

import "path/filepath"

// This file defines the on-disk path scheme for the pre-rendered API JSON
// files. It is the producer side of the R2 contract: the static builder writes
// files at exactly the paths the frontend's static-mode axios interceptor
// (frontend/src/lib/staticMode.ts) rewrites live API URLs to. One divergent
// path silently 404s the no-backend site, so scheme_test.go mirrors the cases
// in staticMode.test.ts to keep the two sides honest.
//
// All functions return slash-separated paths relative to the output root
// (e.g. "api/tree/_.json"). The builder joins them onto the output directory
// with the OS separator before writing.

// apiDir is the subdirectory under the output root that holds every
// pre-rendered JSON file, mirroring the live "/api" URL prefix.
const apiDir = "api"

// rootTreeName is the file stem the frontend uses for the repository root in
// place of ".": GET /api/tree?path=. rewrites to api/tree/_.json.
const rootTreeName = "_"

// SimpleEndpoints names the query-less endpoints the frontend rewrites to a
// flat "api/<name>.json" file. They mirror the simpleEndpoints list and the
// fall-through in staticMode.ts: repos, info, files, health. "static" is not in
// that list (the frontend reads the sentinel from index.html, not over HTTP),
// but the builder still emits api/static.json for parity with the reference
// implementation and for offline inspection.
var SimpleEndpoints = []string{"repos", "info", "files", "health"}

// SimpleEndpointPath returns the output-relative path for a query-less endpoint
// such as "repos" → "api/repos.json".
func SimpleEndpointPath(name string) string {
	return join(apiDir, name+".json")
}

// StaticSentinelPath returns the path of the static-mode sentinel document,
// "api/static.json". The frontend does not fetch it; it is written for parity
// with the reference builder and for offline inspection.
func StaticSentinelPath() string {
	return join(apiDir, "static.json")
}

// TreePath returns the output-relative path for the directory tree of relPath.
// The repository root (".") maps to "api/tree/_.json"; every other directory
// maps to "api/tree/<relPath>.json" (creating nested directories as needed),
// mirroring the /api/tree?path=X rewrite (root "." → _).
func TreePath(relPath string) string {
	if relPath == "." || relPath == "" {
		return join(apiDir, "tree", rootTreeName+".json")
	}
	return join(apiDir, "tree", relPath+".json")
}

// ContentPath returns the output-relative path for the content of the file at
// relPath, "api/content/<relPath>.json". The path keeps the file's own
// extension (e.g. README.md → api/content/README.md.json), mirroring the
// /api/content?path=X rewrite, which appends .json to the verbatim path.
func ContentPath(relPath string) string {
	return join(apiDir, "content", relPath+".json")
}

// HistoryPath returns the output-relative path for the git history of relPath,
// "api/git/history/<relPath>.json", mirroring /api/git/history?path=X.
func HistoryPath(relPath string) string {
	return join(apiDir, "git", "history", relPath+".json")
}

// StatusPath returns the output-relative path for the git status of relPath,
// "api/git/status/<relPath>.json", mirroring /api/git/status?path=X.
func StatusPath(relPath string) string {
	return join(apiDir, "git", "status", relPath+".json")
}

// RecentPath returns the output-relative path for the recent-files list,
// "api/git/recent.json". The frontend drops the ?limit=N query, so a single
// file serves every limit, mirroring /api/git/recent.
func RecentPath() string {
	return join(apiDir, "git", "recent.json")
}

// DiffPath returns the output-relative path for the diff of relPath at commit,
// "api/git/diff/<relPath>/<commit>.json", mirroring
// /api/git/diff?path=X&commit=Y. commit is a hex SHA or the sentinel "working".
func DiffPath(relPath, commit string) string {
	return join(apiDir, "git", "diff", relPath, commit+".json")
}

// StripRepoPrefix mirrors the frontend's /api/r/{repo} → /api rewrite: static
// mode is always single-repo, so a leading "r/<repo>/" segment on an
// output-relative API path (below apiDir) is dropped. It is exposed for
// symmetry with staticMode.ts; the builder itself never emits repo-scoped paths.
func StripRepoPrefix(relPath string) string {
	const marker = "r/"
	if len(relPath) <= len(marker) || relPath[:len(marker)] != marker {
		return relPath
	}
	rest := relPath[len(marker):]
	if i := indexSlash(rest); i >= 0 {
		return rest[i+1:]
	}
	return rest
}

// indexSlash returns the index of the first '/' in s, or -1 if absent.
func indexSlash(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == '/' {
			return i
		}
	}
	return -1
}

// join builds a slash-separated, cleaned, output-relative path. It uses
// path.Join semantics via filepath with forward slashes normalized so callers
// get a stable, OS-independent scheme path; the builder converts to the OS
// separator at write time.
func join(elem ...string) string {
	return filepath.ToSlash(filepath.Join(elem...))
}
