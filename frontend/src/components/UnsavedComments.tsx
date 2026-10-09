/**
 * The app shell's word on comments not saved yet
 * (`docs/design/planning-to-do-list.md` §6.2). A comment box saves as the
 * reader types and keeps retrying a save that fails; one closed with text not
 * yet saved hands it to the same retries (`lib/commentAutosave.ts`). So while
 * any box is retrying, or closed with text still on its way, this says how
 * many comments are not saved and lists them, each with **Reopen**, which
 * opens its box here holding the text it was closed with. And while any text
 * typed in any box is not saved, leaving or reloading the tab asks first, and
 * sends what it can.
 *
 * It floats over the page's corner rather than taking a line of the frame, so
 * a save that fails moves nothing the reader is looking at.
 */
import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { CommentBox } from "../lib/commentAutosave";
import {
  useBoxesToReport,
  useUnsavedCommentsGuard,
} from "../hooks/useCommentBox";
import {
  CommentBoxFoot,
  CommentBoxTextarea,
  GoneActions,
} from "./CommentBoxFields";

/** A reported box, reopened here: its textarea and foot. */
const ReopenedBox: React.FC<{ box: CommentBox; onClose: () => void }> = ({
  box,
  onClose,
}) => {
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
        rows={3}
        className="w-full text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 px-2 py-1.5 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <CommentBoxFoot box={box} onClose={close} />
    </div>
  );
};

export const UnsavedComments: React.FC = () => {
  useUnsavedCommentsGuard();
  const reported = useBoxesToReport();
  const [listOpen, setListOpen] = useState(false);
  const [reopened, setReopened] = useState<CommentBox | null>(null);

  // A box reopened here stays drawn while it is open, even once its saves
  // land and it is no longer one to report.
  const shown =
    reopened !== null && !reported.includes(reopened)
      ? [...reported, reopened]
      : reported;
  if (shown.length === 0) return null;

  // A comment deleted under its box is not retried, so it is counted apart.
  const deleted = reported.filter(
    (box) => box.getState().status === "gone",
  ).length;
  const retrying = reported.length - deleted;
  const summary = [
    retrying === 1
      ? "1 comment not saved, retrying"
      : retrying > 1
        ? `${retrying} comments not saved, retrying`
        : "",
    deleted === 1
      ? "1 comment deleted, your text kept"
      : deleted > 1
        ? `${deleted} comments deleted, your text kept`
        : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <div
      data-unsaved-comments
      role="region"
      aria-label="Comments not saved"
      className="fixed bottom-4 left-4 z-[95] w-80 max-w-[calc(100vw-32px)] rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 shadow-lg dark:border-amber-700 dark:bg-slate-800 dark:text-slate-100"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
        <span className="flex-1 font-medium" role="status">
          {summary === "" ? "Comment reopened" : summary}
        </span>
        <button
          type="button"
          aria-expanded={listOpen}
          onClick={() => setListOpen((v) => !v)}
          className="rounded px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900"
        >
          {listOpen ? "Hide" : "Show"}
        </button>
      </div>
      {(listOpen || reopened !== null) && (
        <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
          {shown.map((box) => (
            <li
              key={`${box.subject.kind}:${box.subject.commentId}:${box.subject.replyId ?? ""}`}
              className="rounded border border-amber-200 bg-white/60 p-2 dark:border-amber-800 dark:bg-slate-900/60"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{box.subject.label}</span>
                  {" · "}
                  {box.subject.target.path}
                </span>
                {box !== reopened && !box.isOpen && (
                  <button
                    type="button"
                    onClick={() => setReopened(box)}
                    className="rounded px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900"
                  >
                    Reopen
                  </button>
                )}
              </div>
              {box === reopened ? (
                <ReopenedBox box={box} onClose={() => setReopened(null)} />
              ) : (
                <>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words opacity-80">
                    {box.typed}
                  </p>
                  {box.getState().status === "gone" && (
                    <>
                      <p className="mt-1 font-medium">
                        This comment was deleted
                      </p>
                      <GoneActions box={box} />
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
