import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, X } from "lucide-react";
import { popoverPosition } from "../lib/popoverPosition";

interface ReviewCommentPopoverProps {
  selectedText: string;
  rect: DOMRect;
  onSave: (comment: string) => void;
  onCancel: () => void;
}

export const ReviewCommentPopover: React.FC<ReviewCommentPopoverProps> = ({
  selectedText,
  rect,
  onSave,
  onCancel,
}) => {
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Small delay so the popover renders before we focus — avoids the
    // browser collapsing the selection on immediate focus steal.
    const id = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  // Close on click outside the popover
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onCancel();
      }
    };
    // Delay registration so the mouseup that opened us doesn't immediately close us
    const id = setTimeout(
      () => document.addEventListener("mousedown", handler),
      100,
    );
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onCancel]);

  const handleSave = () => {
    const trimmed = comment.trim();
    if (trimmed) onSave(trimmed);
  };

  const truncated =
    selectedText.length > 200
      ? selectedText.slice(0, 200) + "..."
      : selectedText;

  const { top, left } = popoverPosition(
    rect,
    window.innerWidth,
    window.innerHeight,
  );

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[100] w-[440px] max-w-[calc(100vw-32px)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl"
      style={{ top, left }}
      onMouseDown={(e) => e.stopPropagation()} // prevent outside-click handler
    >
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          <MessageSquarePlus size={12} />
          Add Comment
        </div>
        <button
          onClick={onCancel}
          className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"
        >
          <X size={14} />
        </button>
      </div>
      <div className="p-3 space-y-2">
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded px-2 py-1.5 border-l-2 border-blue-400 max-h-24 overflow-y-auto whitespace-pre-wrap">
          {truncated}
        </div>
        <textarea
          ref={textareaRef}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder="Your comment..."
          rows={6}
          className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-3 py-2 resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            {/Mac|iPhone/.test(navigator.userAgent) ? "⌘" : "Ctrl"}+Enter to
            save
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded-md text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!comment.trim()}
              className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
