// Package model defines the wire-format DTOs exchanged between the Vantage
// backend and its React frontend. It is the leaf package every other internal
// package imports; it depends only on the standard library.
//
// The frontend (frontend/src/types/index.ts) is the contract authority. JSON
// key names here must match it exactly, and any value the frontend compares or
// branches on must be preserved verbatim. Several encoding choices are
// load-bearing and documented inline:
//
//   - Git/API timestamps are time.Time, emitted as RFC3339; the frontend parses
//     them with new Date(). Review timestamps are different — see below.
//   - Review timestamps (ReviewComment.CreatedAt, ReviewSnapshot.Timestamp,
//     CommentReaction.Timestamp) are JSON numbers: epoch seconds authored
//     client-side as Date.now()/1000 and round-tripped untouched as float64.
//   - DiffLine line numbers are *int with no omitempty: always present, null on
//     the absent side of the diff.
//   - RepoInfo.LastActivity emits explicit null (no omitempty); the frontend
//     branches on its falsiness and its TS type is string|null.
//   - FileNode.HasMarkdown is non-omitempty so a no-markdown directory sends
//     has_markdown:false rather than omitting the key.
//   - Review slices (Comments, Reactions) must marshal as [] rather than
//     null. Construct review values with NewReviewData / NewReviewComment,
//     or initialize those fields to non-nil empties before marshaling.
//     (Snapshots is deprecated legacy tolerance: omitempty, never written.)
package model

import "time"

// GitCommit describes a single commit touching a file. hexsha is the real git
// SHA (40-char) and is strict: the frontend feeds it back as a diff request.
type GitCommit struct {
	Hexsha      string    `json:"hexsha"`
	AuthorName  string    `json:"author_name"`
	AuthorEmail string    `json:"author_email"`
	Date        time.Time `json:"date"`
	Message     string    `json:"message"`
}

// FileStatus is the git status of a single file: its most recent commit (or
// null when clean/untracked) and a status enum string (or null when clean).
type FileStatus struct {
	LastCommit *GitCommit `json:"last_commit"`
	// GitStatus is one of "modified", "added", "deleted", "untracked", or null.
	GitStatus *string `json:"git_status"`
}

// FileNode is one entry in a file tree. The tree is recursive: directories may
// carry Children, which is omitted (not null) for files and unexpanded dirs.
type FileNode struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	// HasMarkdown is non-omitempty: an empty directory must report false so the
	// frontend can hide it.
	HasMarkdown bool `json:"has_markdown"`
	// GitStatus is one of "modified", "added", "deleted", "untracked",
	// "contains_changes", or omitted when clean.
	GitStatus     string      `json:"git_status,omitempty"`
	LastCommit    *GitCommit  `json:"last_commit,omitempty"`
	Children      []*FileNode `json:"children,omitempty"`
	IsSymlink     bool        `json:"is_symlink,omitempty"`
	SymlinkTarget string      `json:"symlink_target,omitempty"`
}

// FileContent is the JSON payload for a readable file. Encoding is "utf-8" or
// "binary"; the frontend compares only against "binary".
type FileContent struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

// DiffLine is one line of a parsed diff. Type is one of "add", "delete",
// "context", "header". OldLineNo/NewLineNo are *int and always present (no
// omitempty): the absent side serializes as null.
type DiffLine struct {
	Type      string `json:"type"`
	Content   string `json:"content"`
	OldLineNo *int   `json:"old_line_no"`
	NewLineNo *int   `json:"new_line_no"`
}

// DiffHunk is a contiguous run of diff lines under a single @@ header.
type DiffHunk struct {
	Header string     `json:"header"`
	Lines  []DiffLine `json:"lines"`
}

// FileDiff is the diff of one file at one commit. CommitHexsha is the real SHA,
// except for working-directory diffs where it is the literal sentinel "working".
type FileDiff struct {
	CommitHexsha  string     `json:"commit_hexsha"`
	CommitMessage string     `json:"commit_message"`
	CommitAuthor  string     `json:"commit_author"`
	CommitDate    time.Time  `json:"commit_date"`
	FilePath      string     `json:"file_path"`
	Hunks         []DiffHunk `json:"hunks"`
	RawDiff       string     `json:"raw_diff"`
}

// RecentFile is a recently changed file. Path and date are the primary fields;
// untracked files carry empty author/message/hexsha and Untracked=true.
type RecentFile struct {
	Path       string    `json:"path"`
	Date       time.Time `json:"date"`
	AuthorName string    `json:"author_name"`
	Message    string    `json:"message"`
	Hexsha     string    `json:"hexsha"`
	Untracked  bool      `json:"untracked,omitempty"`
}

// RepoInfo describes a configured repository for GET /repos. Name is strict:
// the empty string is the single-repo sentinel and is used in URLs and keys.
// LastActivity emits explicit null (no omitempty) because the frontend branches
// on its falsiness and its TS type is string|null.
type RepoInfo struct {
	Name         string     `json:"name"`
	LastActivity *time.Time `json:"last_activity"`
}

// RepoFile is one entry of GET /files/all: a repo name paired with a
// repo-relative file path. Both fields are strict.
type RepoFile struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
}

// VersionInfo is the payload for GET /version. Both fields are display-only:
// CommitHash is the short HEAD SHA or "unknown".
type VersionInfo struct {
	CommitHash string `json:"commit_hash"`
	IsDirty    bool   `json:"is_dirty"`
}

// RepoInfoResponse is the payload for GET /info: the repo's display name and
// absolute root path (used for display and clipboard).
type RepoInfoResponse struct {
	Name     string `json:"name"`
	RootPath string `json:"root_path"`
}

// ReviewSnapshot is a saved copy of a file's content at a point in time. The
// timestamp is epoch seconds (float64), authored client-side.
//
// Deprecated: nothing writes snapshots anymore. The type survives only so
// legacy review files carrying them still parse (and round-trip) cleanly.
type ReviewSnapshot struct {
	ID        string  `json:"id"`
	Content   string  `json:"content"`
	Timestamp float64 `json:"timestamp"`
}

// CommentAnchor binds a review comment to a Markdown block. The block is
// identified by SourceLine and verified by BlockTextHash.
// SelectionOffset/SelectionLength describe a substring within the block; a
// zero length means the whole block.
//
// SourceLine is a 1-based line in the *file*, frontmatter included — the same
// basis blockTextAt uses to re-capture the block from disk, and the basis the
// rendered DOM's data-source-line reports.
type CommentAnchor struct {
	SourceLine      int    `json:"source_line"`
	BlockTextHash   string `json:"block_text_hash"`
	SelectionOffset int    `json:"selection_offset"`
	SelectionLength int    `json:"selection_length"`
}

// CommentReaction records an action taken in response to a comment, by either
// the agent (an inbox delivery) or the reviewer. Actor is "agent" or
// "reviewer"; Kind is one of "addressed", "wont_fix", "needs_clarification",
// "noted". Timestamp is epoch seconds (float64).
//
// "noted" is legacy and is no longer written: it recorded the retired reviewer
// "accept" turn, and dismissing a comment is now a flag (Resolved) rather than
// a turn. It stays in the allowed set because review files already on disk
// carry noted reactions and must keep deserializing.
//
// AnswersRound is set only on agent reactions whose delivery named the thread
// round it was written against (the comment's reaction count as of the payload
// the agent read). It exists because a reaction's position in the slice implies
// which turn it answers, and that implication is wrong for a delivery that
// lands after the reviewer posted a follow-up. Absent means "not stated", which
// readers treat as answering the newest turn.
type CommentReaction struct {
	Actor        string  `json:"actor"`
	Kind         string  `json:"kind"`
	Summary      string  `json:"summary"`
	BeforeText   string  `json:"before_text"`
	AfterText    string  `json:"after_text"`
	Timestamp    float64 `json:"timestamp"`
	AnswersRound *int    `json:"answers_round,omitempty"`
}

// ReviewComment is a single review comment. CreatedAt is epoch seconds
// (float64). Reactions must marshal as [] rather than null — use
// NewReviewComment or initialize it to a non-nil empty slice.
type ReviewComment struct {
	ID        string  `json:"id"`
	Comment   string  `json:"comment"`
	CreatedAt float64 `json:"created_at"`
	// EditedAt is when the reviewer last reworded Comment. It is compared
	// against the agent's last response time to decide whether the agent has
	// answered the comment's current wording. Zero means never edited.
	EditedAt float64 `json:"edited_at,omitempty"`
	Resolved bool    `json:"resolved,omitempty"`
	// Anchor is omitted while a legacy comment has not yet acquired one.
	Anchor       *CommentAnchor `json:"anchor,omitempty"`
	FallbackText string         `json:"fallback_text,omitempty"`
	// CapturedBlock is the canonicalized text of the anchored block at the
	// moment the comment was created or last replied-to/reopened — the text the
	// reviewer was actually looking at. Written server-side only; it becomes an
	// agent reaction's before_text at delivery time.
	CapturedBlock string            `json:"captured_block,omitempty"`
	Reactions     []CommentReaction `json:"reactions"`
	// SelectedText is legacy: the verbatim selection of pre-anchor comments.
	SelectedText string `json:"selected_text,omitempty"`
}

// ReviewData is the full review record persisted for one file. Comments must
// marshal as [] rather than null — use NewReviewData or initialize it to a
// non-nil empty.
type ReviewData struct {
	FilePath string `json:"file_path"`
	// Snapshots is dead weight kept only so legacy review files that carry
	// snapshots still parse and round-trip. Nothing writes it; the frontend
	// tolerates its absence.
	//
	// Deprecated: do not read or write; retained for legacy-file tolerance.
	Snapshots []ReviewSnapshot `json:"snapshots,omitempty"`
	Comments  []ReviewComment  `json:"comments"`
	// Nonces are the delivery dedup keys of agent responses already applied,
	// most-recent-last, capped at 200 (oldest dropped). Stored inside the review
	// so the record survives restarts and is written in the same atomic save as
	// the reactions it guards.
	Nonces []string `json:"nonces,omitempty"`
}

// NewReviewData returns a ReviewData for filePath with Comments initialized
// to a non-nil empty, so it marshals comments as [] rather than null. The
// deprecated Snapshots field stays nil (omitted from the JSON).
func NewReviewData(filePath string) *ReviewData {
	return &ReviewData{
		FilePath: filePath,
		Comments: []ReviewComment{},
	}
}

// NewReviewComment returns a ReviewComment with its Reactions slice
// initialized to a non-nil empty, so it marshals as [] rather than null.
func NewReviewComment(id, comment string, createdAt float64) ReviewComment {
	return ReviewComment{
		ID:        id,
		Comment:   comment,
		CreatedAt: createdAt,
		Reactions: []CommentReaction{},
	}
}
