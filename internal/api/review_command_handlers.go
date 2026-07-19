package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/model"
	"github.com/mschulkind-oss/vantage/internal/review"
)

// This file holds the review command endpoints: small operations that replace
// whole-state PUTs. Every handler mutates through a [review.Store] command
// (atomic under the store's per-file lock), returns the full persisted
// [model.ReviewData] at HTTP 200, and fires deps.ReviewChanged on success so
// connected browsers reload. A malformed body is a 400; an unknown {id} is a
// 404; both use the {"error":…} envelope the frontend keys on by status code.

// currentDocContent reads the document's current content through the same read
// the /content endpoint uses. Any failure (missing, unreadable, binary)
// degrades to "" — block capture then records an empty text rather than
// failing the command.
func currentDocContent(svc RepoServices, path string) string {
	fc, err := BuildContent(svc.FS, path)
	if err != nil || fc == nil {
		return ""
	}
	return fc.Content
}

// reviewCommandTarget is the shared preamble of every command handler: the
// resolved repo services and the required path query parameter.
func (h *Handlers) reviewCommandTarget(w http.ResponseWriter, r *http.Request) (RepoServices, string, bool) {
	svc, ok := h.repoOr400(w, r)
	if !ok {
		return RepoServices{}, "", false
	}
	path, ok := requirePath(w, r)
	if !ok {
		return RepoServices{}, "", false
	}
	return svc, path, true
}

// writeCommandResult is the shared tail of every command handler: it maps the
// store command's outcome to its HTTP response and, on success, fires the
// review_changed broadcaster. Centralized so the status shapes cannot drift
// between endpoints.
func (h *Handlers) writeCommandResult(w http.ResponseWriter, repo, path string, data *model.ReviewData, err error) {
	switch {
	case errors.Is(err, review.ErrCommentNotFound):
		writeError(w, http.StatusNotFound, "No comment found")
	case errors.Is(err, review.ErrReviewNotFound):
		writeError(w, http.StatusNotFound, "No review found")
	case err != nil:
		slog.Error("api: review command failed", "path", path, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to update review")
	default:
		if h.deps.ReviewChanged != nil {
			h.deps.ReviewChanged(repo, path)
		}
		// A nil data (a response delivery with no review to land in) marshals to
		// the literal null, matching ReviewGet's absent shape.
		writeJSON(w, http.StatusOK, data)
	}
}

// decodeBody decodes the request body into v, reporting false (and writing the
// 400) on malformed JSON.
func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	defer func() { _ = r.Body.Close() }()
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return false
	}
	return true
}

// ReviewCommentCreate handles POST /review/comments (and the /r/{repo} form).
// The client supplies the id and created_at; the server captures the anchored
// block's current text so the comment records what the reviewer was looking
// at. The review file is created if absent.
func (h *Handlers) ReviewCommentCreate(w http.ResponseWriter, r *http.Request) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	// A dedicated request shape rather than model.ReviewComment: server-owned
	// fields (captured_block, reactions, resolved) must not be client-writable.
	var req struct {
		ID           string               `json:"id"`
		Comment      string               `json:"comment"`
		Anchor       *model.CommentAnchor `json:"anchor"`
		FallbackText string               `json:"fallback_text"`
		CreatedAt    float64              `json:"created_at"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.ID == "" || req.Comment == "" {
		writeError(w, http.StatusBadRequest, "Comment id and text are required")
		return
	}
	c := model.NewReviewComment(req.ID, req.Comment, req.CreatedAt)
	c.Anchor = req.Anchor
	c.FallbackText = req.FallbackText
	data, err := h.deps.Reviews.AddComment(path, svc.Repo, c, currentDocContent(svc, path))
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// ReviewCommentPatch handles PATCH /review/comments/{id}. Exactly one of two
// body shapes: {"comment":…} edits the text (stamping edited_at server-side);
// {"resolved":true|false} dismisses without a reaction / reopens. Both or
// neither present is a 400.
func (h *Handlers) ReviewCommentPatch(w http.ResponseWriter, r *http.Request) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		Comment  *string `json:"comment"`
		Resolved *bool   `json:"resolved"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if (req.Comment == nil) == (req.Resolved == nil) {
		writeError(w, http.StatusBadRequest, "Provide exactly one of comment or resolved")
		return
	}
	id := r.PathValue("id")
	var (
		data *model.ReviewData
		err  error
	)
	if req.Comment != nil {
		// The document is read before the store lock, exactly as the add and
		// reply handlers do: editing re-captures the anchored block.
		data, err = h.deps.Reviews.EditCommentText(path, svc.Repo, id, *req.Comment, currentDocContent(svc, path))
	} else {
		data, err = h.deps.Reviews.SetResolved(path, svc.Repo, id, *req.Resolved)
	}
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// ReviewCommentReply handles POST /review/comments/{id}/replies: a reviewer
// follow-up. The anchored block is re-captured from the current document.
func (h *Handlers) ReviewCommentReply(w http.ResponseWriter, r *http.Request) {
	h.replyCommand(w, r, false)
}

// ReviewCommentReopenReply handles POST /review/comments/{id}/reopen-reply:
// reopen plus follow-up, atomically.
func (h *Handlers) ReviewCommentReopenReply(w http.ResponseWriter, r *http.Request) {
	h.replyCommand(w, r, true)
}

func (h *Handlers) replyCommand(w http.ResponseWriter, r *http.Request, reopen bool) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Text == "" {
		writeError(w, http.StatusBadRequest, "Reply text is required")
		return
	}
	id := r.PathValue("id")
	doc := currentDocContent(svc, path)
	var (
		data *model.ReviewData
		err  error
	)
	if reopen {
		data, err = h.deps.Reviews.ReopenReply(path, svc.Repo, id, req.Text, doc)
	} else {
		data, err = h.deps.Reviews.Reply(path, svc.Repo, id, req.Text, doc)
	}
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// ReviewCommentAccept handles POST /review/comments/{id}/accept: the reviewer
// accepts the agent's response. The body carries nothing and is ignored.
func (h *Handlers) ReviewCommentAccept(w http.ResponseWriter, r *http.Request) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	data, err := h.deps.Reviews.Accept(path, svc.Repo, r.PathValue("id"))
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// ReviewCommentDelete handles DELETE /review/comments/{id}.
func (h *Handlers) ReviewCommentDelete(w http.ResponseWriter, r *http.Request) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	data, err := h.deps.Reviews.DeleteComment(path, svc.Repo, r.PathValue("id"))
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// ReviewDismissals handles POST /review/dismissals: a bulk resolve as one
// command, so no half-applied state is representable. {"scope":"all"} targets
// every unresolved comment; {"scope":"ids","ids":[…]} exactly the listed ones.
// No reactions are recorded — dismissal is not a conversation turn.
func (h *Handlers) ReviewDismissals(w http.ResponseWriter, r *http.Request) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		Scope string   `json:"scope"`
		IDs   []string `json:"ids"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	var (
		data *model.ReviewData
		err  error
	)
	switch req.Scope {
	case "all":
		data, err = h.deps.Reviews.DismissMany(path, svc.Repo, nil)
	case "ids":
		if len(req.IDs) == 0 {
			writeError(w, http.StatusBadRequest, "ids is required for scope \"ids\"")
			return
		}
		data, err = h.deps.Reviews.DismissMany(path, svc.Repo, req.IDs)
	default:
		writeError(w, http.StatusBadRequest, "scope must be \"all\" or \"ids\"")
		return
	}
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// ReviewResponses handles POST /review/responses — the paste-box door for
// agent responses. The text is parsed with the existing bullet grammar
// ("- [<short_id>] <summary>" lines); a text with no parseable bullet is a
// 400. The dedup nonce is derived server-side from the trimmed text, so a
// double-paste of the same block is a no-op; the entries of one paste share
// that nonce, which [review.Store.ApplyResponses] is built to tolerate.
func (h *Handlers) ReviewResponses(w http.ResponseWriter, r *http.Request) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	entries := review.ParseResponses(req.Text)
	if len(entries) == 0 {
		writeError(w, http.StatusBadRequest, "No response bullets found")
		return
	}
	sum := sha256.Sum256([]byte(strings.TrimSpace(req.Text)))
	nonce := hex.EncodeToString(sum[:])
	for i := range entries {
		entries[i].Nonce = nonce
	}
	// Bullets carry no round; ParseResponses already marks them RoundUnknown.
	data, applied, err := h.deps.Reviews.ApplyResponses(path, svc.Repo, entries, currentDocContent(svc, path))
	if err != nil || data == nil {
		// Absent review, or a real failure: the shared tail writes null-at-200
		// or the right error status. Either way nothing was applied, and the
		// zero count below would be a lie about a review that does not exist.
		h.writeCommandResult(w, svc.Repo, path, data, err)
		return
	}
	if h.deps.ReviewChanged != nil {
		h.deps.ReviewChanged(svc.Repo, path)
	}
	// The count is what tells the reviewer whether the paste landed. Bullets
	// naming comments this document does not have — a block pasted into the
	// wrong panel — parse fine and apply nothing, and reporting that as success
	// is exactly the silent swallow this protocol replaced.
	writeJSON(w, http.StatusOK, reviewResponsesResult{ReviewData: data, Applied: applied})
}

// reviewResponsesResult is a ReviewData with the applied-delivery count folded
// in, so the paste box can tell "recorded" from "matched nothing" without a
// second request. The embedded fields marshal inline, keeping the shape the
// client already adopts.
type reviewResponsesResult struct {
	*model.ReviewData
	Applied int `json:"applied"`
}
