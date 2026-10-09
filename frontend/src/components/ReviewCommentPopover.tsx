import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, X } from "lucide-react";
import { popoverPosition } from "../lib/popoverPosition";
import type { CommentBox } from "../lib/commentAutosave";
import { CommentBoxFoot, CommentBoxTextarea } from "./CommentBoxFields";

interface ReviewCommentPopoverProps {
  selectedText: string;
  rect: DOMRect;
  /**
   * The box the popover types into, made once when it opens: its first save
   * creates the comment, its later ones edit it (`lib/commentAutosave.ts`).
   */
  makeBox: () => CommentBox;
  /**
   * The reader closed the popover: Close, the ✕, Ctrl+Enter or ⌘+Enter, Esc,
   * or a click outside it. The box is closed by then, which saves what it
   * holds, so nothing typed is lost; the owner only stops drawing it.
   * Unmounting the popover any other way closes the box the same way.
   */
  onClose: (box: CommentBox) => void;
}

/**
 * The new-comment box: a comment on a block or a selection in review mode,
 * and the box **Answer…** opens on a document and on a planning card. It
 * saves as the reader types and has no Save and no Cancel
 * (`docs/reference/comment-autosave.md` §3.2).
 */
export const ReviewCommentPopover: React.FC<ReviewCommentPopoverProps> = ({
  selectedText,
  rect,
  makeBox,
  onClose,
}) => {
  const [box] = useState(makeBox);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Open while drawn, and closed — saving what it holds — however the popover
  // goes: a file switch, review mode turned off, or leaving the page.
  useEffect(() => {
    box.open();
    return () => box.close();
  }, [box]);

  const close = useCallback(() => {
    box.close();
    onClose(box);
  }, [box, onClose]);

  useEffect(() => {
    // Small delay so the popover renders before we focus — avoids the
    // browser collapsing the selection on immediate focus steal.
    const id = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  // Esc anywhere closes it, keeping the text.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close]);

  // So does a click outside it.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        close();
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
  }, [close]);

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
      data-comment-popover
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
          type="button"
          onClick={close}
          title="Close"
          aria-label="Close"
          className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
        >
          <X size={14} />
        </button>
      </div>
      <div className="p-3 space-y-2">
        <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded px-2 py-1.5 border-l-2 border-blue-400 max-h-24 overflow-y-auto whitespace-pre-wrap">
          {truncated}
        </div>
        <CommentBoxTextarea
          ref={textareaRef}
          box={box}
          onClose={close}
          placeholder="Your comment..."
          rows={6}
          className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-3 py-2 resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <CommentBoxFoot box={box} onClose={close} />
      </div>
    </div>,
    document.body,
  );
};
