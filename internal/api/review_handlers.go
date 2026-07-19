package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/mschulkind-oss/vantage/internal/model"
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

// ReviewPut handles PUT /review (and /r/{repo}/review). The body is a full
// [model.ReviewData]. This does NOT apply the changelog (that would
// double-record agent reactions the client already holds), but it is not a
// blind overwrite either: agent reactions the client's copy predates are
// preserved — see [review.Store.SaveFromClient]. A malformed body is a 400; a
// persistence failure is a 500. Success returns {"status":"ok"}.
func (h *Handlers) ReviewPut(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return
	}
	path, ok := requirePath(w, r)
	if !ok {
		return
	}
	defer func() { _ = r.Body.Close() }()

	var data model.ReviewData
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid review body")
		return
	}
	if err := h.deps.Reviews.SaveFromClient(path, svc.Repo, &data); err != nil {
		slog.Error("api: review save failed", "path", path, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to save review")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
