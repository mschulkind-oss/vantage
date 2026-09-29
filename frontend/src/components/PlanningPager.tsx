/**
 * The pager of one section of the planning page
 * (`docs/design/planning-index-at-scale.md` §10.2):
 * `1–10 of 143 · ‹ Previous · Next ›`, and a page select in a long section.
 *
 * It sits under the section's heading and again after its last entry, at a
 * fixed height, so nothing it shows moves anything else. Its buttons are
 * disabled at the ends. A section of one page has none, which is its caller's
 * choice, not this component's.
 *
 * When the pointer or the focus reaches it, it asks for the next page's inputs
 * ahead of the click, so a flip usually has them in hand.
 */
import React from "react";
import { Loader2 } from "lucide-react";
import { planningLimits } from "../planningScan/limits";

export type PagerPlace = "top" | "bottom";

interface PlanningPagerProps {
  /** The section's name, for the pager's own label. */
  title: string;
  /** The page shown, 1-based, and how many there are. */
  page: number;
  pageCount: number;
  /** The shown page's first entry, 0-based, and one past its last. */
  start: number;
  end: number;
  /** Entries in the whole section. */
  total: number;
  place: PagerPlace;
  /** Show `page` of the section. */
  onFlip: (page: number, place: PagerPlace) => void;
  /** Ask for `page`'s inputs ahead of a flip to it. */
  onPrefetch?: (page: number) => void;
  /** A flip of this section has waited long enough to say so. */
  busy?: boolean;
}

const BUTTON =
  "rounded px-1.5 py-0.5 font-medium text-blue-600 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent dark:text-blue-400 dark:hover:bg-slate-700 dark:disabled:text-slate-500";

export const PlanningPager: React.FC<PlanningPagerProps> = ({
  title,
  page,
  pageCount,
  start,
  end,
  total,
  place,
  onFlip,
  onPrefetch,
  busy = false,
}) => {
  const prefetchNext = () => {
    if (page < pageCount) onPrefetch?.(page + 1);
  };
  return (
    <nav
      aria-label={place === "top" ? `${title} pages` : `${title} pages, below`}
      data-planning-pager={place}
      className="my-2 flex h-7 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
      onPointerEnter={prefetchNext}
      onFocus={prefetchNext}
    >
      <span className="tabular-nums">
        {(start + 1).toLocaleString("en-US")}–{end.toLocaleString("en-US")} of{" "}
        {total.toLocaleString("en-US")}
      </span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className={BUTTON}
        disabled={page <= 1}
        onClick={() => onFlip(page - 1, place)}
      >
        ‹ Previous
      </button>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className={BUTTON}
        disabled={page >= pageCount}
        onClick={() => onFlip(page + 1, place)}
      >
        Next ›
      </button>
      {pageCount >= planningLimits.pageSelectFrom && (
        <select
          aria-label={`${title} page`}
          value={page}
          onChange={(e) => onFlip(Number(e.target.value), place)}
          className="ml-1 h-6 rounded border border-slate-300 bg-transparent px-1 tabular-nums dark:border-slate-600"
        >
          {Array.from({ length: pageCount }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Page {i + 1}
            </option>
          ))}
        </select>
      )}
      {/* Always there, so a spinner that shows moves nothing. */}
      <span className="inline-flex w-4 justify-center" aria-live="polite">
        {busy && (
          <Loader2
            size={12}
            className="animate-spin"
            aria-label="Loading the page"
          />
        )}
      </span>
    </nav>
  );
};
