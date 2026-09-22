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
  type:
    | "files_changed"
    | "review_changed"
    | "repos_changed"
    | "starred_changed"
    | "hello";
  paths?: string[];
  /** review_changed: the document whose review state changed server-side. */
  path?: string;
  repo?: string;
  /**
   * repos_changed: the repositories the daemon has just started serving
   * (discovered under a configured source dir) and stopped serving (their
   * directories are gone). Informational — the list itself is refetched from
   * /api/repos.
   */
  added?: string[];
  removed?: string[];
  version?: string;
}

/**
 * One bookmark. `repo` is "" in single-repo mode — the same sentinel the API
 * uses everywhere — and the repo name in daemon mode, where a single list spans
 * several repositories. Build a bookmark's link from this field, never from the
 * currently selected repo.
 *
 * `is_dir` records what the target was when it was starred; it drives the icon
 * only, and may be stale if the target changed kind since.
 */
export type StarredSource = "user" | "repo" | "user-config";

export interface StarredEntry {
  repo: string;
  path: string;
  is_dir: boolean;
  starred_at: string;
  /**
   * Where the row came from. `"user"` is one the reader starred; the others are
   * promoted by a config file and are not theirs to remove.
   *
   * Never widen a check for "is this starred" to include the promoted sources —
   * see `isStarred` in `useStarredStore`, which explains what breaks.
   */
  source: StarredSource;
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
  "addressed" | "wont_fix" | "needs_clarification" | "noted";

export interface CommentReaction {
  actor: ReactionActor;
  kind: ReactionKind;
  summary: string;
  before_text: string;
  after_text: string;
  timestamp: number;
  /**
   * On an agent reaction, the thread's turn count as of the payload the agent
   * was answering — copied from the clipboard payload onto the delivery.  A
   * reaction's position implies which turn it answers, and that implication is
   * wrong for a delivery that lands after the reviewer replied; this records
   * the fact instead of inferring it.  Absent on the paste door and on any
   * delivery predating the field, which reads as "answers the newest turn".
   */
  answers_round?: number;
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

/**
 * One user colour theme: a stylesheet in the reader's themes directory. `id` is
 * the file stem, the URL segment it is served under and the value the browser
 * stores; `name` is what the settings menu shows. The server sets `name` to the
 * id today — a directory listing has nothing else to go on — so that a display
 * name can arrive later without changing the wire format.
 */
export interface ThemeInfo {
  id: string;
  name: string;
  /**
   * Whether the stylesheet declares a `:root.dark` rule. The server reads the
   * file anyway, and only it can tell: `:root` alone applies in both modes, so
   * a theme with no dark half renders its light palette in dark mode instead of
   * failing in any way the reader could attribute to the theme.
   */
  has_dark: boolean;
}

/**
 * The /api/themes response. `default` is the theme id the reader's config.toml
 * names, or `""` for the built-in look — a choice made in the browser outranks
 * it. The built-in themes are not listed: they ship in this bundle.
 *
 * `repo_defaults` is the theme each repository offers its readers, keyed by repo
 * name with `""` for single-repo mode — the same sentinel the bookmarks API
 * uses. It ranks below `default`, because a repository may suggest a palette but
 * the reader's own config decides.
 */
export interface ThemeList {
  default: string;
  repo_defaults: Record<string, string>;
  themes: ThemeInfo[];
}
