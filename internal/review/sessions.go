package review

import (
	"errors"
	"slices"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// Server-held editing sessions and validated question binding:
// docs/design/planning-question-state.md §4 and §7. Every command here runs
// under the document's lock, like every other review command.

// ErrSessionNotFound is returned for a session the review does not hold under
// that comment, and for a write naming a session that is already closed (the
// closed-session barrier). Handlers map it to a 404, the only status legacy
// clients handle.
var ErrSessionNotFound = errors.New("review: session not found")

// ErrSessionConflict is returned when the session's root text was written by
// something other than the session. Handlers map it to a 409.
var ErrSessionConflict = errors.New("review: session has an external text edit")

// PreconditionError is a bind refused because the evidence it was made against
// no longer holds. Reason names the first precondition that failed. Handlers map
// it to a 409 carrying the reason.
type PreconditionError struct{ Reason string }

func (e *PreconditionError) Error() string { return "review: precondition failed: " + e.Reason }

// ErrQuestionBound is returned when a bind would replace the question id of a
// comment that already has one without allow_rebind. Handlers map it to a 409.
var ErrQuestionBound = errors.New("review: comment is already bound to a question")

// BindPreconditions are the evidence a bind is made against. All four must
// equal the server's state at the moment it takes the review's lock, reading the
// document itself then. They bind the client's view to the contents the server
// holds; that the id names exactly one question of those contents, and that the
// evidence is about that unit, is proven separately by the shared scanner
// ([proveQuestion]).
type BindPreconditions struct {
	BootID             string `json:"boot_id"`
	DocumentGeneration int64  `json:"document_generation"`
	MutationRevision   int64  `json:"mutation_revision"`
	ContentHash        string `json:"content_hash"`
}

// violation returns the first failing precondition's name, or "".
func (p BindPreconditions) violation(cur Evidence, revision int64) string {
	switch {
	case cur.ContentHash == "":
		return "document_unreadable"
	case p.BootID != cur.BootID:
		return "boot_id"
	case p.DocumentGeneration != cur.DocumentGeneration:
		return "document_generation"
	case p.ContentHash != cur.ContentHash:
		return "content_hash"
	case p.MutationRevision != revision:
		return "mutation_revision"
	}
	return ""
}

// BindRequest is bind-comment-question.
type BindRequest struct {
	CommentID     string
	QuestionID    string
	Evidence      *model.QuestionEvidence
	Preconditions BindPreconditions
	// AllowRebind lets the bind replace an existing question id: the explicit
	// attach path. Without it a bound comment is never rewritten.
	AllowRebind bool
	// Doc reads the document under the review's lock. Nil proves nothing, so
	// every bind is refused (scanner_unavailable or document_unreadable).
	Doc DocSource
}

// BindQuestion binds an existing comment to a question id, provided the
// preconditions hold against the document as read under the lock and the
// review's mutation revision, the scanner proves the id names exactly one
// question of that document and the given evidence is about that unit, and the
// comment is unbound (or AllowRebind is set). Binding a comment to the id it
// already has changes nothing. The stored evidence carries the unit fingerprint
// the server computed.
func (s *Store) BindQuestion(filePath, repo string, req BindRequest) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, ErrCommentNotFound
	}
	c := commentByID(data.Comments, req.CommentID)
	if c == nil || slices.Contains(data.DeletedIDs, req.CommentID) {
		return nil, ErrCommentNotFound
	}
	doc := observeFrom(req.Doc)
	if reason := req.Preconditions.violation(doc.Evidence, data.MutationRevision); reason != "" {
		return nil, &PreconditionError{Reason: reason}
	}
	proven, reason := proveQuestion(doc, req.QuestionID, req.Evidence)
	if reason != "" {
		return nil, &PreconditionError{Reason: reason}
	}
	if c.QuestionID != "" {
		if c.QuestionID == req.QuestionID {
			return data, nil
		}
		if !req.AllowRebind {
			return nil, ErrQuestionBound
		}
	}
	c.QuestionID = req.QuestionID
	c.QuestionEvidence = proven
	bindOwnership(c, doc)
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	return data, nil
}

// SessionAck is what a session command answers besides the review.
type SessionAck struct {
	SessionID string `json:"session_id"`
	CommentID string `json:"comment_id"`
	State     string `json:"state"`
	Outcome   string `json:"outcome,omitempty"`
	// Baseline is the server's snapshot, present while the session is open.
	Baseline *model.SessionBaseline `json:"baseline,omitempty"`
	// RootTextVersion is the root's version on the server now ("" when the root
	// does not exist or has none).
	RootTextVersion string `json:"root_text_version"`
	// Stale (begin only) is true when the version the client showed differs
	// from RootTextVersion: the box must show the server text.
	Stale bool `json:"stale,omitempty"`
	// Comment is the newest state of the root, absent when there is none.
	Comment *model.ReviewComment `json:"comment,omitempty"`
}

func sessionByID(data *model.ReviewData, id string) *model.CommentSession {
	for i := range data.Sessions {
		if data.Sessions[i].ID == id {
			return &data.Sessions[i]
		}
	}
	return nil
}

func ack(data *model.ReviewData, sess *model.CommentSession) *SessionAck {
	a := &SessionAck{
		SessionID: sess.ID,
		CommentID: sess.CommentID,
		State:     sess.State,
		Outcome:   sess.Outcome,
		Baseline:  sess.Baseline,
	}
	if c := commentByID(data.Comments, sess.CommentID); c != nil && !slices.Contains(data.DeletedIDs, sess.CommentID) {
		a.RootTextVersion = c.RootTextVersion
		cc := *c
		a.Comment = &cc
	}
	return a
}

// BeginSession opens the editing session sessionID on commentID, snapshotting
// the baseline on the server. A comment that does not exist yet is a new
// answer: the baseline records that it did not exist. Replaying a session id
// returns the original baseline (or the closed outcome) and never snapshots
// again. shownVersion is the root_text_version the client was showing.
func (s *Store) BeginSession(filePath, repo, commentID, sessionID, shownVersion string) (*model.ReviewData, *SessionAck, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, nil, err
	}
	if data == nil {
		data = model.NewReviewData(filePath)
	}
	if sess := sessionByID(data, sessionID); sess != nil {
		if sess.CommentID != commentID {
			return nil, nil, ErrSessionNotFound
		}
		a := ack(data, sess)
		a.Stale = a.Comment != nil && shownVersion != a.RootTextVersion
		return data, a, nil
	}
	if slices.Contains(data.DeletedIDs, commentID) {
		return nil, nil, ErrCommentNotFound
	}
	sess := model.CommentSession{ID: sessionID, CommentID: commentID, State: model.SessionOpen}
	if c := commentByID(data.Comments, commentID); c != nil {
		b := &model.SessionBaseline{
			Text:            c.Comment,
			CapturedBlock:   c.CapturedBlock,
			RootTextVersion: c.RootTextVersion,
			EditedAt:        c.EditedAt,
			Ownership:       c.Ownership,
			OwnershipReason: c.OwnershipReason,
			ReactionCount:   len(c.Reactions),
		}
		for i, r := range c.Reactions {
			if r.ID != "" {
				b.ReplyIDs = append(b.ReplyIDs, r.ID)
			}
			if c.RootTextVersion != "" && r.RootTextVersion == c.RootTextVersion {
				b.BaselineVersionReactions = append(b.BaselineVersionReactions, i)
			}
		}
		sess.Baseline = b
	} else {
		sess.Baseline = &model.SessionBaseline{DidNotExist: true}
	}
	data.Sessions = append(data.Sessions, sess)
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, nil, err
	}
	a := ack(data, &data.Sessions[len(data.Sessions)-1])
	a.Stale = a.Comment != nil && shownVersion != a.RootTextVersion
	return data, a, nil
}

// FinishSession closes the open session with outcome kept. Finishing a closed
// session changes nothing and reports its stored outcome. It never creates a
// root: finishing a session whose root was deleted is [ErrCommentNotFound].
func (s *Store) FinishSession(filePath, repo, commentID, sessionID string) (*model.ReviewData, *SessionAck, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, nil, err
	}
	if data == nil {
		return nil, nil, ErrSessionNotFound
	}
	sess := sessionByID(data, sessionID)
	if sess == nil || sess.CommentID != commentID {
		return nil, nil, ErrSessionNotFound
	}
	if sess.State == model.SessionClosed {
		return data, ack(data, sess), nil
	}
	if slices.Contains(data.DeletedIDs, commentID) {
		return nil, nil, ErrCommentNotFound
	}
	closeSession(sess, model.SessionKept)
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, nil, err
	}
	return data, ack(data, sess), nil
}

// RestoreSession undoes everything the session did to the root, per
// planning-question-state.md §7, in this order:
//
//  1. a closed session replays its stored outcome;
//  2. an unknown session, or a root deleted elsewhere, is not found;
//  3. an external text edit is [ErrSessionConflict] and writes nothing;
//  4. a root created in the session is deleted with its replies and its id
//     recorded in deleted_ids;
//  5. an existing root gets its baseline text, captured block and text version
//     back with a larger mutation counter; replies, reactions, the resolved flag
//     and everything else are untouched.
func (s *Store) RestoreSession(filePath, repo, commentID, sessionID string) (*model.ReviewData, *SessionAck, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, nil, err
	}
	if data == nil {
		return nil, nil, ErrSessionNotFound
	}
	sess := sessionByID(data, sessionID)
	if sess != nil && sess.CommentID == commentID && sess.State == model.SessionClosed {
		return data, ack(data, sess), nil
	}
	if sess == nil || sess.CommentID != commentID {
		return nil, nil, ErrSessionNotFound
	}
	if slices.Contains(data.DeletedIDs, commentID) {
		return nil, nil, ErrCommentNotFound
	}
	if sess.ExternalTextEdit {
		return nil, nil, ErrSessionConflict
	}
	base := sess.Baseline
	if base.DidNotExist {
		if c := commentByID(data.Comments, commentID); c != nil {
			for _, r := range c.Reactions {
				if r.ID != "" && !slices.Contains(data.DeletedIDs, r.ID) {
					data.DeletedIDs = append(data.DeletedIDs, r.ID)
				}
			}
		}
		data.Comments = slices.DeleteFunc(data.Comments, func(c model.ReviewComment) bool { return c.ID == commentID })
		data.DeletedIDs = append(data.DeletedIDs, commentID)
		closeSession(sess, model.SessionDiscarded)
	} else {
		c := commentByID(data.Comments, commentID)
		if c == nil {
			return nil, nil, ErrCommentNotFound
		}
		c.Comment = base.Text
		c.CapturedBlock = base.CapturedBlock
		c.RootTextVersion = base.RootTextVersion
		c.EditedAt = base.EditedAt
		c.Ownership, c.OwnershipReason = base.Ownership, base.OwnershipReason
		c.MutationCounter++
		closeSession(sess, model.SessionRestored)
	}
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, nil, err
	}
	return data, ack(data, sess), nil
}

// closeSession keeps only the id, comment and outcome.
func closeSession(sess *model.CommentSession, outcome string) {
	sess.State = model.SessionClosed
	sess.Outcome = outcome
	sess.Baseline = nil
	sess.ExternalTextEdit = false
}

// checkSessionWrite vets a root text write: no session is always allowed (the
// write then marks open sessions external); a named session must be open for
// this comment — otherwise [ErrSessionNotFound] — and unconflicted — otherwise
// [ErrSessionConflict].
func checkSessionWrite(data *model.ReviewData, commentID, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	sess := sessionByID(data, sessionID)
	if sess == nil || sess.CommentID != commentID || sess.State != model.SessionOpen {
		return ErrSessionNotFound
	}
	if sess.ExternalTextEdit {
		return ErrSessionConflict
	}
	return nil
}

// markOtherSessionsExternal flags every open session of the comment other than
// sessionID: a text write attributed to anyone else is an external edit to it.
func markOtherSessionsExternal(data *model.ReviewData, commentID, sessionID string) {
	for i := range data.Sessions {
		s := &data.Sessions[i]
		if s.CommentID == commentID && s.State == model.SessionOpen && s.ID != sessionID {
			s.ExternalTextEdit = true
		}
	}
}

// refreshReplyCoverage recomputes the comment's derived reply coverage from its
// agent reactions: for each, whether the root version it echoed is the current
// one, another, or absent.
func refreshReplyCoverage(c *model.ReviewComment) {
	c.ReplyCoverage = nil
	for i, r := range c.Reactions {
		if r.Actor != "agent" {
			continue
		}
		cov := model.ReplyCoverage{ReactionIndex: i, RootTextVersion: r.RootTextVersion, Covers: "unknown"}
		switch {
		case r.RootTextVersion == "" || c.RootTextVersion == "":
		case r.RootTextVersion == c.RootTextVersion:
			cov.Covers = "current"
		default:
			cov.Covers = "other"
		}
		c.ReplyCoverage = append(c.ReplyCoverage, cov)
	}
}
