package api

import (
	"net/http"

	"github.com/mschulkind-oss/vantage/internal/git"
)

// repoOr400 recovers the request's [RepoServices] or, when absent (multi-repo
// mode reached without a resolved {repo}), writes a 400 {"error":…} and reports
// false. Every repo-scoped handler begins with this guard.
func (h *Handlers) repoOr400(w http.ResponseWriter, r *http.Request) (RepoServices, bool) {
	svc, ok := RepoServicesFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusBadRequest, "Repository name is required in multi-repo mode")
		return RepoServices{}, false
	}
	return svc, true
}

// requirePath reads the required "path" query parameter, writing a 400
// {"detail":…} and reporting false when it is missing. The detail envelope is
// used because a missing path is a request-validation error the frontend may
// surface, consistent with the fs validation 400s.
func requirePath(w http.ResponseWriter, r *http.Request) (string, bool) {
	path := r.URL.Query().Get("path")
	if path == "" {
		writeDetail(w, http.StatusBadRequest, "Missing required query parameter: path")
		return "", false
	}
	return path, true
}

// GitHistory handles GET /git/history (and /r/{repo}/git/history). It returns up
// to [HistoryLimit] commits touching the path, newest first. Git errors degrade
// to an empty list at HTTP 200 — the frontend treats [] as "no history".
func (h *Handlers) GitHistory(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path, ok := requirePath(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, BuildHistory(svc.Git, path))
}

// GitStatus handles GET /git/status (and /r/{repo}/git/status). It returns the
// file's last commit (or null) and working-tree status enum (or null). Git
// errors degrade to nulls at HTTP 200.
func (h *Handlers) GitStatus(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path, ok := requirePath(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, BuildStatus(svc.Git, path))
}

// GitDiff handles GET /git/diff (and /r/{repo}/git/diff). The commit parameter
// is validated against ^[0-9a-fA-F]{4,40}$: a bad shape is a 400. A commit that
// does not touch the file (nil diff) is a 404. Otherwise the parsed diff is
// returned at HTTP 200.
func (h *Handlers) GitDiff(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path, ok := requirePath(w, r)
	if !ok {
		return
	}
	commit := r.URL.Query().Get("commit")
	if !git.ValidateSHA(commit) {
		writeError(w, http.StatusBadRequest, "Invalid commit SHA")
		return
	}
	diff, err := BuildDiff(svc.Git, path, commit)
	if err != nil || diff == nil {
		writeError(w, http.StatusNotFound, "Could not generate diff")
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

// GitWorkingDiff handles GET /git/diff/working (and the multi variant). A file
// with no uncommitted changes (nil diff) is a 404; otherwise the working diff
// with its "working" sentinel metadata is returned at HTTP 200.
func (h *Handlers) GitWorkingDiff(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path, ok := requirePath(w, r)
	if !ok {
		return
	}
	diff, err := BuildWorkingDiff(svc.Git, path)
	if err != nil || diff == nil {
		writeError(w, http.StatusNotFound, "No uncommitted changes for this file")
		return
	}
	writeJSON(w, http.StatusOK, diff)
}

// GitRecent handles GET /git/recent (and the multi variant). The limit defaults
// to [RecentDefaultLimit] and is clamped to [1,1000]; show_hidden and
// show_gitignored default to true. Git errors degrade to whatever could be
// gathered.
func (h *Handlers) GitRecent(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	limit := queryInt(r, "limit", RecentDefaultLimit)
	showHidden := queryBool(r, "show_hidden", true)
	showGitignored := queryBool(r, "show_gitignored", true)
	writeJSON(w, http.StatusOK, BuildRecent(svc.Git, limit, showHidden, showGitignored))
}

// Version handles GET /version (and /r/{repo}/version). It returns the short
// HEAD SHA (or "unknown") and the working-tree dirty flag.
func (h *Handlers) Version(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, BuildVersion(svc.Git))
}

// Info handles GET /info (and /r/{repo}/info). It returns the repository's
// display name and absolute root path.
func (h *Handlers) Info(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, BuildInfo(svc.Git, svc.FS))
}
