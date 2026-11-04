/**
 * The planning page header's updates slot (`docs/reference/planning-index.md`
 * §6.3, §6.4): *N updates · Refresh* while the page holds late data back
 * from its layout, and nothing otherwise.
 *
 * Its room is kept from the first paint, as Copy answers' count is: the
 * button is always in the header, invisible while there is nothing to apply,
 * with the count in a slot of a few digits and its words in a cell as wide
 * as the longer of them. So its appearing moves nothing. Where the header is
 * narrow, its words give way with every button's (`hdr-label`), and the icon
 * and the count stay; it is never folded into the "⋯", where an update would
 * be hidden. Its title lists the updates by kind.
 */
import React from "react";
import { RefreshCw, RotateCw } from "lucide-react";
import { planningLimits } from "../planningScan/limits";
import type { ReloadStatus } from "../hooks/usePlanningReviews";

const words = (n: number) => `${n === 1 ? "update" : "updates"} · Refresh`;

export const PlanningUpdates: React.FC<{
  /** The held updates' count; `0` hides the button and keeps its room. */
  count: number;
  /** The updates by kind, as *2 new replies, 1 done*. */
  title: string;
  onRefresh: () => void;
  /**
   * Why applying is refused now (an open answer holds changes), or null.
   * Apply updates never saves, restores or closes such an answer itself.
   */
  blockedReason?: string | null;
}> = ({ count, title, onRefresh, blockedReason: blocked = null }) => {
  const shown = count > 0;
  let blockedReason = blocked;
  // Nothing to apply, nothing to refuse: the reason shows with the button.
  if (!shown) blockedReason = null;
  return (
    <button
      type="button"
      data-planning-updates
      onClick={blockedReason === null ? onRefresh : undefined}
      disabled={blockedReason !== null}
      data-tip={
        blockedReason !== null
          ? blockedReason
          : shown
            ? `Apply updates, with no request: ${title}`
            : undefined
      }
      aria-label={
        shown
          ? `Apply updates: ${count.toLocaleString("en-US")} ${count === 1 ? "update" : "updates"} (${title})${blockedReason === null ? "" : `. ${blockedReason}`}`
          : blockedReason === null
            ? undefined
            : blockedReason
      }
      aria-hidden={shown || blockedReason !== null ? undefined : true}
      tabIndex={shown || blockedReason !== null ? undefined : -1}
      className={
        "inline-flex items-center gap-1.5 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 print:hidden dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30" +
        (shown || blockedReason !== null ? "" : " invisible") +
        (blockedReason !== null ? " cursor-not-allowed opacity-60" : "")
      }
    >
      <RefreshCw size={14} aria-hidden="true" />
      <span
        data-testid="planning-updates-count"
        className="inline-block text-right tabular-nums"
        style={{ minWidth: `${planningLimits.pendingCountDigits - 1}ch` }}
      >
        {shown ? count.toLocaleString("en-US") : ""}
      </span>
      {/* As wide as its longer words, so 1 becoming 2 moves nothing. */}
      <span className="hdr-label hdr-label-minor inline-grid">
        <span className="[grid-area:1/1]">{words(count)}</span>
        <span aria-hidden="true" className="invisible [grid-area:1/1]">
          {words(2)}
        </span>
      </span>
    </button>
  );
};

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * *Reload from server*, and beside it the Unknown pill once a reload has
 * failed or has seen the document change while it was read. It reads the
 * server again and changes no painted body: Apply updates is what lays the
 * page out.
 */
export const PlanningReload: React.FC<{
  status: ReloadStatus;
  onReload: () => void;
}> = ({ status, onReload }) => {
  const failed = status.lastFailureAt !== null;
  const unknown = failed || status.sampleChanged;
  const parts: string[] = [];
  if (status.lastSuccessAt !== null) {
    parts.push(`last successful read ${clock(status.lastSuccessAt)}`);
  }
  if (status.lastFailureAt !== null) {
    parts.push(`last attempt failed ${clock(status.lastFailureAt)}`);
  }
  if (status.sampleChanged) {
    parts.push("the document changed while it was read, so Reload again");
  }
  return (
    <>
      {unknown && (
        <span
          data-planning-reload-status
          role="status"
          className="rounded-md border border-blue-300 px-2 py-1 text-xs text-blue-600 print:hidden dark:border-blue-700 dark:text-blue-400"
        >
          Unknown · {parts.join(" · ")}
        </span>
      )}
      <button
        type="button"
        data-planning-reload
        onClick={onReload}
        disabled={status.running}
        data-tip="Read the document and its reviews from the server again. Layout waits for Apply updates."
        className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-60 print:hidden dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30"
      >
        <RotateCw size={14} aria-hidden="true" />
        <span className="hdr-label hdr-label-minor">Reload from server</span>
      </button>
    </>
  );
};
