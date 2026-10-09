/**
 * The planning outline (a term this module coins): what the contents column
 * lists on the planning page, titled *On this page*
 * (`docs/design/planning-to-do-list.md` §3.5). The documents of *Needs
 * you*'s full cards, in list order, each with how many of its questions need
 * you; then one line each for the answered rows, *Blocked* and
 * *Maintenance*, with their counts. Maintenance's items are not listed.
 *
 * A pure function of the layout on screen, as *Needs you* is, so the column
 * and the cards it jumps to always agree.
 */
import type { PlanningQuestion } from "vantage-md/planning";
import { planningLimits } from "../planningScan/limits";
import { planningCardId } from "./planningCardId";
import type { SectionId } from "./planningPages";

/** One document of *Needs you*'s full cards. */
export interface OutlineDocument {
  path: string;
  /** How many of its questions need you, in the layout on screen. */
  questions: number;
  /** The id of its first full card, which the entry goes to. */
  target: string;
}

/** What a line after the documents stands for. */
export type OutlineLineId = "answered" | "waiting" | "maintenance";

/** One line after the documents: the answered rows, or a folded group. */
export interface OutlineLine {
  id: OutlineLineId;
  title: string;
  total: number;
  /** The id it goes to: the first answered row, or the group's heading. */
  target: string;
  /** Its tooltip, where the page has a line under the heading to give. */
  explanation?: string;
}

export interface PlanningOutline {
  /** At most `planningLimits.outlineDocuments` documents. */
  documents: readonly OutlineDocument[];
  /** Documents past `documents`, counted and not listed. */
  more: number;
  /** The answered rows while there are any, then the layout's groups. */
  lines: readonly OutlineLine[];
}

/** What the outline is drawn from: the layout on screen and its counts. */
export interface OutlineInput {
  /** *Needs you*'s full cards, in list order. */
  cards: readonly PlanningQuestion[];
  /** Every question that needs you in the layout, cards and the rest. */
  needing: readonly PlanningQuestion[];
  /** The answered rows: how many, and the first, which the line goes to. */
  answered: { total: number; first: PlanningQuestion | null };
  /**
   * *Blocked*'s count, absent when the layout has no *Blocked*: which groups
   * there are is the layout's, and their counts are live (§4.2), so a group
   * whose count falls to 0 keeps its line.
   */
  blocked?: number;
  /** The line under *Blocked*'s heading. */
  blockedExplanation?: string;
  /** *Maintenance*'s count, absent when the layout has none. */
  maintenance?: number;
}

/** The outline of the page on screen. */
export function planningOutline(input: OutlineInput): PlanningOutline {
  const needing = new Map<string, number>();
  for (const q of input.needing) {
    needing.set(q.path, (needing.get(q.path) ?? 0) + 1);
  }
  const byPath = new Map<string, OutlineDocument>();
  for (const q of input.cards) {
    if (byPath.has(q.path)) continue;
    byPath.set(q.path, {
      path: q.path,
      questions: needing.get(q.path) ?? 0,
      target: planningCardId(q.path, q.id, q.unitLine),
    });
  }
  const documents = [...byPath.values()];
  const shown = Math.max(0, planningLimits.outlineDocuments);
  const lines: OutlineLine[] = [];
  const first = input.answered.first;
  if (input.answered.total > 0 && first !== null) {
    lines.push({
      id: "answered",
      title: "Answered",
      total: input.answered.total,
      target: planningCardId(first.path, first.id, first.unitLine),
    });
  }
  if (input.blocked !== undefined) {
    lines.push({
      id: "waiting",
      title: "Blocked",
      total: input.blocked,
      target: "waiting",
      explanation: input.blockedExplanation,
    });
  }
  if (input.maintenance !== undefined) {
    lines.push({
      id: "maintenance",
      title: "Maintenance",
      total: input.maintenance,
      target: "maintenance",
    });
  }
  return {
    documents: documents.slice(0, shown),
    more: Math.max(0, documents.length - shown),
    lines,
  };
}

/**
 * The id a document's row carries in a section: the row a link to it goes
 * to. A section's own, since a document's row is one per section that lists
 * it.
 */
export function planningRowId(section: SectionId, path: string): string {
  return `pr-${section}--${encodeURIComponent(path)}`;
}
