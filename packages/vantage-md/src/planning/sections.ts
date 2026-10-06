/**
 * The planning page's sections and the roadmaps' routing
 * (`docs/reference/planning-index.md` §4, §6), and the
 * Referenced by list (§7).
 *
 * The page, `vantage-check index` and the checker's planning rules all derive
 * from these functions, so the page and the gate cannot disagree (P7). Nothing
 * here is stored: every section is recomputed from the index, and nothing a
 * reader does on the page changes the order.
 */

import { VANTAGE_OQ_ID } from "../vantageDirectives.js";
import {
  compareRoadmaps,
  hasRoadmapName,
  isRoadmapPath,
  ROADMAP_FILE_NAME,
  type PlanningConfig,
  type StageRole,
} from "./config.js";
import type {
  NotUnderstoodPlanningFilter,
  PlanningFilterReason,
  PlanningFilterSummary,
} from "./filter.js";
import { PLANNING_FILTER_LIMITS } from "./filterLimits.js";
import { PLANNING_SECTION_TITLES, codeSpan } from "./guide.js";
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

/** A question a roadmap routes, with the roadmap heading its link sits under. */
export interface RoutedQuestion extends QuestionRef {
  heading: string | null;
}

export type WaitingEntry =
  | { kind: "question"; question: QuestionRef }
  | { kind: "document"; path: string; waitingOn: DependsOn[] };

/**
 * A roadmap's *state* (§4.2, a term defined in §2): whether it routes,
 * and why not when it does not. `missing` is only ever a listed roadmap's,
 * since a roadmap found by name is one because the index holds it.
 */
export type RoadmapState =
  "routes" | "done" | "skipped" | "unreadable" | "missing";

/** One roadmap, as the picker, the notices and `vantage-check index` list it. */
export interface PlanningRoadmap {
  path: string;
  state: RoadmapState;
  /** Its routed questions that are open or answered: Needs you when chosen. 0 unless `routes`. */
  needsYouCount: number;
}

/** A question another roadmap routes and the chosen one does not (§6.2). */
export interface OtherRoadmapQuestion extends RoutedQuestion {
  /** The first roadmap in roadmap order, other than the chosen one, that routes it. */
  roadmap: string;
}

export interface PlanningSections {
  /** Every roadmap, in roadmap order (§4.2), each with its state. */
  roadmaps: PlanningRoadmap[];
  /**
   * The roadmap Needs you follows: the one asked for when it routes, else the
   * first in roadmap order that does, the *default roadmap*. `null` when none
   * routes.
   */
  chosenRoadmap: string | null;
  stagesDeclared: boolean;
  /** No open question in any document outside the `done` role. */
  nothingNeedsYou: boolean;
  /**
   * The chosen roadmap's routed open or answered questions, in its order.
   * With none chosen: every open question, by path, then line.
   */
  needsYou: RoutedQuestion[];
  /**
   * Open or answered questions another roadmap routes and the chosen one does
   * not, each once, in roadmap order and then that roadmap's own order: what
   * the page counts beside its picker (§6.8). Empty when none is chosen.
   */
  onOtherRoadmaps: OtherRoadmapQuestion[];
  /** Open questions no roadmap routes; `null` when none is chosen. */
  unrouted: QuestionRef[] | null;
  waiting: WaitingEntry[];
  /** The three stage sections are `null` when no stages are declared. */
  ready: string[] | null;
  graduate: string[] | null;
  disagrees: string[] | null;
  skipped: PlanningIndex["skipped"];
  unreadable: PlanningIndex["unreadable"];
}

/**
 * What a roadmap that does not route is said to be, after its path (§6.8): the
 * one phrase for each state, shared by every notice and `vantage-check
 * index`'s Roadmaps block.
 */
export const ROADMAP_STATE_PHRASES: Readonly<
  Record<Exclude<RoadmapState, "routes">, string>
> = Object.freeze({
  missing:
    "is missing or not in Vantage's file list (it is not a .md file, or is in a hidden or excluded directory, or matches .vantageignore)",
  skipped: "is larger than max-file-bytes",
  unreadable: "could not be read",
  done: "has a stage with the done role",
});

/** `a`, `a, and b`, `a, b, and c`: clauses, which already hold commas. */
function clauses(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

const LISTS_EVERY_QUESTION =
  "so Needs you lists every open question by document.";

/**
 * One line of a notice whose text sets something off (the filter notice,
 * §6.18): plain text, and `code` parts, which the page draws as code and the
 * checker prints between backticks, so the `:` after a filter text cannot be
 * read as part of it.
 */
export type PlanningNoticeLine = readonly (string | { code: string })[];

/** Who reads a filter notice: its last words say how to see the rest. */
export type PlanningNoticeReader = "page" | "checker";

/** A notice line as the checker prints it: each code part through `codeSpan`. */
export function noticeText(line: PlanningNoticeLine): string {
  return line
    .map((part) => (typeof part === "string" ? part : codeSpan(part.code)))
    .join("");
}

const count = (n: number): string => n.toLocaleString("en-US");

const plural = (n: number, one: string, many: string): string =>
  `${count(n)} ${n === 1 ? one : many}`;

/** `a`, `a and b`, `a, b, and c`: names, which hold no commas. */
function names(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** What stands in for the term a not-understood filter cannot name. */
function reasonPhrase(reason: PlanningFilterReason): string {
  switch (reason) {
    case "unclosed-quote":
      return "an unclosed quote";
    case "too-many-terms":
      return `a filter past ${plural(PLANNING_FILTER_LIMITS.terms, "term", "terms")}`;
    case "too-long":
      return `a filter past ${plural(PLANNING_FILTER_LIMITS.codePoints, "code point", "code points")}`;
  }
}

/** The term a not-understood filter names, as code, or its reason, as words. */
const notUnderstoodPart = (
  filter: NotUnderstoodPlanningFilter,
): string | { code: string } =>
  filter.term !== null
    ? { code: filter.term }
    : reasonPhrase(filter.reason ?? "unclosed-quote");

/**
 * What follows an unmatched term, in the notice's line for it (§6.18) and in
 * the checker's exit-2 message (§13.4), so the two cannot drift apart.
 */
const MATCHES_NO_PATH = " matches no path the index lists";

/** The example the Not filtered notice gives of a filter the language reads. */
const FILTER_EXAMPLE = "generator path:docs/design/*.md is:open";

/**
 * What the language reads (§6.12), as the Not filtered notice and the
 * checker's exit-2 message both say it after the term they cannot read.
 */
const FILTER_LANGUAGE =
  'words, "quoted phrases", path: and is:open terms, and a - before any of them to leave out what it matches';

/** The filter notice's lines for an applied filter (§6.18), first to last. */
function filteredNotice(
  summary: PlanningFilterSummary,
  reader: PlanningNoticeReader,
): PlanningNoticeLine[] {
  const { entries, documents, openQuestions } = summary;
  const open =
    openQuestions === 0
      ? "none of them open questions"
      : openQuestions === 1
        ? "1 of them an open question"
        : `${count(openQuestions)} of them open questions`;
  // The paths only where the filter's path terms leave one out: a filter
  // with none keeps every path, and saying so of a word that keeps nothing
  // reads as a contradiction (§6.18).
  const paths =
    documents.kept < documents.of
      ? ` in ${count(documents.kept)} of ${plural(documents.of, "path", "paths")},`
      : "";
  const lines: PlanningNoticeLine[] = [
    [
      "Filtered by ",
      { code: summary.canonical },
      `: ${count(entries.shown)} of ${plural(entries.of, "entry", "entries")},${paths} ${open}.`,
    ],
  ];
  for (const term of summary.unmatched) {
    lines.push([{ code: term }, `${MATCHES_NO_PATH}.`]);
  }
  for (const { key, terms } of summary.unknownKeys) {
    const line: (string | { code: string })[] = [
      { code: `${key}:` },
      " is not a filter key, so ",
    ];
    terms.forEach((term, i) => {
      if (i > 0) line.push(i === terms.length - 1 ? " and " : ", ");
      line.push({ code: term });
    });
    line.push(
      terms.length === 1 ? " is searched as text." : " are searched as text.",
      " The keys are ",
      { code: "path:" },
      " and ",
      { code: "is:" },
      ".",
    );
    lines.push(line);
  }

  const others = summary.otherRoadmaps;
  if (others.length > 0) {
    // Each question once, though two of the roadmaps may route it.
    const total = summary.onOtherRoadmaps;
    const line: (string | { code: string })[] = [
      total === 1
        ? "1 more question it keeps is on "
        : `${count(total)} more questions it keeps are on `,
      others.length === 1 ? "another roadmap: " : "other roadmaps: ",
    ];
    others.forEach((roadmap, i) => {
      if (i > 0) line.push(", ");
      line.push({ code: roadmap.path }, ` (${count(roadmap.count)})`);
    });
    const one = others.length === 1;
    line.push(
      reader === "page"
        ? one
          ? `. Choose that roadmap to see ${total === 1 ? "it" : "them"}; the filter stays.`
          : `. Choose one to see ${total === 1 ? "it" : "them"}; the filter stays.`
        : one
          ? ". Rerun with --roadmap naming it."
          : ". Rerun with --roadmap naming one.",
    );
    lines.push(line);
  }

  const blocked = summary.blockedLeftOut;
  if (blocked > 0) {
    lines.push([
      blocked === 1
        ? "1 of its questions is blocked and will need you later."
        : `${count(blocked)} of its questions are blocked and will need you later.`,
    ]);
  }

  // One line per kept document, naming every target it waits on outside.
  const outside = new Map<string, string[]>();
  for (const { path, target } of summary.waitsOutside) {
    const targets = outside.get(path) ?? [];
    targets.push(target);
    outside.set(path, targets);
  }
  for (const [path, targets] of outside) {
    lines.push([
      `${path} waits on ${names(targets)}, which this filter leaves out.`,
    ]);
  }

  const hidden = entries.of - entries.shown;
  lines.push([
    hidden === 0
      ? "It hides no entry."
      : reader === "page"
        ? `Clear the filter to see the other ${count(hidden)}.`
        : `Run without --filter to see the other ${count(hidden)}.`,
  ]);
  return lines;
}

/** One wording for the page and the CLI (P7). */
export const PLANNING_NOTICES: {
  nothingNeedsYou: string;
  /** *Nothing needs you* under a filter (§6.15): no open question it keeps. */
  nothingFilteredNeedsYou: string;
  /**
   * The filter notice of an applied filter (§6.18): the first line with its
   * counts, one line per unmatched term, one per unknown key, the clauses
   * that apply (other roadmaps, blocked questions left out, waits on a
   * document left out), and a last line saying how to see the rest, in
   * `reader`'s words.
   */
  filtered(
    summary: PlanningFilterSummary,
    reader: PlanningNoticeReader,
  ): PlanningNoticeLine[];
  /** The page's notice for a filter it cannot read, and so does not apply. */
  notFiltered(filter: NotUnderstoodPlanningFilter): PlanningNoticeLine;
  /** The checker's exit-2 message for a filter it cannot read, unprefixed. */
  filterNotUnderstood(filter: NotUnderstoodPlanningFilter): string;
  /**
   * The checker's exit-2 message for a term that matches no path the index
   * lists (§13.4), unprefixed: the notice's line for it, without its period.
   */
  filterUnmatched(term: string): string;
  /**
   * The roadmap notice of §6.8, or null: the No roadmap line when none
   * routes, the Not read as a roadmap line when a listed one is missing,
   * skipped or unreadable while another routes, and null otherwise.
   */
  roadmapNotice(
    config: PlanningConfig,
    roadmaps: readonly PlanningRoadmap[],
  ): string | null;
  /** "1 more question needs you on another roadmap." / "3 more questions need you on other roadmaps." */
  otherRoadmaps(count: number): string;
  noStages: string;
  refused(candidateCount: number, maxCandidates: number): string;
} = {
  nothingNeedsYou: "Nothing needs you.",
  nothingFilteredNeedsYou: "Nothing this filter keeps needs you.",
  filtered: filteredNotice,
  notFiltered: (filter) => [
    "Not filtered: this Vantage cannot read ",
    notUnderstoodPart(filter),
    `. It reads ${FILTER_LANGUAGE}, such as `,
    { code: FILTER_EXAMPLE },
    ". Every entry is shown.",
  ],
  filterNotUnderstood: (filter) =>
    `this checker cannot read ${noticeText([notUnderstoodPart(filter)])}; it reads ${FILTER_LANGUAGE}`,
  filterUnmatched: (term) => noticeText([{ code: term }, MATCHES_NO_PATH]),
  roadmapNotice(config, roadmaps) {
    const unread = roadmaps.filter(
      (r): r is PlanningRoadmap & { state: Exclude<RoadmapState, "routes"> } =>
        r.state !== "routes",
    );
    if (unread.length < roadmaps.length) {
      // One routes. Only a listed roadmap that could not be read is named: a
      // `done` stage is a deliberate retirement, and Too large and Unreadable
      // already list a roadmap found by name.
      if (config.roadmaps === null) return null;
      const failed = unread.filter((r) => r.state !== "done");
      if (failed.length === 0) return null;
      return `Not read as a roadmap: ${failed
        .map(
          (r) =>
            `${r.path}, which roadmap under [planning] lists, ${ROADMAP_STATE_PHRASES[r.state]}`,
        )
        .join("; ")}.`;
    }
    const named = clauses(
      unread.map((r) => `${r.path} ${ROADMAP_STATE_PHRASES[r.state]}`),
    );
    // When every one was read and is retired by a done stage, the path is
    // right, and finding by name finds the same file: the remedy is its stage.
    const allDone =
      unread.length > 0 && unread.every((r) => r.state === "done");
    const restage = `Give ${unread.length === 1 ? "it a stage" : "them stages"} without the done role`;
    if (config.roadmaps === null) {
      const found =
        unread.length === 0
          ? `no planning candidate is named ${ROADMAP_FILE_NAME}`
          : named;
      const remedy = allDone
        ? `${restage}, add another ${ROADMAP_FILE_NAME} in any directory, or name one with roadmap under [planning] in .vantage.toml.`
        : `Add a ${ROADMAP_FILE_NAME} in any directory, or name one with roadmap under [planning] in .vantage.toml.`;
      return `No roadmap: ${found}, ${LISTS_EVERY_QUESTION} ${remedy} A ${ROADMAP_FILE_NAME} in a hidden directory, matched by .vantageignore, or ruled out by include or exclude is not read.`;
    }
    if (unread.length === 0) {
      return `No roadmap: roadmap under [planning] in .vantage.toml is an empty list, ${LISTS_EVERY_QUESTION} List a roadmap there, or remove roadmap to find every ${ROADMAP_FILE_NAME}.`;
    }
    const listed = clauses(
      unread.map((r) => `${r.path}, which ${ROADMAP_STATE_PHRASES[r.state]}`),
    );
    const remedy = allDone
      ? `${restage}, or list another roadmap.`
      : `Correct the ${unread.length === 1 ? "path" : "paths"}, or remove roadmap to find every ${ROADMAP_FILE_NAME}.`;
    return `No roadmap: roadmap under [planning] in .vantage.toml lists ${listed}, ${LISTS_EVERY_QUESTION} ${remedy}`;
  },
  otherRoadmaps: (count) =>
    count === 1
      ? "1 more question needs you on another roadmap."
      : `${count.toLocaleString("en-US")} more questions need you on other roadmaps.`,
  noStages: `No stages are declared, so ${PLANNING_SECTION_TITLES.ready}, ${PLANNING_SECTION_TITLES.graduate} and ${PLANNING_SECTION_TITLES.disagrees} are not shown. Declare them under [planning.stages] in .vantage.toml.`,
  refused: (candidateCount, maxCandidates) =>
    `This repository has ${candidateCount.toLocaleString("en-US")} candidate files, more than max-candidates (${maxCandidates.toLocaleString("en-US")}), so nothing was scanned. Narrow include under [planning] in .vantage.toml, or raise max-candidates.`,
};

/** A document's stage role, or `null` without a stage or declared stages. */
function roleOf(index: PlanningIndex, doc: PlanningDocument): StageRole | null {
  const stages = index.config.stages;
  if (stages === null || doc.stage === null) return null;
  return Object.hasOwn(stages, doc.stage) ? (stages[doc.stage] ?? null) : null;
}

/**
 * A `done` document is not a live proposal and contributes to no section.
 * Exported for the filter's recount of *Nothing needs you*, and not from
 * `planning/index.ts`.
 */
export const isLive = (index: PlanningIndex, doc: PlanningDocument): boolean =>
  roleOf(index, doc) !== "done";

const refOf = (q: PlanningQuestion): QuestionRef => ({
  path: q.path,
  id: q.id,
  line: q.line,
});

const keyOf = (ref: QuestionRef): string => `${ref.path}\n${ref.line}`;

const isOpen = (q: PlanningQuestion): boolean => q.state === "open";

/**
 * The questions one link of `roadmap` routes (§4.3), or `null` when it routes
 * nothing at all.
 *
 * A bare link to a document routes every question in it, and routes the
 * document even when it has none, so the list can be empty; a link to
 * `#OQ-…` routes that one question, and nothing when no question carries the
 * id; a link to a heading routes nothing, since a compacted question is cited
 * through its document's `#decision-ledger` heading and routing that would
 * route the document's unrelated open questions (Plan Q12). Links to
 * non-planning documents, and to `done` documents, route nothing, and neither
 * do a roadmap's links to itself: a document's links are its links to another
 * candidate (§3.2). A link to another roadmap is an ordinary link, and routes
 * the questions written there, never the ones that roadmap routes.
 */
function routedBy(
  index: PlanningIndex,
  roadmap: string,
  link: PlanningLink,
): PlanningQuestion[] | null {
  if (link.target === roadmap) return null;
  const doc = findDocument(index, link.target);
  if (doc === undefined || !isLive(index, doc)) return null;
  if (link.fragment === null) return doc.questions;
  if (!VANTAGE_OQ_ID.test(link.fragment)) return null;
  const reached = doc.questions.filter((q) => q.id === link.fragment);
  return reached.length > 0 ? reached : null;
}

/** A roadmap's path and its state, before any routing is counted. */
interface RoadmapEntry {
  path: string;
  state: RoadmapState;
  /** The document, when it `routes`. */
  doc: PlanningDocument | null;
}

/**
 * Every roadmap of the index, in roadmap order, with its state (§4.2).
 * Listed: one entry per listed path, `missing` when the index holds nothing
 * at it. Found by name: every path the index holds, as a document, skipped or
 * unreadable, whose name is `roadmap.md`.
 */
function roadmapEntries(index: PlanningIndex): RoadmapEntry[] {
  const listed = index.config.roadmaps;
  const paths =
    listed === null
      ? [...index.documents, ...index.skipped, ...index.unreadable]
          .map((entry) => entry.path)
          .filter(hasRoadmapName)
      : listed;
  return [...new Set(paths)].sort(compareRoadmaps).map((path) => {
    const doc = findDocument(index, path);
    if (doc !== undefined) {
      return isLive(index, doc)
        ? { path, state: "routes", doc }
        : { path, state: "done", doc: null };
    }
    const has = (list: readonly { path: string }[]) =>
      list.some((entry) => entry.path === path);
    const state: RoadmapState = has(index.skipped)
      ? "skipped"
      : has(index.unreadable)
        ? "unreadable"
        : "missing";
    return { path, state, doc: null };
  });
}

/**
 * The questions one routing document's links reach, in the order they reach
 * them, each link read by `routedBy`. A question reached twice keeps its
 * first position.
 */
function routesOf(
  index: PlanningIndex,
  roadmap: PlanningDocument,
): RoutedQuestion[] {
  const routed: RoutedQuestion[] = [];
  const seen = new Set<string>();
  for (const link of roadmap.links) {
    const reached = routedBy(index, roadmap.path, link);
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
 * The questions one roadmap routes, in its order (§4.3): `[]` unless `roadmap`
 * is a roadmap of the index whose state is `routes`.
 */
export function routeQuestions(
  index: PlanningIndex,
  roadmap: string,
): RoutedQuestion[] {
  if (!isRoadmapPath(index.config, roadmap)) return [];
  const doc = findDocument(index, roadmap);
  if (doc === undefined || !isLive(index, doc)) return [];
  return routesOf(index, doc);
}

/** Every routing roadmap's routes, in roadmap order. */
interface Routing {
  roadmaps: PlanningRoadmap[];
  /** One entry per roadmap in `routes`, in roadmap order. */
  routes: { path: string; doc: PlanningDocument; routed: RoutedQuestion[] }[];
}

/** Whether a routed question needs a ruling, or an answer compacted. */
function needsYouFilter(index: PlanningIndex): (ref: QuestionRef) => boolean {
  return (ref) => {
    const state = questionFor(index, ref)?.state;
    return state === "open" || state === "answered";
  };
}

function routingOf(index: PlanningIndex): Routing {
  const needsYou = needsYouFilter(index);
  const routes: Routing["routes"] = [];
  const roadmaps = roadmapEntries(index).map(({ path, state, doc }) => {
    if (doc === null) return { path, state, needsYouCount: 0 };
    const routed = routesOf(index, doc);
    routes.push({ path, doc, routed });
    return { path, state, needsYouCount: routed.filter(needsYou).length };
  });
  return { roadmaps, routes };
}

/**
 * Every roadmap, in roadmap order (§4.2). Listed: one entry per listed path,
 * `missing` when the index holds nothing at it. Found by name: every path the
 * index holds, as a document, skipped or unreadable, whose name is
 * `roadmap.md`; never `missing`. A document whose stage has the done role is
 * `done`, any other document `routes`.
 */
export function roadmapsOf(index: PlanningIndex): PlanningRoadmap[] {
  return routingOf(index).roadmaps;
}

/**
 * The open questions of `docs` that `routed` does not hold (§6.2 *Not on a
 * roadmap*), by document, then line. `docs` are live documents: a `done` one
 * has no questions to leave unrouted.
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

/**
 * Every section of the planning page, top to bottom (§6.2), for one chosen
 * roadmap: `options.roadmap` when it routes, else the default roadmap, the
 * first in roadmap order that does.
 */
export function derivePlanningSections(
  index: PlanningIndex,
  options: { roadmap?: string | null } = {},
): PlanningSections {
  const { config } = index;
  const live = index.documents.filter((doc) => isLive(index, doc));
  const stagesDeclared = config.stages !== null;
  const { roadmaps, routes } = routingOf(index);
  const chosen =
    routes.find((route) => route.path === options.roadmap) ?? routes[0];

  let needsYou: RoutedQuestion[];
  const onOtherRoadmaps: OtherRoadmapQuestion[] = [];
  let unrouted: QuestionRef[] | null;
  if (chosen !== undefined) {
    const needs = needsYouFilter(index);
    needsYou = chosen.routed.filter(needs);
    const listed = new Set(chosen.routed.map(keyOf));
    for (const route of routes) {
      if (route === chosen) continue;
      for (const ref of route.routed) {
        if (listed.has(keyOf(ref)) || !needs(ref)) continue;
        listed.add(keyOf(ref));
        onOtherRoadmaps.push({ ...ref, roadmap: route.path });
      }
    }
    unrouted = unroutedIn(
      live,
      routes.flatMap((route) => route.routed),
    );
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
    roadmaps,
    chosenRoadmap: chosen?.path ?? null,
    stagesDeclared,
    nothingNeedsYou: !live.some(hasOpen),
    needsYou,
    onOtherRoadmaps,
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
  /**
   * The documents that link here: the roadmaps that route first, in roadmap
   * order, then the rest by path.
   */
  sources: ReferenceSource[];
  /**
   * Each roadmap that routes this document or one of its questions (§4.3), in
   * roadmap order, with the heading of its first link that does, `heading`
   * being `null` for a link above every heading. Never the document itself,
   * which is not on itself, though it may be on another roadmap that links it.
   */
  onRoadmaps: { roadmap: string; heading: string | null }[];
  /**
   * Its open questions no roadmap routes: what the planning page lists for it
   * under *Not on a roadmap* (§6.2). `0` when no roadmap routes, where there
   * is no such section, and for a `done` document, which contributes to none.
   */
  unrouted: number;
  /**
   * Every roadmap that routes, in roadmap order: how many there are, which
   * decides the line's wording, and what a label must tell apart.
   */
  roadmaps: string[];
  /**
   * Its stage has no `done` role and it holds at least one question: the
   * line then links to the planning page filtered to this document (§7.1).
   * `false` for a path the index holds no document at.
   */
  hasLiveQuestions: boolean;
}

/**
 * Who links to `path`, and which roadmaps route it: the two questions a
 * Referenced by line answers. Routing and the unrouted count are the planning
 * page's own derivations, applied to one document, so the line and the page
 * cannot disagree (P7). None of it depends on a chosen roadmap, so every
 * reader sees the same line.
 */
export function referenceSummary(
  index: PlanningIndex,
  path: string,
): ReferenceSummary {
  const { routes } = routingOf(index);
  const roadmaps = routes.map((route) => route.path);
  const sources: ReferenceSource[] = [];
  for (const ref of referencedBy(index, path)) {
    const last = sources.at(-1);
    if (last?.from === ref.from) last.references.push(ref);
    else sources.push({ from: ref.from, references: [ref] });
  }
  const first = sources
    .filter((source) => roadmaps.includes(source.from))
    .sort((a, b) => compareRoadmaps(a.from, b.from));
  const rest = sources.filter((source) => !roadmaps.includes(source.from));

  const onRoadmaps: ReferenceSummary["onRoadmaps"] = [];
  for (const route of routes) {
    if (route.path === path) continue;
    const link = route.doc.links.find(
      (l) => l.target === path && routedBy(index, route.path, l) !== null,
    );
    if (link !== undefined) {
      onRoadmaps.push({ roadmap: route.path, heading: link.heading });
    }
  }
  const doc = findDocument(index, path);
  const unrouted =
    routes.length === 0 || doc === undefined || !isLive(index, doc)
      ? 0
      : unroutedIn(
          [doc],
          routes.flatMap((route) => route.routed),
        ).length;
  const hasLiveQuestions =
    doc !== undefined && isLive(index, doc) && doc.questions.length > 0;
  return {
    sources: [...first, ...rest],
    onRoadmaps,
    unrouted,
    roadmaps,
    hasLiveQuestions,
  };
}
