import { Loader2 } from "lucide-react";

/**
 * A quiet "an agent is working in this document" marker for the review header.
 *
 * It is informational, not a warning: the underlying signal is that the document
 * changed on disk while comments were still waiting on a response, which is
 * consistent with an agent mid-turn and with nothing else the reviewer needs to
 * act on. There is no dismiss affordance because there is nothing to acknowledge
 * — it clears itself when the response lands.
 *
 * This replaced a dismissible amber banner that claimed the agent's response had
 * been lost to a retired protocol. That claim was not something the server could
 * know, so the honest version reports the activity and lets the reviewer draw
 * their own conclusion.
 */
export function AgentWorkingIndicator() {
  return (
    <span
      className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 px-2 py-1.5"
      // A live region would announce this on every save; it is ambient status,
      // so it is exposed as a label a screen reader reaches on demand instead.
      role="status"
      aria-label="An agent is working on this document"
      title="This document changed while comments were awaiting a response — an agent is working on it."
    >
      <Loader2 size={14} className="animate-spin shrink-0" />
      <span className="hidden sm:inline">agent working</span>
    </span>
  );
}
