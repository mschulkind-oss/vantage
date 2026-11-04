package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

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
	case errors.Is(err, review.ErrReplyNotFound):
		writeError(w, http.StatusNotFound, "No reply found")
	case errors.Is(err, review.ErrReviewNotFound):
		writeError(w, http.StatusNotFound, "No review found")
	case errors.Is(err, review.ErrSessionNotFound):
		writeError(w, http.StatusNotFound, "No session found")
	case errors.Is(err, review.ErrSessionConflict):
		writeConflict(w, "Changed outside this session", "external_text_edit")
	case errors.Is(err, review.ErrQuestionBound):
		writeConflict(w, "The comment is already bound to a question", "already_bound")
	case isPrecondition(err):
		writeConflict(w, "The evidence is out of date", err.(*review.PreconditionError).Reason)
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

func isPrecondition(err error) bool {
	var p *review.PreconditionError
	return errors.As(err, &p)
}

// writeConflict answers 409 with the {"error":…} envelope plus a machine
// readable "reason".
func writeConflict(w http.ResponseWriter, message, reason string) {
	writeJSON(w, http.StatusConflict, map[string]string{"error": message, "reason": reason})
}

// documentEvidence reads the document the server holds, observes its content
// hash (bumping the document generation when it changed) and returns the
// evidence. An unreadable or binary document has the empty hash.
func (h *Handlers) documentEvidence(svc RepoServices, path string) review.Evidence {
	return h.docs.Source(svc, path)().Evidence
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
// at. The review file is created if absent. A create naming a comment the
// review already holds edits that comment's text instead, so a retried create
// cannot duplicate it ([review.Store.AddComment]).
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
		QuestionID   string               `json:"question_id"`
		CreatedAt    float64              `json:"created_at"`
		// SessionID, QuestionEvidence and Preconditions are optional; see
		// review.CreateOptions.
		SessionID        string                    `json:"session_id"`
		QuestionEvidence *model.QuestionEvidence   `json:"question_evidence"`
		Preconditions    *review.BindPreconditions `json:"preconditions"`
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
	c.QuestionID = req.QuestionID
	c.QuestionEvidence = req.QuestionEvidence
	opts := review.CreateOptions{SessionID: req.SessionID, Preconditions: req.Preconditions, Doc: h.docs.Source(svc, path)}
	data, err := h.deps.Reviews.AddCommentWith(path, svc.Repo, c, currentDocContent(svc, path), opts)
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
		Comment   *string `json:"comment"`
		Resolved  *bool   `json:"resolved"`
		SessionID string  `json:"session_id"`
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
		data, err = h.deps.Reviews.EditCommentTextFrom(path, svc.Repo, id, *req.Comment, h.docs.Source(svc, path), req.SessionID)
	} else {
		data, err = h.deps.Reviews.SetResolved(path, svc.Repo, id, *req.Resolved)
	}
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// ReviewCommentReply handles POST /review/comments/{id}/replies: a reviewer
// follow-up. The anchored block is re-captured from the current document. The
// body is {"text":…}, with an optional "id" the client chose for the reply: a
// reply whose id the comment already holds edits that reply's text instead of
// adding another, so a retried reply cannot duplicate it.
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
		ID   string `json:"id"`
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
	data, err := h.deps.Reviews.ReplyFrom(path, svc.Repo, id, req.ID, req.Text, h.docs.Source(svc, path), reopen)
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// ReviewReplyPatch handles PATCH /review/comments/{id}/replies/{reply}: it
// rewrites the text of the reviewer's reply {reply} on comment {id}, which a
// comment box does as the reviewer goes on typing it
// ([review.Store.EditReply]). The body is {"text":…}, and empty text is a 400.
// An unknown comment or reply is a 404.
func (h *Handlers) ReviewReplyPatch(w http.ResponseWriter, r *http.Request) {
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
	data, err := h.deps.Reviews.EditReplyFrom(path, svc.Repo, r.PathValue("id"), r.PathValue("reply"), req.Text, h.docs.Source(svc, path))
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

// ReviewMove handles POST /review/move (and the /r/{repo} form): the document
// at `path` is at the body's `to` now, because a directory it was in was
// renamed and the viewer followed it there, so its review is filed under `to`
// ([review.Store.Move]). It answers with the review filed under `to`, or null
// when there is none.
//
// Refused with a 409 while a file is still at `path`: a review follows its
// document, and a request that arrives after the folder has come back, or one
// from a viewer that followed the wrong way, must not carry the review off.
// Whether `to` exists is not asked, because a folder renamed twice in quick
// succession has already moved on from the first new name by the time the
// viewer asks, and the second request carries the review on from there.
func (h *Handlers) ReviewMove(w http.ResponseWriter, r *http.Request) {
	svc, from, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		To string `json:"to"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.To == "" || req.To == from {
		writeError(w, http.StatusBadRequest, "to is required, and must differ from path")
		return
	}
	for _, p := range []string{from, req.To} {
		if _, _, err := svc.FS.ResolveFile(p); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid path")
			return
		}
	}
	if _, there, _ := svc.FS.ResolveFile(from); there {
		writeError(w, http.StatusConflict, "The document is still at path")
		return
	}
	data, moved, err := h.deps.Reviews.Move(from, req.To, svc.Repo)
	if err != nil {
		slog.Error("api: review move failed", "from", from, "to", req.To, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to move review")
		return
	}
	if moved && h.deps.ReviewChanged != nil {
		h.deps.ReviewChanged(svc.Repo, from)
		h.deps.ReviewChanged(svc.Repo, req.To)
	}
	writeJSON(w, http.StatusOK, data)
}

// sessionResponse is what the session commands answer: the session's receipt
// and the persisted review.
type sessionResponse struct {
	Session *review.SessionAck `json:"session"`
	Review  *model.ReviewData  `json:"review"`
}

// sessionCommand is the shared body of the three session endpoints. Each takes
// {"comment_id","session_id"} (begin adds "shown_root_version") and answers
// {"session":…,"review":…}.
func (h *Handlers) sessionCommand(w http.ResponseWriter, r *http.Request,
	run func(path, repo string, commentID, sessionID, shown string) (*model.ReviewData, *review.SessionAck, error)) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		CommentID        string `json:"comment_id"`
		SessionID        string `json:"session_id"`
		ShownRootVersion string `json:"shown_root_version"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.CommentID == "" || req.SessionID == "" {
		writeError(w, http.StatusBadRequest, "comment_id and session_id are required")
		return
	}
	data, a, err := run(path, svc.Repo, req.CommentID, req.SessionID, req.ShownRootVersion)
	if err != nil {
		h.writeCommandResult(w, svc.Repo, path, nil, err)
		return
	}
	if h.deps.ReviewChanged != nil {
		h.deps.ReviewChanged(svc.Repo, path)
	}
	writeJSON(w, http.StatusOK, sessionResponse{Session: a, Review: data})
}

// ReviewSessionBegin handles POST /review/begin-comment-session.
func (h *Handlers) ReviewSessionBegin(w http.ResponseWriter, r *http.Request) {
	h.sessionCommand(w, r, h.deps.Reviews.BeginSession)
}

// ReviewSessionFinish handles POST /review/finish-comment-session.
func (h *Handlers) ReviewSessionFinish(w http.ResponseWriter, r *http.Request) {
	h.sessionCommand(w, r, func(path, repo, commentID, sessionID, _ string) (*model.ReviewData, *review.SessionAck, error) {
		return h.deps.Reviews.FinishSession(path, repo, commentID, sessionID)
	})
}

// ReviewSessionRestore handles POST /review/restore-comment-session.
func (h *Handlers) ReviewSessionRestore(w http.ResponseWriter, r *http.Request) {
	h.sessionCommand(w, r, func(path, repo, commentID, sessionID, _ string) (*model.ReviewData, *review.SessionAck, error) {
		return h.deps.Reviews.RestoreSession(path, repo, commentID, sessionID)
	})
}

// ReviewBindQuestion handles POST /review/bind-comment-question: bind (or, with
// allow_rebind, attach) a comment to a question id against preconditions on the
// server's current state. A refused bind is a 409 with a "reason".
func (h *Handlers) ReviewBindQuestion(w http.ResponseWriter, r *http.Request) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		CommentID     string                   `json:"comment_id"`
		QuestionID    string                   `json:"question_id"`
		Evidence      *model.QuestionEvidence  `json:"evidence"`
		Preconditions review.BindPreconditions `json:"preconditions"`
		AllowRebind   bool                     `json:"allow_rebind"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	if req.CommentID == "" || req.QuestionID == "" {
		writeError(w, http.StatusBadRequest, "comment_id and question_id are required")
		return
	}
	data, err := h.deps.Reviews.BindQuestion(path, svc.Repo, review.BindRequest{
		CommentID: req.CommentID, QuestionID: req.QuestionID, Evidence: req.Evidence,
		Preconditions: req.Preconditions, AllowRebind: req.AllowRebind,
		Doc: h.docs.Source(svc, path),
	})
	h.writeCommandResult(w, svc.Repo, path, data, err)
}

// reviewEvidenceResponse is GET /review/evidence.
type reviewEvidenceResponse struct {
	review.Evidence
	MutationRevision int64 `json:"mutation_revision"`
}

// ReviewEvidence handles GET /review/evidence: the server boot id, the
// document's generation and content hash, and the review's mutation revision
// (0 when there is no review) — the coherent pair a bind is preconditioned on.
func (h *Handlers) ReviewEvidence(w http.ResponseWriter, r *http.Request) {
	svc, path, ok := h.reviewCommandTarget(w, r)
	if !ok {
		return
	}
	ev, revision, err := h.deps.Reviews.ObserveWithRevision(path, svc.Repo, h.docs.Source(svc, path))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not read the review")
		return
	}
	resp := reviewEvidenceResponse{Evidence: ev, MutationRevision: revision}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, resp)
}
