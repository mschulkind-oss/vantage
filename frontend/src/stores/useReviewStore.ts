import { create } from "zustand";
import axios from "axios";
import { useRepoStore } from "./useRepoStore";
import type {
  CommentAnchor,
  CommentReaction,
  ReviewComment,
  ReviewData,
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
// comments auto-enable review mode from server data.)
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
 * The canonical comment-state predicates.  Every surface (inline document,
 * sidebar panel, toolbar, minimap stripe) must derive button visibility from
 * these rather than re-deriving the rules locally — divergent local copies are
 * how the Copy button silently stopped re-lighting after a reply.
 */

/**
 * A comment is "pending" (still needs to go back to the agent) when it's
 * unresolved AND the agent has not answered its current wording — i.e. either
 * the agent hasn't responded yet, or the reviewer has posted a follow-up reply
 * or edited the comment since the agent's last response. This is what gates
 * every Copy affordance and what gets included in the clipboard payload.
 */
export function isPendingForAgent(c: ReviewComment): boolean {
  if (c.resolved) return false;
  const reactions = c.reactions ?? [];
  // A trailing reviewer "noted" is an acceptance — a turn that CLOSES a round,
  // which is how every surface renders it. Skip it when deciding whose turn it
  // is, so reopening an accepted comment doesn't re-send it to the agent under
  // "your earlier answer did not satisfy the reviewer". A reviewer who wants
  // another round replies, which appends needs_clarification instead.
  let i = reactions.length - 1;
  // An acceptance also re-dates the answer: accepting at T3 endorses whatever
  // the comment said at T3, so an edit made before it must not re-queue the
  // comment when it is later reopened.
  let acceptedAt = 0;
  while (
    i >= 0 &&
    reactions[i].actor === "reviewer" &&
    reactions[i].kind === "noted"
  ) {
    acceptedAt = Math.max(acceptedAt, reactions[i].timestamp);
    i--;
  }
  const last = i >= 0 ? reactions[i] : undefined;
  // Declining is an answer too: the agent has responded, so the ball is back
  // with the reviewer. Treating only "addressed" as an answer left a declined
  // comment pending forever — re-sent on every Copy, and stuck under
  // "Needs agent" with no way out but dismissing it.
  const answered =
    !!last &&
    last.actor === "agent" &&
    (last.kind === "addressed" || last.kind === "wont_fix");
  if (!answered) return true;
  // The agent answered the *previous* wording; a later edit re-queues it.
  return (c.edited_at ?? 0) > Math.max(last.timestamp, acceptedAt);
}

/** Whether the agent has ever responded to this comment. */
export function hasAgentReaction(c: ReviewComment): boolean {
  return (c.reactions ?? []).some((r) => r.actor === "agent");
}

/** The agent's most recent response, or undefined if it has never replied. */
export function latestAgentReaction(
  c: ReviewComment,
): CommentReaction | undefined {
  const reactions = c.reactions ?? [];
  for (let i = reactions.length - 1; i >= 0; i--) {
    if (reactions[i].actor === "agent") return reactions[i];
  }
  return undefined;
}

/** Unresolved and never yet answered by the agent — the first-round state. */
export function isAwaitingFirstResponse(c: ReviewComment): boolean {
  return !c.resolved && !hasAgentReaction(c);
}

/**
 * Unresolved, answered by the agent, and not re-queued since — the state where
 * the ball is in the reviewer's court (accept it, or reply for another round).
 */
export function isAnsweredByAgent(c: ReviewComment): boolean {
  return !c.resolved && hasAgentReaction(c) && !isPendingForAgent(c);
}

/**
 * `crypto.randomUUID` only exists in a secure context, so it is undefined when
 * Vantage is served over plain HTTP to another machine on the LAN — the common
 * `vantage serve` setup.  Without the fallback, creating a comment throws and
 * the popover silently does nothing.
 */
function newId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // RFC 4122 version 4 / variant 10xx bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Monotonic counters that make the review round-trip safe against races.
 * `loadSeq` discards a GET whose response lost the race to a newer one;
 * `saveSeq` discards a GET that started before a local write, so a
 * websocket-triggered reload can't revert a reply the reviewer just made.
 * Together they also gate command-echo adoption in `runCommand`: an echo is
 * only adopted when nothing newer — write, reload, or file switch — landed
 * while it was in flight.
 */
let loadSeq = 0;
let saveSeq = 0;

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

  // Outdated tracking (set by useReviewHighlights)
  outdatedCommentIds: Set<string>;
  setOutdatedCommentIds: (ids: Set<string>) => void;

  /**
   * Set when the server reports a saved document still carrying a
   * retired-protocol changelog block: the agent followed a stale clipboard
   * payload and its response was NOT recorded. Rendered as a dismissible
   * notice when the path matches the document on screen.
   */
  staleProtocolWarning: { path: string } | null;
  warnStaleProtocol: (path: string) => void;
  dismissStaleProtocolWarning: () => void;

  // Loading
  isLoading: boolean;

  // Actions
  loadReview: (filePath: string) => Promise<void>;
  /**
   * Shared plumbing for the review command endpoints: fires the request
   * against the current repo base + file, adopts the comments the server
   * persisted (captured blocks, server-stamped edits, reactions another
   * writer added) unless something newer landed while it was in flight, and
   * resyncs from the server on failure so the optimistic mutation can't
   * stand as a lie — unlike the old whole-state PUT, no later write
   * retransmits a lost command.
   */
  runCommand: (
    fn: (base: string, path: string) => Promise<{ data: ReviewData | null }>,
  ) => Promise<void>;
  setPendingSelection: (sel: PendingSelection) => void;
  clearPendingSelection: () => void;
  addComment: (
    anchor: CommentAnchor,
    comment: string,
    fallbackText: string,
  ) => void;
  deleteComment: (id: string) => void;
  editComment: (id: string, newComment: string) => void;
  /** Resolve with a "noted" reviewer reaction (means "I accept the agent's fix"). */
  resolveComment: (id: string) => void;
  /** Dismiss without writing a reaction (means "I'm done with this comment"). */
  dismissComment: (id: string) => void;
  /** Reopen a resolved comment without writing a follow-up reply. */
  unresolveComment: (id: string) => void;
  /** Dismiss all unresolved comments at once. */
  dismissAll: () => void;
  /** Dismiss only outdated (orphaned) comments. */
  dismissOutdated: () => void;
  /** Reply to an agent-addressed comment (keeps it unresolved for another round). */
  replyToComment: (id: string, replyText: string) => void;
  /** Reopen a resolved comment and add a follow-up reply. */
  reopenAndReply: (id: string, replyText: string) => void;
  setLastContent: (content: string) => void;
  copyAllToClipboard: () => Promise<boolean>;
  /** Copy a single comment's thread to the clipboard for the agent. */
  copyCommentToClipboard: (id: string) => Promise<boolean>;
  deleteReview: () => Promise<void>;
  /** End review mode and clear all data (comments). */
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
  outdatedCommentIds: new Set<string>(),
  staleProtocolWarning: null,
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
    // state (comments, pending selection, and *review mode itself*).  The
    // new file's mode is then re-derived below from whether it has saved
    // review data.  This prevents review mode from bleeding from one file
    // to another just because it was enabled on the previous.
    const switchingFile = get().filePath !== filePath;
    if (switchingFile) {
      set({
        filePath,
        comments: [],
        pendingSelection: null,
        isReviewMode: false,
      });
    }

    const seq = ++loadSeq;
    const saveSeqAtStart = saveSeq;
    // A response is stale if a newer load started, if a local write happened
    // while it was in flight, or if the user has since moved to a different
    // file.  Applying it would resurrect the previous file's comments, revert
    // a reply the reviewer just made, or leave filePath pointing at the wrong
    // document.
    const isStale = () =>
      seq !== loadSeq ||
      saveSeq !== saveSeqAtStart ||
      get().filePath !== filePath;

    set({ isLoading: true });
    try {
      const { data } = await axios.get<ReviewData | null>(`${base}/review`, {
        params: { path: filePath },
      });
      if (isStale()) return;
      const persistedOn = readReviewModePref(filePath);
      if (data) {
        const hasData = data.comments.length > 0;
        set({
          comments: data.comments,
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
      if (!isStale() && readReviewModePref(filePath)) {
        set({ isReviewMode: true });
      }
    } finally {
      if (seq === loadSeq) set({ isLoading: false });
    }
  },

  runCommand: async (fn) => {
    const base = getApiBase();
    const filePath = get().filePath;
    if (!base || !filePath) return;

    const seq = ++saveSeq;
    const loadSeqAtStart = loadSeq;
    try {
      const res = await fn(base, filePath);
      // Adopt what the server actually persisted. Skipped if anything newer
      // has landed meanwhile: another write, a file switch, or a reload — a
      // reload that completed after this command was sent carries the
      // server's own newer state, which this echo would undo.
      const saved = res.data;
      if (
        saved?.comments &&
        seq === saveSeq &&
        loadSeq === loadSeqAtStart &&
        get().filePath === filePath
      ) {
        set({ comments: saved.comments });
      }
    } catch (e) {
      // A failed command is that operation lost. Reload server truth so the
      // UI doesn't keep showing a mutation that never happened.
      console.error("Review command failed", e);
      get().loadReview(filePath);
    }
  },

  setPendingSelection: (sel: PendingSelection) => {
    set({ pendingSelection: sel });
  },

  clearPendingSelection: () => {
    set({ pendingSelection: null });
  },

  setOutdatedCommentIds: (ids: Set<string>) => {
    set({ outdatedCommentIds: ids });
  },

  warnStaleProtocol: (path: string) => {
    set({ staleProtocolWarning: { path } });
  },

  dismissStaleProtocolWarning: () => {
    set({ staleProtocolWarning: null });
  },

  addComment: (
    anchor: CommentAnchor,
    comment: string,
    fallbackText: string,
  ) => {
    const newComment: ReviewComment = {
      id: newId(),
      anchor,
      fallback_text: fallbackText,
      reactions: [],
      comment,
      created_at: Date.now() / 1000,
    };
    set((s) => ({
      comments: [...s.comments, newComment],
      pendingSelection: null,
    }));
    // The server captures captured_block from the document at the anchor.
    get().runCommand((base, path) =>
      axios.post<ReviewData | null>(
        `${base}/review/comments`,
        {
          id: newComment.id,
          comment: newComment.comment,
          anchor: newComment.anchor,
          fallback_text: newComment.fallback_text,
          created_at: newComment.created_at,
        },
        { params: { path } },
      ),
    );
  },

  deleteComment: (id: string) => {
    set((s) => ({
      comments: s.comments.filter((c) => c.id !== id),
    }));
    get().runCommand((base, path) =>
      axios.delete<ReviewData | null>(
        `${base}/review/comments/${encodeURIComponent(id)}`,
        { params: { path } },
      ),
    );
  },

  editComment: (id: string, newComment: string) => {
    // Stamping edited_at re-queues a comment the agent had already addressed:
    // it answered the old wording, so the new wording still needs a response.
    // The optimistic stamp keeps the UI honest immediately; the server sets
    // its own edited_at and the adopted echo replaces this one.
    const now = Date.now() / 1000;
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id ? { ...c, comment: newComment, edited_at: now } : c,
      ),
    }));
    get().runCommand((base, path) =>
      axios.patch<ReviewData | null>(
        `${base}/review/comments/${encodeURIComponent(id)}`,
        { comment: newComment },
        { params: { path } },
      ),
    );
  },

  resolveComment: (id: string) => {
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
    get().runCommand((base, path) =>
      axios.post<ReviewData | null>(
        `${base}/review/comments/${encodeURIComponent(id)}/accept`,
        {},
        { params: { path } },
      ),
    );
  },

  dismissComment: (id: string) => {
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id ? { ...c, resolved: true } : c,
      ),
    }));
    get().runCommand((base, path) =>
      axios.patch<ReviewData | null>(
        `${base}/review/comments/${encodeURIComponent(id)}`,
        { resolved: true },
        { params: { path } },
      ),
    );
  },

  dismissAll: () => {
    set((s) => ({
      comments: s.comments.map((c) =>
        c.resolved ? c : { ...c, resolved: true },
      ),
    }));
    get().runCommand((base, path) =>
      axios.post<ReviewData | null>(
        `${base}/review/dismissals`,
        { scope: "all" },
        { params: { path } },
      ),
    );
  },

  dismissOutdated: () => {
    const outdated = get().outdatedCommentIds;
    // Capture the target ids before mutating so the command names exactly
    // the comments this click dismissed.
    const ids = get()
      .comments.filter((c) => !c.resolved && outdated.has(c.id))
      .map((c) => c.id);
    if (ids.length === 0) return;
    set((s) => ({
      comments: s.comments.map((c) =>
        !c.resolved && outdated.has(c.id) ? { ...c, resolved: true } : c,
      ),
    }));
    get().runCommand((base, path) =>
      axios.post<ReviewData | null>(
        `${base}/review/dismissals`,
        { scope: "ids", ids },
        { params: { path } },
      ),
    );
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
    get().runCommand((base, path) =>
      axios.post<ReviewData | null>(
        `${base}/review/comments/${encodeURIComponent(id)}/replies`,
        { text: replyText },
        { params: { path } },
      ),
    );
  },

  unresolveComment: (id: string) => {
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id ? { ...c, resolved: false } : c,
      ),
    }));
    get().runCommand((base, path) =>
      axios.patch<ReviewData | null>(
        `${base}/review/comments/${encodeURIComponent(id)}`,
        { resolved: false },
        { params: { path } },
      ),
    );
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
    get().runCommand((base, path) =>
      axios.post<ReviewData | null>(
        `${base}/review/comments/${encodeURIComponent(id)}/reopen-reply`,
        { text: replyText },
        { params: { path } },
      ),
    );
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
    output.push(...respondingInstructions(filePath, active[0], active));

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
    output.push(...respondingInstructions(filePath, c, [c]));

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
    // Invalidate any write still in flight: its echo would otherwise be
    // adopted after this clear and resurrect the review that was just deleted.
    saveSeq++;
    set({
      comments: [],
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

    // Invalidate any write still in flight: its echo would otherwise be
    // adopted after this clear and resurrect the review that was just deleted.
    saveSeq++;
    set({
      isReviewMode: false,
      comments: [],
      pendingSelection: null,
      lastContent: null,
    });
  },

  hasReviewData: () => {
    return get().comments.length > 0;
  },
}));

/** Repo-aware path prefix for clipboard anchor links. */
function clipboardPathPrefix(filePath: string): string {
  const { currentRepo, isMultiRepo } = useRepoStore.getState();
  return isMultiRepo && currentRepo
    ? `/${currentRepo}/${filePath}`
    : `/${filePath}`;
}

/** Human label for one turn in a comment thread, used in the clipboard payload. */
function turnLabel(r: CommentReaction): string {
  if (r.actor === "agent") {
    return r.kind === "wont_fix" ? "Agent declined" : "Agent response";
  }
  if (r.kind === "noted") return "Reviewer accepted";
  return "Follow-up";
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
  if (c.edited_at) out.push("_(the reviewer edited this comment)_");
  out.push("");
  // Interleave every turn in chronological order so a back-and-forth thread
  // reads correctly.  No reaction kind is skipped: dropping one silently
  // removes a turn from the transcript the agent reads.
  for (const r of c.reactions ?? []) {
    out.push(`**${turnLabel(r)}:** ${r.summary}`);
    out.push("");
  }
  out.push("---");
  out.push("");
  return out;
}

/** The agent-facing delivery instructions appended after the comment(s). */
function respondingInstructions(
  filePath: string,
  example?: ReviewComment,
  batch: ReviewComment[] = [],
): string[] {
  const followUps = batch.filter((c) => hasAgentReaction(c));
  const plural = followUps.length !== 1;
  const subject =
    followUps.length === batch.length
      ? plural
        ? "These are follow-up rounds."
        : "This is a follow-up round."
      : `${followUps.length} of these are follow-up round${plural ? "s" : ""}.`;
  const followUpNote = followUps.length
    ? [
        `> **${subject}** A thread above that already shows an _Agent response_ means your earlier answer did not satisfy the reviewer — read their **Follow-up** and address *that*, rather than restating what you already did.`,
        "",
      ]
    : [];
  // Same flattening scheme as the server-side review store: both separators
  // become "__". The filename is advisory (the consumer never parses it), but
  // giving the exact name keeps every agent writing to one file per document.
  const inboxFile = `.vantage/inbox/${filePath.replace(/[/\\]/g, "__")}.jsonl`;
  const exampleId = example?.id.slice(0, 8) ?? "<short-id>";
  return [
    "## Responding to Comments",
    "",
    ...followUpNote,
    `After addressing a comment: **save the document first**, then deliver your response by appending one line to \`${inboxFile}\` at the root of this document's repository (create the directory and file if needed).`,
    "",
    "Each line is a single JSON object, newline-terminated:",
    "",
    "```",
    `{"path":"${filePath}","id":"<short-id>","summary":"<one sentence: what you changed>","nonce":"<fresh random string>"}`,
    "```",
    "",
    `Example (using a real id from this batch): \`{"path":"${filePath}","id":"${exampleId}","summary":"Reworded the paragraph for clarity","nonce":"k7f29qd1x4"}\``,
    "",
    "### Delivery rules",
    "",
    "- **Save the document before appending your line.** Vantage reads the document from disk at delivery time to record what changed; delivering first records a stale version.",
    "- **One line per comment you acted on.** Skip the rest — a line claiming work you did not do reads to the reviewer as an answered comment.",
    "- **Generate a fresh random nonce for every line you write** (never copy the example's), and **never re-append a line you have already written**. The nonce is how Vantage tells a new response from a redelivered one; a line with a reused nonce is silently dropped.",
    "- **Append only.** Never edit or delete lines already in the file — Vantage consumes and deletes it.",
    "",
    "### How your summary is displayed",
    "",
    "The summary is rendered **inline in the document**, directly below the commented paragraph — the reviewer sees it right next to the original text and their comment. This means:",
    "- **Do NOT restate context.** The reviewer already sees the paragraph and their comment. Your summary should say *what you did*, not re-explain what the paragraph says.",
    "- **Keep it short.** One sentence is ideal. The summary shares a narrow column with the comment text and a before/after diff.",
    '- **Be specific about your action.** Good: "Split into two paragraphs and added the exception case." Bad: "The substrate is a typed-dataflow graph so I updated the text to reflect..."',
    "",
    "### If you cannot write files",
    "",
    "Reply in chat with a fenced code block containing one bullet per comment you addressed; the reviewer will paste it into the Review panel:",
    "",
    "```",
    "- [<short-id>] <one sentence: what you changed>",
    "```",
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
