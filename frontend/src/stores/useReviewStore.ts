import { create } from "zustand";
import axios from "axios";
import { useRepoStore } from "./useRepoStore";
import type {
  CommentAnchor,
  CommentReaction,
  ReviewComment,
  ReviewData,
  ReviewSnapshot,
} from "../types";

const getApiBase = (): string | null => {
  const { currentRepo, isMultiRepo } = useRepoStore.getState();
  if (isMultiRepo) {
    if (!currentRepo) return null;
    return `/api/r/${encodeURIComponent(currentRepo)}`;
  }
  return "/api";
};

// Per-file review-mode toggle is persisted to localStorage so refreshing a
// file where the user has turned review mode ON but hasn't added any
// comments yet doesn't silently drop the toggle.  (Files with saved
// comments/snapshots auto-enable review mode from server data.)
const REVIEW_MODE_KEY_PREFIX = "vantage.reviewMode:";

const reviewModeKey = (filePath: string): string => {
  const { currentRepo, isMultiRepo } = useRepoStore.getState();
  const prefix = isMultiRepo && currentRepo ? `${currentRepo}:` : "";
  return `${REVIEW_MODE_KEY_PREFIX}${prefix}${filePath}`;
};

const readReviewModePref = (filePath: string): boolean => {
  try {
    return localStorage.getItem(reviewModeKey(filePath)) === "on";
  } catch {
    return false;
  }
};

const writeReviewModePref = (filePath: string, on: boolean): void => {
  try {
    if (on) {
      localStorage.setItem(reviewModeKey(filePath), "on");
    } else {
      localStorage.removeItem(reviewModeKey(filePath));
    }
  } catch {
    // storage quota / privacy mode — persistence is best-effort
  }
};

/**
 * A comment is "pending" (still needs to go back to the agent) when it's
 * unresolved AND its most recent reaction is NOT an agent "addressed" — i.e.
 * either the agent hasn't responded yet, or the reviewer has posted a
 * follow-up reply since the agent's last response. This is what gates the
 * Copy button and what gets included in the clipboard payload.
 */
export function isPendingForAgent(c: ReviewComment): boolean {
  if (c.resolved) return false;
  const reactions = c.reactions ?? [];
  const last = reactions[reactions.length - 1];
  return !(last && last.actor === "agent" && last.kind === "addressed");
}

export interface PendingSelection {
  anchor: CommentAnchor;
  rect: DOMRect;
  /** Visible text for the popover preview. */
  displayText: string;
  /** True when the selection's start and end blocks differed and we clamped. */
  clamped?: boolean;
}

interface ReviewState {
  // Mode
  isReviewMode: boolean;
  toggleReviewMode: () => void;

  // Current file
  filePath: string | null;
  lastContent: string | null;

  // Comments
  comments: ReviewComment[];
  pendingSelection: PendingSelection | null;

  // Hover highlight
  hoveredCommentId: string | null;
  setHoveredCommentId: (id: string | null) => void;

  // Outdated tracking (set by useReviewHighlights)
  outdatedCommentIds: Set<string>;
  setOutdatedCommentIds: (ids: Set<string>) => void;

  // Snapshots (still kept for reaction before/after capture; no UI)
  snapshots: ReviewSnapshot[];

  // Loading
  isLoading: boolean;

  // Actions
  loadReview: (filePath: string) => Promise<void>;
  saveReview: () => Promise<void>;
  setPendingSelection: (sel: PendingSelection) => void;
  clearPendingSelection: () => void;
  addComment: (
    anchor: CommentAnchor,
    comment: string,
    fallbackText: string,
    blockHashes?: Record<string, string>,
  ) => void;
  deleteComment: (id: string) => void;
  editComment: (id: string, newComment: string) => void;
  /** Resolve with a "noted" reviewer reaction (means "I accept the agent's fix"). */
  resolveComment: (id: string) => void;
  /** Dismiss without writing a reaction (means "I'm done with this comment"). */
  dismissComment: (id: string) => void;
  /** Dismiss all unresolved comments at once. */
  dismissAll: () => void;
  /** Dismiss only outdated (orphaned) comments. */
  dismissOutdated: () => void;
  /** Reply to an agent-addressed comment (keeps it unresolved for another round). */
  replyToComment: (id: string, replyText: string) => void;
  /** Reopen a resolved comment and add a follow-up reply. */
  reopenAndReply: (id: string, replyText: string) => void;
  clearAllComments: () => void;
  addSnapshot: (content: string) => void;
  setLastContent: (content: string) => void;
  copyAllToClipboard: () => Promise<boolean>;
  /** Copy a single comment's thread to the clipboard for the agent. */
  copyCommentToClipboard: (id: string) => Promise<boolean>;
  deleteReview: () => Promise<void>;
  /** End review mode and clear all data (comments, snapshots). */
  endReview: () => Promise<void>;
  /** Whether ending review mode needs confirmation (has data to lose). */
  hasReviewData: () => boolean;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  isReviewMode: false,
  filePath: null,
  lastContent: null,
  comments: [],
  pendingSelection: null,
  hoveredCommentId: null,
  outdatedCommentIds: new Set<string>(),
  snapshots: [],
  isLoading: false,

  toggleReviewMode: () => {
    set((s) => {
      const next = !s.isReviewMode;
      if (s.filePath) writeReviewModePref(s.filePath, next);
      return { isReviewMode: next, pendingSelection: null };
    });
  },

  loadReview: async (filePath: string) => {
    const base = getApiBase();
    if (!base) return;

    // Review state is per-file: when switching files, reset the transient
    // state (comments, snapshots, pending selection, and *review mode
    // itself*).  The new file's mode is then re-derived below from whether
    // it has saved review data.  This prevents review mode from bleeding
    // from one file to another just because it was enabled on the previous.
    const switchingFile = get().filePath !== filePath;
    if (switchingFile) {
      set({
        filePath,
        comments: [],
        snapshots: [],
        pendingSelection: null,
        isReviewMode: false,
      });
    }

    set({ isLoading: true });
    try {
      const { data } = await axios.get<ReviewData | null>(`${base}/review`, {
        params: { path: filePath },
      });
      const persistedOn = readReviewModePref(filePath);
      if (data) {
        const hasData = data.comments.length > 0 || data.snapshots.length > 0;
        set({
          comments: data.comments,
          snapshots: data.snapshots,
          filePath: data.file_path,
          // Auto-enable review mode if the file has saved review data OR if
          // the user explicitly toggled it on for this file (persisted in
          // localStorage).  Without the persistence, refreshing a fresh
          // file where review mode was turned on but no comments exist
          // would silently revert to off.
          isReviewMode: hasData || persistedOn,
        });
      } else if (persistedOn) {
        // Server has nothing, but the user had toggled review mode on
        // before the refresh — honor that preference.
        set({ isReviewMode: true });
      }
    } catch {
      // No review data yet — still honor the persisted toggle if present.
      if (readReviewModePref(filePath)) {
        set({ isReviewMode: true });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  saveReview: async () => {
    const { filePath, comments, snapshots } = get();
    const base = getApiBase();
    if (!base || !filePath) return;

    const data: ReviewData = { file_path: filePath, snapshots, comments };
    try {
      await axios.put(`${base}/review`, data, {
        params: { path: filePath },
      });
    } catch (e) {
      console.error("Failed to save review", e);
    }
  },

  setPendingSelection: (sel: PendingSelection) => {
    set({ pendingSelection: sel });
  },

  clearPendingSelection: () => {
    set({ pendingSelection: null });
  },

  setHoveredCommentId: (id: string | null) => {
    set({ hoveredCommentId: id });
  },

  setOutdatedCommentIds: (ids: Set<string>) => {
    set({ outdatedCommentIds: ids });
  },

  addComment: (
    anchor: CommentAnchor,
    comment: string,
    fallbackText: string,
    blockHashes?: Record<string, string>,
  ) => {
    const newComment: ReviewComment = {
      id: crypto.randomUUID(),
      anchor,
      fallback_text: fallbackText,
      reactions: [],
      comment,
      created_at: Date.now() / 1000,
      block_hashes_at_creation: blockHashes ?? {},
    };
    set((s) => ({
      comments: [...s.comments, newComment],
      pendingSelection: null,
    }));
    get().saveReview();
  },

  deleteComment: (id: string) => {
    if (get().hoveredCommentId === id) set({ hoveredCommentId: null });
    set((s) => ({
      comments: s.comments.filter((c) => c.id !== id),
    }));
    get().saveReview();
  },

  editComment: (id: string, newComment: string) => {
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id ? { ...c, comment: newComment } : c,
      ),
    }));
    get().saveReview();
  },

  resolveComment: (id: string) => {
    if (get().hoveredCommentId === id) set({ hoveredCommentId: null });
    const reaction: CommentReaction = {
      actor: "reviewer",
      kind: "noted",
      summary: "Accepted",
      before_text: "",
      after_text: "",
      timestamp: Date.now() / 1000,
    };
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id
          ? {
              ...c,
              resolved: true,
              reactions: [...(c.reactions ?? []), reaction],
            }
          : c,
      ),
    }));
    get().saveReview();
  },

  dismissComment: (id: string) => {
    if (get().hoveredCommentId === id) set({ hoveredCommentId: null });
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id ? { ...c, resolved: true } : c,
      ),
    }));
    get().saveReview();
  },

  dismissAll: () => {
    set({ hoveredCommentId: null });
    set((s) => ({
      comments: s.comments.map((c) =>
        c.resolved ? c : { ...c, resolved: true },
      ),
    }));
    get().saveReview();
  },

  dismissOutdated: () => {
    const outdated = get().outdatedCommentIds;
    if (outdated.size === 0) return;
    set({ hoveredCommentId: null });
    set((s) => ({
      comments: s.comments.map((c) =>
        !c.resolved && outdated.has(c.id) ? { ...c, resolved: true } : c,
      ),
    }));
    get().saveReview();
  },

  replyToComment: (id: string, replyText: string) => {
    const reaction: CommentReaction = {
      actor: "reviewer",
      kind: "needs_clarification",
      summary: replyText,
      before_text: "",
      after_text: "",
      timestamp: Date.now() / 1000,
    };
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id
          ? { ...c, reactions: [...(c.reactions ?? []), reaction] }
          : c,
      ),
    }));
    get().saveReview();
  },

  reopenAndReply: (id: string, replyText: string) => {
    const reaction: CommentReaction = {
      actor: "reviewer",
      kind: "needs_clarification",
      summary: replyText,
      before_text: "",
      after_text: "",
      timestamp: Date.now() / 1000,
    };
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id
          ? {
              ...c,
              resolved: false,
              reactions: [...(c.reactions ?? []), reaction],
            }
          : c,
      ),
    }));
    get().saveReview();
  },

  clearAllComments: () => {
    set({ comments: [] });
    get().saveReview();
  },

  addSnapshot: (content: string) => {
    const snap: ReviewSnapshot = {
      id: crypto.randomUUID(),
      content,
      timestamp: Date.now() / 1000,
    };
    set((s) => ({ snapshots: [...s.snapshots, snap] }));
    get().saveReview();
  },

  setLastContent: (content: string) => {
    set({ lastContent: content });
  },

  copyAllToClipboard: async () => {
    const { filePath, lastContent, comments } = get();
    const active = comments.filter(isPendingForAgent);
    if (!filePath || active.length === 0) return false;

    const contentLines = (lastContent || "").split("\n");
    const pathPrefix = clipboardPathPrefix(filePath);

    const output = [`## Review Comments for \`${filePath}\``, ""];
    for (const c of active) {
      output.push(...commentBlock(c, contentLines, pathPrefix));
    }
    output.push(...respondingInstructions(active[0]));

    try {
      await navigator.clipboard.writeText(output.join("\n"));
      return true;
    } catch {
      return false;
    }
  },

  copyCommentToClipboard: async (id: string) => {
    const { filePath, lastContent, comments } = get();
    const c = comments.find((x) => x.id === id);
    if (!filePath || !c) return false;

    const contentLines = (lastContent || "").split("\n");
    const pathPrefix = clipboardPathPrefix(filePath);

    const output = [`## Review Comment for \`${filePath}\``, ""];
    output.push(...commentBlock(c, contentLines, pathPrefix));
    output.push(...respondingInstructions(c));

    try {
      await navigator.clipboard.writeText(output.join("\n"));
      return true;
    } catch {
      return false;
    }
  },

  deleteReview: async () => {
    const { filePath } = get();
    const base = getApiBase();
    if (!base || !filePath) return;

    try {
      await axios.delete(`${base}/review`, { params: { path: filePath } });
    } catch {
      // ignore
    }
    set({
      comments: [],
      snapshots: [],
      pendingSelection: null,
    });
  },

  endReview: async () => {
    const { filePath } = get();
    const base = getApiBase();

    // Delete server-side review data if it exists
    if (base && filePath) {
      try {
        await axios.delete(`${base}/review`, { params: { path: filePath } });
      } catch {
        // ignore
      }
      writeReviewModePref(filePath, false);
    }

    set({
      isReviewMode: false,
      comments: [],
      snapshots: [],
      pendingSelection: null,
      lastContent: null,
    });
  },

  hasReviewData: () => {
    const { comments, snapshots } = get();
    return comments.length > 0 || snapshots.length > 0;
  },
}));

/** Repo-aware path prefix for clipboard anchor links. */
function clipboardPathPrefix(filePath: string): string {
  const { currentRepo, isMultiRepo } = useRepoStore.getState();
  return isMultiRepo && currentRepo
    ? `/${currentRepo}/${filePath}`
    : `/${filePath}`;
}

/** Render one comment (heading, quote, comment, agent response, follow-ups). */
function commentBlock(
  c: ReviewComment,
  contentLines: string[],
  pathPrefix: string,
): string[] {
  const out: string[] = [];
  const shortId = c.id.slice(0, 8);
  const anchorLine = c.anchor?.source_line ?? null;
  const quoted = quotedFor(c, contentLines);
  out.push(
    anchorLine !== null
      ? `### [Line ${anchorLine}](${pathPrefix}#L${anchorLine}) \`[${shortId}]\``
      : `### Comment \`[${shortId}]\``,
  );
  out.push("");
  if (quoted.text) {
    out.push(`**Selected text:** "${quoted.text}"`);
    out.push("");
  }
  if (quoted.contextBlock) {
    out.push("```");
    out.push(quoted.contextBlock);
    out.push("```");
  }
  out.push("");
  out.push(`**Comment:** ${c.comment}`);
  out.push("");
  // Interleave agent responses and reviewer follow-ups in chronological order
  // so a back-and-forth thread reads correctly.
  for (const r of c.reactions ?? []) {
    if (r.actor === "agent" && r.kind === "addressed") {
      out.push(`**Agent response:** ${r.summary}`);
      out.push("");
    } else if (r.actor === "reviewer" && r.kind === "needs_clarification") {
      out.push(`**Follow-up:** ${r.summary}`);
      out.push("");
    }
  }
  out.push("---");
  out.push("");
  return out;
}

/** The "how to respond" instructions appended after the comment(s). */
function respondingInstructions(example?: ReviewComment): string[] {
  return [
    "## Responding to Comments",
    "",
    "After addressing a comment, append a **changelog entry** to the END of this document. The format is parsed by Vantage and must match exactly:",
    "",
    "```markdown",
    "<!-- changelog -->",
    "- [<short-id>] <one-line summary of what you changed>",
    "```",
    "",
    `Example (using a real id from this batch): \`- [${example?.id.slice(0, 8)}] Reworded paragraph for clarity\``,
    "",
    "### How your response is displayed",
    "",
    "Your summary text is rendered **inline in the document**, directly below the commented paragraph — the reviewer sees it right next to the original text and the comment. This means:",
    "- **Do NOT restate context.** The reviewer already sees the paragraph and their comment. Your summary should say *what you did*, not re-explain what the paragraph says.",
    "- **Keep it short.** One sentence is ideal. The summary shares a narrow column with the comment text and a before/after diff.",
    '- **Be specific about your action.** Good: "Split into two paragraphs and added the exception case." Bad: "The substrate is a typed-dataflow graph so I updated the text to reflect..."',
    "",
    "### Format rules",
    "",
    "- The marker line must be exactly `<!-- changelog -->` (HTML comment, nothing else on the line).",
    "- Each entry is a single bullet: `- [<short-id>] <summary>` — no nested lists, no extra prose between bullets.",
    "- One bullet per comment you addressed. Skip comments you didn't act on.",
    "- Vantage parses this block on save and records a reaction against the matching comment, including a before/after capture of the affected block.",
    "",
  ];
}

/**
 * Build a quoted/contextualized chunk for the clipboard prompt.  Uses the
 * comment's anchor.source_line when available, falling back to a text
 * search against `selected_text`/`fallback_text` for legacy comments.
 */
function quotedFor(
  c: ReviewComment,
  contentLines: string[],
): { text: string; contextBlock: string } {
  const fallback = c.fallback_text || c.selected_text || "";
  if (c.anchor?.source_line) {
    const idx = c.anchor.source_line - 1;
    if (idx >= 0 && idx < contentLines.length) {
      const CONTEXT = 2;
      const start = Math.max(0, idx - CONTEXT);
      const end = Math.min(contentLines.length - 1, idx + CONTEXT);
      const lines: string[] = [];
      for (let i = start; i <= end; i++) {
        const marker = i === idx ? ">" : " ";
        lines.push(
          `${marker} ${String(i + 1).padStart(4)} | ${contentLines[i]}`,
        );
      }
      return { text: fallback, contextBlock: lines.join("\n") };
    }
  }
  return { text: fallback, contextBlock: "" };
}
