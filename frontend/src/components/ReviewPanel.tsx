import React, { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useReviewStore } from "../stores/useReviewStore";
import type { ReviewComment } from "../types";

interface ReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Filter = "all" | "with_reaction" | "awaiting" | "resolved";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  with_reaction: "With reaction",
  awaiting: "Awaiting reaction",
  resolved: "Resolved",
};

function hasAgentReaction(c: ReviewComment): boolean {
  return (c.reactions ?? []).some((r) => r.actor === "agent");
}

function commentMatchesFilter(c: ReviewComment, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "resolved") return !!c.resolved;
  if (c.resolved) return false;
  if (f === "with_reaction") return hasAgentReaction(c);
  if (f === "awaiting") return !hasAgentReaction(c);
  return true;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const comments = useReviewStore((s) => s.comments);
  const deleteComment = useReviewStore((s) => s.deleteComment);
  const editComment = useReviewStore((s) => s.editComment);
  const resolveComment = useReviewStore((s) => s.resolveComment);
  const dismissComment = useReviewStore((s) => s.dismissComment);
  const dismissAll = useReviewStore((s) => s.dismissAll);
  const dismissOutdated = useReviewStore((s) => s.dismissOutdated);
  const outdatedCommentIds = useReviewStore((s) => s.outdatedCommentIds);
  const replyToComment = useReviewStore((s) => s.replyToComment);
  const reopenAndReply = useReviewStore((s) => s.reopenAndReply);
  const copyAllToClipboard = useReviewStore((s) => s.copyAllToClipboard);
  const endReview = useReviewStore((s) => s.endReview);

  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  // Counts (computed from full comment list, regardless of active filter)
  const counts = useMemo(() => {
    const total = comments.length;
    const resolved = comments.filter((c) => c.resolved).length;
    const active = total - resolved;
    const withReaction = comments.filter(
      (c) => !c.resolved && hasAgentReaction(c),
    ).length;
    const awaiting = active - withReaction;
    return { all: total, withReaction, awaiting, resolved };
  }, [comments]);

  const visible = useMemo(
    () => comments.filter((c) => commentMatchesFilter(c, filter)),
    [comments, filter],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  if (!isOpen) return null;

  const activeCount = counts.all - counts.resolved;
  const outdatedCount = comments.filter(
    (c) => !c.resolved && outdatedCommentIds.has(c.id),
  ).length;
  const pendingCount = comments.filter(
    (c) =>
      !c.resolved &&
      !(c.reactions ?? []).some(
        (r) => r.actor === "agent" && r.kind === "addressed",
      ),
  ).length;

  const handleCopy = async () => {
    const ok = await copyAllToClipboard();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEndReview = () => {
    if (confirmEnd) {
      endReview();
      setConfirmEnd(false);
      setMenuOpen(false);
      onClose();
    } else {
      setConfirmEnd(true);
      setTimeout(() => setConfirmEnd(false), 3000);
    }
  };

  const handleDismiss = () => {
    if (confirmDismiss) {
      dismissAll();
      setConfirmDismiss(false);
    } else if (outdatedCount > 0) {
      dismissOutdated();
    } else {
      setConfirmDismiss(true);
      setTimeout(() => setConfirmDismiss(false), 3000);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90] bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[91] w-96 max-w-[90vw] bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-slate-500" />
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
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"
                title="More actions"
              >
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-full mt-1 w-56 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1 z-10"
                >
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
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {comments.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 flex flex-wrap gap-1.5">
            {(["all", "with_reaction", "awaiting", "resolved"] as Filter[]).map(
              (f) => {
                const count =
                  f === "all"
                    ? counts.all
                    : f === "with_reaction"
                      ? counts.withReaction
                      : f === "awaiting"
                        ? counts.awaiting
                        : counts.resolved;
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
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-sm">
              <MessageSquare size={24} className="mb-2 opacity-40" />
              <p>No comments yet</p>
              <p className="text-xs mt-1">
                Select text in the document to add comments
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm">
              <p>No comments in this view</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {visible.map((c) => {
                const agentReaction = (c.reactions ?? [])
                  .slice()
                  .reverse()
                  .find((r) => r.actor === "agent");
                const showResolve = !c.resolved && !!agentReaction;
                const showDismiss = !c.resolved && !agentReaction;
                const fallback = c.fallback_text || c.selected_text || "";
                return (
                  <div key={c.id} className="px-4 py-3 group">
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className={
                          c.resolved
                            ? "flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 flex-1"
                            : "text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded px-2 py-1 border-l-2 border-blue-400 line-clamp-2 flex-1"
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
                            onClick={() => {
                              setEditingId(c.id);
                              setEditText(c.comment);
                              setTimeout(() => editRef.current?.focus(), 0);
                            }}
                            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-400 hover:text-blue-500 transition-opacity"
                            title="Edit comment"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteComment(c.id)}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 transition-opacity"
                          title="Delete comment"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-1.5">
                        <textarea
                          ref={editRef}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              const trimmed = editText.trim();
                              if (trimmed && trimmed !== c.comment) {
                                editComment(c.id, trimmed);
                              }
                              setEditingId(null);
                            }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          rows={3}
                          className="w-full text-sm rounded-md border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-2 py-1.5 resize-y min-h-[48px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <div className="flex justify-end gap-1.5 mt-1">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1 text-[11px] rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const trimmed = editText.trim();
                              if (trimmed && trimmed !== c.comment) {
                                editComment(c.id, trimmed);
                              }
                              setEditingId(null);
                            }}
                            className="px-2 py-1 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-700"
                          >
                            Save
                          </button>
                        </div>
                      </div>
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

                    {agentReaction && (
                      <ReactionView summary={agentReaction.summary} />
                    )}

                    {replyingId === c.id && (
                      <div className="mt-1.5">
                        <textarea
                          ref={replyRef}
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              const trimmed = replyText.trim();
                              if (trimmed) {
                                if (c.resolved) {
                                  reopenAndReply(c.id, trimmed);
                                } else {
                                  replyToComment(c.id, trimmed);
                                }
                              }
                              setReplyingId(null);
                              setReplyText("");
                            }
                            if (e.key === "Escape") {
                              setReplyingId(null);
                              setReplyText("");
                            }
                          }}
                          rows={2}
                          placeholder="Follow-up for the agent..."
                          className="w-full text-sm rounded-md border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-2 py-1.5 resize-y min-h-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <div className="flex justify-end gap-1.5 mt-1">
                          <button
                            onClick={() => {
                              setReplyingId(null);
                              setReplyText("");
                            }}
                            className="px-2 py-1 text-[11px] rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const trimmed = replyText.trim();
                              if (trimmed) {
                                if (c.resolved) {
                                  reopenAndReply(c.id, trimmed);
                                } else {
                                  replyToComment(c.id, trimmed);
                                }
                              }
                              setReplyingId(null);
                              setReplyText("");
                            }}
                            className="px-2 py-1 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-700"
                          >
                            {c.resolved ? "Reopen & Reply" : "Reply"}
                          </button>
                        </div>
                      </div>
                    )}

                    {replyingId !== c.id && (
                      <div className="mt-2 flex justify-end gap-1.5">
                        {showResolve && (
                          <>
                            <button
                              onClick={() => {
                                setReplyingId(c.id);
                                setReplyText("");
                                setTimeout(() => replyRef.current?.focus(), 0);
                              }}
                              className="px-2 py-1 text-[11px] rounded text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              Reply
                            </button>
                            <button
                              onClick={() => resolveComment(c.id)}
                              className="px-2 py-1 text-[11px] rounded text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                              title="Dismiss — the agent already addressed this"
                            >
                              Dismiss
                            </button>
                          </>
                        )}
                        {showDismiss && (
                          <button
                            onClick={() => dismissComment(c.id)}
                            className="px-2 py-1 text-[11px] rounded text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                            title="Dismiss without recording an agent reaction"
                          >
                            Dismiss
                          </button>
                        )}
                        {c.resolved && hasAgentReaction(c) && (
                          <button
                            onClick={() => {
                              setReplyingId(c.id);
                              setReplyText("");
                              setTimeout(() => replyRef.current?.focus(), 0);
                            }}
                            className="px-2 py-1 text-[11px] rounded text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                          >
                            Reopen &amp; Reply
                          </button>
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
                  : outdatedCount > 0
                    ? `Dismiss Outdated (${outdatedCount})`
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

const ReactionView: React.FC<{
  summary: string;
}> = ({ summary }) => {
  return (
    <div className="review-reaction mt-2">
      <div className="review-reaction-header">
        <span className="review-reaction-badge">Agent</span>
        <span className="review-reaction-summary">{summary}</span>
      </div>
    </div>
  );
};
