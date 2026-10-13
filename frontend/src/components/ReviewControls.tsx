import {
  Check,
  ClipboardCopy,
  MessageSquare,
  MessageSquarePlus,
} from "lucide-react";

import { CommentsDriftedIndicator } from "./CommentsDriftedIndicator";
import { RESERVED_ICON_SIZE, ReservedLabel } from "./ReservedLabel";
import { cn } from "../lib/utils";

/** `noun`, or its plural for any count but one. */
const plural = (count: number, noun: string) =>
  count === 1 ? noun : `${noun}s`;

/**
 * What a reader with this document in front of them can do about its comments:
 * switch review mode on or off, copy the comments the agent still owes an
 * answer to, dismiss the ones it has answered, and open the comments panel.
 *
 * Every one of them is a button of the header's own row, drawn where it stands.
 * Until 2026-10-12 the cluster was five buttons in that row and their labels
 * alone cost about 520px, so the three deliberate actions — Dismiss, Copy and
 * Manage — were folded into a menu behind the comment count. That hid the one
 * action a reviewer reaches for most: *Copy* was two clicks in at *every*
 * width, which is a poor place for the thing that saves their review before
 * they leave. They are inline again, in the row, where the count they carry is
 * part of their own label (`Copy 3`, `Dismiss 2 answered`) rather than a chip
 * beside a trigger — so there is no separate count element, and the words yield
 * to the `labels` step exactly as the rest of the toolbar's do
 * (`lib/headerFit.ts`).
 *
 * The "⋯" the header folds into at its `actions` step holds the file's own
 * actions (its history and Raw) and not these: folding the review cluster there
 * is what made Copy unreachable at every width, and the reader who is
 * reviewing is the one the header's tight widths are least likely to be for.
 * The cluster is a fragment rather than a box, so its buttons are the row's own
 * items and the header's fit measures them like any other
 * (`components/HeaderOverflow.tsx` does the same with `display: contents`).
 *
 * Dismiss keeps its two-step confirm where it stands: it turns into *Confirm?*
 * in place, so the second click is the one under the pointer that asked for it.
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
          {drifted && <CommentsDriftedIndicator />}
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={onCopy}
              data-tip={
                copied
                  ? "Copied!"
                  : `Copy ${pendingCount} ${plural(pendingCount, "comment")} to clipboard`
              }
              className={cn(
                "flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                // The chip this action wears: the purple is the one signal
                // that the copy is the agent-facing one, and a named
                // background is also what lets the contrast guard measure the
                // ink against a palette color rather than the chrome
                // (`lib/textContrast.test.ts`).
                "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50",
              )}
            >
              <ReservedLabel
                icon={
                  copied ? (
                    <Check
                      size={RESERVED_ICON_SIZE}
                      className="text-green-500"
                    />
                  ) : (
                    <ClipboardCopy size={RESERVED_ICON_SIZE} />
                  )
                }
                label={copied ? "Copied!" : `Copy ${pendingCount}`}
                reserve={[`Copy ${pendingCount}`, "Copied!"]}
                labelClassName="hdr-label"
              />
            </button>
          )}
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onDismiss}
              data-tip={dismissTitle}
              className={cn(
                "flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                dismissConfirm
                  ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50"
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
              )}
            >
              {/* The label can be any of three things — how much the sweep
                  takes, and the confirm that asks for the click again — so the
                  room of the widest is kept and the icon does not move under
                  the pointer (`index.css`, "A button whose label changes on
                  click"). */}
              <ReservedLabel
                icon={<Check size={RESERVED_ICON_SIZE} />}
                label={dismissConfirm ? "Confirm?" : dismissLabel}
                reserve={[
                  "Confirm?",
                  `Dismiss ${activeCount}`,
                  `Dismiss ${answeredCount} answered`,
                ]}
                labelClassName="hdr-label"
              />
            </button>
          )}
          {/* Icon-only: the panel is a place to read the comments, not a
              destination whose name a reader needs in the row. The label it
              gives up is in its tooltip and in the name it keeps for assistive
              technology. */}
          <button
            type="button"
            onClick={onManage}
            aria-label="Manage comments"
            data-tip="Manage comments"
            className="flex items-center rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
          >
            <MessageSquare
              size={RESERVED_ICON_SIZE}
              className="shrink-0"
              aria-hidden="true"
            />
          </button>
        </>
      )}
    </>
  );
};
