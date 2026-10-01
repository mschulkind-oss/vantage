/**
 * What a link to a planning document or question says about its target
 * (`docs/reference/planning-index.md` §5).
 *
 * A badge is derived, never written: the viewer draws one after a rendered link
 * and `vantage-check index` prints one inline in brackets, and both ask this
 * module what it says, so the page and the CLI read the same (P7).
 */

import { VANTAGE_OQ_ID, VANTAGE_OQ_STATUS } from "../vantageDirectives.js";
import type { DocStatus } from "../vantageFrontmatter.js";
import { findDocument, type PlanningIndex } from "./model.js";
import type { QuestionState } from "./scan.js";

export type PlanningBadge =
  | {
      kind: "document";
      path: string;
      status: DocStatus | null;
      stage: string | null;
      /** `false` only for a stage outside declared stages; `true` with none declared. */
      stageInVocabulary: boolean;
      /** Open questions (💬). */
      open: number;
      /** Blocked questions (🔒). */
      blocked: number;
    }
  | { kind: "question"; path: string; id: string; state: QuestionState }
  /** No directive carries the id, but the id is in the text: compacted. */
  | { kind: "ruled"; path: string; id: string }
  /**
   * A directive carries the id, but it is no question's: an orphan, or one in
   * raw HTML. Nothing compacted it, so it is not ruled.
   */
  | { kind: "not-a-question"; path: string; id: string }
  /** The id is nowhere in the target. */
  | { kind: "not-found"; path: string; id: string };

const WARNING = "⚠";

const QUESTION_GLYPH: Readonly<Record<QuestionState, string>> = {
  open: VANTAGE_OQ_STATUS.open,
  blocked: VANTAGE_OQ_STATUS.blocked,
  answered: VANTAGE_OQ_STATUS.settled,
};

/**
 * The badge for a link from `fromPath` to `target`, or `null` when it gets
 * none (§5.1): the target is `fromPath` itself, is not a planning document in
 * this index, or has nothing to show — no status, no stage, and no open or
 * blocked question.
 *
 * A fragment shaped as an Open Question id asks about that question (§5.2); any
 * other fragment, a heading's included, gets the document's badge.
 */
export function badgeFor(
  index: PlanningIndex,
  fromPath: string,
  target: { path: string; fragment: string | null },
): PlanningBadge | null {
  if (target.path === fromPath) return null;
  const doc = findDocument(index, target.path);
  if (doc === undefined) return null;
  const { path } = doc;

  const id = target.fragment;
  if (id !== null && VANTAGE_OQ_ID.test(id)) {
    const question = doc.questions.find((q) => q.id === id);
    if (question !== undefined) {
      return { kind: "question", path, id, state: question.state };
    }
    // Compaction deletes the directive (§3.3), so one still there has not
    // been compacted, though it is no question the index holds.
    if (doc.directiveIds.includes(id)) {
      return { kind: "not-a-question", path, id };
    }
    // The `design-doc` compaction rule keeps a ruled id in the Decision
    // Ledger, so an id still in the text is ruled, and the ledger itself is
    // never parsed (P3).
    return doc.ids.includes(id)
      ? { kind: "ruled", path, id }
      : { kind: "not-found", path, id };
  }

  let open = 0;
  let blocked = 0;
  for (const question of doc.questions) {
    if (question.state === "open") open++;
    if (question.state === "blocked") blocked++;
  }
  if (
    doc.status === null &&
    doc.stage === null &&
    open === 0 &&
    blocked === 0
  ) {
    return null;
  }
  const stages = index.config.stages;
  return {
    kind: "document",
    path,
    status: doc.status,
    stage: doc.stage,
    stageInVocabulary:
      stages === null || doc.stage === null || Object.hasOwn(stages, doc.stage),
    open,
    blocked,
  };
}

/** The badge as text: `in-review · DESIGN · 💬 5`, `🔒 blocked`, `✅ ruled`. */
export function badgeText(badge: PlanningBadge): string {
  switch (badge.kind) {
    case "document":
      return [
        badge.status,
        badge.stage,
        badge.open > 0 ? `${VANTAGE_OQ_STATUS.open} ${badge.open}` : null,
        badge.blocked > 0
          ? `${VANTAGE_OQ_STATUS.blocked} ${badge.blocked}`
          : null,
      ]
        .filter((part) => part !== null)
        .join(" · ");
    case "question":
      return `${QUESTION_GLYPH[badge.state]} ${badge.state}`;
    case "ruled":
      return `${VANTAGE_OQ_STATUS.settled} ruled`;
    case "not-a-question":
      return `${WARNING} not a question`;
    case "not-found":
      return `${WARNING} not found`;
  }
}

function count(n: number, what: string): string {
  return `${n} ${what} question${n === 1 ? "" : "s"}`;
}

/**
 * The badge as a screen reader should say it, after the link's own text:
 * `in review, design, 5 open questions` (§5.3). No glyphs, since an emoji read
 * aloud is its name, and a stage outside the declared ones says so in words,
 * where the page says it with a color.
 */
export function badgeSpeech(badge: PlanningBadge): string {
  switch (badge.kind) {
    case "document":
      return [
        badge.status?.replace(/-/g, " ") ?? null,
        badge.stage === null
          ? null
          : `${badge.stage.toLowerCase()}${badge.stageInVocabulary ? "" : ", not a declared stage"}`,
        badge.open > 0 ? count(badge.open, "open") : null,
        badge.blocked > 0 ? count(badge.blocked, "blocked") : null,
      ]
        .filter((part) => part !== null)
        .join(", ");
    case "question":
      return `${badge.state} question`;
    case "ruled":
      return "ruled";
    case "not-a-question":
      return "not a question";
    case "not-found":
      return "question not found";
  }
}
