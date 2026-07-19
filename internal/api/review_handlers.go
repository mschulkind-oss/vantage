package api

import (
	"log/slog"
	"net/http"
)

// ReviewGet handles GET /review (and /r/{repo}/review). When a review exists it
// is returned verbatim at HTTP 200. When none exists it returns the literal
// JSON null at HTTP 200 — the frontend tolerates both null-at-200 and 404, and
// null-at-200 is the preferred shape. A store I/O error degrades to null rather
// than failing the request.
func (h *Handlers) ReviewGet(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path, ok := requirePath(w, r)
	if !ok {
		return
	}
	data, err := h.deps.Reviews.Get(path, svc.Repo)
	if err != nil {
		slog.Warn("api: review get failed; returning null", "path", path, "error", err)
		data = nil
	}
	// A nil *ReviewData marshals to the literal null the frontend expects.
	writeJSON(w, http.StatusOK, data)
}

// ReviewDelete handles DELETE /review (and /r/{repo}/review). When a review file
// was removed it returns {"status":"ok"} at HTTP 200. When there was nothing to
// delete it returns 404 with the {"error":"No review found"} envelope the
// frontend keys on by status code. A delete I/O error is a 500.
func (h *Handlers) ReviewDelete(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path, ok := requirePath(w, r)
	if !ok {
		return
	}
	deleted, err := h.deps.Reviews.Delete(path, svc.Repo)
	if err != nil {
		slog.Error("api: review delete failed", "path", path, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to delete review")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "No review found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
