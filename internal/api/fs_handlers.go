package api

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/fs"
)

// imageExtensions are the file suffixes the /content endpoint serves as raw
// image bytes (the <img> branch of its dual mode) rather than as JSON
// FileContent (the axios branch). The frontend's markdown renderer points
// <img src> at /content for relative images, while axios fetches text files; the
// two never overlap, so branching on the requested path's extension is exact.
var imageExtensions = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".bmp":  "image/bmp",
	".ico":  "image/x-icon",
	".avif": "image/avif",
}

// fsOptions builds the per-call [fs.Options] for a tree request from its query
// parameters. include_git defaults false; show_hidden and show_gitignored
// default true (matching the frontend, which requests everything and filters
// client-side).
func fsOptions(r *http.Request) fs.Options {
	return fs.Options{
		IncludeGit:     queryBool(r, "include_git", false),
		ShowHidden:     queryBool(r, "show_hidden", true),
		ShowGitignored: queryBool(r, "show_gitignored", true),
	}
}

// writePathError maps a filesystem error to its HTTP response. A *fs.PathError
// (validation failure) becomes a 400 with a {"detail":…} envelope the frontend
// reads; any other error becomes a 400 with its message. It reports whether it
// wrote a response.
func writePathError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	var pe *fs.PathError
	if errors.As(err, &pe) {
		writeDetail(w, http.StatusBadRequest, pe.Detail)
		return true
	}
	writeDetail(w, http.StatusBadRequest, err.Error())
	return true
}

// Health handles GET /health. It is a repo-agnostic liveness probe with no
// consumer beyond uptime checks.
func (h *Handlers) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Tree handles GET /tree (and /r/{repo}/tree). path defaults to ".". A
// validation error returns a 400 {"detail":…}; a permission error degrades to
// an empty listing at HTTP 200.
func (h *Handlers) Tree(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "."
	}
	nodes, err := BuildTree(svc.FS, path, fsOptions(r))
	if writePathError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

// Content handles GET /content (and /r/{repo}/content) in dual mode. When the
// requested path has an image extension, the raw file bytes are streamed with
// the matching image content type (the <img> branch). Otherwise the file is
// returned as a JSON [model.FileContent] (the axios branch). A validation error
// or a non-file path returns a 400 {"detail":…}.
func (h *Handlers) Content(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path, ok := requirePath(w, r)
	if !ok {
		return
	}

	if mime, isImage := imageExtensions[strings.ToLower(filepath.Ext(path))]; isImage {
		h.serveRawImage(w, svc.FS, path, mime)
		return
	}

	content, err := BuildContent(svc.FS, path)
	if writePathError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, content)
}

// serveRawImage streams an image file's bytes with the given content type. The
// requested path is validated and resolved against the repository root with the
// same rules the fs service enforces (no NUL, no absolute paths, no ".git"
// segment, no traversal above the root), since the fs service exposes only its
// root and not its internal validator. Validation failures map to a 400
// {"detail":…}; a non-file or unreadable path after validation is a 404.
func (h *Handlers) serveRawImage(w http.ResponseWriter, svc *fs.FileSystemService, path, mime string) {
	abs, err := resolveImagePath(svc.RootPath(), path)
	if writePathError(w, err) {
		return
	}
	info, err := os.Stat(abs)
	if err != nil || !info.Mode().IsRegular() {
		writeError(w, http.StatusNotFound, "Not a file")
		return
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		writeError(w, http.StatusNotFound, "Not a file")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write(data); werr != nil {
		slog.Debug("api: failed to write image body", "path", path, "error", werr)
	}
}

// resolveImagePath validates path against root and returns the cleaned absolute
// file path. It mirrors the fs service's validatePath: it rejects empty paths,
// NUL bytes, absolute paths, any ".git" segment, and any path that resolves
// outside root, returning a *fs.PathError (→ 400 {"detail":…}) in each case.
func resolveImagePath(root, path string) (string, error) {
	if path == "" || strings.ContainsRune(path, '\x00') {
		return "", &fs.PathError{Detail: "Invalid path"}
	}
	if strings.HasPrefix(path, "/") {
		return "", &fs.PathError{Detail: "Absolute paths not allowed"}
	}
	normalized := strings.ReplaceAll(path, "\\", "/")
	for _, part := range strings.Split(normalized, "/") {
		if part == ".git" {
			return "", &fs.PathError{Detail: "Access to .git directory is not allowed"}
		}
	}
	full := filepath.Clean(filepath.Join(root, normalized))
	rel, err := filepath.Rel(root, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", &fs.PathError{Detail: "Path traversal detected"}
	}
	return full, nil
}

// Files handles GET /files (and /r/{repo}/files): every Markdown file in the
// repository as repo-relative slash-separated paths.
func (h *Handlers) Files(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, BuildFilesAll(svc.FS))
}

// Repos handles GET /repos. In single-repo mode it returns exactly the sentinel
// [{"name":""}] the frontend uses for mode detection. In multi-repo mode the
// server overrides this handler with its repo-activity-aware version, so this
// implementation only needs to be correct for single-repo deployments.
func (h *Handlers) Repos(w http.ResponseWriter, _ *http.Request) {
	if h.deps.Config != nil && h.deps.Config.MultiRepo {
		// Defensive: the server is expected to mount its own /repos in daemon
		// mode. If it did not, returning the sentinel would mis-signal
		// single-repo mode, so respond with an empty list instead of a wrong
		// sentinel. The server's handler is the real contract here.
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, BuildReposList())
}

// FilesAll handles GET /files/all. In single-repo mode it returns the repository
// files tagged with the empty repo name. Multi-repo fan-out is the server's
// responsibility (it has all the repos' services); the server overrides this
// handler in daemon mode.
func (h *Handlers) FilesAll(w http.ResponseWriter, r *http.Request) {
	svc, ok := RepoServicesFromContext(r.Context())
	if !ok {
		// No single-repo services in context (daemon mode without the server's
		// override): an empty list is the safe, contract-valid response.
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, BuildFilesAllScoped(svc.FS, svc.Repo))
}

// RecentAll handles GET /recent/all. In single-repo mode it returns the
// repository's recent files tagged with the empty repo name. Multi-repo fan-out
// and the cross-repo re-sort are the server's responsibility; the server
// overrides this handler in daemon mode.
func (h *Handlers) RecentAll(w http.ResponseWriter, r *http.Request) {
	svc, ok := RepoServicesFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	limit := queryInt(r, "limit", RecentDefaultLimit)
	showHidden := queryBool(r, "show_hidden", true)
	showGitignored := queryBool(r, "show_gitignored", true)
	writeJSON(w, http.StatusOK, BuildRecentAll(svc.Git, svc.Repo, limit, showHidden, showGitignored))
}
