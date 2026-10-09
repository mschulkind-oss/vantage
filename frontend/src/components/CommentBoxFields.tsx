/**
 * The React half of a comment box (`lib/commentAutosave.ts`): the textarea
 * that hands the box what was typed, and the foot that says where its saves
 * stand beside its one button, **Close**. The popover, the review panel and
 * the app shell's list of unsaved comments draw their boxes with these; the
 * document's inline boxes are hand-built DOM with the same classes
 * (`hooks/useReviewHighlights.ts`).
 */
import React, { useEffect, useState } from "react";
import { useCommentBox } from "../hooks/useCommentBox";
import {
  closeHint,
  closesBox,
  statusText,
  STATUS_TICK_MS,
  type BoxState,
  type CommentBox,
} from "../lib/commentAutosave";

interface CommentBoxTextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> {
  box: CommentBox;
  /** Close the box: Ctrl+Enter, ⌘+Enter and Esc do. */
  onClose: () => void;
}

/** The box's textarea: every keystroke goes to the box, which saves on its own. */
export const CommentBoxTextarea = React.forwardRef<
  HTMLTextAreaElement,
  CommentBoxTextareaProps
>(function CommentBoxTextarea({ box, onClose, onKeyDown, ...rest }, ref) {
  const state = useCommentBox(box);
  return (
    <textarea
      ref={ref}
      {...rest}
      value={state.text}
      onChange={(e) => box.input(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (closesBox(e)) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    />
  );
});

/** The words for `state` now, read again as the minutes pass. */
function useStatusText(state: BoxState): string {
  const [now, setNow] = useState(() => Date.now());
  const ticking = state.status === "saved";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), STATUS_TICK_MS);
    return () => clearInterval(id);
  }, [ticking]);
  // A save that lands is "just now" whatever the last tick read.
  const at = Math.max(now, state.savedAt ?? 0);
  return statusText(state, at);
}

/**
 * The box's foot: the hint, the status, and Close. The status pulses once for
 * each save that lands, by remounting with the count as its key.
 */
export const CommentBoxFoot: React.FC<{
  box: CommentBox;
  onClose: () => void;
}> = ({ box, onClose }) => {
  const state = useCommentBox(box);
  const text = useStatusText(state);
  const pulse = state.saves > 0 && state.status === "saved" && !state.empty;
  const gone = state.status === "gone";
  return (
    <>
      <div className="comment-box-foot">
        <span className="comment-box-hint">{closeHint()}</span>
        <span
          key={state.saves}
          role="status"
          className={
            "comment-box-status" +
            (state.status === "retrying" || gone
              ? " comment-box-status--retrying"
              : "") +
            (pulse ? " comment-box-status--pulse" : "")
          }
        >
          {text}
        </span>
        <button type="button" className="comment-box-close" onClick={onClose}>
          Close
        </button>
      </div>
      {gone && <GoneActions box={box} />}
    </>
  );
};

/**
 * What a box whose comment was deleted offers for its text
 * (`docs/design/planning-to-do-list.md` §6.2): **Copy text**, and **Post as a
 * new comment**, which files it anew and goes on saving it there.
 */
export const GoneActions: React.FC<{ box: CommentBox }> = ({ box }) => {
  const state = useCommentBox(box);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="comment-box-foot">
      <button
        type="button"
        className="comment-box-close"
        onClick={() =>
          void box.copyText().then((ok) => setCopy(ok ? "copied" : "failed"))
        }
      >
        {copy === "copied" || state.copied
          ? "Copied"
          : copy === "failed"
            ? "Copy failed"
            : "Copy text"}
      </button>
      {state.canPost && (
        <button
          type="button"
          className="comment-box-close"
          onClick={() => box.postAsNew()}
        >
          Post as a new comment
        </button>
      )}
    </div>
  );
};
