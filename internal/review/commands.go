package review

import (
	"errors"
	"log/slog"
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
// to record, and the delivery's dedup nonce.
type ResponseEntry struct {
	ShortID string
	Summary string
	Nonce   string
}

// ParseResponses parses agent response text — the paste-box door — into
// entries. Every line that parses as a "- [<short_id>] <summary>" bullet
// counts, in order; anything else (prose, blank lines, a stray retired-protocol
// changelog marker) is skipped. There is no marker to scope to: the whole text
// is scanned. Nonce is left empty for the caller to assign.
func ParseResponses(text string) []ResponseEntry {
	var out []ResponseEntry
	for _, line := range splitLines(text) {
		shortID, summary, ok := parseBullet(line)
		if !ok {
			continue
		}
		out = append(out, ResponseEntry{ShortID: shortID, Summary: summary})
	}
	return out
}

// AddComment appends c to the review for filePath in repo, creating the review
// if absent. The anchored block's current text is captured from docContent so a
// later agent response has an honest "before" even across restarts.
func (s *Store) AddComment(filePath, repo string, c model.ReviewComment, docContent string) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, err
	}
	if data == nil {
		data = model.NewReviewData(filePath)
	}
	if c.Reactions == nil {
		c.Reactions = []model.CommentReaction{}
	}
	c.CapturedBlock = blockTextAt(docContent, anchorLineOf(&c))
	data.Comments = append(data.Comments, c)
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	return data, nil
}

// EditCommentText rewrites the comment's text and stamps EditedAt, which is
// what marks pre-edit agent responses as answering different wording.
func (s *Store) EditCommentText(filePath, repo, id, text string) (*model.ReviewData, error) {
	return s.mutateComment(filePath, repo, id, func(c *model.ReviewComment, _ float64) {
		c.Comment = text
		c.EditedAt = float64(time.Now().Unix())
	})
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
func (s *Store) Reply(filePath, repo, id, text, docContent string) (*model.ReviewData, error) {
	return s.reply(filePath, repo, id, text, docContent, false)
}

// ReopenReply is Reply plus resolved=false, atomically — reopening a resolved
// thread with the follow-up that explains why.
func (s *Store) ReopenReply(filePath, repo, id, text, docContent string) (*model.ReviewData, error) {
	return s.reply(filePath, repo, id, text, docContent, true)
}

func (s *Store) reply(filePath, repo, id, text, docContent string, reopen bool) (*model.ReviewData, error) {
	return s.mutateComment(filePath, repo, id, func(c *model.ReviewComment, now float64) {
		if reopen {
			c.Resolved = false
		}
		c.Reactions = append(c.Reactions, model.CommentReaction{
			Actor:     "reviewer",
			Kind:      "needs_clarification",
			Summary:   text,
			Timestamp: now,
		})
		c.CapturedBlock = blockTextAt(docContent, anchorLineOf(c))
	})
}

// Accept records the reviewer's acceptance of the agent's response: a
// reviewer/noted "Accepted" reaction plus resolved=true.
func (s *Store) Accept(filePath, repo, id string) (*model.ReviewData, error) {
	return s.mutateComment(filePath, repo, id, func(c *model.ReviewComment, now float64) {
		c.Reactions = append(c.Reactions, model.CommentReaction{
			Actor:     "reviewer",
			Kind:      "noted",
			Summary:   "Accepted",
			Timestamp: now,
		})
		c.Resolved = true
	})
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
		return nil, ErrCommentNotFound
	}
	at := -1
	for i := range data.Comments {
		if data.Comments[i].ID == id {
			at = i
			break
		}
	}
	if at < 0 {
		return nil, ErrCommentNotFound
	}
	data.Comments = append(data.Comments[:at], data.Comments[at+1:]...)
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	return data, nil
}

// ApplyResponses records a batch of agent responses (one inbox file, or one
// paste) as agent/addressed reactions, deduped by nonce. It returns the
// persisted review and how many entries were applied. A document with no
// review returns (nil, 0, nil): there is nothing to deliver into.
//
// Nonce dedup is measured against the set as of batch start, not the evolving
// list: a multi-bullet paste shares one content-derived nonce across all its
// entries, and checking as-we-go would apply only the first bullet. Within a
// batch, only byte-identical entries dedup against each other (an agent
// re-appending the same inbox line); distinct entries sharing a nonce all land.
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
		return nil, 0, nil
	}

	seen := make(map[string]struct{}, len(data.Nonces))
	for _, n := range data.Nonces {
		seen[n] = struct{}{}
	}
	inBatch := make(map[ResponseEntry]struct{}, len(entries))
	recorded := map[string]struct{}{}

	applied := 0
	now := float64(time.Now().Unix())
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

		comment.Reactions = append(comment.Reactions, model.CommentReaction{
			Actor:      "agent",
			Kind:       "addressed",
			Summary:    e.Summary,
			BeforeText: comment.CapturedBlock,
			AfterText:  blockTextAt(docContent, anchorLineOf(comment)),
			Timestamp:  now,
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

// mutateComment is the shared command skeleton: lock, load, locate the comment,
// mutate it (fn receives the current time as epoch seconds), save, return the
// persisted review. A missing review or comment is ErrCommentNotFound.
func (s *Store) mutateComment(filePath, repo, id string, fn func(c *model.ReviewComment, now float64)) (*model.ReviewData, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, ErrCommentNotFound
	}
	comment := commentByID(data.Comments, id)
	if comment == nil {
		return nil, ErrCommentNotFound
	}
	fn(comment, float64(time.Now().Unix()))
	if err := s.saveLocked(filePath, repo, data); err != nil {
		return nil, err
	}
	return data, nil
}

// anchorLineOf returns the comment's anchor source line, or 0 (the "no block"
// sentinel blockTextAt maps to "") for an anchorless comment.
func anchorLineOf(c *model.ReviewComment) int {
	if c.Anchor == nil {
		return 0
	}
	return c.Anchor.SourceLine
}
