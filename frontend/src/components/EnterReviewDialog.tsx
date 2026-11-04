import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { OQ_ANSWER_LABEL, OQ_LABEL } from "../hooks/useOpenQuestionButtons";

/**
 * The consent a question's row asks for outside review mode: answering is a
 * review comment, so it turns review mode on first. Confirm continues the
 * action the reader clicked; Cancel and Escape change nothing.
 *
 * Focus starts on the confirming button, Tab stays inside, and focus returns
 * to the control that opened it (when it is still in the document).
 */
export function EnterReviewDialog({
  kind,
  opener,
  onConfirm,
  onCancel,
}: {
  kind: "take" | "answer";
  opener: HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirm.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  const action = kind === "take" ? OQ_LABEL : OQ_ANSWER_LABEL;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="enter-review-title"
        aria-describedby="enter-review-body"
        className="w-full max-w-md rounded-lg bg-white p-5 text-sm shadow-xl dark:bg-slate-800 dark:text-slate-100"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key !== "Tab") return;
          const buttons = Array.from(
            box.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
          );
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <h2 id="enter-review-title" className="mb-2 text-base font-semibold">
          Enter review mode?
        </h2>
        <p id="enter-review-body" className="mb-4">
          {action} files a review comment, so this document switches to review
          mode first. Your place in the document is kept, and the action then
          happens once. Cancel leaves the document, and your comments, as they
          are.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="comment-box-close"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirm}
            type="button"
            className="comment-box-close"
            onClick={onConfirm}
          >
            Enter review mode
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** What changed, and how to continue — shown where the reader is looking. */
export function EntryNotice({
  text,
  onDismiss,
}: {
  text: string;
  onDismiss: () => void;
}) {
  return createPortal(
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-start gap-3 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 shadow-md dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
    >
      <span>{text}</span>
      <button
        type="button"
        className="font-medium underline"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>,
    document.body,
  );
}
