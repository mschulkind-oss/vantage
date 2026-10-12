import { useCallback, useRef, useState } from "react";
import {
  Check,
  ClipboardCopy,
  MessageSquare,
  MessageSquarePlus,
} from "lucide-react";

import { AnchoredMenu } from "./AnchoredMenu";
import { CommentsDriftedIndicator } from "./CommentsDriftedIndicator";
import { RESERVED_ICON_SIZE, ReservedLabel } from "./ReservedLabel";
import { cn } from "../lib/utils";

/** `noun`, or its plural for any count but one. */
const plural = (count: number, noun: string) =>
  count === 1 ? noun : `${noun}s`;

/** The room the comment count keeps, in digits. */
const COUNT_DIGITS = 2;

/**
 * What a reader with this document in front of them can do about its comments:
 * switch review mode on or off, and open the comments menu.
 *
 * Until 2026-10-12 this was five buttons in the header's row — Review, Dismiss
 * N, the document-changed indicator, Copy N and Manage comments. In review mode
 * with a modified file, ten controls stood in the row and their labels alone
 * cost about 520px, so at a 1200px header every one of them was an icon
 * (`lib/headerFit.ts`, "The viewer header's yield steps"). Folding Dismiss,
 * Copy and Manage into one menu takes about 230px off that, which is what lets
 * the labels the reader still needs — *Modified*, *Review* and the comment
 * count — stay drawn at laptop widths.
 *
 * A menu rather than five rows in the "⋯" panel: the panel's own actions are
 * the file's (history, Path, Raw) and these are the document's comments, and
 * five more rows there would be a wall. What the reader needs *at a glance*
 * stays in the row — the mode, how many comments there are, and the
 * document-changed indicator, which is a warning and keeps the element and
 * the announcement it had — and the three actions, which are deliberate
 * anyway, are one click in.
 *
 * The two-step confirms are why this is not a `role="menu"` of the closing
 * kind: Dismiss turns into *Confirm?* where it stands, as it did in the row, so
 * the second click is the one under the pointer that asked for it.
 */
export interface ReviewControlsProps {
  /** The Review toggle is offered at all: not raw view, not a static export. */
  visible: boolean;
  isReviewMode: boolean;
  /** Comments on this document that are not resolved. */
  activeCount: number;
  /** Of those, the ones the agent has answered. */
  answeredCount: number;
  /** Comments still waiting on the agent's reply. */
  pendingCount: number;
  /** The document changed under a comment still awaiting a response. */
  drifted: boolean;
  /** The Review toggle's first click asked to end review and clear the data. */
  exitConfirm: boolean;
  /** Dismiss's first click asked to sweep comments the agent never answered. */
  dismissConfirm: boolean;
  /** The last copy landed, until it has been said for long enough. */
  copied: boolean;
  /** The Review toggle's tooltip, which carries the Open Questions count. */
  toggleTitle: string;
  onToggle: () => void;
  onDismiss: () => void;
  onCopy: () => void;
  onManage: () => void;
}

/** A row of the comments menu. */
const itemClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors cursor-pointer";

export const ReviewControls: React.FC<ReviewControlsProps> = ({
  visible,
  isReviewMode,
  activeCount,
  answeredCount,
  pendingCount,
  drifted,
  exitConfirm,
  dismissConfirm,
  copied,
  toggleTitle,
  onToggle,
  onDismiss,
  onCopy,
  onManage,
}) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Where the menu hangs when its own trigger is not on screen. See `onOpen`.
  const menuAnchorRef = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const count = `${activeCount} ${plural(activeCount, "comment")}`;
  // An answered comment is still in the list; dismissing it is the sweep that
  // clears what the agent has finished with. With none answered, the click
  // discards comments nobody has replied to, which is why it asks first.
  const dismissLabel = `Dismiss ${
    answeredCount > 0 ? `${answeredCount} answered` : activeCount
  }`;
  const dismissTitle = dismissConfirm
    ? "Click again to dismiss all"
    : answeredCount > 0
      ? `Dismiss the ${answeredCount} ${plural(answeredCount, "comment")} the agent has answered`
      : activeCount === 1
        ? "Dismiss 1 comment"
        : `Dismiss all ${activeCount} comments`;

  const onOpen = () => {
    // Entering a portaled menu closes the compact toolbar's "⋯" panel, which
    // takes this trigger off screen within the same click. Anchor to the "⋯"
    // it folds into instead, so placement and Escape's focus return never
    // target a hidden button (`PlanningPendingAnswers` does the same).
    const panel = triggerRef.current?.closest(".hdr-overflow[data-open]");
    menuAnchorRef.current =
      panel?.querySelector<HTMLElement>(".hdr-more") ??
      (triggerRef.current as HTMLElement | null);
    setOpen((value) => !value);
  };

  return (
    <>
      {visible && (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
            exitConfirm
              ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 ring-1 ring-red-300 dark:ring-red-700"
              : isReviewMode
                ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-300 dark:ring-purple-700"
                : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
          )}
          data-tip={toggleTitle}
        >
          <ReservedLabel
            icon={<MessageSquarePlus size={RESERVED_ICON_SIZE} />}
            label={exitConfirm ? "End review?" : "Review"}
            reserve={["Review", "End review?"]}
            labelClassName="hdr-label"
          />
        </button>
      )}
      {isReviewMode && (
        <>
          <button
            ref={triggerRef}
            type="button"
            data-testid="review-comments-menu"
            onClick={onOpen}
            aria-haspopup="menu"
            aria-expanded={open}
            // The count and its word are two elements, and a name read off the
            // two of them is "3comments". This is the one place the phrase is
            // written whole — and it is what a reader is told when the `labels`
            // step has taken the visible word.
            aria-label={count}
            data-tip={`Comments on this document: ${count}`}
            className={cn(
              "flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
              open
                ? "text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/50"
                : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
            )}
          >
            <MessageSquare
              size={RESERVED_ICON_SIZE}
              className="shrink-0"
              aria-hidden="true"
            />
            {/* The count is no label: the `labels` yield step leaves it drawn
                when every word in the row has gone. */}
            <span
              data-testid="review-comment-count"
              className="inline-block text-right tabular-nums"
              style={{ minWidth: `${COUNT_DIGITS}ch` }}
            >
              {activeCount}
            </span>
            {/* The label classes are on the word itself, not on the grid
                around it as `PlanningUpdates` has them: a yield step puts
                `position: absolute` and a 1px box on the element it names, so
                a clipped wrapper would leave the word inside it at its full
                width — which the header's own e2e reads as a label the row
                never gave up (`header_fit.spec.ts`). The ghost word carries
                the same classes, so the room it keeps goes with the word. */}
            <span className="inline-grid">
              <span className="hdr-label hdr-label-minor [grid-area:1/1]">
                {plural(activeCount, "comment")}
              </span>
              {/* As wide as the longer word, so one comment becoming two moves
                  nothing in the header. */}
              <span
                aria-hidden="true"
                className="hdr-label hdr-label-minor invisible [grid-area:1/1]"
              >
                comments
              </span>
            </span>
          </button>
          {drifted && <CommentsDriftedIndicator />}
        </>
      )}
      <AnchoredMenu
        open={open}
        onClose={close}
        anchorRef={menuAnchorRef}
        width={260}
        aria-label="Comments"
      >
        {activeCount > 0 && (
          <button
            type="button"
            role="menuitem"
            onClick={onDismiss}
            title={dismissTitle}
            className={cn(
              itemClass,
              dismissConfirm
                ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700",
            )}
          >
            <Check size={RESERVED_ICON_SIZE} className="shrink-0" />
            <span>{dismissConfirm ? "Confirm?" : dismissLabel}</span>
          </button>
        )}
        {pendingCount > 0 && (
          <button
            type="button"
            role="menuitem"
            onClick={onCopy}
            title={`Copy ${pendingCount} ${plural(pendingCount, "comment")} to clipboard`}
            className={cn(
              itemClass,
              // The chip this action wore in the row, kept: the purple is the
              // one signal that the copy is the agent-facing one, and a named
              // background is also what lets the contrast guard measure the
              // ink against a palette color rather than the chrome
              // (`lib/textContrast.test.ts`).
              "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50",
            )}
          >
            {copied ? (
              <Check size={RESERVED_ICON_SIZE} className="shrink-0" />
            ) : (
              <ClipboardCopy size={RESERVED_ICON_SIZE} className="shrink-0" />
            )}
            <span>{copied ? "Copied!" : `Copy ${pendingCount}`}</span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            onManage();
          }}
          title="Manage comments"
          className={cn(
            itemClass,
            "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700",
          )}
        >
          <MessageSquare size={RESERVED_ICON_SIZE} className="shrink-0" />
          <span>Manage comments</span>
        </button>
      </AnchoredMenu>
    </>
  );
};
