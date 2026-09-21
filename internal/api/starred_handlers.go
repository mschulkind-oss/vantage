package api

import (
	"errors"
	"net/http"

	"github.com/mschulkind-oss/vantage/internal/starred"
)

// The bookmark endpoints.
//
// These are ScopeGlobal, unlike every other path-taking route here, because the
// store is keyed by the vantage invocation rather than by repository: in daemon
// mode one list spans every served repo and each entry carries its own repo
// name. A reader expecting ScopeRepo should read [starred.RootKey] before
// "fixing" it.
//
// Every mutation returns the full list at 200 and fires deps.StarredChanged, so
// other browsers reload — the same shape the review command endpoints use.
//
// There is deliberately no BuildStarred in responses.go: that file holds the
// pure builders shared with the static site exporter, and the exporter emits
// nothing for bookmarks (they are per-machine user state, and static mode
// coerces every request to GET). Ordering lives in starred.SortEntries, applied
// by the store, so the list and the mutation responses agree without a builder.

// starredResponse is the envelope every bookmark route answers with. The list
// is always present and never null, so a client can render it without a nil
// check.
type starredResponse struct {
	Entries []starred.Listed `json:"entries"`
}

// listed labels stored entries as the reader's own and orders them.
//
// Every route answers through this, so the mutation responses and the list agree
// about the shape without a builder. Promotion joins here later; until it does,
// every row is SourceUser.
func (h *Handlers) listed(entries []starred.Entry) []starred.Listed {
	own := starred.UserListed(entries)
	if h.deps.Promoted == nil {
		starred.SortListed(own)
		return own
	}
	// The reader's own rows first, so they win every collision: theirs is the
	// only row with an honest timestamp and the only one they can remove.
	return starred.MergeListed(own, h.deps.Promoted())
}

// starredOr503 recovers the bookmark store, writing a 503 when bookmarks are
// unavailable — the user config dir could not be resolved at startup, which the
// server logs and then carries on without. It mirrors repoOr400's shape.
func (h *Handlers) starredOr503(w http.ResponseWriter) (*starred.Store, bool) {
	if h.deps.Starred == nil {
		writeError(w, http.StatusServiceUnavailable, "Bookmarks are unavailable")
		return nil, false
	}
	return h.deps.Starred, true
}

// StarredList handles GET /starred.
func (h *Handlers) StarredList(w http.ResponseWriter, r *http.Request) {
	store, ok := h.starredOr503(w)
	if !ok {
		return
	}
	entries, err := store.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to read bookmarks")
		return
	}
	writeJSON(w, http.StatusOK, starredResponse{Entries: h.listed(entries)})
}

// starredAddRequest is the POST /starred body.
type starredAddRequest struct {
	Repo  string `json:"repo"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
}

// StarredAdd handles POST /starred. It is idempotent: starring something twice
// leaves one bookmark, and the second call still answers 200 with the list.
func (h *Handlers) StarredAdd(w http.ResponseWriter, r *http.Request) {
	store, ok := h.starredOr503(w)
	if !ok {
		return
	}
	var req starredAddRequest
	if !decodeBody(w, r, &req) {
		return
	}

	entries, err := store.Add(starred.Entry{Repo: req.Repo, Path: req.Path, IsDir: req.IsDir})
	if err != nil {
		writeStarredError(w, err)
		return
	}
	h.starredChanged()
	writeJSON(w, http.StatusOK, starredResponse{Entries: h.listed(entries)})
}

// StarredDelete handles DELETE /starred?repo=&path=. An absent repo and an
// empty one are both the single-repo sentinel, which needs no special case.
func (h *Handlers) StarredDelete(w http.ResponseWriter, r *http.Request) {
	store, ok := h.starredOr503(w)
	if !ok {
		return
	}
	// Not requirePath: that helper answers with the {"detail":…} envelope, which
	// is reserved for filesystem path validation. Bookmarks use the repo-wide
	// {"error":…} envelope.
	path := r.URL.Query().Get("path")
	if path == "" {
		writeError(w, http.StatusBadRequest, "Missing required query parameter: path")
		return
	}

	entries, removed, err := store.Remove(r.URL.Query().Get("repo"), path)
	if err != nil {
		writeStarredError(w, err)
		return
	}
	if !removed {
		writeError(w, http.StatusNotFound, "No bookmark found for that path")
		return
	}
	h.starredChanged()
	writeJSON(w, http.StatusOK, starredResponse{Entries: h.listed(entries)})
}

// starredChanged fires the live push, if one is wired. A nil hook (tests,
// static builds) silently skips it, the same contract ReviewChanged has.
func (h *Handlers) starredChanged() {
	if h.deps.StarredChanged != nil {
		h.deps.StarredChanged()
	}
}

// writeStarredError maps a store error onto a status. A shape rejection is the
// client's fault, a full list is a conflict, and anything else is ours.
func writeStarredError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, starred.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, starred.ErrTooMany):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "Failed to save bookmarks")
	}
}
