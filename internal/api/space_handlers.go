package api

import (
	"net/http"

	"github.com/mschulkind-oss/vantage/internal/spaceid"
)

// spaceAnswer is GET /spaces/{id}'s body. Repo is the served project whose
// .vantage/space holds the id: its name in multi-project mode, "" (the
// single-repo sentinel every repo-keyed answer uses) in single-project mode,
// and null when no project this server serves holds it.
type spaceAnswer struct {
	Repo *string `json:"repo"`
}

// Space handles GET /spaces/{id}: which project this server serves holds the
// space id {id}, the random id a checkout keeps in its .vantage/space and a
// planning link carries as `space=` (see [spaceid]). The planning page asks it
// when a link with no project segment names a space, so a Vantage serving many
// projects opens the right one without a chooser. Reference:
// docs/reference/planning-index.md §13.6.
//
// An {id} that is not 16 characters of lowercase base32 is refused with a 400
// before any file is looked at. Otherwise the answer is a 200 whether or not a
// project holds it, since "none here" is an answer the page acts on rather than
// a failure: `{"repo": "<name>"}`, `{"repo": ""}` for the one project of a
// single-project server, or `{"repo": null}`. It is sent `no-store`, because
// the answer changes the moment a checker makes the file. The handler parses no
// Markdown and writes nothing.
//
// Global, not repo-scoped: the question is which repository, so no repository
// can be resolved before it is answered. The server answers it through
// [Deps.SpaceRepo], since it knows every root it serves; a nil hook holds no
// space, as a server serving nothing would.
func (h *Handlers) Space(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !spaceid.Valid(id) {
		writeError(w, http.StatusBadRequest, "Not a space id")
		return
	}
	answer := spaceAnswer{}
	if h.deps.SpaceRepo != nil {
		if repo, ok := h.deps.SpaceRepo(id); ok {
			answer.Repo = &repo
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, answer)
}
