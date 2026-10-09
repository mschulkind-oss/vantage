import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ClipboardCopy,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  hasAgentReaction,
  isAnsweredByAgent,
  isPendingForAgent,
  reviewTarget,
  useReviewStore,
} from "../stores/useReviewStore";
import type { CommentReaction, ReviewComment } from "../types";
import { AnchoredMenu } from "./AnchoredMenu";
import { CommentBoxFoot, CommentBoxTextarea } from "./CommentBoxFields";
import type { CommentBox } from "../lib/commentAutosave";
import { editCommentBox, replyBox } from "../lib/reviewBoxes";

interface ReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The filters partition comments by *whose turn it is*, so every state is
 * reachable through exactly one tab and "Needs agent" selects precisely the
 * set the Copy button sends.  (The previous "Awaiting reaction" tab keyed off
 * "has the agent ever replied", which excluded replied-to threads — the very
 * comments Copy was about to send.)
 */
type Filter = "all" | "needs_agent" | "answered" | "resolved";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  needs_agent: "Needs agent",
  answered: "Answered",
  resolved: "Resolved",
};

/**
 * Scroll the document to a comment's inline block and flash it.  The inline
 * surface owns that DOM, so this addresses it by the same attribute the
 * minimap stripe uses rather than reaching through React.
 */
function scrollToComment(id: string): void {
  const el = document.querySelector(`[data-review-inline-comment="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("review-inline-comment--flash");
  setTimeout(() => el.classList.remove("review-inline-comment--flash"), 1200);
}

/** Minimum gap between arming a confirm and it accepting, to defeat a double-click. */
const CONFIRM_MIN_MS = 350;

function clearCopyTimer(
  ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
): void {
  if (ref.current) clearTimeout(ref.current);
  ref.current = null;
}

function commentMatchesFilter(c: ReviewComment, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "resolved") return !!c.resolved;
  if (f === "needs_agent") return isPendingForAgent(c);
  if (f === "answered") return isAnsweredByAgent(c);
  return true;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const comments = useReviewStore((s) => s.comments);
  const deleteComment = useReviewStore((s) => s.deleteComment);
  const dismissComment = useReviewStore((s) => s.dismissComment);
  const dismissAll = useReviewStore((s) => s.dismissAll);
  const dismissAnswered = useReviewStore((s) => s.dismissAnswered);
  const commandError = useReviewStore((s) => s.commandError);
  const clearCommandError = useReviewStore((s) => s.clearCommandError);
  const unresolveComment = useReviewStore((s) => s.unresolveComment);
  const copyAllToClipboard = useReviewStore((s) => s.copyAllToClipboard);
  const copyCommentToClipboard = useReviewStore(
    (s) => s.copyCommentToClipboard,
  );
  const endReview = useReviewStore((s) => s.endReview);

  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // The edit box and the reply box open in the panel, if any. Each saves as
  // the reviewer types (`lib/commentAutosave.ts`), so closing one only stops
  // drawing it.
  const filePath = useReviewStore((s) => s.filePath);
  const [editing, setEditing] = useState<CommentBox | null>(null);
  const [replying, setReplying] = useState<CommentBox | null>(null);
  const editingId = editing?.subject.commentId ?? null;
  const replyingId = replying?.subject.commentId ?? null;
  const openEdit = (c: ReviewComment) => {
    const target = filePath === null ? null : reviewTarget(filePath);
    if (target !== null) setEditing(editCommentBox(target, c));
  };
  const openReply = (c: ReviewComment) => {
    const target = filePath === null ? null : reviewTarget(filePath);
    if (target !== null) setReplying(replyBox(target, c));
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  // Which button last failed to write the clipboard: a comment id, "all" for
  // the footer button, or null.  A clipboard write can be rejected (missing
  // permission, non-secure context) and used to fail completely silently.
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One ref per confirm: sharing a single timer let arming either one cancel
  // the other's disarm, stranding it armed indefinitely.
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which comment's delete button is armed, if any.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedDeleteAt = useRef(0);

  // Counts (computed from full comment list, regardless of active filter)
  const counts = useMemo(
    () => ({
      all: comments.length,
      needs_agent: comments.filter(isPendingForAgent).length,
      answered: comments.filter(isAnsweredByAgent).length,
      resolved: comments.filter((c) => c.resolved).length,
    }),
    [comments],
  );

  // A comment with a box open stays listed whatever its saves make of it: a
  // reply on a dismissed comment reopens it, and moving it out of the Resolved
  // view would take the box away from the reviewer typing in it.
  const visible = useMemo(
    () =>
      comments.filter(
        (c) =>
          commentMatchesFilter(c, filter) ||
          c.id === editingId ||
          c.id === replyingId,
      ),
    [comments, filter, editingId, replyingId],
  );

  // Closing the panel disarms the destructive confirms. Without this, arming
  // "Dismiss all" or "End review (delete all data)" and then closing left the
  // confirm armed, so reopening within the 3s window turned the next single
  // click destructive. Adjusting state during render (React's documented
  // "reset state when a prop changes" pattern) rather than in an effect keeps
  // the panel correct on its own, without depending on the parent to unmount it.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setConfirmDismiss(false);
      setConfirmEnd(false);
      setConfirmDeleteId(null);
      setMenuOpen(false);
      // The pending timers are left to fire: they only ever disarm, so a late
      // one is a no-op against the flags already cleared here. Clearing them
      // would be a side effect in render for no benefit.
    }
  }

  // An open edit/reply box does not outlive its comment: one deleted
  // underneath it closes it, and the box, which keeps its text, says whether
  // what it held could be saved. Adjusted during render rather than in an
  // effect, so the inconsistent state never reaches the DOM.
  const liveIds = useMemo(() => new Set(comments.map((c) => c.id)), [comments]);
  if (editingId && !liveIds.has(editingId)) setEditing(null);
  if (replyingId && !liveIds.has(replyingId)) setReplying(null);
  if (confirmDeleteId && !liveIds.has(confirmDeleteId))
    setConfirmDeleteId(null);
  // Switching tabs can unmount the armed row. Leaving it armed means the
  // reviewer returns to a button that deletes on the very next click, with no
  // "Delete?" label ever shown to them.
  const [armedUnderFilter, setArmedUnderFilter] = useState(filter);
  if (confirmDeleteId && armedUnderFilter !== filter) {
    setConfirmDeleteId(null);
    setArmedUnderFilter(filter);
  } else if (armedUnderFilter !== filter) {
    setArmedUnderFilter(filter);
  }

  useEffect(
    () => () => {
      clearCopyTimer(copyTimer);
      clearCopyTimer(confirmTimer);
      clearCopyTimer(endTimer);
      clearCopyTimer(deleteTimer);
    },
    [],
  );

  if (!isOpen) return null;

  const activeCount = counts.all - counts.resolved;
  // Answered, not outdated — the same split the inline toolbar makes.
  const answeredCount = comments.filter(isAnsweredByAgent).length;
  const pendingCount = comments.filter(isPendingForAgent).length;

  // One shared timer for every Copy flash, always cleared before rearming, so
  // a second click restarts the full 2s instead of inheriting the first
  // click's remaining time.
  const flashCopied = (target: string, ok: boolean) => {
    clearCopyTimer(copyTimer);
    setCopied(ok && target === "all");
    setCopiedId(ok && target !== "all" ? target : null);
    setCopyFailed(ok ? null : target);
    copyTimer.current = setTimeout(() => {
      setCopied(false);
      setCopiedId(null);
      setCopyFailed(null);
    }, 2000);
  };

  const handleCopy = async () => {
    flashCopied("all", await copyAllToClipboard());
  };

  const handleCopyComment = async (id: string) => {
    flashCopied(id, await copyCommentToClipboard(id));
  };

  // Confirm windows are held in a ref and cleared before rearming. A bare
  // setTimeout leaks across close/reopen cycles: an earlier timer would fire
  // partway through a later confirm window and silently disarm it, so the
  // reviewer gets less than the 3s the UI implies.
  const armConfirm = (
    ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    set: (v: boolean) => void,
  ) => {
    if (ref.current) clearTimeout(ref.current);
    set(true);
    ref.current = setTimeout(() => set(false), 3000);
  };

  const handleDeleteComment = (id: string) => {
    // A physical double-click is two clicks, and would otherwise arm and fire
    // in one gesture — defeating the guard entirely. The confirm only counts
    // once the reviewer has had time to read the "Delete?" label.
    if (
      confirmDeleteId === id &&
      Date.now() - armedDeleteAt.current >= CONFIRM_MIN_MS
    ) {
      setConfirmDeleteId(null);
      deleteComment(id);
      return;
    }
    if (confirmDeleteId === id) return; // too fast — ignore, stay armed
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setConfirmDeleteId(id);
    armedDeleteAt.current = Date.now();
    deleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 3000);
  };

  const handleEndReview = () => {
    if (confirmEnd) {
      endReview();
      setConfirmEnd(false);
      setMenuOpen(false);
      onClose();
    } else {
      armConfirm(endTimer, setConfirmEnd);
    }
  };

  const handleDismiss = () => {
    if (confirmDismiss) {
      dismissAll();
      setConfirmDismiss(false);
    } else if (answeredCount > 0) {
      dismissAnswered();
    } else {
      armConfirm(confirmTimer, setConfirmDismiss);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90] bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[91] w-96 max-w-[90vw] bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare
              size={16}
              className="text-slate-500 dark:text-slate-400"
            />
            <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">
              Review Comments
            </span>
            {activeCount > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                {activeCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                ref={menuTriggerRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                title="More actions"
              >
                <MoreHorizontal size={18} />
              </button>
              <AnchoredMenu
                open={menuOpen}
                onClose={closeMenu}
                anchorRef={menuTriggerRef}
                width={224}
                aria-label="More actions"
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={handleEndReview}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <Trash2 size={12} />
                    {confirmEnd
                      ? "Confirm end & delete data?"
                      : "End review (delete all data)"}
                  </button>
                </div>
              </AnchoredMenu>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {commandError && (
          <div className="px-3 py-2 border-b border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 flex items-start gap-2">
            <AlertCircle
              size={13}
              className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
            />
            <div className="min-w-0 flex-1 text-[11px] text-red-700 dark:text-red-300">
              <p className="font-medium">Not saved: {commandError.message}</p>
              {commandError.draft && (
                <p className="mt-0.5 whitespace-pre-wrap break-words opacity-80">
                  Your text: {commandError.draft}
                </p>
              )}
            </div>
            <button
              onClick={clearCommandError}
              className="shrink-0 p-0.5 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40"
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {comments.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 flex flex-wrap gap-1.5">
            {(["all", "needs_agent", "answered", "resolved"] as Filter[]).map(
              (f) => {
                const count = counts[f];
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={
                      filter === f
                        ? "px-2 py-0.5 text-[11px] rounded-full bg-blue-600 text-white"
                        : "px-2 py-0.5 text-[11px] rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                    }
                  >
                    {FILTER_LABEL[f]} ({count})
                  </button>
                );
              },
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500 dark:text-slate-400 text-sm">
              <MessageSquare size={24} className="mb-2 opacity-40" />
              <p>No comments yet</p>
              <p className="text-xs mt-1">
                Select text in the document to add comments
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-500 dark:text-slate-400 text-sm">
              <p>No comments in this view</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {visible.map((c) => {
                const agentReaction = hasAgentReaction(c);
                // Reply is offered once the agent has answered; Dismiss is
                // offered on every open comment. They used to be exclusive,
                // with the answered branch rendering a "Dismiss" that actually
                // recorded an acceptance turn.
                const showReply = !c.resolved && agentReaction;
                const showDismiss = !c.resolved;
                const fallback = c.fallback_text || c.selected_text || "";
                return (
                  <div key={c.id} className="px-4 py-3 group">
                    <div className="flex items-start justify-between gap-2">
                      <div
                        onClick={() => scrollToComment(c.id)}
                        title="Jump to this comment in the document"
                        className={
                          c.resolved
                            ? "flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 flex-1 cursor-pointer"
                            : "text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded px-2 py-1 border-l-2 border-blue-400 line-clamp-2 flex-1 cursor-pointer"
                        }
                      >
                        {c.resolved && (
                          <CheckCircle2
                            size={12}
                            className="text-green-500 shrink-0"
                          />
                        )}
                        <span
                          className={
                            c.resolved ? "line-clamp-1 line-through" : undefined
                          }
                        >
                          {fallback || "(whole-block comment)"}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {!c.resolved && (
                          <button
                            onClick={() => openEdit(c)}
                            // Reveal-on-hover, but only where hovering exists.
                            // Tailwind already gates group-hover: behind
                            // (hover: hover) — the bare opacity-0 was not, so
                            // on a touch screen Edit and Delete sat at zero
                            // opacity with no gesture that could reveal them.
                            className="p-1 rounded [@media(hover:hover)]:opacity-0 group-hover:opacity-100 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-500 dark:text-slate-400 hover:text-blue-500 transition-opacity"
                            title="Edit comment"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        {/* Two-click, like the panel's other destructive
                            actions: delete throws away the agent's replies
                            too, and there is no undo. */}
                        <button
                          onClick={() => handleDeleteComment(c.id)}
                          className={
                            confirmDeleteId === c.id
                              ? "flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium bg-red-600 text-white"
                              : "p-1 rounded [@media(hover:hover)]:opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-500 dark:text-slate-400 hover:text-red-500 transition-opacity"
                          }
                          title={
                            confirmDeleteId === c.id
                              ? "Click again to delete this comment and its replies"
                              : "Delete comment"
                          }
                        >
                          <Trash2 size={12} />
                          {confirmDeleteId === c.id && "Delete?"}
                        </button>
                      </div>
                    </div>
                    {editing !== null && editingId === c.id ? (
                      <PanelBox
                        box={editing}
                        onClose={() => setEditing(null)}
                        rows={3}
                      />
                    ) : (
                      <p
                        className={
                          c.resolved
                            ? "mt-1 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap line-through"
                            : "mt-1.5 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap"
                        }
                      >
                        {c.comment}
                      </p>
                    )}

                    <ThreadView
                      comment={c}
                      editingReplyId={
                        replyingId === c.id
                          ? replying?.subject.replyId
                          : undefined
                      }
                    />

                    {replying !== null && replyingId === c.id && (
                      <PanelBox
                        box={replying}
                        onClose={() => setReplying(null)}
                        rows={2}
                        placeholder="Follow-up for the agent..."
                      />
                    )}

                    {replyingId !== c.id && (
                      <div className="mt-2 flex justify-end gap-1.5">
                        {isPendingForAgent(c) && (
                          <button
                            onClick={() => handleCopyComment(c.id)}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                            title="Copy this comment thread to send back to the agent"
                          >
                            {copiedId === c.id ? (
                              <>
                                <Check size={11} /> Copied!
                              </>
                            ) : copyFailed === c.id ? (
                              <>
                                <AlertCircle size={11} /> Copy failed
                              </>
                            ) : (
                              <>
                                <ClipboardCopy size={11} /> Copy
                              </>
                            )}
                          </button>
                        )}
                        {showReply && (
                          <button
                            onClick={() => openReply(c)}
                            className="px-2 py-1 text-[11px] rounded text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            Reply
                          </button>
                        )}
                        {showDismiss && (
                          <button
                            onClick={() => dismissComment(c.id)}
                            className="px-2 py-1 text-[11px] rounded text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                            title="Dismiss this comment"
                          >
                            Dismiss
                          </button>
                        )}
                        {/* Reopen is offered for EVERY resolved comment, not
                            just agent-answered ones: a comment dismissed
                            before the agent ever saw it was otherwise
                            unrecoverable on every surface. */}
                        {c.resolved && (
                          <>
                            <button
                              onClick={() => unresolveComment(c.id)}
                              className="px-2 py-1 text-[11px] rounded text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                              title="Reopen this comment without writing a reply"
                            >
                              Reopen
                            </button>
                            <button
                              onClick={() => openReply(c)}
                              className="px-2 py-1 text-[11px] rounded text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                            >
                              Reopen &amp; Reply
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {comments.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 shrink-0">
            {activeCount > 0 && (
              <button
                onClick={handleDismiss}
                className={`flex items-center justify-center gap-1.5 min-w-[160px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  confirmDismiss
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-slate-700 dark:bg-slate-600 text-white hover:bg-slate-800 dark:hover:bg-slate-500"
                }`}
              >
                <Check size={12} />
                {confirmDismiss
                  ? "Confirm dismiss all?"
                  : answeredCount > 0
                    ? `Dismiss Answered (${answeredCount})`
                    : `Dismiss All (${activeCount})`}
              </button>
            )}
            <button
              onClick={handleCopy}
              disabled={pendingCount === 0}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {copied ? (
                <>
                  <Check size={12} /> Copied!
                </>
              ) : copyFailed === "all" ? (
                <>
                  <AlertCircle size={12} /> Copy failed
                </>
              ) : (
                <>
                  <ClipboardCopy size={12} /> Copy ({pendingCount})
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
};

/** Label and badge styling for one turn in a thread. */
function turnStyle(r: CommentReaction): { label: string; className: string } {
  if (r.actor === "agent") {
    return r.kind === "wont_fix"
      ? { label: "Agent", className: "review-reaction-badge--declined" }
      : { label: "Agent", className: "review-reaction-badge--agent" };
  }
  return { label: "You", className: "review-reaction-badge--reviewer" };
}

/**
 * The full back-and-forth for one comment, in order.  Rendering only the last
 * agent reaction (as this panel used to) made the reviewer's own replies vanish
 * the instant they were submitted, and hid every earlier round of a thread.
 */
const ThreadView: React.FC<{
  comment: ReviewComment;
  /** A reply the open reply box is still editing, shown in the box instead. */
  editingReplyId?: string;
}> = ({ comment, editingReplyId }) => {
  // Legacy "noted" turns are dropped, not relabeled: they recorded a dismissal
  // through a since-removed accept action, and dismissing is a flag on the
  // comment rather than something either party said. Rendering them stacked up
  // "You accepted" rows that no reviewer ever typed.
  const reactions = (comment.reactions ?? []).filter(
    (r) =>
      r.kind !== "noted" &&
      (editingReplyId === undefined || r.id !== editingReplyId),
  );
  if (reactions.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {reactions.map((r, i) => {
        const { label, className } = turnStyle(r);
        return (
          <div key={i} className="review-reaction">
            <div className="review-reaction-header">
              <span className={`review-reaction-badge ${className}`}>
                {label}
              </span>
              <span className="review-reaction-summary">{r.summary}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * An edit or reply box in the panel: open while drawn, and closed — which
 * saves what it holds — however it goes, by Close, Ctrl+Enter or ⌘+Enter, Esc,
 * the panel closing or the page going.
 */
const PanelBox: React.FC<{
  box: CommentBox;
  onClose: () => void;
  rows: number;
  placeholder?: string;
}> = ({ box, onClose, rows, placeholder }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.open();
    ref.current?.focus();
    return () => box.close();
  }, [box]);
  const close = () => {
    box.close();
    onClose();
  };
  return (
    <div className="mt-1.5">
      <CommentBoxTextarea
        ref={ref}
        box={box}
        onClose={close}
        rows={rows}
        placeholder={placeholder}
        className="w-full text-sm rounded-md border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-2 py-1.5 resize-y min-h-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <CommentBoxFoot box={box} onClose={close} />
    </div>
  );
};
