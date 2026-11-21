/**
 * The planning page header's freshness slot
 * (`docs/reference/planning-ownership.md` §8): **Update · N** while the
 * page holds late data back from its layout, **Offline since HH:MM ·
 * retrying** with **Retry now** once its reads have failed for 30 s, and
 * nothing while it is current.
 *
 * Update's room is kept from the first paint, as Copy answers' count is: the
 * button is always in the header, invisible while there is nothing to lay
 * out, with the count in a slot of a few digits. So its appearing moves
 * nothing. It is never folded into the "⋯", where an update would be
 * hidden; at the narrowest widths its word yields with the other labels and
 * the icon and count stay. Its title lists the updates
 * by kind.
 */
import React from "react";
import { CloudOff, ListChecks, RotateCw } from "lucide-react";
import { planningLimits } from "../planningScan/limits";

/** Why Update waits while an answer box is open (OQ-FS4). */
export const UPDATE_BLOCKED =
  "Close the open answer first — what you typed is saved";

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const PlanningUpdates: React.FC<{
  /** The held updates' count; `0` hides the button and keeps its room. */
  count: number;
  /** The updates by kind, as *2 new replies, 1 done*. */
  title: string;
  onRefresh: () => void;
  /**
   * Why updating is refused now (an answer box is open), or null. Update
   * never saves, restores or closes an answer itself.
   */
  blockedReason?: string | null;
  /**
   * `Date.now()` of the first of the reads that have failed for 30 s, when
   * the page is offline; null otherwise. The slot then says so instead.
   */
  offlineSince?: number | null;
  /** Retry now: read again at once what failed. */
  onRetry?: () => void;
}> = ({
  count,
  title,
  onRefresh,
  blockedReason: blocked = null,
  offlineSince = null,
  onRetry,
}) => {
  if (offlineSince !== null) {
    return (
      <span
        data-planning-offline
        role="status"
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-600 px-2 py-1 text-xs whitespace-nowrap text-amber-700 print:hidden dark:border-amber-400 dark:text-amber-400"
      >
        <CloudOff size={14} aria-hidden="true" />
        <span>Offline since {clock(offlineSince)} · retrying</span>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-amber-50 dark:hover:bg-amber-900/30"
        >
          <RotateCw size={12} aria-hidden="true" />
          Retry now
        </button>
      </span>
    );
  }
  const shown = count > 0;
  // Nothing to lay out, nothing to refuse: the reason shows with the button.
  const blockedReason = shown ? blocked : null;
  const noun = count === 1 ? "update" : "updates";
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
            ? `Lay out what has changed, and check the server for anything newer: ${title}`
            : undefined
      }
      aria-label={
        shown
          ? `Update: ${count.toLocaleString("en-US")} ${noun} (${title})${blockedReason === null ? "" : `. ${blockedReason}`}`
          : undefined
      }
      aria-hidden={shown ? undefined : true}
      tabIndex={shown ? undefined : -1}
      className={
        "inline-flex items-center gap-1.5 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 print:hidden dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30" +
        (shown ? "" : " invisible") +
        (blockedReason !== null ? " cursor-not-allowed opacity-60" : "")
      }
    >
      <ListChecks size={14} aria-hidden="true" />
      {/* The word and its dot give their room up with the other toolbar
          labels (`labels`, `lib/headerFit.ts`), leaving the icon and the
          count. At a phone's width the row has no room for the word and
          the repository's Folders control both. */}
      <span className="hdr-label whitespace-nowrap">Update</span>
      <span aria-hidden="true" className="hdr-label">
        ·
      </span>
      <span
        data-testid="planning-updates-count"
        className="inline-block text-right tabular-nums"
        style={{ minWidth: `${planningLimits.pendingCountDigits - 1}ch` }}
      >
        {shown ? count.toLocaleString("en-US") : ""}
      </span>
    </button>
  );
};
