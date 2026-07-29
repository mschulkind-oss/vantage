import { FileWarning } from "lucide-react";

/**
 * Shown when the document has changed under a comment still waiting on the
 * agent — the text that comment is about is no longer the text on screen.
 *
 * One bit, no count. The reviewer's response to this is to re-read the document
 * before handing the comments over, which is a whole-document action; knowing
 * that it was two of five comments rather than one would not change it. The
 * per-comment truth is already visible where it does change something: the
 * drifted block renders faint with its comment card marked, and a comment whose
 * block is gone renders detached, quoting the text it was written against.
 */
export function CommentsDriftedIndicator() {
  return (
    <span
      className="flex items-center space-x-1.5 text-xs text-amber-600 dark:text-amber-500 px-2 py-1.5"
      role="status"
      aria-label="The document changed under comments awaiting a response"
      title="The document changed under comments still awaiting a response — the text they were written about is no longer what's on screen. Re-read before copying them to an agent."
    >
      <FileWarning size={14} className="shrink-0" />
      <span className="hidden sm:inline">document changed</span>
    </span>
  );
}
