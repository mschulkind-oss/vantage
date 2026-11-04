package review

import (
	"errors"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// ErrCommentNotFound is returned by comment-scoped commands when the target
// comment (or the whole review) does not exist. Handlers map it to a 404.
var ErrCommentNotFound = errors.New("review: comment not found")

// ErrReviewNotFound is returned by review-scoped commands (bulk dismissals)
// when no review exists for the document. Handlers map it to a 404.
var ErrReviewNotFound = errors.New("review: no review found")

// maxNonces caps ReviewData.Nonces so client-supplied deliveries cannot grow
// server state unboundedly. Oldest entries are dropped first.
const maxNonces = 200

// ResponseEntry is one parsed agent response: a comment short id, the summary
// to record, the delivery's dedup nonce, and the thread round it answers.
//
// Round is the comment's reaction count as of the payload the agent read, or
// [RoundUnknown] when the delivery did not name one (any inbox line written
// without the field). It is a plain int rather than a pointer because
// [Store.ApplyResponses] uses ResponseEntry as a map key to collapse
// byte-identical entries within a batch — two pointers to equal ints are not
// equal, so a pointer here would silently defeat that.
type ResponseEntry struct {
	ShortID string
	Summary string
	Nonce   string
	Round   int
	// RootVersion is the root_text_version the delivery echoed, "" when it
	// named none (coverage unknown).
	RootVersion string
}

// RoundUnknown marks a delivery that carries no round. Reactions recorded from
// one omit answers_round, which is exactly the pre-round behavior: the reader
// falls back to treating the newest agent reaction as answering the newest
// reviewer turn.
const RoundUnknown = -1

// ErrReplyNotFound is returned when a reply edit names a reply the comment
// does not hold, or one that is not the reviewer's. Handlers map it to a 404.
var ErrReplyNotFound = errors.New("review: reply not found")

// CreateOptions are the optional parts of a create that legacy callers do not
// send.
type CreateOptions struct {
	// SessionID names the editing session this write belongs to ("" for none).
	SessionID string
	// Preconditions, when non-nil, must also hold against the observation (boot,
	// generation, content hash; the mutation revision is ignored on create) for
	// the comment's QuestionID to count.
	// Whatever they are, a QuestionID counts only when the scanner proves it
	// names exactly one question of the document and the evidence is about that
	// unit ([proveQuestion]); otherwise the comment is stored unbound. A create
	// with a bare question_id is therefore bound only on that proof, and stores
	// the server's own evidence for it.
	Preconditions *BindPreconditions
	// Doc reads the document under the review's lock, so the text, its evidence
	// and the scanner's units are one coherent reading with the review. Nil
	// means the docContent argument, which proves no question ownership.
	Doc DocSource
}

// AddComment is [Store.AddCommentWith] without options: a legacy create.
func (s *Store) AddComment(filePath, repo string, c model.ReviewComment, docContent string) (*model.ReviewData, error) {
	return s.AddCommentWith(filePath, repo, c, docContent, CreateOptions{})
}

// AddCommentWith appends c to the review for filePath in repo, creating the review
// if absent. The anchored block's current text is captured from docContent so a
// later agent response has an honest "before" even across restarts.
//
// Creating is safe to repeat. The browser chooses a comment's id, and a comment
// box that saves as the reviewer types retries a create whose answer it never
// heard, so a create naming a comment the review already holds is an edit of
// that comment's text ([Store.EditCommentText]), and nothing else about it
// changes — the held comment's question_id included. The same text again
// changes nothing at all, so a pure retry does not mark the comment edited
// (docs/reference/comment-autosave.md §5).
//
// A create carrying a session id is accepted only while that session is open
// for this comment: an unknown or closed session is [ErrSessionNotFound], a
// session whose root was edited elsewhere [ErrSessionConflict].
func (s *Store) AddCommentWith(filePath, repo string, c model.ReviewComment, docContent string, opts CreateOptions) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, err
	}
	if data == nil {
		data = model.NewReviewData(filePath)
	}
	if slices.Contains(data.DeletedIDs, c.ID) {
		return nil, ErrCommentNotFound
	}
	if err := checkSessionWrite(data, c.ID, opts.SessionID); err != nil {
		return nil, err
	}
	doc := observeFrom(orStatic(opts.Doc, docContent))
	if held := commentByID(data.Comments, c.ID); held != nil {
		if held.Comment == c.Comment {
			return data, nil
		}
		editText(data, held, c.Comment, nowSeconds(), doc, opts.SessionID)
		if err := s.saveLocked(filePath, repo, data); err != nil {
			return nil, err
		}
		return data, nil
	}
	if c.Reactions == nil {
		c.Reactions = []model.CommentReaction{}
	}
	if c.QuestionID != "" {
		reason := ""
		if p := opts.Preconditions; p != nil {
			// The review's mutation revision is not a precondition of a create: the
			// server proves the id itself, under this lock, and an unrelated write
			// between the evidence and the create must not unbind the answer.
			held := *p
			held.MutationRevision = data.MutationRevision
			reason = held.violation(doc.Evidence, data.MutationRevision)
		}
		if reason == "" {
			c.QuestionEvidence, reason = proveQuestion(doc, c.QuestionID, c.QuestionEvidence)
		}
		if reason != "" {
			c.QuestionID = ""
			c.QuestionEvidence = nil
		} else {
			bindOwnership(&c, doc)
		}
	}
	c.CapturedBlock = blockTextAt(doc.Content, anchorLineOf(&c))
	c.RootTextVersion = newRandomID()
	c.MutationCounter = 1
	markOtherSessionsExternal(data, c.ID, opts.SessionID)
	data.Comments = append(data.Comments, c)
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	return data, nil
}

// EditCommentText is [Store.EditCommentTextIn] outside any session.
func (s *Store) EditCommentText(filePath, repo, id, text, docContent string) (*model.ReviewData, error) {
	return s.EditCommentTextIn(filePath, repo, id, text, docContent, "")
}

// EditCommentTextIn rewrites the comment's text, stamps EditedAt — which is what
// marks pre-edit agent responses as answering different wording — gives the
// root a new text version, and re-captures the anchored block from docContent
// when that block is provably still the comment's own ([recapture]).
//
// Editing is a capture point for the same reason replying is: a reviewer
// rewording a comment is looking at the document as it stands now, so the next
// response's "before" is this block now. Keeping the original capture would
// make the round-2 diff span round 1 as well, crediting the agent's second
// answer with changes its first answer made.
//
// sessionID is "" for a write outside any session, which marks every open
// session of the comment as externally edited; otherwise see [checkSessionWrite].
func (s *Store) EditCommentTextIn(filePath, repo, id, text, docContent, sessionID string) (*model.ReviewData, error) {
	return s.EditCommentTextFrom(filePath, repo, id, text, StaticDoc(docContent), sessionID)
}

// EditCommentTextFrom is [Store.EditCommentTextIn] reading the document through
// doc, under the lock.
func (s *Store) EditCommentTextFrom(filePath, repo, id, text string, doc DocSource, sessionID string) (*model.ReviewData, error) {
	return s.mutateCommentErr(filePath, repo, id, func(data *model.ReviewData, c *model.ReviewComment, now float64) error {
		if err := checkSessionWrite(data, id, sessionID); err != nil {
			return err
		}
		editText(data, c, text, now, observeFrom(doc), sessionID)
		return nil
	})
}

// editText is the edit [Store.EditCommentTextIn] makes, shared with a repeated
// create: it is the one place the root's text is written.
func editText(data *model.ReviewData, c *model.ReviewComment, text string, now float64, doc *Observation, sessionID string) {
	c.Comment = text
	c.EditedAt = now
	recapture(c, doc)
	c.RootTextVersion = newRandomID()
	c.MutationCounter++
	markOtherSessionsExternal(data, c.ID, sessionID)
}

// recapture refreshes the comment's per-round CapturedBlock from the document
// and records, in Ownership, what the shared planning scanner proved.
//
// A comment bound to a question is refreshed only when the scanner proves the
// block at the anchor line lies in that question's unit (its directive id
// unique in the scanned document).
//
// A comment bound to none is a note on whatever sits at its anchor line, and is
// refreshed only when the scanner proves that line lies in no question unit.
// Where it lies in one, nothing the server holds says whether that question is
// the block the comment captured or one that took its slot — the comment has no
// id and no similarity of words or neighbours is identity — so the older capture
// stays and the comment is marked unknown.
//
// Where the scanner is unavailable (none installed, it failed, the document
// changed under it) the capture stays too, marked unknown with
// scanner_unavailable: never a guess in either direction.
func recapture(c *model.ReviewComment, doc *Observation) {
	line := anchorLineOf(c)
	sc := doc.Scanned()
	switch {
	case line == 0:
		c.CapturedBlock = blockTextAt(doc.Content, line)
		return
	case sc == nil:
		setOwnership(c, model.OwnershipUnknown, doc.scanFailure())
	case c.QuestionID != "" && ownsAnchor(doc, c.QuestionID, line):
		setOwnership(c, model.OwnershipProven, "")
		c.CapturedBlock = blockTextAt(doc.Content, line)
	case c.QuestionID != "":
		setOwnership(c, model.OwnershipUnknown, model.ReasonQuestionMoved)
	case sc.covers(line):
		setOwnership(c, model.OwnershipUnknown, model.ReasonAnchorInQuestion)
	default:
		setOwnership(c, model.OwnershipUnowned, "")
		c.CapturedBlock = blockTextAt(doc.Content, line)
	}
}

// bindOwnership records whether the question a comment was just bound to holds
// its anchor line, which the bind's own proof (a unique id) does not say.
func bindOwnership(c *model.ReviewComment, doc *Observation) {
	if ownsAnchor(doc, c.QuestionID, anchorLineOf(c)) {
		setOwnership(c, model.OwnershipProven, "")
		return
	}
	setOwnership(c, model.OwnershipUnknown, model.ReasonQuestionMoved)
}

func setOwnership(c *model.ReviewComment, state, reason string) {
	c.Ownership, c.OwnershipReason = state, reason
}

// SetResolved sets the comment's resolved flag: dismiss-without-reaction
// (true) or reopen (false).
func (s *Store) SetResolved(filePath, repo, id string, resolved bool) (*model.ReviewData, error) {
	return s.mutateComment(filePath, repo, id, func(c *model.ReviewComment, _ float64) {
		c.Resolved = resolved
	})
}

// Reply appends a reviewer follow-up (needs_clarification) to the comment and
// re-captures the anchored block: the reviewer is looking at the current text,
// so the next agent response's "before" is this block, now.
//
// replyID is the id the browser chose for the reply, or "" for a reply that has
// none. Like creating a comment, replying with an id is safe to repeat: when
// the comment already holds the reviewer's reply of that id, its text is edited
// in place ([Store.EditReply]) rather than a second reply appended.
func (s *Store) Reply(filePath, repo, id, replyID, text, docContent string) (*model.ReviewData, error) {
	return s.reply(filePath, repo, id, replyID, text, StaticDoc(docContent), false)
}

// ReplyFrom is [Store.Reply] reading the document through doc, under the lock;
// reopen also sets resolved=false ([Store.ReopenReply]).
func (s *Store) ReplyFrom(filePath, repo, id, replyID, text string, doc DocSource, reopen bool) (*model.ReviewData, error) {
	return s.reply(filePath, repo, id, replyID, text, doc, reopen)
}

// ReopenReply is Reply plus resolved=false, atomically — reopening a resolved
// thread with the follow-up that explains why.
func (s *Store) ReopenReply(filePath, repo, id, replyID, text, docContent string) (*model.ReviewData, error) {
	return s.reply(filePath, repo, id, replyID, text, StaticDoc(docContent), true)
}

func (s *Store) reply(filePath, repo, id, replyID, text string, src DocSource, reopen bool) (*model.ReviewData, error) {
	return s.mutateComment(filePath, repo, id, func(c *model.ReviewComment, now float64) {
		if reopen {
			c.Resolved = false
		}
		doc := observeFrom(src)
		if held := reviewerReply(c, replyID); held != nil {
			if held.Summary != text {
				editReply(c, held, text, now, doc)
			}
			return
		}
		c.Reactions = append(c.Reactions, model.CommentReaction{
			ID:        replyID,
			Actor:     "reviewer",
			Kind:      "needs_clarification",
			Summary:   text,
			Timestamp: now,
		})
		recapture(c, doc)
	})
}

// EditReply rewrites the text of the reviewer's reply replyID on comment id,
// wherever it sits in the thread and whatever has been added after it, and
// stamps the reply's EditedAt. An edit later than the agent's last answer puts
// the thread back in the agent's queue, as editing a comment does. The anchored
// block is re-captured for the reason an edit of the comment re-captures it.
//
// A missing comment is ErrCommentNotFound; a reply the comment does not hold,
// or one that is not the reviewer's, is ErrReplyNotFound.
func (s *Store) EditReply(filePath, repo, id, replyID, text, docContent string) (*model.ReviewData, error) {
	return s.EditReplyFrom(filePath, repo, id, replyID, text, StaticDoc(docContent))
}

// EditReplyFrom is [Store.EditReply] reading the document through doc, under
// the lock.
func (s *Store) EditReplyFrom(filePath, repo, id, replyID, text string, doc DocSource) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, ErrCommentNotFound
	}
	comment := commentByID(data.Comments, id)
	if comment == nil || slices.Contains(data.DeletedIDs, id) {
		return nil, ErrCommentNotFound
	}
	held := reviewerReply(comment, replyID)
	if held == nil {
		return nil, ErrReplyNotFound
	}
	editReply(comment, held, text, nowSeconds(), observeFrom(doc))
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	return data, nil
}

// reviewerReply is the reviewer's reply replyID on c, or nil when replyID is
// "" or names no reply of the reviewer's.
func reviewerReply(c *model.ReviewComment, replyID string) *model.CommentReaction {
	if replyID == "" {
		return nil
	}
	for i := range c.Reactions {
		r := &c.Reactions[i]
		if r.ID == replyID && r.Actor == "reviewer" {
			return r
		}
	}
	return nil
}

func editReply(c *model.ReviewComment, r *model.CommentReaction, text string, now float64, doc *Observation) {
	r.Summary = text
	r.EditedAt = now
	recapture(c, doc)
}

// DismissMany resolves comments in bulk without recording reactions. A nil ids
// slice means every unresolved comment; otherwise exactly the listed full ids
// (unknown ids are ignored — bulk dismissal is not an id lookup).
func (s *Store) DismissMany(filePath, repo string, ids []string) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, ErrReviewNotFound
	}
	var want map[string]struct{}
	if ids != nil {
		want = make(map[string]struct{}, len(ids))
		for _, id := range ids {
			want[id] = struct{}{}
		}
	}
	for i := range data.Comments {
		if want == nil {
			data.Comments[i].Resolved = true
			continue
		}
		if _, ok := want[data.Comments[i].ID]; ok {
			data.Comments[i].Resolved = true
		}
	}
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	return data, nil
}

// DeleteComment removes the comment from the review.
func (s *Store) DeleteComment(filePath, repo, id string) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, err
	}
	if data == nil {
		data = model.NewReviewData(filePath)
	}
	at := -1
	for i := range data.Comments {
		if data.Comments[i].ID == id {
			at = i
			break
		}
	}
	if !slices.Contains(data.DeletedIDs, id) {
		data.DeletedIDs = append(data.DeletedIDs, id)
	}
	if at >= 0 {
		data.Comments = append(data.Comments[:at], data.Comments[at+1:]...)
	}
	// The record is persisted even when the comment was absent: its create may
	// still be in flight, and must find the id deleted when it lands.
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	if at < 0 {
		return nil, ErrCommentNotFound
	}
	return data, nil
}

// ApplyResponses records a batch of agent responses (one inbox file) as
// agent/addressed reactions, deduped by nonce and by content. It returns the
// persisted review and how many entries were applied. A document with no
// review returns (nil, 0, nil): there is nothing to deliver into.
//
// Nonce dedup is measured against the set as of batch start, not the evolving
// list: a batch may share one nonce across all its entries, and checking
// as-we-go would apply only the first. Within a batch, only byte-identical
// entries dedup against each other (an agent re-appending the same inbox
// line); distinct entries sharing a nonce all land.
//
// Content dedup catches what the nonce cannot: an agent that re-runs its
// delivery step writes fresh nonces for answers it already delivered, and
// every one of them would otherwise land again under the same comment. An
// entry is a redelivery when the comment already carries an agent reaction
// with the same round AND the same (whitespace-trimmed) summary. Round is part
// of the key because the same summary against a later reviewer turn is a
// genuine second answer — the agent restating "Fixed it" after being told it
// is still broken — while the same summary at the same round is the same
// answer arriving twice. Entries carrying no round ([RoundUnknown]) match each
// other on summary alone, which is the best available signal for a delivery
// that would not say which turn it answers.
//
// The reaction's before_text is the comment's CapturedBlock — the text the
// reviewer was looking at when they wrote or last followed up on the comment —
// and after_text is the block in docContent, the document as delivered.
func (s *Store) ApplyResponses(filePath, repo string, entries []ResponseEntry, docContent string) (*model.ReviewData, int, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, 0, err
	}
	if data == nil {
		// A delivery whose path/repo has no review file lands here and, before
		// this warning, vanished without a trace: every entry dropped, the inbox
		// file deleted, no review_changed pushed. The agent believes it answered
		// the comments. Warn loudly — a mismatched path or repo prefix is the
		// likeliest cause, and the agent should see its answers went nowhere.
		if len(entries) > 0 {
			slog.Warn("review: delivery targets a document with no review; all entries dropped",
				"path", filePath, "repo", repo, "entries", len(entries))
		}
		return nil, 0, nil
	}

	seen := make(map[string]struct{}, len(data.Nonces))
	for _, n := range data.Nonces {
		seen[n] = struct{}{}
	}
	inBatch := make(map[ResponseEntry]struct{}, len(entries))
	recorded := map[string]struct{}{}

	applied := 0
	now := nowSeconds()
	for _, e := range entries {
		if _, dup := inBatch[e]; dup {
			continue
		}
		inBatch[e] = struct{}{}

		cid, ok := resolveCommentID(data.Comments, e.ShortID)
		if !ok {
			// Warn, not Debug: the agent believes it answered this comment and a
			// silent drop leaves nobody able to tell the response went nowhere.
			slog.Warn("review: no comment matches response short id; response dropped",
				"short_id", e.ShortID, "path", filePath, "summary", e.Summary)
			continue
		}
		if _, delivered := seen[e.Nonce]; delivered && e.Nonce != "" {
			continue
		}
		comment := commentByID(data.Comments, cid)
		if comment == nil {
			continue
		}

		// AnswersRound records which turn the agent was answering rather than
		// letting the reaction's position imply it: a delivery that lands after
		// the reviewer posted a follow-up sits at the end of the thread but
		// answers something older, and only the delivery itself knows that.
		var answersRound *int
		if e.Round >= 0 {
			round := e.Round
			answersRound = &round
		}
		// Checked against the live reaction list, not a snapshot: two entries in
		// one batch that carry fresh nonces but repeat the same answer are the
		// same redelivery, and the first one's reaction must dedup the second.
		if hasAgentAnswer(comment, answersRound, e.Summary) {
			continue
		}
		comment.Reactions = append(comment.Reactions, model.CommentReaction{
			Actor:        "agent",
			Kind:         "addressed",
			Summary:      e.Summary,
			BeforeText:   comment.CapturedBlock,
			AfterText:    blockTextAt(docContent, anchorLineOf(comment)),
			Timestamp:    now,
			AnswersRound: answersRound,

			RootTextVersion: e.RootVersion,
		})
		applied++
		if e.Nonce != "" {
			if _, done := recorded[e.Nonce]; !done {
				data.Nonces = append(data.Nonces, e.Nonce)
				recorded[e.Nonce] = struct{}{}
			}
		}

		short := cid
		if len(short) > 8 {
			short = short[:8]
		}
		slog.Info("review: recorded agent response", "comment", short, "path", filePath, "summary", e.Summary)
	}

	if applied == 0 {
		// Nothing changed; skip the save so a replayed delivery is a pure no-op.
		return data, 0, nil
	}
	if n := len(data.Nonces); n > maxNonces {
		data.Nonces = append([]string(nil), data.Nonces[n-maxNonces:]...)
	}
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, 0, err
	}
	return data, applied, nil
}

// hasAgentAnswer reports whether the comment already carries an agent reaction
// answering round with summary — the content dedup key documented on
// [Store.ApplyResponses]. round is nil for a delivery that named none and
// matches only other round-less reactions; reviewer reactions never match,
// since a reviewer echoing the agent's wording is a different turn, not a
// redelivery. Summaries compare whitespace-trimmed, so a re-emitted line that
// differs only in padding is still recognized as the same answer.
func hasAgentAnswer(c *model.ReviewComment, round *int, summary string) bool {
	want := strings.TrimSpace(summary)
	for i := range c.Reactions {
		r := &c.Reactions[i]
		if r.Actor != "agent" || !sameRound(r.AnswersRound, round) {
			continue
		}
		if strings.TrimSpace(r.Summary) == want {
			return true
		}
	}
	return false
}

// sameRound compares two optional rounds. Both absent matches — two deliveries
// that each declined to name a round are treated as the same round, which is
// what makes unknown-round redeliveries dedup at all.
func sameRound(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// mutateComment is the shared command skeleton: lock, load, locate the comment,
// mutate it (fn receives the current time as epoch seconds), save, return the
// persisted review. A missing review or comment is ErrCommentNotFound.
func (s *Store) mutateComment(filePath, repo, id string, fn func(c *model.ReviewComment, now float64)) (*model.ReviewData, error) {
	return s.mutateCommentErr(filePath, repo, id, func(_ *model.ReviewData, c *model.ReviewComment, now float64) error {
		fn(c, now)
		return nil
	})
}

// mutateCommentErr is [Store.mutateComment] for a mutation that sees the whole
// review and can refuse: nothing is saved when fn returns an error.
func (s *Store) mutateCommentErr(filePath, repo, id string, fn func(data *model.ReviewData, c *model.ReviewComment, now float64) error) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, ErrCommentNotFound
	}
	comment := commentByID(data.Comments, id)
	if comment == nil || slices.Contains(data.DeletedIDs, id) {
		return nil, ErrCommentNotFound
	}
	if err := fn(data, comment, nowSeconds()); err != nil {
		return nil, err
	}
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	return data, nil
}

// nowSeconds is the server clock for every review timestamp: epoch seconds
// carrying sub-second precision.
//
// Whole seconds made ties routine, and the frontend's pending predicate
// compares them with a strict ">": an edit stamped in the same second as the
// delivery it follows compared equal, so the comment counted as already
// answered and the reviewer's re-queue was silently dropped. Fractional seconds
// also make these directly comparable to the browser's own Date.now()/1000
// stamps, which the store adopts on the command echo.
func nowSeconds() float64 {
	return float64(time.Now().UnixNano()) / 1e9
}

// anchorLineOf returns the comment's anchor source line, or 0 (the "no block"
// sentinel blockTextAt maps to "") for an anchorless comment.
func anchorLineOf(c *model.ReviewComment) int {
	if c.Anchor == nil {
		return 0
	}
	return c.Anchor.SourceLine
}
