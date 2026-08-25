import { create } from "zustand";
import axios from "axios";
import { useRepoStore } from "./useRepoStore";
import { copyTextOrWarn } from "../lib/clipboard";
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
  if (answeredAnOlderRound(reactions)) return true;
  // "noted" is legacy: it was written by an accept action that no longer
  // exists, because dismissing is a flag on the comment and not a turn in the
  // conversation. Nothing produces it now, but review files written before that
  // change still carry it, so it is skipped rather than counted as the
  // reviewer having spoken last.
  let i = reactions.length - 1;
  while (i >= 0 && reactions[i].kind === "noted") i--;
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
  return (c.edited_at ?? 0) > last.timestamp;
}

/**
 * Whether the newest agent turn answered a round the reviewer has since moved
 * past — an answer written before a follow-up that landed while the agent was
 * working.
 *
 * A reaction's position in the array implies which turn it answers, and that
 * implication is wrong for a delivery that arrives after the reviewer replied:
 * the answer sits last, so the thread reads as "agent had the last word" and
 * the follow-up drops out of the agent queue having never been seen. The
 * delivery is the only party that knows which turn it was written against, so
 * it carries `answers_round` (the thread length as of the payload it read) and
 * this compares that against where the reviewer's follow-ups actually sit.
 *
 * A delivery that names no round — any payload predating the field — yields
 * false, which is exactly the old behavior.
 */
function answeredAnOlderRound(reactions: CommentReaction[]): boolean {
  const last = reactions[reactions.length - 1];
  if (!last || last.actor !== "agent" || last.answers_round == null) {
    return false;
  }
  const round = last.answers_round;
  return reactions.some(
    (r, i) =>
      i >= round && r.actor === "reviewer" && r.kind === "needs_clarification",
  );
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
 * the ball is in the reviewer's court (dismiss it, or reply for another round).
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

  /**
   * Whether the document has changed under any comment still waiting on the
   * agent — i.e. some pending comment's anchored block no longer holds the text
   * the reviewer commented on. Published by useReviewHighlights, which already
   * resolves every anchor against the rendered document; recomputing it from the
   * source here would be a second implementation of the same hash comparison,
   * free to drift from the one that draws the highlights.
   *
   * This is deliberately a claim about *text*, not about time or authorship. It
   * asks "is this comment still about what's on screen?", which is answerable by
   * comparing the anchor's block hash against the block's current hash — false
   * when they match, true when they don't, checkable either way.
   *
   * Two earlier attempts made a claim the available signals could not support. A
   * warning fired whenever a saved document contained a retired-protocol
   * changelog marker, asserting the agent's response had been lost — the marker
   * read identically whether the turn vanished or arrived through the inbox
   * seconds later. Its replacement said "an agent is working here" on the
   * strength of a `files_changed` push, which reports that a document changed and
   * never why: the reviewer's own editor, a formatter, or an agent editing an
   * untouched section all read the same. Drift avoids the whole class by
   * comparing content to content.
   */
  commentsDrifted: boolean;
  setCommentsDrifted: (drifted: boolean) => void;

  /**
   * The last review command that failed, so the failure is visible instead of
   * living only in the console. A failed command is that operation lost —
   * unlike the retired whole-state PUT, no later write retransmits it — and
   * `draft` carries the text the reviewer typed so a reply whose surface has
   * since unmounted is still recoverable from the banner.
   */
  commandError: { message: string; draft?: string } | null;
  clearCommandError: () => void;

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
    draft?: string,
  ) => Promise<void>;
  setPendingSelection: (sel: PendingSelection) => void;
  clearPendingSelection: () => void;
  addComment: (
    anchor: CommentAnchor,
    comment: string,
    fallbackText: string,
  ) => Promise<void>;
  deleteComment: (id: string) => void;
  editComment: (id: string, newComment: string) => Promise<void>;
  /** Dismiss: mark the comment done. Not a turn — no reaction is written. */
  dismissComment: (id: string) => void;
  /** Reopen a dismissed comment without writing a follow-up reply. */
  unresolveComment: (id: string) => void;
  /** Dismiss all open comments at once. */
  dismissAll: () => void;
  /** Dismiss every comment the agent has answered. */
  dismissAnswered: () => void;
  /**
   * Reply to an agent-addressed comment (keeps it unresolved for another
   * round). Resolves once the command has landed or failed; callers that clear
   * a textarea must await it, or a failure discards what the reviewer typed.
   */
  replyToComment: (id: string, replyText: string) => Promise<void>;
  /** Reopen a resolved comment and add a follow-up reply. */
  reopenAndReply: (id: string, replyText: string) => Promise<void>;
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
  commentsDrifted: false,
  commandError: null,
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
        // A command failure belongs to the document it happened on. It is
        // deliberately NOT cleared on a same-file reload: runCommand's error
        // path resyncs through here, and clearing there would erase the
        // failure a moment after setting it.
        commandError: null,
        // Belongs to the document being left: the new file's anchors have not
        // been resolved yet, and until they are, "unchanged" is the honest
        // default. useReviewHighlights republishes on its first render.
        commentsDrifted: false,
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
      } else {
        // Null at 200 means specifically "no review file" — deleting every
        // comment still persists an empty review. So the review was removed
        // out of band (another tab's End review, a branch switch, git clean),
        // or this is runCommand's resync after a command 404'd. Either way the
        // local comments are gone server-side and must go here too: the resync
        // exists so an optimistic mutation cannot stand as a lie, and leaving
        // them would do exactly that, with every later command 404ing and no
        // path back to truth short of a reload.
        //
        // isStale() above already guarantees this response matches the current
        // file and that no local write landed while the GET was in flight, so
        // this cannot clobber a fresh reviewer action.
        set({ comments: [] });
        if (persistedOn) {
          // Honor the toggle rather than kicking the reviewer out of review
          // mode mid-session; they land in an empty review instead.
          set({ isReviewMode: true });
        }
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

  clearCommandError: () => {
    set({ commandError: null });
  },

  runCommand: async (fn, draft) => {
    const base = getApiBase();
    const filePath = get().filePath;
    if (!base || !filePath) return;

    const seq = ++saveSeq;
    const loadSeqAtStart = loadSeq;
    set({ commandError: null });
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
      // A failed command is that operation lost — no later write retransmits
      // it, the way the retired whole-state PUT did. Resync so the UI doesn't
      // keep showing a mutation that never happened, and surface the failure:
      // resyncing silently just deletes the reviewer's turn from the screen
      // with no explanation, which is the same silent loss in a new place.
      console.error("Review command failed", e);
      set({ commandError: { message: commandErrorMessage(e), draft } });
      get().loadReview(filePath);
    }
  },

  setPendingSelection: (sel: PendingSelection) => {
    set({ pendingSelection: sel });
  },

  clearPendingSelection: () => {
    set({ pendingSelection: null });
  },

  setCommentsDrifted: (drifted: boolean) => {
    // Guarded so the highlighter can publish unconditionally on every render
    // without a no-op write waking every subscriber to this slice.
    if (get().commentsDrifted !== drifted) set({ commentsDrifted: drifted });
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
    return get().runCommand(
      (base, path) =>
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
      comment,
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
    return get().runCommand(
      (base, path) =>
        axios.patch<ReviewData | null>(
          `${base}/review/comments/${encodeURIComponent(id)}`,
          { comment: newComment },
          { params: { path } },
        ),
      newComment,
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

  dismissAnswered: () => {
    // Answered — not outdated. These are two different facts: "the agent has
    // replied and the ball is back with you" versus "the text this was
    // anchored to is gone". Bulk-dismissing the former is the useful action;
    // the two were conflated when this button dismissed by anchor state.
    const ids = get()
      .comments.filter(isAnsweredByAgent)
      .map((c) => c.id);
    if (ids.length === 0) return;
    const target = new Set(ids);
    set((s) => ({
      comments: s.comments.map((c) =>
        target.has(c.id) ? { ...c, resolved: true } : c,
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
    return get().runCommand(
      (base, path) =>
        axios.post<ReviewData | null>(
          `${base}/review/comments/${encodeURIComponent(id)}/replies`,
          { text: replyText },
          { params: { path } },
        ),
      replyText,
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
    return get().runCommand(
      (base, path) =>
        axios.post<ReviewData | null>(
          `${base}/review/comments/${encodeURIComponent(id)}/reopen-reply`,
          { text: replyText },
          { params: { path } },
        ),
      replyText,
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

    return copyTextOrWarn(output.join("\n"));
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

    return copyTextOrWarn(output.join("\n"));
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

/**
 * Human-readable text for a failed review command. Prefers the server's own
 * {"error":…} envelope — "No comment found" is far more actionable than a
 * status code — and falls back to `fallback` for a transport failure that
 * carries no body. Duck-typed rather than axios.isAxiosError so a non-HTTP
 * failure (network down) falls through instead of throwing here.
 */
export function commandErrorMessage(
  e: unknown,
  fallback = "Review command failed",
): string {
  const data = (e as { response?: { data?: { error?: unknown } } } | null)
    ?.response?.data;
  if (data && typeof data.error === "string" && data.error) return data.error;
  return fallback;
}

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
  // The round is this thread's turn count right now. The agent echoes it back
  // on its delivery so a follow-up the reviewer posts while the agent works is
  // not mistaken for something that answer addressed.
  const round = (c.reactions ?? []).length;
  const idToken = `\`[${shortId}]\` \`round:${round}\``;
  out.push(
    anchorLine !== null
      ? `### [Line ${anchorLine}](${pathPrefix}#L${anchorLine}) ${idToken}`
      : `### Comment ${idToken}`,
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
  // reads correctly.  Only legacy "noted" is skipped: it recorded a dismissal
  // by a since-removed accept action, and dismissing is not something the
  // agent needs to read — labelling it as a turn would put words in the
  // reviewer's mouth.  `round` above stays the raw count so it keeps agreeing
  // with the positional comparison in [answeredAnOlderRound].
  for (const r of c.reactions ?? []) {
    if (r.kind === "noted") continue;
    out.push(`**${turnLabel(r)}:** ${r.summary}`);
    out.push("");
  }
  out.push("---");
  out.push("");
  return out;
}

/**
 * Whether the thread carries a reviewer turn the agent has not answered — a
 * reaction sitting after the agent's last one, ignoring legacy "noted". This
 * is exactly what [turnLabel] renders as "Follow-up", so a note referring the
 * agent to that label is only accurate when this holds.
 */
function hasTrueFollowUp(c: ReviewComment): boolean {
  const reactions = c.reactions ?? [];
  let lastAgent = -1;
  for (let i = reactions.length - 1; i >= 0; i--) {
    if (reactions[i].actor === "agent") {
      lastAgent = i;
      break;
    }
  }
  if (lastAgent < 0) return false;
  return reactions.some(
    (r, i) => i > lastAgent && r.actor === "reviewer" && r.kind !== "noted",
  );
}

/** The agent-facing delivery instructions appended after the comment(s). */
function respondingInstructions(
  filePath: string,
  example?: ReviewComment,
  batch: ReviewComment[] = [],
): string[] {
  // Two different reasons a thread can come back, and they need different
  // instructions. A "Follow-up" turn is a reviewer reaction that lands AFTER
  // the agent's last one — the same rule turnLabel uses to print that label, so
  // pointing the agent at it is guaranteed to find something. A comment
  // re-queued purely by an edit has no such turn: telling the agent to read the
  // reviewer's Follow-up sends it looking for text that is not there.
  const trueFollowUps = batch.filter(hasTrueFollowUp);
  const editRequeued = batch.filter(
    (c) => hasAgentReaction(c) && !hasTrueFollowUp(c),
  );
  const returning = trueFollowUps.length + editRequeued.length;
  const plural = returning !== 1;
  const subject =
    returning === batch.length
      ? plural
        ? "These are follow-up rounds."
        : "This is a follow-up round."
      : `${returning} of these are follow-up round${plural ? "s" : ""}.`;
  const followUpNote = returning
    ? [
        `> **${subject}**`,
        ...(trueFollowUps.length
          ? [
              `> A thread above that already shows an _Agent response_ followed by a **Follow-up** means your earlier answer did not satisfy the reviewer — address *that*, rather than restating what you already did.`,
            ]
          : []),
        ...(editRequeued.length
          ? [
              `> A thread marked _(the reviewer edited this comment)_ means the reviewer rewrote the request itself. Re-read the comment text as it now stands and answer that, rather than restating what you already did.`,
            ]
          : []),
        "",
      ]
    : [];
  // Same flattening scheme as the server-side review store: both separators
  // become "__". The filename is advisory (the consumer reads meaning only from
  // each line's own `path`), so a per-delivery suffix keeps two turns for the
  // same document from ever colliding on the committed name.
  const inboxDir = ".vantage/inbox";
  const fileStem = filePath.replace(/[/\\]/g, "__");
  const exampleId = example?.id.slice(0, 8) ?? "<short-id>";
  const exampleRound = example ? (example.reactions ?? []).length : 0;
  return [
    "## Responding to Comments",
    "",
    ...followUpNote,
    "After addressing your comments: **save the document first**, then deliver your responses with a single command from the root of this document's repository:",
    "",
    "```bash",
    `mkdir -p ${inboxDir} && f=${inboxDir}/${fileStem}.$RANDOM.jsonl && cat > "$f.writing" <<'EOF'`,
    `{"path":"${filePath}","id":"${exampleId}","round":${exampleRound},"summary":"Reworded the paragraph for clarity","nonce":"k7f29qd1x4"}`,
    "EOF",
    'mv "$f.writing" "$f"',
    "```",
    "",
    "One JSON object per line, one line per comment you acted on. The fields:",
    "",
    "```",
    `{"path":"${filePath}","id":"<short-id>","round":<round>,"summary":"<one sentence: what you changed>","nonce":"<fresh random string>"}`,
    "```",
    "",
    "The command writes to a `.writing` scratch name, then `mv`s it onto the `.jsonl` name. That rename is the completion signal: Vantage ignores every non-`.jsonl` name, so it never reads the file until the whole delivery is in place. **Do not write directly to the `.jsonl` name** (`cat > x.jsonl`) — that creates the file empty before the write lands, and Vantage can consume the empty file and drop your response. (If your shell has no `$RANDOM`, substitute any unique token for the suffix. Never append line-by-line.)",
    "",
    "### Delivery rules",
    "",
    "- **Save the document before delivering.** Vantage reads the document from disk at delivery time to record what changed; delivering first records a stale version.",
    `- **Check the document before delivering.** From the root of this document's repo, run \`uvx vantage-check ${filePath}\` and fix what it reports — it verifies the document actually renders in Vantage. If \`uvx\` is unavailable, proceed: it is a quality gate, not a delivery dependency.`,
    "- **One line per comment you acted on.** Skip the rest — a line claiming work you did not do reads to the reviewer as an answered comment.",
    "- **Copy `id` and `round` from the heading of the comment you are answering** (they are shown there as `` `[id]` `` and `` `round:N` ``). The round says which turn you answered, so a follow-up the reviewer writes while you work is not mistaken for something your answer already covered.",
    "- **Generate a fresh random nonce for every line**, and **do not re-deliver a line you have already delivered**. The nonce is how Vantage tells a new response from a redelivered one; a line with a reused nonce is silently dropped.",
    "- **A fresh `.jsonl` file per delivery.** The `$RANDOM` suffix ensures this; each file is consumed and deleted whole, so a new delivery never overwrites one still waiting.",
    "",
    "### How your summary is displayed",
    "",
    "The summary is rendered **inline in the document**, directly below the commented paragraph — the reviewer sees it right next to the original text and their comment. This means:",
    "- **Do NOT restate context.** The reviewer already sees the paragraph and their comment. Your summary should say *what you did*, not re-explain what the paragraph says.",
    "- **Keep it short.** One sentence is ideal. The summary shares a narrow column with the comment text and a before/after diff.",
    '- **Be specific about your action.** Good: "Split into two paragraphs and added the exception case." Bad: "The substrate is a typed-dataflow graph so I updated the text to reflect..."',
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
