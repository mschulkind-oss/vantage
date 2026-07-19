export interface RepoInfo {
  name: string;
  last_activity: string | null;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  has_markdown?: boolean;
  git_status?: string; // 'modified' | 'added' | 'deleted' | 'untracked' | 'contains_changes'
  last_commit?: GitCommit;
  children?: FileNode[];
  is_symlink?: boolean;
  symlink_target?: string | null; // relative path to target (null = broken/external)
}

export interface GitCommit {
  hexsha: string;
  author_name: string;
  author_email: string;
  date: string;
  message: string;
}

export interface FileStatus {
  last_commit: GitCommit | null;
  git_status: string | null; // 'modified' | 'added' | 'deleted' | 'untracked' | null
}

export interface FileContent {
  path: string;
  content: string;
  encoding: string;
}

export interface WebSocketMessage {
  type: "files_changed" | "review_changed" | "changelog_ignored" | "hello";
  paths?: string[];
  /**
   * review_changed: the document whose review state changed server-side.
   * changelog_ignored: the document that was saved still carrying a
   * retired-protocol changelog block (the agent's response went nowhere).
   */
  path?: string;
  repo?: string;
  version?: string;
}

export interface RecentFile {
  path: string;
  date: string;
  author_name: string;
  message: string;
  hexsha: string;
  untracked?: boolean;
}

export interface DiffLine {
  type: "add" | "delete" | "context" | "header";
  content: string;
  old_line_no: number | null;
  new_line_no: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  commit_hexsha: string;
  commit_message: string;
  commit_author: string;
  commit_date: string;
  file_path: string;
  hunks: DiffHunk[];
  raw_diff: string;
}

// --- Review mode types ---

/**
 * Legacy: nothing writes snapshots anymore. The type survives only so review
 * files written before snapshots were retired still typecheck when loaded.
 */
export interface ReviewSnapshot {
  id: string;
  content: string;
  timestamp: number;
}

export interface CommentAnchor {
  source_line: number;
  block_text_hash: string;
  /** Char offset within the canonicalized block text. 0 + length=0 = whole-block. */
  selection_offset: number;
  /** Length of the selection within the block; 0 means whole-block. */
  selection_length: number;
}

export type ReactionActor = "agent" | "reviewer";
export type ReactionKind =
  | "addressed"
  | "wont_fix"
  | "needs_clarification"
  | "noted";

export interface CommentReaction {
  actor: ReactionActor;
  kind: ReactionKind;
  summary: string;
  before_text: string;
  after_text: string;
  timestamp: number;
}

export interface ReviewComment {
  id: string;
  comment: string;
  created_at: number;
  /**
   * When the reviewer last edited `comment`.  Absent on comments that have
   * never been edited.  Compared against the agent's last response timestamp
   * to decide whether the agent has answered the *current* wording.
   */
  edited_at?: number;
  resolved?: boolean;
  anchor?: CommentAnchor | null;
  fallback_text?: string;
  reactions?: CommentReaction[];
  /**
   * Server-captured text of the anchored block as of the comment's creation
   * or last reply/reopen — it becomes a delivered reaction's `before_text`.
   * Written server-side only; never sent by the client.
   */
  captured_block?: string;
  /** Legacy: pre-anchor schema kept the verbatim selection here. */
  selected_text?: string;
}

export interface ReviewData {
  file_path: string;
  /** Legacy tolerance only: present on old review files, never written. */
  snapshots?: ReviewSnapshot[];
  comments: ReviewComment[];
  /** Delivery dedup keys, most-recent-last. Server-side only. */
  nonces?: string[];
}
