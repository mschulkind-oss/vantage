/**
 * The planning page's layout (`docs/reference/planning-index.md` §6.2): what
 * *Needs you* and the two folded groups list, from the index alone, the
 * chosen roadmap, the applied filter and the page size. *Needs you* holds the
 * open questions the roadmap routes, in its order; which of them are answered
 * rows and which full cards is the page's to say, from the reviews it holds
 * (`lib/planningLayout.ts`). There are no pages (§7): a section-id parameter
 * in an address, such as `needs-you=3`, is ignored, and the in-place rewrite
 * drops it.
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
  PLANNING_SPACE_PARAM,
  PLANNING_SECTION_IDS,
  PLANNING_SECTION_TITLES,
  answeredQuestions,
  applyPlanningFilter,
  derivePlanningSections,
  encodePlanningQueryValue,
  filterKeepsQuestion,
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

/** A question the page lists, and whether its card is a preview card. */
export interface QuestionEntry {
  kind: "question";
  question: PlanningQuestion;
  /** Its block is past `cardChars`, so its card is a preview card. */
  preview: boolean;
}

/** One entry of Needs you, Not on a roadmap or Blocked. */
export type CardEntry =
  | QuestionEntry
  | { kind: "document"; path: string; waitingOn: readonly DependsOn[] };

/**
 * The kinds *Maintenance* lists, in the order it lists them
 * (`planning-index.md` §6.2): each agent section, the ✅ questions to
 * fold into the ledger (`compact`, a request and not a section of the
 * index), and the files the index could not read.
 */
export const MAINTENANCE_KIND_IDS = [
  "unrouted",
  "ready",
  "graduate",
  "disagrees",
  "compact",
  "skipped",
  "could-not-read",
] as const;
export type MaintenanceKindId = (typeof MAINTENANCE_KIND_IDS)[number];

/** Each kind's sub-heading. */
export const MAINTENANCE_TITLES: Readonly<Record<MaintenanceKindId, string>> = {
  unrouted: PLANNING_SECTION_TITLES.unrouted,
  ready: PLANNING_SECTION_TITLES.ready,
  graduate: PLANNING_SECTION_TITLES.graduate,
  disagrees: PLANNING_SECTION_TITLES.disagrees,
  compact: "To fold into the ledger",
  skipped: PLANNING_SECTION_TITLES.skipped,
  "could-not-read": PLANNING_SECTION_TITLES["could-not-read"],
};

/** One non-empty kind of *Maintenance*, with every item it lists. */
export type MaintenanceKind =
  | {
      id: "unrouted" | "compact";
      kind: "questions";
      items: readonly QuestionEntry[];
    }
  | {
      id: "ready" | "graduate" | "disagrees";
      kind: "documents";
      items: readonly string[];
    }
  | {
      id: "skipped";
      kind: "skipped";
      items: readonly { path: string; size: number }[];
    }
  | {
      id: "could-not-read";
      kind: "unreadable";
      items: readonly { path: string; reason: string }[];
    };

export interface PlanningLayout {
  /**
   * The chosen roadmap its *Needs you* follows, `null` when no roadmap
   * routes. Part of what names a layout.
   */
  roadmap: string | null;
  /**
   * The applied planning filter's canonical text: `""` for none, and for a
   * filter that is not understood, which is not applied and so shows what no
   * filter does (§6.16). Part of what names a layout.
   */
  filter: string;
  /** How many questions that need you are full cards. Part of its name. */
  pageSize: number;
  /** *Needs you*'s open questions, in the roadmap's order; ✅ ones leave it. */
  needsYou: readonly QuestionEntry[];
  /** The line under *Needs you*'s heading. */
  needsYouExplanation: string;
  /** What *Blocked* holds: 🔒 questions and documents that still wait. */
  blocked: readonly CardEntry[];
  /** *Maintenance*'s non-empty kinds, in `MAINTENANCE_KIND_IDS` order. */
  maintenance: readonly MaintenanceKind[];
}

/**
 * The page size this browser remembers, else the default: one of
 * `planningLimits.pageSizes` (`planning-index.md` §6.4). Read at every
 * layout the page makes, never followed live: a size another tab chose
 * applies here at the next one.
 */
export function readPageSize(): number {
  const raw = Number(readPreference(PAGE_SIZE_PREFERENCE));
  return planningLimits.pageSizes.includes(raw)
    ? raw
    : planningLimits.defaultPageSize;
}

/** Remember a page size the reader chose. */
export function rememberPageSize(size: number): void {
  writePreference(PAGE_SIZE_PREFERENCE, String(size));
}

const PAGE_SIZE_PREFERENCE = "vantage:planningPageSize";

/** Whether a question's card is a preview card (§6.6). */
export const isPreview = (question: PlanningQuestion): boolean =>
  question.cardChars > planningLimits.cardChars;

const questionEntry = (question: PlanningQuestion): QuestionEntry => ({
  kind: "question",
  question,
  preview: isPreview(question),
});

function questionsOf(
  index: PlanningIndex,
  refs: readonly QuestionRef[],
): QuestionEntry[] {
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
  const waiting: CardEntry[] = sections.waiting.flatMap(
    (entry): CardEntry[] => {
      if (entry.kind === "document") {
        return [
          { kind: "document", path: entry.path, waitingOn: entry.waitingOn },
        ];
      }
      const question = questionFor(index, entry.question);
      return question === undefined ? [] : [questionEntry(question)];
    },
  );
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
 * The ✅ questions *Maintenance* lists to fold into the ledger
 * (`planning-index.md` §6.2): the ones the `compact` request lists,
 * from the same function (`answeredQuestions`, P7), so the page and
 * `vantage-check index --request compact` name the same questions. They wait
 * only for compaction, so they leave *Needs you*.
 */
export function compactEntries(
  index: PlanningIndex,
  filter: string,
): QuestionEntry[] {
  const parsed = understoodFilter(filter);
  return questionsOf(
    index,
    answeredQuestions(
      index,
      parsed === null ? undefined : (q) => filterKeepsQuestion(parsed, q),
    ),
  );
}

/**
 * Lay the page out (`planning-index.md` §6.2): *Needs you*'s open
 * questions, *Blocked* and *Maintenance*. `sections` are `sectionsOf(index,
 * roadmap, filter)`, and `filter` the canonical text they were filtered by,
 * which the layout names, as it names `pageSize`.
 */
export function layoutPlanningPage(
  index: PlanningIndex,
  sections: PlanningSections,
  pageSize: number,
  filter = "",
): PlanningLayout {
  const entries = new Map(
    sectionEntries(index, sections).map((section) => [section.id, section]),
  );
  const cardsOf = (id: SectionId): CardEntry[] => {
    const section = entries.get(id);
    return section?.kind === "cards" ? section.entries : [];
  };
  const needsYou = cardsOf("needs-you").filter(
    (entry): entry is QuestionEntry =>
      entry.kind === "question" && entry.question.state === "open",
  );
  const maintenance: MaintenanceKind[] = [];
  for (const id of MAINTENANCE_KIND_IDS) {
    if (id === "compact") {
      const items = compactEntries(index, filter);
      if (items.length > 0) maintenance.push({ id, kind: "questions", items });
      continue;
    }
    const section = entries.get(id);
    if (section === undefined) continue;
    if (id === "unrouted" && section.kind === "cards") {
      maintenance.push({
        id,
        kind: "questions",
        items: section.entries.filter(
          (entry): entry is QuestionEntry => entry.kind === "question",
        ),
      });
    } else if (
      (id === "ready" || id === "graduate" || id === "disagrees") &&
      section.kind === "rows"
    ) {
      maintenance.push({ id, kind: "documents", items: section.entries });
    } else if (id === "skipped" && section.kind === "skipped") {
      maintenance.push({ id, kind: "skipped", items: section.entries });
    } else if (id === "could-not-read" && section.kind === "unreadable") {
      maintenance.push({ id, kind: "unreadable", items: section.entries });
    }
  }
  return {
    roadmap: sections.chosenRoadmap,
    filter,
    pageSize,
    needsYou,
    needsYouExplanation: sectionExplanation("needs-you", sections),
    blocked: cardsOf("waiting"),
    maintenance,
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
 * `search` rewritten to name exactly `layout`'s roadmap and filter, with no
 * page parameter (`withoutPages`), or `null` when it already does. The
 * roadmap is named when two or more roadmaps route, so the address always
 * says which one is shown, and removed when fewer do. An applied filter is named by its canonical text as one parameter, an
 * empty one is removed, and one that is not understood is left exactly as
 * written, so it can be fixed (§6.16, §6.14). With `dropSpace`, every
 * `space` parameter goes too: the page has no use for a space id it has
 * already acted on or that a project segment overrides (§13.6).
 */
export function planningSearch(
  search: URLSearchParams,
  layout: PlanningLayout,
  sections: PlanningSections,
  dropSpace = false,
): URLSearchParams | null {
  let next = withoutPages(search);
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
  if (dropSpace && search.has(PLANNING_SPACE_PARAM)) {
    edit().delete(PLANNING_SPACE_PARAM);
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
 * a planning link writes it, or removed when that is empty; every
 * section-id parameter deleted, which names no page any more; and `roadmap`
 * set to the one a pasted link
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
 * `search` with `roadmap` picked: the roadmap replaced, and any old page
 * parameter of *Needs you* gone. Every other parameter stays.
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
 * `search` without any section-id parameter, or `null` when it holds none:
 * the parameters that named a page before the page had none
 * (`planning-index.md` §6.4). An old link's pages are ignored, and the
 * in-place rewrite drops them. Every other parameter, and the order of those
 * it keeps, is left as it is.
 */
export function withoutPages(search: URLSearchParams): URLSearchParams | null {
  if (!SECTION_IDS.some((id) => search.has(id))) return null;
  const next = new URLSearchParams(search);
  for (const id of SECTION_IDS) next.delete(id);
  return next;
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
