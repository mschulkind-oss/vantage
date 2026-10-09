/**
 * The planning outline (a term this module coins): what the contents column
 * lists on the planning page, in place of a document's table of contents
 * (`docs/reference/planning-index.md` §6.9). Each non-empty section, with its
 * count, and under a section of cards or document rows the documents it
 * lists, in the section's own order, each with the number of its questions
 * there. *Needs you* lists its open questions' documents: a ✅ question has
 * left it (`docs/design/planning-to-do-list.md` §3.3). There are no pages.
 *
 * Pure functions of the index and the sections, as the page's layout is, so
 * the outline and the pages it flips to always agree.
 */
import {
  findDocument,
  sectionExplanation,
  type PlanningIndex,
  type PlanningQuestion,
  type PlanningSections,
} from "vantage-md/planning";
import { planningLimits } from "../planningScan/limits";
import { planningCardId } from "./planningCardId";
import {
  SECTION_TITLES,
  sectionEntries,
  type SectionId,
} from "./planningPages";

/** One document under a section of the outline. */
export interface OutlineDocument {
  path: string;
  /**
   * How many of its questions the section holds: its cards there, or, under
   * *Stage conflict*, the open questions that put it there. `0` when the section
   * holds none of its questions, as a stage row or a waiting document.
   */
  questions: number;
  /**
   * The document's first entry in the section: the question of its first
   * card, or `null` when that is the document's own row.
   */
  question: PlanningQuestion | null;
}

/** One section of the outline. */
export interface OutlineSection {
  id: SectionId;
  title: string;
  /** The line under its heading on the page, which its link's tooltip says. */
  explanation: string;
  /** Entries in the whole section, as its heading counts them. */
  total: number;
  /**
   * Its documents, at most `planningLimits.outlineDocuments` of them; none
   * under *Too large* and *Unreadable*, whose lines name files that are
   * not planning documents.
   */
  documents: readonly OutlineDocument[];
  /** Documents past `documents`, which the outline counts and does not list. */
  more: number;
}

/** The outline of `sections`, as the page lays them out. */
export function planningOutline(
  index: PlanningIndex,
  sections: PlanningSections,
): OutlineSection[] {
  return sectionEntries(index, sections)
    .map((section) => {
      const byPath = new Map<string, OutlineDocument>();
      const add = (
        path: string,
        question: PlanningQuestion | null,
        counts: number,
      ) => {
        const listed = byPath.get(path);
        if (listed !== undefined) {
          listed.questions += counts;
          return;
        }
        byPath.set(path, { path, questions: counts, question });
      };
      if (section.kind === "cards") {
        for (const entry of section.entries) {
          if (entry.kind === "question") {
            if (section.id === "needs-you" && entry.question.state !== "open") {
              continue;
            }
            add(entry.question.path, entry.question, 1);
          } else {
            add(entry.path, null, 0);
          }
        }
      } else if (section.kind === "rows") {
        section.entries.forEach((path) => {
          const open =
            section.id === "disagrees"
              ? (findDocument(index, path)?.questions.filter(
                  (q) => q.state === "open",
                ).length ?? 0)
              : 0;
          add(path, null, open);
        });
      }
      const documents = [...byPath.values()];
      const shown = Math.max(0, planningLimits.outlineDocuments);
      return {
        id: section.id,
        title: SECTION_TITLES[section.id],
        explanation: sectionExplanation(section.id, sections),
        total:
          section.id === "needs-you" && section.kind === "cards"
            ? section.entries.filter(
                (e) => e.kind === "question" && e.question.state === "open",
              ).length
            : section.entries.length,
        documents: documents.slice(0, shown),
        more: Math.max(0, documents.length - shown),
      };
    })
    .filter((section) => section.total > 0);
}

/**
 * The id a document's row carries in a section: the row an outline entry
 * with no card goes to. A section's own, since a document's row is one per
 * section that lists it.
 */
export function planningRowId(section: SectionId, path: string): string {
  return `pr-${section}--${encodeURIComponent(path)}`;
}

/** The id of what an outline document goes to: its first card, or its row. */
export function outlineTargetId(
  section: SectionId,
  document: OutlineDocument,
): string {
  const { question } = document;
  return question === null
    ? planningRowId(section, document.path)
    : planningCardId(question.path, question.id, question.unitLine);
}
