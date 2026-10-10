/**
 * *Needs you*, as a to-do list (`docs/reference/planning-index.md` §6.4):
 * its heading with the live count of questions that need you and the
 * answered rows it lists; the answered rows, the first few and then *… N
 * more answered · Show*; the full cards, with the rows of cards answered in
 * place where they were; and the end line, *M more need you · show 10 | 20 |
 * 30 | 50*.
 *
 * What it lists, and as what, is the layout's (`lib/planningLayout.ts`),
 * which only the reader's own actions change: the numbers here change live,
 * in slots kept for them, and nothing else does (§6.4).
 */
import React, { useLayoutEffect, useRef } from "react";
import { ChevronDown, Undo2 } from "lucide-react";
import type { PlanningQuestion } from "vantage-md/planning";
import {
  OQ_ANSWERED_HINT,
  OQ_ANSWERED_LABEL,
  OQ_TAKEN_DISMISSED_LABEL,
  OQ_TAKEN_LABEL,
  OQ_TAKEN_REPLIED_LABEL,
  OQ_UNDO_LABEL,
  takeUndoable,
} from "../hooks/useOpenQuestionButtons";
import {
  MARK_LABELS,
  NEW_REPLY_LABEL,
  type Mark,
  type NeedsYouItem,
  type NeedsYouView,
  type RowAnswer,
} from "../lib/planningLayout";
import { planningCardId } from "../lib/planningCardId";
import { cn } from "../lib/utils";
import { AppLink } from "./AppLink";

/** A count in a slot as wide as `room` digits, so its changes move nothing. */
export const LiveCount: React.FC<{
  n: number;
  room?: number;
  testId?: string;
}> = ({ n, room = 3, testId }) => {
  const text = n.toLocaleString("en-US");
  return (
    <span
      data-testid={testId}
      className="inline-block tabular-nums"
      style={{ minWidth: `${Math.max(room, text.length)}ch` }}
    >
      {text}
    </span>
  );
};

/**
 * A late change's marks, in an item's own line: the New reply mark's words,
 * a button that opens the reply, and each other mark as text (§6.4).
 */
export const ItemMarks: React.FC<{
  marks: readonly Mark[];
  newReply: boolean;
  onNewReply?: () => void;
}> = ({ marks, newReply, onNewReply }) => (
  <>
    {newReply && (
      <button
        type="button"
        data-planning-new-reply
        onClick={onNewReply}
        className="shrink-0 rounded px-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
      >
        {NEW_REPLY_LABEL}
      </button>
    )}
    {marks.map((mark) => (
      <span
        key={mark}
        data-planning-mark={mark}
        className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400"
      >
        {MARK_LABELS[mark]}
      </span>
    ))}
  </>
);

/** The New reply mark's bar, in the item's left gutter: room it already has. */
export const NewReplyBar: React.FC = () => (
  <span
    aria-hidden="true"
    data-planning-new-reply-bar
    className="pointer-events-none absolute inset-y-1 left-0 w-1 rounded-full bg-blue-500"
  />
);

/** How long a card answered here takes to shrink to its row. */
const ROW_SHRINK_MS = 320;
/** How long the row it shrank to stays tinted green after. */
const ROW_FLASH_MS = 1600;
/** The green the row starts from, painted over its own background. */
const ROW_FLASH = "inset 0 0 0 100vmax rgb(34 197 94 / 0.22)";

/**
 * A card answered here becoming its row (§6.4), so the reader sees it go
 * rather than finding the next question where it was: the row starts at the
 * card's height, with its one line where the card's top was, and its bottom
 * edge sweeps up to the line, carrying what is below up with it; then the row
 * fades from green. The pane keeps its scroll while it does, so nothing above
 * the row moves. For a reader who asked for less motion the row is at its
 * height at once, and only the green fades: a change of color moves nothing.
 */
function shrinkToRow(row: HTMLElement, from: number): void {
  if (typeof row.animate !== "function") return;
  const still =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const to = row.getBoundingClientRect().height;
  if (!still && from > to) {
    const pane = row.closest<HTMLElement>("[data-content-scroll]");
    pane?.style.setProperty("overflow-anchor", "none");
    // Border-box, so height less padding is the line's own height throughout.
    const shrink = row.animate(
      [
        { height: `${from}px`, paddingBottom: `${from - to}px` },
        { height: `${to}px`, paddingBottom: "0px" },
      ],
      { duration: ROW_SHRINK_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
    const resume = () => pane?.style.removeProperty("overflow-anchor");
    shrink.onfinish = resume;
    shrink.oncancel = resume;
  }
  row.animate([{ boxShadow: ROW_FLASH }, { boxShadow: "none" }], {
    duration: ROW_FLASH_MS,
    easing: "ease-in",
  });
}

/**
 * An answered row (§6.4): one line, its marker, id and
 * title, the chip its card shows, Undo on a take that is still the whole
 * thread, and Show, which opens it into its card where it stands.
 */
export const AnsweredRow: React.FC<{
  question: PlanningQuestion;
  itemKey: string;
  href: string;
  answer: RowAnswer;
  marks: readonly Mark[];
  newReply: boolean;
  /** Its card is on its way, for Show or Undo: inert, not disabled. */
  opening: boolean;
  onShow: () => void;
  onUndo?: () => void;
  onNewReply: () => void;
  onOpenHere?: () => void;
  /**
   * The height of the card answered here that this row has just replaced,
   * asked for once as the row mounts; `undefined` for any other row.
   */
  shrunkFrom?: () => number | undefined;
}> = ({
  question,
  itemKey,
  href,
  answer,
  marks,
  newReply,
  opening,
  onShow,
  onUndo,
  onNewReply,
  onOpenHere,
  shrunkFrom,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const shrunkFromRef = useRef(shrunkFrom);
  useLayoutEffect(() => {
    const from = shrunkFromRef.current?.();
    if (from !== undefined && rowRef.current !== null) {
      shrinkToRow(rowRef.current, from);
    }
  }, []);
  const chip =
    answer === null
      ? null
      : answer.kind === "answered"
        ? OQ_ANSWERED_LABEL
        : answer.kind === "taken"
          ? OQ_TAKEN_LABEL
          : answer.replied
            ? OQ_TAKEN_REPLIED_LABEL
            : OQ_TAKEN_DISMISSED_LABEL;
  const undoable =
    answer !== null &&
    answer.kind !== "answered" &&
    takeUndoable(answer.comment) &&
    onUndo !== undefined;
  return (
    <div
      ref={rowRef}
      id={planningCardId(question.path, question.id, question.unitLine)}
      role="group"
      aria-label={question.title}
      data-planning-row
      data-planning-item={itemKey}
      className="relative flex h-9 min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-slate-200 bg-white px-4 text-sm whitespace-nowrap dark:border-slate-700 dark:bg-slate-800"
    >
      {newReply && <NewReplyBar />}
      <span
        aria-hidden="true"
        className="shrink-0 text-green-600 dark:text-green-400"
      >
        ✓
      </span>
      <AppLink
        to={href}
        onBeforeNavigate={() => onOpenHere?.()}
        className="shrink-0 font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
      >
        {question.id ?? question.path}
      </AppLink>
      <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
        {question.title}
      </span>
      {/* Every slot after the title keeps its room whatever it holds, so a
          late change of a mark, the chip or Undo moves nothing in the row
          (planning-index.md §12.1). */}
      <span className="flex w-20 shrink-0 justify-end">
        <ItemMarks marks={marks} newReply={newReply} onNewReply={onNewReply} />
      </span>
      <span className="inline-grid shrink-0 justify-items-start">
        {/* Drawn from `data-reserve` by the stylesheet, so the room adds no
            text to the page (`ReservedLabel`'s ghosts). */}
        {CHIP_LABELS.map((label) => (
          <span
            key={label}
            aria-hidden="true"
            className="hdr-reserve-ghost [grid-area:1/1]"
          >
            <span data-reserve={label} className="review-oq-taken" />
          </span>
        ))}
        {chip !== null && (
          <span
            className={cn(
              "[grid-area:1/1]",
              answer?.kind === "answered"
                ? "review-oq-answered"
                : answer?.kind === "taken"
                  ? "review-oq-taken"
                  : "review-oq-taken review-oq-taken--past",
            )}
            title={answer?.kind === "answered" ? OQ_ANSWERED_HINT : undefined}
          >
            {chip}
          </span>
        )}
      </span>
      <span
        className={cn("shrink-0", !undoable && "invisible")}
        aria-hidden={undoable ? undefined : true}
      >
        <button
          type="button"
          className="review-oq-undo"
          title="Delete the review comment the take filed"
          tabIndex={undoable ? undefined : -1}
          aria-disabled={opening ? "true" : undefined}
          onClick={() => {
            if (undoable && !opening) onUndo?.();
          }}
        >
          <Undo2 size={12} aria-hidden="true" className="mr-0.5 inline" />
          {OQ_UNDO_LABEL}
        </button>
      </span>
      <button
        type="button"
        data-planning-row-show
        aria-label={`Show ${question.title}`}
        aria-disabled={opening ? "true" : undefined}
        onClick={() => {
          if (!opening) onShow();
        }}
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        Show
      </button>
    </div>
  );
};

/** Every chip an answered row can show, whose room its slot keeps. */
const CHIP_LABELS = [
  OQ_ANSWERED_LABEL,
  OQ_TAKEN_LABEL,
  OQ_TAKEN_REPLIED_LABEL,
  OQ_TAKEN_DISMISSED_LABEL,
];

/** `1 more answered`, `10 more answered`. */
const moreAnswered = (n: number) =>
  `… ${n.toLocaleString("en-US")} more answered`;

export const PlanningNeedsYou: React.FC<{
  /** The line under its heading. */
  explanation: string;
  /** The questions that need you, live (§6.4): the heading's first count. */
  needYou: number;
  view: NeedsYouView;
  pageSize: number;
  pageSizes: readonly number[];
  item: (item: NeedsYouItem) => React.ReactNode;
  onShowAnswered: () => void;
  onPageSize: (size: number) => void;
  /** The roadmap picker, drawn at its heading's end where it has one. */
  headingExtra?: React.ReactNode;
}> = ({
  explanation,
  needYou,
  view,
  pageSize,
  pageSizes,
  item,
  onShowAnswered,
  onPageSize,
  headingExtra,
}) => {
  // Whether the layout on screen still paints a full card: the end line says
  // *Nothing needs you* only where none is left, never under a card still
  // shown, which an answer from elsewhere only marks (§6.4).
  const cardsPainted = view.list.some((i) => i.as === "card");
  const sizes = (
    <span className="inline-flex items-center gap-1">
      show{" "}
      {pageSizes.map((size, at) => (
        <React.Fragment key={size}>
          {at > 0 && (
            <span
              aria-hidden="true"
              className="text-slate-500 dark:text-slate-400"
            >
              {" | "}
            </span>
          )}
          <button
            type="button"
            aria-pressed={size === pageSize}
            onClick={() => onPageSize(size)}
            className={cn(
              "rounded px-1 tabular-nums hover:bg-slate-100 dark:hover:bg-slate-700",
              size === pageSize
                ? "font-semibold text-slate-800 dark:text-slate-100"
                : "text-blue-600 dark:text-blue-400",
            )}
          >
            {size}
          </button>
        </React.Fragment>
      ))}
    </span>
  );
  return (
    <section
      aria-labelledby="needs-you"
      aria-describedby="about-needs-you"
      className="mb-10"
    >
      <div className="flex flex-wrap items-center gap-x-3">
        <h2
          id="needs-you"
          tabIndex={-1}
          className="scroll-mt-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
        >
          Needs you{" "}
          <span className="ml-1 font-normal">
            <LiveCount n={needYou} testId="needs-you-count" />
          </span>
          {view.rows > 0 && (
            <span
              data-planning-section-answered
              className="font-normal tracking-normal normal-case"
            >
              {" · "}
              <LiveCount n={view.rows} room={1} /> answered
            </span>
          )}
        </h2>
        {headingExtra}
      </div>
      <p
        id="about-needs-you"
        data-planning-section-about
        className="mt-0.5 mb-3 text-[13px] text-slate-500 dark:text-slate-400"
      >
        {explanation}
      </p>
      <div className="space-y-3">
        {view.top.map((i) => (
          <React.Fragment key={i.key}>{item(i)}</React.Fragment>
        ))}
        {view.hiddenAnswered > 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {moreAnswered(view.hiddenAnswered)} ·{" "}
            <button
              type="button"
              data-planning-more-answered
              onClick={onShowAnswered}
              className="inline-flex items-center gap-0.5 text-blue-600 hover:underline dark:text-blue-400"
            >
              Show
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          </p>
        )}
        {view.list.map((i) => (
          <React.Fragment key={i.key}>{item(i)}</React.Fragment>
        ))}
      </div>
      <p
        data-testid="needs-you-end"
        className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-slate-500 print:hidden dark:text-slate-400"
      >
        {view.more > 0 ? (
          <>
            <span>
              {view.more.toLocaleString("en-US")} more{" "}
              {view.more === 1 ? "needs" : "need"} you ·
            </span>{" "}
            {sizes}
          </>
        ) : cardsPainted ? (
          sizes
        ) : (
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Nothing needs you
          </span>
        )}
      </p>
    </section>
  );
};
