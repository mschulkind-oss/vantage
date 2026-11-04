import {
  Archive,
  CheckCircle2,
  CircleDot,
  Clock,
  HelpCircle,
  MessageSquareReply,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { Lifecycle } from "../lib/questionOwnership";
import { cn } from "../lib/utils";

/**
 * How each status reads: an icon and the words always, so the status never
 * rests on its color, and a border of its own: thick and colored for every
 * status but *Open*, the quiet case a reader already assumes, and dashed for
 * *Unknown*. The ink is the page's own on its own surface in both themes.
 */
const LOOKS: Readonly<Record<Lifecycle, { Icon: LucideIcon; tone: string }>> = {
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
  Unknown: {
    Icon: HelpCircle,
    tone: "border-2 border-dashed border-slate-500 dark:border-slate-400",
  },
};

/** What a status that is not *Open* adds, for a reader who reads only it. */
const NOTES: Readonly<Partial<Record<Lifecycle, string>>> = {
  "Response saved, waiting for agent":
    "A response is saved on this question; this card was not refreshed.",
  "Ruling recorded": "The document records a ruling for this question.",
  Compacted: "The question is now in the Decision Ledger only.",
  "Question removed from document":
    "The document no longer has this question; its threads are kept.",
  Unknown: "The document and its reviews cannot be read as one.",
};

/**
 * A question's factual status (`lifecycleFor`), at the top of its card in a
 * band of one fixed height that every card with an id has, so a status that
 * changes under the reader, or arrives late, moves nothing and a card already
 * answered elsewhere is not mistaken for an untouched one. Two lines fit, so
 * a narrow screen wraps the words rather than cutting them.
 */
export const PlanningLifecycleBanner: React.FC<{ status: Lifecycle }> = ({
  status,
}) => {
  const { Icon, tone } = LOOKS[status];
  const note = NOTES[status];
  return (
    <div
      data-testid="lifecycle"
      data-planning-lifecycle={status}
      title={note === undefined ? status : `${status}. ${note}`}
      className={cn(
        "mb-2 flex h-9 items-center gap-1.5 rounded-md border bg-white px-2 text-xs leading-4 font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100",
        tone,
      )}
    >
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0">{status}</span>
    </div>
  );
};
