/**
 * The planning page's pages (`docs/reference/planning-index.md` §6.4):
 * which run of each section's entries is shown, from the index alone and the
 * page each section's URL parameter asks for.
 *
 * | Sections | A page holds |
 * | :--- | :--- |
 * | Needs you, Not on a roadmap, Blocked | `pageEntries` entries, stopping early before its cards' Markdown passes `pageMarkdownChars` |
 * | Ready to build, Ready to graduate, Stage conflict | `pageRows` document rows |
 * | Too large, Unreadable | `pageLines` lines |
 *
 * A card's Markdown is its question's `cardChars`, so page boundaries are
 * known before anything is fetched. A Blocked document row counts as one entry
 * and no Markdown, and so does a preview card, whose block is not rendered
 * (§6.6). A page always holds at least one entry.
 *
 * The URL carries the pages, `?needs-you=3&waiting=2`, 1-based, with page 1
 * left out. A page past the end is clamped to the last, and a value that is not
 * a page number reads as 1; `pageSearch` says how the URL is to be rewritten.
 *
 * With two or more roadmaps that route, the URL carries the chosen one too, as
 * `?roadmap=docs/plans/roadmap.md` (`docs/reference/planning-index.md` §6.8):
 * *Needs you* follows it. Which roadmap is chosen is `chooseRoadmap`, one pure
 * function of the roadmaps, the URL's value and the one this browser
 * remembers for the repository, so the page, its inputs and every prefetch
 * resolve it alike; `planningSearch` rewrites the URL to name it.
 *
 * A planning filter (`docs/reference/planning-index.md` §6.11) narrows the
 * sections, as `?filter=path:docs/design/x.md+is:open`: the planning module
 * parses and applies it (F1), to the sections derived from the whole index
 * under the chosen roadmap (F2), and this file is the page's one reader and
 * writer of the parameter, beside `roadmap=` (§6.16). The applied filter's
 * canonical text joins every identity a layout has (§6.16): the derived
 * sections are cached by index, roadmap and filter, and a layout names its
 * filter as it names its roadmap.
 *
 * Pure functions of the index and the limits module, so the page, its inputs
 * and the viewer's prefetch lay a page out identically.
 */
import {
  PLANNING_FILTER_PARAM,
  PLANNING_ROADMAP_PARAM,
  PLANNING_SECTION_IDS,
  PLANNING_SECTION_TITLES,
  applyPlanningFilter,
  derivePlanningSections,
  encodePlanningQueryValue,
  parsePlanningFilter,
  questionFor,
  sectionExplanation,
  type DependsOn,
  type FilteredPlanningSections,
  type PlanningFilterSummary,
  type PlanningIndex,
  type PlanningQuestion,
  type PlanningRoadmap,
  type PlanningSectionId,
  type PlanningSections,
  type QuestionRef,
  type UnderstoodPlanningFilter,
} from "vantage-md/planning";
import { planningLimits } from "../planningScan/limits";
import {
  planningRoadmapPreferenceKey,
  readPreference,
  writePreference,
} from "./preferences";

/**
 * Each section, by the name its URL parameter and its heading's id carry, and
 * its title: the shared planning module's (`vantage-md/planning`'s guide),
 * which `vantage-check index` prints too. An id is a machine interface and
 * never changes; a title is display text.
 */
export const SECTION_IDS = PLANNING_SECTION_IDS;
export type SectionId = PlanningSectionId;
export const SECTION_TITLES: Readonly<Record<SectionId, string>> =
  PLANNING_SECTION_TITLES;

/** One entry of Needs you, Not on a roadmap or Blocked. */
export type CardEntry =
  | {
      kind: "question";
      question: PlanningQuestion;
      /** Its block is past `cardChars`, so its card is a preview card. */
      preview: boolean;
    }
  | { kind: "document"; path: string; waitingOn: readonly DependsOn[] };

interface SectionPage {
  id: SectionId;
  title: string;
  /** The line under its heading: what its entries are, and what to do. */
  explanation: string;
  /** Entries in the whole section. */
  total: number;
  pageCount: number;
  /** The page shown, 1-based. */
  page: number;
  /** The shown page's first entry, 0-based, and one past its last. */
  start: number;
  end: number;
}

/** One non-empty section, with the page of it that is shown. */
export type LaidOutSection =
  | (SectionPage & { kind: "cards"; items: readonly CardEntry[] })
  | (SectionPage & { kind: "rows"; items: readonly string[] })
  | (SectionPage & {
      kind: "skipped";
      items: readonly { path: string; size: number }[];
    })
  | (SectionPage & {
      kind: "unreadable";
      items: readonly { path: string; reason: string }[];
    });

export interface PlanningLayout {
  /**
   * The chosen roadmap its *Needs you* follows, `null` when no roadmap
   * routes. Part of what names a layout, with `pages`.
   */
  roadmap: string | null;
  /**
   * The applied planning filter's canonical text: `""` for none, and for a
   * filter that is not understood, which is not applied and so shows what no
   * filter does (§6.16). Part of what names a layout.
   */
  filter: string;
  /** The non-empty sections, top to bottom. */
  sections: readonly LaidOutSection[];
  /**
   * The shown pages, canonically: `needs-you=2&waiting=3`, sections in order,
   * page 1 left out, `""` when every section is on its first page. Two layouts
   * of one index with the same `roadmap`, `filter` and `pages` show the same
   * entries.
   */
  pages: string;
}

/** What the URL asks for: each section's raw parameter, or `null`. */
export type PageRequest = Readonly<Partial<Record<SectionId, string | null>>>;

/** The page a raw parameter asks for: a positive integer, else page 1. */
function pageAsked(raw: string | null | undefined): number {
  return raw !== null && raw !== undefined && /^[1-9]\d{0,8}$/.test(raw)
    ? Number(raw)
    : 1;
}

/** Each section's parameter in `search`. */
export function readPageRequest(search: URLSearchParams): PageRequest {
  const out: Partial<Record<SectionId, string | null>> = {};
  for (const id of SECTION_IDS) out[id] = search.get(id);
  return out;
}

/** Whether a question's card is a preview card (§6.6). */
export const isPreview = (question: PlanningQuestion): boolean =>
  question.cardChars > planningLimits.cardChars;

/** The Markdown a card entry puts on its page, in characters. */
const markdownOf = (entry: CardEntry): number =>
  entry.kind === "question" && !entry.preview ? entry.question.cardChars : 0;

/**
 * Where each page of a card section starts: `bounds[i]` is page `i + 1`'s
 * first entry, and the last bound is the section's length.
 */
function cardBounds(entries: readonly CardEntry[]): number[] {
  const bounds = [0];
  let count = 0;
  let chars = 0;
  entries.forEach((entry, at) => {
    const size = markdownOf(entry);
    // An entry with no Markdown never passes the budget, whatever the page
    // already holds.
    if (
      count > 0 &&
      (count >= planningLimits.pageEntries ||
        (size > 0 && chars + size > planningLimits.pageMarkdownChars))
    ) {
      bounds.push(at);
      count = 0;
      chars = 0;
    }
    count += 1;
    chars += size;
  });
  bounds.push(entries.length);
  return bounds;
}

/** The bounds of a section whose pages hold `size` entries each. */
function fixedBounds(length: number, size: number): number[] {
  const bounds = [0];
  for (let at = size; at < length; at += size) bounds.push(at);
  bounds.push(length);
  return bounds;
}

const questionEntry = (question: PlanningQuestion): CardEntry => ({
  kind: "question",
  question,
  preview: isPreview(question),
});

function questionsOf(
  index: PlanningIndex,
  refs: readonly QuestionRef[],
): CardEntry[] {
  return refs.flatMap((ref) => {
    const question = questionFor(index, ref);
    return question === undefined ? [] : [questionEntry(question)];
  });
}

/** One section's entries, all of them, before they are paged. */
export type SectionEntries =
  | { id: SectionId; kind: "cards"; entries: CardEntry[] }
  | { id: SectionId; kind: "rows"; entries: string[] }
  | { id: SectionId; kind: "skipped"; entries: PlanningIndex["skipped"] }
  | { id: SectionId; kind: "unreadable"; entries: PlanningIndex["unreadable"] };

/**
 * Every section's entries, in order; an empty section is left out. What the
 * page lays out, and what the planning outline lists
 * (`lib/planningOutline.ts`).
 */
export function sectionEntries(
  index: PlanningIndex,
  sections: PlanningSections,
): SectionEntries[] {
  const waiting: CardEntry[] = sections.waiting.flatMap((entry) => {
    if (entry.kind === "document") {
      return [
        { kind: "document", path: entry.path, waitingOn: entry.waitingOn },
      ];
    }
    const question = questionFor(index, entry.question);
    return question === undefined ? [] : [questionEntry(question)];
  });
  const all = [
    {
      id: "needs-you",
      kind: "cards",
      entries: questionsOf(index, sections.needsYou),
    },
    {
      id: "unrouted",
      kind: "cards",
      entries: questionsOf(index, sections.unrouted ?? []),
    },
    { id: "waiting", kind: "cards", entries: waiting },
    { id: "ready", kind: "rows", entries: sections.ready ?? [] },
    { id: "graduate", kind: "rows", entries: sections.graduate ?? [] },
    { id: "disagrees", kind: "rows", entries: sections.disagrees ?? [] },
    { id: "skipped", kind: "skipped", entries: sections.skipped },
    { id: "could-not-read", kind: "unreadable", entries: sections.unreadable },
  ] as const;
  return all.filter(
    (section) => section.entries.length > 0,
  ) as SectionEntries[];
}

/**
 * Where each page of a section starts: `bounds[i]` is page `i + 1`'s first
 * entry, and the last bound is the section's length.
 */
export function pageBounds(section: SectionEntries): number[] {
  return section.kind === "cards"
    ? cardBounds(section.entries)
    : fixedBounds(
        section.entries.length,
        section.kind === "rows"
          ? planningLimits.pageRows
          : planningLimits.pageLines,
      );
}

/**
 * Lay the page out: every non-empty section, with the page `request` asks
 * for, clamped to the section's last. `sections` are `sectionsOf(index,
 * roadmap, filter)`, and `filter` the canonical text they were filtered by,
 * which the layout names: a filtered link's page parameters are read against
 * the filtered sections (§6.16).
 */
export function layoutPlanningPage(
  index: PlanningIndex,
  sections: PlanningSections,
  request: PageRequest,
  filter = "",
): PlanningLayout {
  const laid: LaidOutSection[] = [];
  const pages: string[] = [];
  for (const section of sectionEntries(index, sections)) {
    const bounds = pageBounds(section);
    const pageCount = bounds.length - 1;
    const page = Math.min(pageAsked(request[section.id]), pageCount);
    const start = bounds[page - 1] ?? 0;
    const end = bounds[page] ?? section.entries.length;
    if (page > 1) pages.push(`${section.id}=${page}`);
    laid.push({
      id: section.id,
      title: SECTION_TITLES[section.id],
      explanation: sectionExplanation(section.id, sections),
      total: section.entries.length,
      pageCount,
      page,
      start,
      end,
      kind: section.kind,
      items: section.entries.slice(start, end),
    } as LaidOutSection);
  }
  return {
    roadmap: sections.chosenRoadmap,
    filter,
    sections: laid,
    pages: pages.join("&"),
  };
}

/**
 * The sections of `index` with `roadmap` asked for, derived once per index
 * and chosen roadmap, then filtered by `filter`, once per filter. `filter` is
 * a canonical text, as `PlanningLayout.filter` holds one; `""`, or a text
 * that is not understood, is the unfiltered derivation itself.
 *
 * `derivePlanningSections` falls back from a roadmap that does not route,
 * and `null` asks for the default, so a derivation is kept under the roadmap
 * it chose as well as the one asked for: asking for the default by name or by
 * `null` is one derivation, and one object. A filter applies to that
 * derivation, over the whole index (F2), so it is cached under the
 * derivation's object: index, then roadmap, then filter (§6.16). Each
 * derivation keeps the `FILTERED_KEPT` filters used last, since the page
 * applies a filter per keystroke and the map would otherwise grow with them.
 */
const derived = new WeakMap<
  PlanningIndex,
  Map<string | null, PlanningSections>
>();
const filtered = new WeakMap<
  PlanningSections,
  Map<string, FilteredPlanningSections>
>();
export function sectionsOf(
  index: PlanningIndex,
  roadmap: string | null = null,
  filter = "",
): PlanningSections {
  return (
    filteredSectionsOf(index, roadmap, filter)?.sections ??
    derivedSectionsOf(index, roadmap)
  );
}

/** The unfiltered derivation, once per index and chosen roadmap. */
function derivedSectionsOf(
  index: PlanningIndex,
  roadmap: string | null,
): PlanningSections {
  let byRoadmap = derived.get(index);
  if (byRoadmap === undefined) {
    byRoadmap = new Map();
    derived.set(index, byRoadmap);
  }
  let sections = byRoadmap.get(roadmap);
  if (sections === undefined) {
    const fresh = derivePlanningSections(index, { roadmap });
    sections = byRoadmap.get(fresh.chosenRoadmap) ?? fresh;
    byRoadmap.set(roadmap, sections);
    byRoadmap.set(fresh.chosenRoadmap, sections);
  }
  return sections;
}

/** How many filtered sections each derivation keeps, the last used last out. */
const FILTERED_KEPT = 16;

/**
 * The sections `filter` keeps of `sectionsOf(index, roadmap)`, and what the
 * filter notice says of them (§6.18), from the same
 * cache as `sectionsOf`; `null` when `filter` applies nothing: `""`, or a
 * text that is not understood.
 */
export function filteredSectionsOf(
  index: PlanningIndex,
  roadmap: string | null,
  filter: string,
): FilteredPlanningSections | null {
  const parsed = understoodFilter(filter);
  if (parsed === null) return null;
  const base = derivedSectionsOf(index, roadmap);
  let byFilter = filtered.get(base);
  if (byFilter === undefined) {
    byFilter = new Map();
    filtered.set(base, byFilter);
  }
  let out = byFilter.get(parsed.canonical);
  if (out === undefined) {
    out = applyPlanningFilter(index, base, parsed);
  } else {
    byFilter.delete(parsed.canonical);
  }
  byFilter.set(parsed.canonical, out);
  while (byFilter.size > FILTERED_KEPT) {
    const oldest = byFilter.keys().next().value;
    if (oldest === undefined) break;
    byFilter.delete(oldest);
  }
  return out;
}

/** The filter notice's numbers for `filter` over `index`'s sections, or `null`. */
export function filterSummaryOf(
  index: PlanningIndex,
  roadmap: string | null,
  filter: string,
): PlanningFilterSummary | null {
  return filteredSectionsOf(index, roadmap, filter)?.summary ?? null;
}

/** How many parsed filters `understoodFilter` keeps, the last used last out. */
const FILTERS_KEPT = 16;
const understood = new Map<string, UnderstoodPlanningFilter | null>();

/**
 * `filter` parsed, or `null` when it applies nothing: one object per text, so
 * the matchers the planning module compiles once per filter object are
 * compiled once for the page, its recounts and its Copy answers alike.
 */
export function understoodFilter(
  filter: string,
): UnderstoodPlanningFilter | null {
  if (filter === "") return null;
  let parsed = understood.get(filter);
  if (parsed === undefined) {
    const read = parsePlanningFilter(filter);
    parsed = read.kind === "understood" ? read : null;
  } else {
    understood.delete(filter);
  }
  understood.set(filter, parsed);
  while (understood.size > FILTERS_KEPT) {
    const oldest = understood.keys().next().value;
    if (oldest === undefined) break;
    understood.delete(oldest);
  }
  return parsed;
}

/**
 * The roadmap the URL asks for, repo-relative with one leading `./` dropped,
 * or `null`. `URLSearchParams` has already decoded it, so `docs/plans/x.md`
 * and `docs%2Fplans%2Fx.md` read alike.
 */
export function readRoadmapRequest(search: URLSearchParams): string | null {
  const asked = search.get(PLANNING_ROADMAP_PARAM);
  if (asked === null || asked === "") return null;
  return asked.startsWith("./") ? asked.slice(2) : asked;
}

/** The roadmaps that route, in roadmap order: what the picker offers. */
export const routingRoadmaps = (
  roadmaps: readonly PlanningRoadmap[],
): PlanningRoadmap[] => roadmaps.filter((r) => r.state === "routes");

/**
 * Which roadmap is chosen (`planning-index.md` §6.8): the URL's, when it names
 * a roadmap that routes; else the one this browser remembers for the
 * repository, when it still routes; else the default, the first that routes.
 * `null` when none routes. `roadmaps` are in roadmap order, as
 * `PlanningSections.roadmaps` holds them.
 */
export function chooseRoadmap(
  roadmaps: readonly PlanningRoadmap[],
  asked: string | null,
  remembered: string | null,
): string | null {
  const routing = routingRoadmaps(roadmaps);
  for (const want of [asked, remembered]) {
    if (want !== null && routing.some((r) => r.path === want)) return want;
  }
  return routing[0]?.path ?? null;
}

/**
 * The roadmap this browser remembers for `repo` (`""` in single-repo mode),
 * or `null`. Storage that fails reads as nothing remembered.
 */
export function readRememberedRoadmap(repo: string): string | null {
  const value = readPreference(planningRoadmapPreferenceKey(repo));
  return value === null || value === "" ? null : value;
}

/**
 * Remember a pick of `path` for `repo`. Only a pick is remembered, never a
 * visit to a URL that names one, and storage that fails remembers nothing
 * and says nothing.
 */
export function rememberRoadmap(repo: string, path: string): void {
  writePreference(planningRoadmapPreferenceKey(repo), path);
}

/**
 * `search` rewritten to name exactly `layout`'s pages, roadmap and filter, or
 * `null` when it already does. The pages are `pageSearch`'s. The roadmap is
 * named when two or more roadmaps route, so the address always says which
 * one is shown, and removed when fewer do, as a page parameter naming page 1
 * is. An applied filter is named by its canonical text as one parameter, an
 * empty one is removed, and one that is not understood is left exactly as
 * written, so it can be fixed (§6.16, §6.14).
 */
export function planningSearch(
  search: URLSearchParams,
  layout: PlanningLayout,
  sections: PlanningSections,
): URLSearchParams | null {
  let next = pageSearch(search, layout);
  const edit = (): URLSearchParams => (next ??= new URLSearchParams(search));
  const want =
    routingRoadmaps(sections.roadmaps).length >= 2 ? layout.roadmap : null;
  const base = next ?? search;
  if (
    base.get(PLANNING_ROADMAP_PARAM) !== want ||
    base.getAll(PLANNING_ROADMAP_PARAM).length > 1
  ) {
    if (want === null) edit().delete(PLANNING_ROADMAP_PARAM);
    else edit().set(PLANNING_ROADMAP_PARAM, want);
  }
  const asked = search.getAll(PLANNING_FILTER_PARAM);
  if (layout.filter !== "") {
    if (asked.length !== 1 || asked[0] !== layout.filter) {
      edit().set(PLANNING_FILTER_PARAM, layout.filter);
    }
  } else if (
    asked.length > 0 &&
    parsePlanningFilter(asked.join(" ")).kind === "none"
  ) {
    edit().delete(PLANNING_FILTER_PARAM);
  }
  return next;
}

/**
 * The filter the URL asks for, as one text: every `filter` value joined with
 * one space, in order, which is what typing them all into the box gives
 * (§6.11). `""` when there is none.
 */
export function readFilterRequest(search: URLSearchParams): string {
  return search.getAll(PLANNING_FILTER_PARAM).join(" ");
}

/**
 * The `filter` value a text is written as (§6.16): its canonical text when it
 * is understood, the text as typed when it is not, and `""`, no parameter,
 * when it is empty or white space alone.
 */
export function filterValue(text: string): string {
  const parsed = parsePlanningFilter(text);
  return parsed.kind === "understood"
    ? parsed.canonical
    : parsed.kind === "none"
      ? ""
      : text;
}

/**
 * `search` with the filter `text` applied, by Enter, ✕ or a pasted link
 * (§6.16): `filter` set to `filterValue(text)`, first, as
 * a planning link writes it, or removed when that is empty; every section's
 * page parameter deleted, as a roadmap pick deletes Needs you's, since the
 * pages were another filter's; and `roadmap` set to the one a pasted link
 * names, if it names one. Every other parameter stays, in its order after
 * `filter`, `roadmap` and unknown ones included. So the address after Enter
 * is the agent's link for the same filter and roadmap (§13.5).
 */
export function withFilter(
  search: URLSearchParams,
  text: string,
  roadmap: string | null = null,
): URLSearchParams {
  const value = filterValue(text);
  const next = new URLSearchParams(
    value === "" ? [] : [[PLANNING_FILTER_PARAM, value]],
  );
  for (const [key, kept] of search) {
    if (key !== PLANNING_FILTER_PARAM && !isSectionId(key)) {
      next.append(key, kept);
    }
  }
  if (roadmap !== null) next.set(PLANNING_ROADMAP_PARAM, roadmap);
  return next;
}

const isSectionId = (key: string): boolean =>
  (SECTION_IDS as readonly string[]).includes(key);

/**
 * `search` written as the page writes every query it navigates to itself,
 * with no `?`: form encoding, as `URLSearchParams` writes it, except for
 * `filter`, which is written as a planning link writes it
 * (`encodePlanningQueryValue`, §13.5), its last character
 * escaped when it ends the query. So the address bar shows what an agent's
 * link shows, after Enter, a flip or a roadmap pick alike, and a pasted copy
 * of it reads back whole. Both encodings read back to the same text.
 */
export function planningQuery(search: URLSearchParams): string {
  const entries = [...search];
  return entries
    .map(([key, value], i) =>
      key === PLANNING_FILTER_PARAM
        ? `${PLANNING_FILTER_PARAM}=${encodePlanningQueryValue(value, i === entries.length - 1)}`
        : new URLSearchParams([[key, value]]).toString(),
    )
    .join("&");
}

/**
 * `search` with `roadmap` picked: the roadmap replaced, and *Needs you* back
 * on its first page, since its order is another roadmap's now. Every other
 * parameter stays.
 */
export function withRoadmap(
  search: URLSearchParams,
  roadmap: string,
): URLSearchParams {
  const next = new URLSearchParams(search);
  next.set(PLANNING_ROADMAP_PARAM, roadmap);
  next.delete("needs-you");
  return next;
}

/**
 * `search` rewritten to name exactly `layout`'s pages, or `null` when it
 * already does: a clamped page, a malformed value, an explicit page 1 and a
 * section that is not shown all go. Every other parameter, and the order of
 * those it keeps, is left as it is.
 */
export function pageSearch(
  search: URLSearchParams,
  layout: PlanningLayout,
): URLSearchParams | null {
  const shown = new Map(layout.sections.map((s) => [s.id, s.page]));
  const next = new URLSearchParams(search);
  let changed = false;
  for (const id of SECTION_IDS) {
    const page = shown.get(id) ?? 1;
    const want = page > 1 ? String(page) : null;
    if (search.get(id) === want && search.getAll(id).length <= 1) continue;
    changed = true;
    if (want === null) next.delete(id);
    else next.set(id, want);
  }
  return changed ? next : null;
}

/** `search` with section `id` on `page`. */
export function withPage(
  search: URLSearchParams,
  id: SectionId,
  page: number,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (page > 1) next.set(id, String(page));
  else next.delete(id);
  return next;
}

/** `request` with section `id` on `page`, for laying out a page not shown. */
export function requestWithPage(
  request: PageRequest,
  id: SectionId,
  page: number,
): PageRequest {
  return { ...request, [id]: page > 1 ? String(page) : null };
}

/**
 * Every question with a card, on any page, in page order, and every question
 * that needs you on another roadmap: what Copy answers covers, under every
 * roadmap, so choosing another changes neither what it copies nor its count
 * (`planning-index.md` §6.7).
 */
export function listedQuestions(
  index: PlanningIndex,
  sections: PlanningSections,
): PlanningQuestion[] {
  const refs: QuestionRef[] = [
    ...sections.needsYou,
    ...sections.onOtherRoadmaps,
    ...(sections.unrouted ?? []),
    ...sections.waiting.flatMap((w) =>
      w.kind === "question" ? [w.question] : [],
    ),
  ];
  return refs.flatMap((ref) => {
    const question = questionFor(index, ref);
    return question === undefined ? [] : [question];
  });
}

/**
 * Every document any section lists: the documents of `listedQuestions`, and
 * the document of every Blocked row and every stage row (Ready to build,
 * Ready to graduate, Stage conflict), in page order. Over the unfiltered
 * sections, what a visit's second reviews request reads
 * (§6.7), so no filter change, nor a flip to a later
 * page of rows, asks for a third.
 */
export function listedDocuments(
  index: PlanningIndex,
  sections: PlanningSections,
): string[] {
  const paths = new Set(listedQuestions(index, sections).map((q) => q.path));
  for (const entry of sections.waiting) {
    if (entry.kind === "document") paths.add(entry.path);
  }
  for (const path of [
    ...(sections.ready ?? []),
    ...(sections.graduate ?? []),
    ...(sections.disagrees ?? []),
  ]) {
    paths.add(path);
  }
  return [...paths];
}

/**
 * The listed question a comment anchored on file line `line` sits on, for a
 * card that has not been rendered (`planning-index.md` §6.7,
 * *placement*): the innermost of `questions` whose unit, `unitLine` to
 * `unitEndLine`, holds the line, or `undefined` when none does. Exact unless
 * the comment's block has moved since it was filed.
 */
export function placeComment(
  questions: readonly PlanningQuestion[],
  line: number,
): PlanningQuestion | undefined {
  let best: PlanningQuestion | undefined;
  for (const question of questions) {
    if (line < question.unitLine || line > question.unitEndLine) continue;
    if (
      best === undefined ||
      question.unitLine > best.unitLine ||
      (question.unitLine === best.unitLine &&
        question.unitEndLine < best.unitEndLine)
    ) {
      best = question;
    }
  }
  return best;
}
