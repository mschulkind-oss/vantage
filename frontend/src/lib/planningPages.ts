/**
 * The planning page's pages (`docs/design/planning-index-at-scale.md` §10.2):
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
 * (§10.4). A page always holds at least one entry.
 *
 * The URL carries the pages, `?needs-you=3&waiting=2`, 1-based, with page 1
 * left out. A page past the end is clamped to the last, and a value that is not
 * a page number reads as 1; `pageSearch` says how the URL is to be rewritten.
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
  type PlanningSections,
  type QuestionRef,
} from "vantage-md/planning";
import { planningLimits } from "../planningScan/limits";

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
  /** The non-empty sections, top to bottom. */
  sections: readonly LaidOutSection[];
  /**
   * The shown pages, canonically: `needs-you=2&waiting=3`, sections in order,
   * page 1 left out, `""` when every section is on its first page. Two layouts
   * of one index with the same `pages` show the same entries.
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

/** Whether a question's card is a preview card (§10.4). */
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

/** Every section's entries, in order; an empty section is left out. */
function entriesOf(
  index: PlanningIndex,
  sections: PlanningSections,
): (
  | { id: SectionId; kind: "cards"; entries: CardEntry[] }
  | { id: SectionId; kind: "rows"; entries: string[] }
  | { id: SectionId; kind: "skipped"; entries: PlanningIndex["skipped"] }
  | { id: SectionId; kind: "unreadable"; entries: PlanningIndex["unreadable"] }
)[] {
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
  return all.filter((section) => section.entries.length > 0) as ReturnType<
    typeof entriesOf
  >;
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
  for (const section of entriesOf(index, sections)) {
    const bounds =
      section.kind === "cards"
        ? cardBounds(section.entries)
        : fixedBounds(
            section.entries.length,
            section.kind === "rows"
              ? planningLimits.pageRows
              : planningLimits.pageLines,
          );
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
  return { sections: laid, pages: pages.join("&") };
}

/** The sections of `index`, derived once per index. */
const derived = new WeakMap<PlanningIndex, PlanningSections>();
export function sectionsOf(index: PlanningIndex): PlanningSections {
  let sections = derived.get(index);
  if (sections === undefined) {
    sections = derivePlanningSections(index);
    derived.set(index, sections);
  }
  return sections;
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

/** Every question with a card, on any page, in page order. */
export function listedQuestions(
  index: PlanningIndex,
  sections: PlanningSections,
): PlanningQuestion[] {
  const refs: QuestionRef[] = [
    ...sections.needsYou,
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
 * card that has not been rendered (`planning-index-at-scale.md` §10.5,
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
