/**
 * The planning page's pages (`docs/reference/planning-index.md` §6.4):
 * which run of each section's entries is shown, from the index alone and the
 * page each section's URL parameter asks for.
 *
 * | Sections | A page holds |
 * | :--- | :--- |
 * | Needs you, Unrouted, Waiting | `pageEntries` entries, stopping early before its cards' Markdown passes `pageMarkdownChars` |
 * | Ready, Graduate, Disagrees | `pageRows` document rows |
 * | Skipped, Could not read | `pageLines` lines |
 *
 * A card's Markdown is its question's `cardChars`, so page boundaries are
 * known before anything is fetched. A Waiting document row counts as one entry
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
 * Pure functions of the index and the limits module, so the page, its inputs
 * and the viewer's prefetch lay a page out identically.
 */
import {
  derivePlanningSections,
  questionFor,
  type DependsOn,
  type PlanningIndex,
  type PlanningQuestion,
  type PlanningRoadmap,
  type PlanningSections,
  type QuestionRef,
} from "vantage-md/planning";
import { planningLimits } from "../planningScan/limits";
import {
  planningRoadmapPreferenceKey,
  readPreference,
  writePreference,
} from "./preferences";

/** Each section, by the name its URL parameter and its heading's id carry. */
export const SECTION_IDS = [
  "needs-you",
  "unrouted",
  "waiting",
  "ready",
  "graduate",
  "disagrees",
  "skipped",
  "could-not-read",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_TITLES: Readonly<Record<SectionId, string>> = {
  "needs-you": "Needs you",
  unrouted: "Unrouted",
  waiting: "Waiting",
  ready: "Ready",
  graduate: "Graduate",
  disagrees: "Disagrees",
  skipped: "Skipped",
  "could-not-read": "Could not read",
};

/** One entry of Needs you, Unrouted or Waiting. */
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
  /** The non-empty sections, top to bottom. */
  sections: readonly LaidOutSection[];
  /**
   * The shown pages, canonically: `needs-you=2&waiting=3`, sections in order,
   * page 1 left out, `""` when every section is on its first page. Two layouts
   * of one index with the same `roadmap` and `pages` show the same entries.
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
 * for, clamped to the section's last.
 */
export function layoutPlanningPage(
  index: PlanningIndex,
  sections: PlanningSections,
  request: PageRequest,
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
    sections: laid,
    pages: pages.join("&"),
  };
}

/**
 * The sections of `index` with `roadmap` asked for, derived once per index
 * and chosen roadmap. `derivePlanningSections` falls back from a roadmap that
 * does not route, and `null` asks for the default, so a derivation is kept
 * under the roadmap it chose as well as the one asked for: asking for the
 * default by name or by `null` is one derivation, and one object.
 */
const derived = new WeakMap<
  PlanningIndex,
  Map<string | null, PlanningSections>
>();
export function sectionsOf(
  index: PlanningIndex,
  roadmap: string | null = null,
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

/** The URL parameter that names the chosen roadmap. */
export const ROADMAP_PARAM = "roadmap";

/**
 * The roadmap the URL asks for, repo-relative with one leading `./` dropped,
 * or `null`. `URLSearchParams` has already decoded it, so `docs/plans/x.md`
 * and `docs%2Fplans%2Fx.md` read alike.
 */
export function readRoadmapRequest(search: URLSearchParams): string | null {
  const asked = search.get(ROADMAP_PARAM);
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
 * `search` rewritten to name exactly `layout`'s pages and roadmap, or `null`
 * when it already does. The pages are `pageSearch`'s. The roadmap is named
 * when two or more roadmaps route, so the address always says which one is
 * shown, and removed when fewer do, as a page parameter naming page 1 is.
 */
export function planningSearch(
  search: URLSearchParams,
  layout: PlanningLayout,
  sections: PlanningSections,
): URLSearchParams | null {
  const paged = pageSearch(search, layout);
  const base = paged ?? search;
  const want =
    routingRoadmaps(sections.roadmaps).length >= 2 ? layout.roadmap : null;
  if (
    base.get(ROADMAP_PARAM) === want &&
    base.getAll(ROADMAP_PARAM).length <= 1
  ) {
    return paged;
  }
  const next = new URLSearchParams(base);
  if (want === null) next.delete(ROADMAP_PARAM);
  else next.set(ROADMAP_PARAM, want);
  return next;
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
  next.set(ROADMAP_PARAM, roadmap);
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
