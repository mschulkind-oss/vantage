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
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Undo2 } from "lucide-react";
import type { PlanningQuestion } from "vantage-md/planning";
import { OQ_UNDO_LABEL, takeUndoable } from "../hooks/useOpenQuestionButtons";
import {
  MARK_LABELS,
  NEW_REPLY_LABEL,
  type Mark,
  type NeedsYouItem,
  type NeedsYouView,
  type RowAnswers,
} from "../lib/planningLayout";
import { editCommentBox, type OnSaved } from "../lib/reviewBoxes";
import { isStaticMode } from "../lib/staticMode";
import { planningCardId } from "../lib/planningCardId";
import { planningLimits } from "../planningScan/limits";
import { reducedMotion } from "../lib/reducedMotion";
import { holdScrollRoom } from "../lib/scrollRoom";
import { isPendingForAgent, reviewTarget } from "../stores/useReviewStore";
import type { ReviewComment } from "../types";
import { cn } from "../lib/utils";
import { AppLink } from "./AppLink";
import { ReviewCommentPopover } from "./ReviewCommentPopover";

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
/**
 * How much of that the tint takes to arrive, as a fraction of it: about an
 * eighth of a second, so the green lands with the shrink rather than before it.
 */
const ROW_FLASH_IN = 0.08;
/** The green the row starts from, painted over its own background. */
const ROW_FLASH = "inset 0 0 0 100vmax rgb(34 197 94 / 0.22)";
/**
 * A one-line answered row's height in rem: the fallback when the row's own
 * height cannot be measured, as under jsdom.
 */
const ROW_REM = 2.25;

/**
 * The row drawn at the card's height. Its column is top-aligned, so the
 * height is all the room and the content stays where the card's top was while
 * the room below it closes.
 */
function tallRow(from: number): React.CSSProperties {
  return { height: `${from}px` };
}

/** The row's own height, with the answers it shows, measured without paint. */
function rowHeight(row: HTMLElement): number {
  const height = row.style.height;
  row.style.height = "auto";
  const measured = row.getBoundingClientRect().height;
  row.style.height = height;
  return (
    measured ||
    parseFloat(getComputedStyle(document.documentElement).fontSize) * ROW_REM
  );
}

/**
 * A card answered here becoming its row (§6.4), so the reader sees it go
 * rather than finding the next question where it was: the row is drawn at
 * the card's height, with its one line where the card's top was, and its
 * bottom edge sweeps up to the line, carrying what is below up with it; then
 * the row fades from green. Its top stays where it is on screen, and so
 * does everything above it. For a reader who asked for less motion the
 * row is at its height at once, and only the green fades: a change of color
 * moves nothing.
 *
 * Near the end of the list the page getting shorter by the card would have
 * the browser pull the pane's scroll back, sliding everything on screen down
 * as the row shrinks, so the pane holds that room at its end until it
 * scrolls out of view (`holdScrollRoom`). The row is drawn tall for the
 * same reason, even with less motion: a layout that saw it at one line
 * first would already have pulled the scroll back.
 */
function shrinkToRow(
  row: HTMLElement,
  from: number,
  to: number,
  move: boolean,
): void {
  const pane = row.closest<HTMLElement>("[data-content-scroll]");
  if (pane !== null) holdScrollRoom(pane, from - to);
  if (typeof row.animate !== "function") return;
  if (move) {
    row.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: ROW_SHRINK_MS,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  }
  // The tint arrives with the shrink rather than at the swap: painted at full
  // strength from the first frame, before the box had moved at all, the green
  // was the loudest thing in the transition — a card's worth of it changing
  // color in one frame. It reaches full at `ROW_FLASH_IN` and fades from
  // there, so the reader sees the green land as the box starts to close.
  row.animate(
    [
      { boxShadow: "none", offset: 0, easing: "ease-out" },
      {
        boxShadow: ROW_FLASH,
        offset: ROW_FLASH_IN,
        easing: "ease-in",
      },
      { boxShadow: "none", offset: 1 },
    ],
    { duration: ROW_FLASH_MS },
  );
}

/**
 * An answered row (§6.4): its marker, id and title; the leaning it filed and
 * the comments the reader wrote, each cut to `answerChars` with the whole of
 * it in the tooltip; Undo on a leaning that is still the whole thread, Edit on
 * a pending comment; and Show, which opens it into its card where it stands. The leaning is drawn as the text the reader did not write:
 * italic, behind a *Leaning:* label.
 */
export const AnsweredRow: React.FC<{
  question: PlanningQuestion;
  itemKey: string;
  href: string;
  /** The leaning and comments it shows; `null` when nothing answered it. */
  answers: RowAnswers | null;
  marks: readonly Mark[];
  newReply: boolean;
  /** Its card is on its way, for Show or Undo: inert, not disabled. */
  opening: boolean;
  onShow: () => void;
  onUndo?: (comment: ReviewComment) => void;
  /**
   * A press on Edit, so the page knows this item is the reader's own and
   * shows it from the live reviews, not the ones the layout painted.
   */
  onEdit?: () => void;
  /** Told of every save of an edit box, as a card's box tells the page. */
  onSaved?: OnSaved;
  onNewReply: () => void;
  onOpenHere?: () => void;
  /**
   * The height of the card answered here that this row replaces, read as
   * the row mounts; `undefined` for any other row.
   */
  shrinkFrom?: number;
  /** `shrinkFrom` has been read, so the page can forget it. */
  onShrunk?: () => void;
}> = ({
  question,
  itemKey,
  href,
  answers,
  marks,
  newReply,
  opening,
  onShow,
  onUndo,
  onEdit,
  onSaved,
  onNewReply,
  onOpenHere,
  shrinkFrom,
  onShrunk,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  // Only as it mounts: a card that became this row just now.
  const [shrink] = useState(() =>
    shrinkFrom === undefined
      ? null
      : { from: shrinkFrom, move: !reducedMotion() },
  );
  // Drawn at the card's height until the shrink has taken over from it.
  const [tall, setTall] = useState(shrink !== null);
  const played = useRef(false);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (shrink === null || row === null || played.current) return;
    played.current = true;
    shrinkToRow(row, shrink.from, rowHeight(row), shrink.move);
    setTall(false);
  }, [shrink]);
  const onShrunkRef = useRef(onShrunk);
  useLayoutEffect(() => {
    onShrunkRef.current = onShrunk;
  });
  useEffect(() => {
    if (shrinkFrom !== undefined) onShrunkRef.current?.();
  }, [shrinkFrom]);
  const leaning = answers?.leaning ?? null;
  // Undo while the take is still the whole thread, whether or not the agent
  // has replied, as a card offers it.
  const undoable =
    leaning !== null && takeUndoable(leaning.comment) && onUndo !== undefined;
  const writable = !isStaticMode();
  // The comment a press on Edit opened, with the button's rect it is drawn by.
  const [editing, setEditing] = useState<{
    rect: DOMRect;
    comment: ReviewComment;
  } | null>(null);
  const openEdit = (
    e: React.MouseEvent<HTMLButtonElement>,
    comment: ReviewComment,
  ) => {
    if (reviewTarget(question.path) === null) return;
    onEdit?.();
    setEditing({ rect: e.currentTarget.getBoundingClientRect(), comment });
  };
  return (
    <div
      ref={rowRef}
      id={planningCardId(question.path, question.id, question.unitLine)}
      role="group"
      aria-label={question.title}
      data-planning-row
      data-planning-item={itemKey}
      style={tall && shrink !== null ? tallRow(shrink.from) : undefined}
      className="relative flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white px-4 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
    >
      {newReply && <NewReplyBar />}
      <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
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
            late change of a mark moves nothing in the row (§12.1). */}
        <span className="flex w-20 shrink-0 justify-end">
          <ItemMarks
            marks={marks}
            newReply={newReply}
            onNewReply={onNewReply}
          />
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
      {answers !== null &&
        (leaning !== null || answers.comments.length > 0) && (
          <ul
            aria-label="Answers on this question"
            className="mt-0.5 space-y-0.5 border-t border-slate-100 pt-1 text-[12px] dark:border-slate-700"
          >
            {leaning !== null && (
              <li
                data-planning-answer="leaning"
                className="flex min-w-0 items-center gap-1.5"
              >
                <span className="shrink-0 text-slate-500 dark:text-slate-400">
                  <em>Leaning:</em>{" "}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate italic",
                    leaning.pending
                      ? "text-slate-600 dark:text-slate-300"
                      : "text-slate-500 dark:text-slate-400",
                  )}
                  title={leaning.comment.comment}
                >
                  {answerText(leaning.comment.comment)}
                </span>
                {undoable && (
                  <button
                    type="button"
                    className="review-oq-undo shrink-0"
                    title="Delete the review comment the take filed"
                    aria-disabled={opening ? "true" : undefined}
                    onClick={() => {
                      if (!opening) onUndo?.(leaning.comment);
                    }}
                  >
                    <Undo2
                      size={12}
                      aria-hidden="true"
                      className="mr-0.5 inline"
                    />
                    {OQ_UNDO_LABEL}
                  </button>
                )}
              </li>
            )}
            {answers.comments.map((c) => (
              <li
                key={c.id}
                data-planning-answer="comment"
                className={cn(
                  "flex min-w-0 items-center gap-1.5 text-slate-700 dark:text-slate-300",
                  c.resolved && "text-slate-500 dark:text-slate-400",
                )}
              >
                <span className="min-w-0 flex-1 truncate" title={c.comment}>
                  {answerText(c.comment)}
                </span>
                {isPendingForAgent(c) && writable && (
                  <button
                    type="button"
                    data-planning-comment-edit
                    className="review-oq-edit shrink-0"
                    title="Edit comment"
                    onClick={(e) => openEdit(e, c)}
                  >
                    <Pencil
                      size={12}
                      aria-hidden="true"
                      className="mr-0.5 inline"
                    />
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      {editing !== null && (
        <ReviewCommentPopover
          label="Edit Comment"
          selectedText={
            editing.comment.fallback_text ?? editing.comment.comment
          }
          rect={editing.rect}
          makeBox={() =>
            editCommentBox(reviewTarget(question.path)!, editing.comment, {
              onSaved,
            })
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

/** A leaning or a comment as far as `answerChars`, then a cut. */
function answerText(text: string): string {
  const max = planningLimits.answerChars;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

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
