from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RepoInfo(BaseModel):
    """Information about a configured repository."""

    name: str
    last_activity: datetime | None = None


class FileNode(BaseModel):
    name: str
    path: str
    is_dir: bool
    has_markdown: bool = True
    git_status: str | None = None  # 'modified', 'added', 'deleted', 'untracked', 'contains_changes'
    last_commit: GitCommit | None = None
    children: list[FileNode] | None = None
    is_symlink: bool = False
    symlink_target: str | None = None  # relative path to target (None = broken/external)


class GitCommit(BaseModel):
    hexsha: str
    author_name: str
    author_email: str
    date: datetime
    message: str


class FileStatus(BaseModel):
    last_commit: GitCommit | None = None
    git_status: str | None = None  # 'modified', 'added', 'deleted', 'untracked', or None (clean)


class FileContent(BaseModel):
    path: str
    content: str
    encoding: str = "utf-8"


class DiffLine(BaseModel):
    type: str  # 'add', 'delete', 'context', 'header'
    content: str
    old_line_no: int | None = None
    new_line_no: int | None = None


class DiffHunk(BaseModel):
    header: str
    lines: list[DiffLine]


class FileDiff(BaseModel):
    commit_hexsha: str
    commit_message: str
    commit_author: str
    commit_date: datetime
    file_path: str
    hunks: list[DiffHunk]
    raw_diff: str


class VersionInfo(BaseModel):
    """Version information about the running Vantage instance."""

    commit_hash: str
    is_dirty: bool


class JJRevision(BaseModel):
    """A jj revision (change)."""

    change_id: str  # Short change ID (e.g., "wosnyxlu")
    commit_id: str  # Full commit hash
    description: str
    author: str
    timestamp: datetime
    bookmarks: list[str] = []
    is_working_copy: bool = False


class JJEvoEntry(BaseModel):
    """An entry in a jj evolution log (evolog)."""

    commit_id: str
    description: str
    author: str
    timestamp: datetime
    operation: str  # What operation caused this evolution
    hidden: bool = False


class JJInfo(BaseModel):
    """Information about jj status in a repository."""

    is_jj: bool
    working_copy_change_id: str | None = None


# --- Review mode models ---


class ReviewSnapshot(BaseModel):
    id: str
    content: str
    timestamp: float  # epoch seconds


class CommentAnchor(BaseModel):
    """Block-level anchor for a review comment.

    Comments attach to a markdown block identified by source_line (its
    position in the rendered DOM via data-source-line) and verified by
    block_text_hash.  The selection_offset/selection_length describe a
    substring within that block; selection_length=0 means the whole block.
    """

    source_line: int
    block_text_hash: str
    selection_offset: int = 0
    selection_length: int = 0


class CommentReaction(BaseModel):
    """A record of an action taken in response to a comment.

    Created either by the agent (via a server-parsed `<!-- changelog -->`
    block) or by the reviewer (when they resolve/dismiss).
    """

    actor: str  # "agent" | "reviewer"
    kind: str  # "addressed" | "wont_fix" | "needs_clarification" | "noted"
    summary: str
    before_text: str = ""
    after_text: str = ""
    timestamp: float = 0.0


class ReviewComment(BaseModel):
    id: str
    comment: str
    created_at: float  # epoch seconds
    resolved: bool = False
    # New (block-anchored) fields.  Optional during the migration window —
    # legacy comments lazily acquire an anchor on first frontend load.
    anchor: CommentAnchor | None = None
    fallback_text: str = ""
    reactions: list[CommentReaction] = []
    # Legacy: original verbatim selection.  Kept for migration of records
    # written before block-anchoring.  New comments leave this empty and
    # store the original text in fallback_text instead.
    selected_text: str = ""


class ReviewData(BaseModel):
    file_path: str
    snapshots: list[ReviewSnapshot] = []
    comments: list[ReviewComment] = []
