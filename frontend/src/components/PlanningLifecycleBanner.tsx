import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleDot,
  Clock,
  Hourglass,
  MessageSquareReply,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { CardStatus } from "../lib/questionOwnership";
import { cn } from "../lib/utils";

/**
 * How each status reads: an icon and the words always, so the status never
 * rests on its color, and a border of its own: thick and colored for every
 * status but *Open*, the quiet case a reader already assumes, and dashed for
 * a document condition and for *Checking*. The ink is the page's own on its own
 * surface in both themes.
 */
const CONDITION = {
  Icon: AlertTriangle,
  tone: "border-2 border-dashed border-amber-700 dark:border-amber-400",
};
const LOOKS: Readonly<Record<CardStatus, { Icon: LucideIcon; tone: string }>> =
  {
    Open: { Icon: CircleDot, tone: "border-slate-300 dark:border-slate-600" },
    "Response saved, waiting for agent": {
      Icon: Clock,
      tone: "border-2 border-amber-600 dark:border-amber-400",
    },
    "Agent replied, question still open": {
      Icon: MessageSquareReply,
      tone: "border-2 border-blue-600 dark:border-blue-400",
    },
    "Ruling recorded": {
      Icon: CheckCircle2,
      tone: "border-2 border-emerald-700 dark:border-emerald-400",
    },
    Compacted: {
      Icon: Archive,
      tone: "border-2 border-violet-600 dark:border-violet-400",
    },
    "Question removed from document": {
      Icon: Trash2,
      tone: "border-2 border-red-700 dark:border-red-400",
    },
    "Not checked — scan refused": CONDITION,
    "Not checked — too large to scan": CONDITION,
    "Not checked — scan failed": CONDITION,
    "Id appears more than once": CONDITION,
    "Id outside a directive": CONDITION,
    Checking: {
      Icon: Hourglass,
      tone: "border-2 border-dashed border-slate-500 dark:border-slate-400",
    },
  };

/** What a status that is not *Open* adds, for a reader who reads only it. */
const NOTES: Readonly<Partial<Record<CardStatus, string>>> = {
  "Response saved, waiting for agent":
    "A response is saved on this question; this card was not refreshed.",
  "Ruling recorded": "The document records a ruling for this question.",
  Compacted: "The question is now in the Decision Ledger only.",
  "Question removed from document":
    "The document no longer has this question; its threads are kept.",
  "Not checked — scan refused":
    "The project has more planning candidates than the scan reads, so this document was not checked.",
  "Not checked — too large to scan":
    "This document is over the scan's size limit, so it was not checked; splitting it lets it be read.",
  "Not checked — scan failed":
    "This document could not be read by the scan; it is listed in Maintenance.",
  "Id appears more than once":
    "Two questions in the document declare this id, so it names neither; the agent makes each id unique.",
  "Id outside a directive":
    "The id is written in the document but no question directive declares it.",
  Checking: "This question's comments are being read.",
};

/** What the band adds while its reading is being checked again (§4.6). */
const CHECKING_NOTE =
  "Shown as last read; the document changed and is being read again.";

/**
 * A question's factual status (`lifecycleFor`), at the top of its card in a
 * band of one fixed height that every card with an id has, so a status that
 * changes under the reader, or arrives late, moves nothing and a card already
 * answered elsewhere is not mistaken for an untouched one. Two lines fit, so
 * a narrow screen wraps the words rather than cutting them.
 *
 * `checking` adds _· checking_ at the end, in the room the band has: the
 * status is the last one read, and the document is being read again
 * (`docs/design/planning-page-freshness.md` §4.6).
 */
export const PlanningLifecycleBanner: React.FC<{
  status: CardStatus;
  checking?: boolean;
}> = ({ status, checking = false }) => {
  const { Icon, tone } = LOOKS[status];
  const note = NOTES[status];
  const marked = checking && status !== "Checking";
  const title = [status, note, marked ? CHECKING_NOTE : undefined]
    .filter((part) => part !== undefined)
    .join(". ");
  return (
    <div
      data-testid="lifecycle"
      data-planning-lifecycle={status}
      data-planning-checking={marked ? "" : undefined}
      title={title}
      className={cn(
        "mb-2 flex h-9 items-center gap-1.5 rounded-md border bg-white px-2 text-xs leading-4 font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100",
        tone,
      )}
    >
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0">
        {status}
        {marked && (
          <span className="font-normal text-slate-600 dark:text-slate-300">
            {" · checking"}
          </span>
        )}
      </span>
    </div>
  );
};
