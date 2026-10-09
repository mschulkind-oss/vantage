/**
 * The planning page header's updates slot (`docs/design/planning-to-do-list.md`
 * §3.1, §4.3): *N updates · Refresh* while the page holds late data back
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
import { RefreshCw } from "lucide-react";
import { planningLimits } from "../planningScan/limits";

const words = (n: number) => `${n === 1 ? "update" : "updates"} · Refresh`;

export const PlanningUpdates: React.FC<{
  /** The held updates' count; `0` hides the button and keeps its room. */
  count: number;
  /** The updates by kind, as *2 new replies, 1 done*. */
  title: string;
  onRefresh: () => void;
}> = ({ count, title, onRefresh }) => {
  const shown = count > 0;
  return (
    <button
      type="button"
      data-planning-updates
      onClick={onRefresh}
      title={shown ? `Lay the page out again: ${title}` : undefined}
      aria-label={
        shown
          ? `Refresh: ${count.toLocaleString("en-US")} ${count === 1 ? "update" : "updates"} (${title})`
          : undefined
      }
      aria-hidden={shown ? undefined : true}
      tabIndex={shown ? undefined : -1}
      className={
        "inline-flex items-center gap-1.5 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 print:hidden dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30" +
        (shown ? "" : " invisible")
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
      <span className="hdr-label inline-grid">
        <span className="[grid-area:1/1]">{words(count)}</span>
        <span aria-hidden="true" className="invisible [grid-area:1/1]">
          {words(2)}
        </span>
      </span>
    </button>
  );
};
