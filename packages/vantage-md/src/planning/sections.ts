/**
 * The planning page's sections and the roadmap's routing (design §6), and the
 * Referenced by list (§7).
 *
 * The page, `vantage-check index` and the checker's planning rules all derive
 * from these functions, so the page and the gate cannot disagree (P7). Nothing
 * here is stored: every section is recomputed from the index, and nothing a
 * reader does on the page changes the order.
 */

import { VANTAGE_OQ_ID } from "../vantageDirectives.js";
import type { StageRole } from "./config.js";
import { findDocument, type PlanningIndex } from "./model.js";
import type {
  DependsOn,
  PlanningDocument,
  PlanningLink,
  PlanningQuestion,
} from "./scan.js";

/** A question, by document and line; `id` too, so a stale reference misses. */
export interface QuestionRef {
  path: string;
  id: string | null;
  line: number;
}

/** A question the roadmap routes, with the roadmap heading its link sits under. */
export interface RoutedQuestion extends QuestionRef {
  heading: string | null;
}

export type WaitingEntry =
  | { kind: "question"; question: QuestionRef }
  | { kind: "document"; path: string; waitingOn: DependsOn[] };

export interface PlanningSections {
  /** `present` is false when the roadmap is missing, skipped or unreadable. */
  roadmap: { path: string; present: boolean };
  stagesDeclared: boolean;
  /** No open question in any document outside the `done` role. */
  nothingNeedsYou: boolean;
  /** Without a roadmap: every open question, by path, then line. */
  needsYou: RoutedQuestion[];
  /** `null` when there is no roadmap. */
  unrouted: QuestionRef[] | null;
  waiting: WaitingEntry[];
  /** The three stage sections are `null` when no stages are declared. */
  ready: string[] | null;
  graduate: string[] | null;
  disagrees: string[] | null;
  skipped: PlanningIndex["skipped"];
  unreadable: PlanningIndex["unreadable"];
}

/** One wording for the page and the CLI (P7). */
export const PLANNING_NOTICES: {
  nothingNeedsYou: string;
  noRoadmap(path: string): string;
  noStages: string;
  refused(candidateCount: number, maxCandidates: number): string;
} = {
  nothingNeedsYou: "Nothing needs you.",
  noRoadmap: (path) =>
    `No roadmap: ${path} is missing, too large or unreadable, so Needs you lists every open question by document. Set roadmap under [planning] in .vantage.toml to read another file.`,
  noStages:
    "No stages are declared, so Ready, Graduate and Disagrees are not shown. Declare them under [planning.stages] in .vantage.toml.",
  refused: (candidateCount, maxCandidates) =>
    `This repository has ${candidateCount.toLocaleString("en-US")} candidate files, more than max-candidates (${maxCandidates.toLocaleString("en-US")}), so nothing was scanned. Narrow include under [planning] in .vantage.toml, or raise max-candidates.`,
};

/** A document's stage role, or `null` without a stage or declared stages. */
function roleOf(index: PlanningIndex, doc: PlanningDocument): StageRole | null {
  const stages = index.config.stages;
  if (stages === null || doc.stage === null) return null;
  return Object.hasOwn(stages, doc.stage) ? (stages[doc.stage] ?? null) : null;
}

/** A `done` document is not a live proposal and contributes to no section. */
const isLive = (index: PlanningIndex, doc: PlanningDocument): boolean =>
  roleOf(index, doc) !== "done";

const refOf = (q: PlanningQuestion): QuestionRef => ({
  path: q.path,
  id: q.id,
  line: q.line,
});

const keyOf = (ref: QuestionRef): string => `${ref.path}\n${ref.line}`;

const isOpen = (q: PlanningQuestion): boolean => q.state === "open";

/**
 * The questions one roadmap link routes (§6.1), or `null` when it routes
 * nothing at all.
 *
 * A bare link to a document routes every question in it, and routes the
 * document even when it has none, so the list can be empty; a link to
 * `#OQ-…` routes that one question, and nothing when no question carries the
 * id; a link to a heading routes nothing, since a compacted question is cited
 * through its document's `#decision-ledger` heading and routing that would
 * route the document's unrelated open questions (Plan Q12). Links to
 * non-planning documents, and to `done` documents, route nothing.
 */
function routedBy(
  index: PlanningIndex,
  link: PlanningLink,
): PlanningQuestion[] | null {
  const doc = findDocument(index, link.target);
  if (doc === undefined || !isLive(index, doc)) return null;
  if (link.fragment === null) return doc.questions;
  if (!VANTAGE_OQ_ID.test(link.fragment)) return null;
  const reached = doc.questions.filter((q) => q.id === link.fragment);
  return reached.length > 0 ? reached : null;
}

/**
 * The questions the roadmap routes, in the order its links reach them (§6.1),
 * each link read by `routedBy`. A question reached twice keeps its first
 * position.
 */
export function routeQuestions(index: PlanningIndex): RoutedQuestion[] {
  const roadmap = findDocument(index, index.config.roadmap);
  if (roadmap === undefined) return [];
  const routed: RoutedQuestion[] = [];
  const seen = new Set<string>();
  for (const link of roadmap.links) {
    const reached = routedBy(index, link);
    if (reached === null) continue;
    for (const question of reached) {
      const ref = refOf(question);
      if (seen.has(keyOf(ref))) continue;
      seen.add(keyOf(ref));
      routed.push({ ...ref, heading: link.heading });
    }
  }
  return routed;
}

/**
 * The open questions of `docs` that `routed` does not hold (§6.2 *Unrouted*),
 * by document, then line. `docs` are live documents: a `done` one has no
 * questions to leave unrouted.
 */
function unroutedIn(
  docs: readonly PlanningDocument[],
  routed: readonly RoutedQuestion[],
): QuestionRef[] {
  const routedKeys = new Set(routed.map(keyOf));
  return docs.flatMap((doc) =>
    doc.questions
      .filter((q) => isOpen(q) && !routedKeys.has(keyOf(refOf(q))))
      .map(refOf),
  );
}

/**
 * Whether one `depends-on` entry still waits (§6.2): an entry naming a question
 * waits while that question is open, and one naming a document waits while
 * that document has an open question (Plan Q6). A target outside the
 * repository, outside the index, or with the `done` role never waits
 * (Plan Q11).
 */
function waits(index: PlanningIndex, entry: DependsOn): boolean {
  if (entry.target === null) return false;
  const doc = findDocument(index, entry.target);
  if (doc === undefined || !isLive(index, doc)) return false;
  if (entry.fragment !== null && VANTAGE_OQ_ID.test(entry.fragment)) {
    return doc.questions.some((q) => q.id === entry.fragment && isOpen(q));
  }
  return doc.questions.some(isOpen);
}

/** Every section of the planning page, top to bottom (§6.2). */
export function derivePlanningSections(index: PlanningIndex): PlanningSections {
  const { config } = index;
  const present = findDocument(index, config.roadmap) !== undefined;
  const live = index.documents.filter((doc) => isLive(index, doc));
  const stagesDeclared = config.stages !== null;

  const byKey = new Map<string, PlanningQuestion>();
  for (const doc of live) {
    for (const q of doc.questions) byKey.set(keyOf(refOf(q)), q);
  }

  let needsYou: RoutedQuestion[];
  let unrouted: QuestionRef[] | null;
  if (present) {
    const routed = routeQuestions(index);
    needsYou = routed.filter((ref) => {
      const state = byKey.get(keyOf(ref))?.state;
      return state === "open" || state === "answered";
    });
    unrouted = unroutedIn(live, routed);
  } else {
    needsYou = live.flatMap((doc) =>
      doc.questions.filter(isOpen).map((q) => ({ ...refOf(q), heading: null })),
    );
    unrouted = null;
  }

  const waiting: WaitingEntry[] = [];
  for (const doc of live) {
    const waitingOn = doc.dependsOn.filter((entry) => waits(index, entry));
    if (waitingOn.length > 0) {
      waiting.push({ kind: "document", path: doc.path, waitingOn });
    }
    for (const q of doc.questions) {
      if (q.state === "blocked") {
        waiting.push({ kind: "question", question: refOf(q) });
      }
    }
  }

  const stageSection = (
    keep: (role: StageRole | null, doc: PlanningDocument) => boolean,
  ): string[] | null =>
    stagesDeclared
      ? live.filter((doc) => keep(roleOf(index, doc), doc)).map((d) => d.path)
      : null;
  const hasOpen = (doc: PlanningDocument) => doc.questions.some(isOpen);

  return {
    roadmap: { path: config.roadmap, present },
    stagesDeclared,
    nothingNeedsYou: !live.some(hasOpen),
    needsYou,
    unrouted,
    waiting,
    ready: stageSection((role, doc) => role === "ready" && !hasOpen(doc)),
    // Every question the index holds is live, so "no live questions" is none.
    graduate: stageSection(
      (role, doc) => role === "built" && doc.questions.length === 0,
    ),
    disagrees: stageSection(
      (role, doc) => (role === "ready" || role === "built") && hasOpen(doc),
    ),
    skipped: index.skipped,
    unreadable: index.unreadable,
  };
}

/** The question a reference names, or `undefined` if the index moved on. */
export function questionFor(
  index: PlanningIndex,
  ref: QuestionRef,
): PlanningQuestion | undefined {
  return findDocument(index, ref.path)?.questions.find(
    (q) => q.line === ref.line && q.id === ref.id,
  );
}

/** One entry of a document's Referenced by list (§7). */
export interface Reference {
  from: string;
  /** The heading the link sits under in `from`; `null` before any heading. */
  heading: string | null;
  line: number;
}

/**
 * The planning documents that link to `path` or to one of its questions: one
 * entry per linking document and heading, the first link under that heading
 * standing for the rest, in order of document then line. A document's links to
 * itself are not listed, and neither is a document outside the index, which by
 * definition is not a planning document.
 */
export function referencedBy(index: PlanningIndex, path: string): Reference[] {
  const references: Reference[] = [];
  for (const doc of index.documents) {
    if (doc.path === path) continue;
    const headings = new Set<string | null>();
    for (const link of doc.links) {
      if (link.target !== path || headings.has(link.heading)) continue;
      headings.add(link.heading);
      references.push({
        from: doc.path,
        heading: link.heading,
        line: link.line,
      });
    }
  }
  return references;
}

/** One document in a Referenced by list, with where its links sit (§7). */
export interface ReferenceSource {
  from: string;
  /** `referencedBy`'s entries from `from`: one per heading, in document order. */
  references: Reference[];
}

/** What a document's Referenced by line reports, and the list behind it (§7). */
export interface ReferenceSummary {
  /** The documents that link here, the roadmap first and then by path. */
  sources: ReferenceSource[];
  /**
   * The roadmap heading of the first roadmap link that routes this document or
   * one of its questions (§6.1), `heading` being `null` for a link above every
   * heading. `null` when no link routes it, when there is no roadmap, and for
   * the roadmap itself, which is not on itself.
   */
  onRoadmap: { heading: string | null } | null;
  /**
   * Its open questions the roadmap does not route: what the planning page lists
   * for it under *Unrouted* (§6.2). `0` without a roadmap, where there is no
   * such section, and for a `done` document, which contributes to none.
   */
  unrouted: number;
}

/**
 * Who links to `path`, and whether the roadmap routes it: the two questions a
 * Referenced by line answers. Routing and the unrouted count are the planning
 * page's own derivations, applied to one document, so the line and the page
 * cannot disagree (P7).
 */
export function referenceSummary(
  index: PlanningIndex,
  path: string,
): ReferenceSummary {
  const roadmapPath = index.config.roadmap;
  const sources: ReferenceSource[] = [];
  for (const ref of referencedBy(index, path)) {
    const last = sources.at(-1);
    if (last?.from === ref.from) last.references.push(ref);
    else sources.push({ from: ref.from, references: [ref] });
  }
  const at = sources.findIndex((source) => source.from === roadmapPath);
  if (at > 0) sources.unshift(...sources.splice(at, 1));

  const roadmap = findDocument(index, roadmapPath);
  const doc = findDocument(index, path);
  let onRoadmap: ReferenceSummary["onRoadmap"] = null;
  if (roadmap !== undefined && path !== roadmapPath) {
    const link = roadmap.links.find(
      (l) => l.target === path && routedBy(index, l) !== null,
    );
    if (link !== undefined) onRoadmap = { heading: link.heading };
  }
  const unrouted =
    roadmap === undefined || doc === undefined || !isLive(index, doc)
      ? 0
      : unroutedIn([doc], routeQuestions(index)).length;
  return { sources, onRoadmap, unrouted };
}
