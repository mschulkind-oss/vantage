/**
 * The planning filter (`docs/design/planning-filter.md`): one line of text,
 * such as `path:docs/design/x.md is:open`, deciding which entries of the
 * planning page's sections are shown.
 *
 * The one reader of that text (F1). The page's Filter box and its `filter=`
 * parameter, and `vantage-check index --filter`, all parse it here, apply it
 * here, and print a link to the filtered page with the function here, so a
 * link an agent prints is a filter the human could have typed.
 *
 * What it promises, and what a later release may never change (§10.3):
 *
 * - **All or nothing (F3).** A text holding any term or form this release
 *   gives no meaning is not understood, and is applied not at all. Every such
 *   form stays free for a later release to define, which can then only show
 *   more than this one does, never less.
 * - **Only remove (F2).** A filter takes in sections derived from the whole
 *   index and returns them with entries removed, in the same order. It never
 *   reaches into the index, so Blocked and routing still see what it hides.
 * - **The canonical text (§5.6)** of every filter this release understands,
 *   and what each one keeps, are frozen: `filterForms.json` holds them, and a
 *   test compares it with its copy at the previous release's tag.
 *
 * Plain data only crosses this boundary (`planning/index.ts`): a parsed filter
 * holds no compiled matcher. Its matchers are compiled once per filter object
 * and kept beside it in a `WeakMap`.
 */

import { dependsOnLabel } from "./guide.js";
import type { PlanningIndex } from "./model.js";
import { compileIgnorePatterns } from "./patterns.js";
import type { QuestionState } from "./scan.js";
import {
  isLive,
  questionFor,
  routeQuestions,
  type PlanningSections,
  type QuestionRef,
} from "./sections.js";
import {
  PLANNING_FILTER_LIMITS,
  type PlanningFilterLimits,
} from "./filterLimits.js";

export { PLANNING_FILTER_LIMITS };
export type { PlanningFilterLimits };

/** The planning page's URL parameter that carries a filter (§5.1). */
export const PLANNING_FILTER_PARAM = "filter";
/** The planning page's URL parameter that names the chosen roadmap. */
export const PLANNING_ROADMAP_PARAM = "roadmap";
/** The planning page's route, before any repository segment. */
export const PLANNING_PAGE_PATH = "/.vantage/planning";

/** One term of an understood filter. */
export type PlanningFilterTerm =
  /**
   * `text` is the canonical term (`path:docs/x.md`, `path:"docs/my notes.md"`);
   * `value` is unquoted, unescaped, and has §5.6 rule 2 applied. `quoted` says
   * the canonical term is quoted, so its value is compared as a literal.
   */
  | { key: "path"; text: string; value: string; quoted: boolean }
  | { key: "is"; text: "is:open"; value: "open" };

/** Why a filter is not understood where there is no term to name (§6.7). */
export type PlanningFilterReason =
  "unclosed-quote" | "too-many-terms" | "too-long";

export type PlanningFilter =
  /** `""`, or white space alone: no filter. */
  | { kind: "none" }
  | {
      kind: "understood";
      /** The terms' canonical texts, joined by one space, repeats dropped. */
      canonical: string;
      terms: readonly PlanningFilterTerm[];
    }
  /** `text` as written; exactly one of `term` and `reason` is non-null. */
  | {
      kind: "not-understood";
      text: string;
      /** The first term this release cannot read, as written. */
      term: string | null;
      reason: PlanningFilterReason | null;
    };

export type UnderstoodPlanningFilter = Extract<
  PlanningFilter,
  { kind: "understood" }
>;
export type NotUnderstoodPlanningFilter = Extract<
  PlanningFilter,
  { kind: "not-understood" }
>;

/* ------------------------------------------------------------------ *
 * Reading the text
 * ------------------------------------------------------------------ */

/**
 * White space, as the grammar has it (§5.2): space, tab, CR and LF only.
 * JavaScript's `\s` also matches U+00A0 and U+2000 to U+200A, which here are
 * characters a term holds, and so make it not understood.
 */
const isSpace = (c: string): boolean =>
  c === " " || c === "\t" || c === "\r" || c === "\n";

/** A bare pattern's characters (§5.2 `pchar`). */
const PATTERN_CHAR = /^[A-Za-z0-9._\-/*]$/;

/**
 * The excluded code points (§5.5): controls and invisible format characters,
 * which a quoted value may not hold. A fixed table, never the engine's
 * Unicode data, so a browser and the checker agree on every one.
 */
const EXCLUDED: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];

/**
 * Whether `c`, one code point as string iteration yields it, is half of a
 * surrogate pair standing alone: no path can hold one, and
 * `encodeURIComponent` throws on one.
 */
const isLoneSurrogate = (c: string): boolean =>
  c.length === 1 && c >= "\ud800" && c <= "\udfff";

/**
 * Whether a quoted value may not hold `c`: an excluded code point, or a lone
 * surrogate, which the table does not list and which is not understood for
 * the same reason a control is not.
 */
function isExcluded(c: string): boolean {
  if (isLoneSurrogate(c)) return true;
  const cp = c.codePointAt(0) ?? 0;
  return EXCLUDED.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/** Whether `text` is empty or white space alone, read no further than needed. */
function isBlank(text: string): boolean {
  for (const c of text) if (!isSpace(c)) return false;
  return true;
}

/** One term as split from the text: `closed` is false for an unclosed quote. */
interface RawTerm {
  text: string;
  closed: boolean;
}

/**
 * The text's first `limit` code points split at white space outside double
 * quotes (§5.2), and whether the text went on past them (`cut`). Inside
 * quotes a `\` takes the character after it with it, so `\"` does not close
 * them, and an unclosed quote runs to the end of the text.
 *
 * Nothing past the limit is read but the one code point after it, which says
 * whether the term the limit falls in ends there. A term the limit cuts off is
 * left out, since what it would have been cannot be known without reading on.
 */
function splitTerms(
  text: string,
  limit: number,
): { terms: RawTerm[]; cut: boolean } {
  const terms: RawTerm[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  // Code points as string iteration yields them: a surrogate pair is one, and
  // so is a lone surrogate.
  let read = 0;
  for (const c of text) {
    if (read === limit) {
      if (current !== "" && !quoted && isSpace(c)) {
        terms.push({ text: current, closed: true });
      }
      return { terms, cut: true };
    }
    read++;
    if (quoted) {
      current += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (isSpace(c)) {
      if (current !== "") terms.push({ text: current, closed: true });
      current = "";
      continue;
    }
    current += c;
    if (c === '"') quoted = true;
  }
  if (current !== "") terms.push({ text: current, closed: !quoted });
  return { terms, cut: false };
}

/**
 * The rules both forms of a path value share (§5.5), over a value with one
 * leading `./` already made `/`: no two `/` in a row, and no `.` or `..`
 * segment.
 */
function segmentsUnderstood(value: string): boolean {
  if (value.includes("//")) return false;
  return value.split("/").every((s) => s !== "." && s !== "..");
}

/** §5.6 rule 2's first half: one leading `./` becomes `/`. */
const rootedDot = (value: string): string =>
  value.startsWith("./") ? `/${value.slice(2)}` : value;

/**
 * §5.6 rule 2's second half: a leading `/` is dropped when what remains still
 * has a `/` before its last character, since it then anchors without it.
 */
function canonicalValue(value: string): string {
  if (!value.startsWith("/")) return value;
  const rest = value.slice(1);
  return rest.slice(0, -1).includes("/") ? rest : value;
}

/**
 * Whether a bare pattern, rule 2's first half applied, is one this release
 * reads (§5.5): pattern characters only, the shared segment rules, a
 * character other than `/` and `*`, and every `**` a whole segment that is
 * neither last, nor before a trailing `/`, nor beside another.
 */
function bareUnderstood(value: string): boolean {
  if (![...value].every((c) => PATTERN_CHAR.test(c))) return false;
  if (!segmentsUnderstood(value)) return false;
  if (!/[^/*]/.test(value)) return false;
  const segments = value.split("/");
  for (const [i, segment] of segments.entries()) {
    if (segment.includes("**") && segment !== "**") return false;
    if (segment === "**" && segments[i + 1] === "**") return false;
  }
  return !value.endsWith("/**") && !value.endsWith("**/");
}

/**
 * A quoted value's text, unescaped, or `null` when it is not one this
 * release reads: it must close on its last character, hold at least one
 * character, and escape only `"` and `\`.
 */
function unquote(value: string): string | null {
  const chars = [...value];
  if (chars[0] !== '"' || chars.length < 2) return null;
  let out = "";
  for (let i = 1; i < chars.length; i++) {
    const c = chars[i];
    if (c === "\\") {
      const next = chars[i + 1];
      if (next !== '"' && next !== "\\") return null;
      out += next;
      i++;
    } else if (c === '"') {
      return i === chars.length - 1 && out !== "" ? out : null;
    } else {
      out += c;
    }
  }
  return null;
}

/** `"` and `\` escaped, and nothing else (§5.6 rule 4). */
const escapeQuoted = (value: string): string =>
  value.replace(/[\\"]/g, (c) => `\\${c}`);

/** One `path:` value read, or `null` when it is not understood. */
function readPathValue(
  raw: string,
): Extract<PlanningFilterTerm, { key: "path" }> | null {
  if (raw === "") return null;
  if (raw.startsWith('"')) {
    const literal = unquote(raw);
    if (literal === null || [...literal].some(isExcluded)) return null;
    const rooted = rootedDot(literal);
    if (rooted === "/" || !segmentsUnderstood(rooted)) return null;
    const value = canonicalValue(rooted);
    // Rule 3: written bare where every character is a pattern character
    // other than `*`, and the bare form is understood.
    const bare =
      [...value].every((c) => c !== "*" && PATTERN_CHAR.test(c)) &&
      bareUnderstood(value);
    return bare
      ? { key: "path", text: `path:${value}`, value, quoted: false }
      : {
          key: "path",
          text: `path:"${escapeQuoted(value)}"`,
          value,
          quoted: true,
        };
  }
  const rooted = rootedDot(raw);
  if (!bareUnderstood(rooted)) return null;
  const value = canonicalValue(rooted);
  return { key: "path", text: `path:${value}`, value, quoted: false };
}

/** One term read, or `null` when it is not understood (§5.5). */
function readTerm(raw: string): PlanningFilterTerm | null {
  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  const key = raw.slice(0, colon);
  const value = raw.slice(colon + 1);
  switch (key) {
    case "path":
      return readPathValue(value);
    case "is":
      // `open` is the only value this release reads (OQ-PF1), and only bare.
      return value === "open"
        ? { key: "is", text: "is:open", value: "open" }
        : null;
    default:
      return null;
  }
}

/**
 * Read one filter text: the box's, or every `filter=` or `--filter` value
 * joined with one space (§5.1). `limits` is for tests, which configure the
 * limits down rather than build long inputs.
 *
 * A not-understood filter names the first term this release cannot read
 * (§10.2), and gives a reason only where there is no term to name (§6.7):
 * past the code-point limit, then past the term limit (repeats counted), then
 * an unclosed quote. So no more than `limits.codePoints` code points are ever
 * split, and only the terms that end within them can be named.
 */
export function parsePlanningFilter(
  text: string,
  limits: PlanningFilterLimits = PLANNING_FILTER_LIMITS,
): PlanningFilter {
  if (isBlank(text)) return { kind: "none" };
  const notUnderstood = (
    term: string | null,
    reason: PlanningFilterReason | null,
  ): PlanningFilter => ({ kind: "not-understood", text, term, reason });
  const { terms: raw, cut } = splitTerms(text, limits.codePoints);
  const terms: PlanningFilterTerm[] = [];
  const seen = new Set<string>();
  let unclosed = false;
  for (const { text: written, closed } of raw) {
    // An unclosed quote runs to the end, so it is the last term.
    if (!closed) {
      unclosed = true;
      break;
    }
    const term = readTerm(written);
    if (term === null) return notUnderstood(written, null);
    if (seen.has(term.text)) continue;
    seen.add(term.text);
    terms.push(term);
  }
  if (cut) return notUnderstood(null, "too-long");
  if (raw.length > limits.terms) return notUnderstood(null, "too-many-terms");
  if (unclosed) return notUnderstood(null, "unclosed-quote");
  return {
    kind: "understood",
    canonical: terms.map((term) => term.text).join(" "),
    terms,
  };
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/**
 * Whether a value anchors to the root: a `/` before its last character, as
 * in git. A `/` only at the end does not.
 */
const anchored = (value: string): boolean => value.slice(0, -1).includes("/");

/**
 * A bare pattern's matcher: the port of the server's gitignore matcher, given
 * an anchored pattern with a leading `/`, and an unanchored one as written
 * (§5.4). With the `/`, the port anchors exactly as git does.
 */
function bareMatcher(value: string): (path: string) => boolean {
  const pattern =
    anchored(value) && !value.startsWith("/") ? `/${value}` : value;
  return compileIgnorePatterns([pattern]);
}

/**
 * A quoted value's matcher: a literal, compared code point for code point
 * under the bare form's anchoring and folder rules (§5.4). Anchored, it keeps
 * the path equal to it and every path under it; unanchored, every path one of
 * whose segments equals it; and a trailing `/` keeps only paths under it.
 */
function literalMatcher(value: string): (path: string) => boolean {
  const under = value.endsWith("/");
  const name = value.replace(/^\//, "").replace(/\/$/, "");
  if (anchored(value)) {
    return under
      ? (path) => path.startsWith(`${name}/`)
      : (path) => path === name || path.startsWith(`${name}/`);
  }
  return under
    ? (path) => path.split("/").slice(0, -1).includes(name)
    : (path) => path.split("/").includes(name);
}

/** A filter's terms, compiled. */
interface Compiled {
  /** One matcher per `path:` term, in order; empty when there are none. */
  paths: { text: string; matches: (path: string) => boolean }[];
  /** The states its `is:` terms keep; `null` when it has none. */
  states: ReadonlySet<QuestionState> | null;
  /** Whether a path is a kept document: one `path:` term matches it, or there are none. */
  keepsPath: (path: string) => boolean;
}

const compiledFilters = new WeakMap<UnderstoodPlanningFilter, Compiled>();

/** `filter`'s matchers, compiled once per filter object. */
function compiled(filter: UnderstoodPlanningFilter): Compiled {
  const known = compiledFilters.get(filter);
  if (known !== undefined) return known;
  const paths: Compiled["paths"] = [];
  let states: Set<QuestionState> | null = null;
  for (const term of filter.terms) {
    if (term.key === "path") {
      paths.push({
        text: term.text,
        matches: term.quoted
          ? literalMatcher(term.value)
          : bareMatcher(term.value),
      });
    } else {
      states ??= new Set();
      states.add(term.value);
    }
  }
  const keepsPath = (path: string) =>
    paths.length === 0 || paths.some((p) => p.matches(path));
  const made: Compiled = { paths, states, keepsPath };
  compiledFilters.set(filter, made);
  return made;
}

/**
 * Whether `filter` keeps a question: its path is a kept document, and an
 * `is:` term, if the filter has any, matches its state (§5.3). Same key OR,
 * different keys AND.
 */
export function filterKeepsQuestion(
  filter: UnderstoodPlanningFilter,
  question: { path: string; state: QuestionState },
): boolean {
  const c = compiled(filter);
  return (
    c.keepsPath(question.path) &&
    (c.states === null || c.states.has(question.state))
  );
}

/* ------------------------------------------------------------------ *
 * Applying it to the sections
 * ------------------------------------------------------------------ */

/**
 * What a filter does to one set of sections, in numbers and names: what the
 * filter notice (§6.7), the request's `Filter:` line (§6.6) and the
 * checker's JSON `filter` key (§8.3) say.
 */
export interface PlanningFilterSummary {
  canonical: string;
  /**
   * `canonical` less its unmatched terms (§6.6): the text the request's
   * `Filter:` line carries, which `--filter` accepts and which keeps the same
   * entries. `null` when every `path:` term is unmatched, since dropping them
   * all would keep more, and nothing is kept.
   */
  requestText: string | null;
  /** Entries the filtered sections list, of those the unfiltered ones do. */
  entries: { shown: number; of: number };
  /** Kept documents, of every path the index lists. */
  documents: { kept: number; of: number };
  /** How many shown entries are open questions. */
  openQuestions: number;
  /** 🔒 questions in kept documents that an `is:` term leaves out. */
  blockedLeftOut: number;
  /**
   * Kept questions that need you and that other roadmaps route and the chosen
   * one does not, each once: the filtered `onOtherRoadmaps`, and the total the
   * notice's Other roadmaps clause gives.
   */
  onOtherRoadmaps: number;
  /**
   * Each roadmap other than the chosen one that routes any of those
   * questions, in roadmap order, with how many of them it routes. A question
   * two roadmaps route is counted under both, so the counts can sum to more
   * than `onOtherRoadmaps`.
   */
  otherRoadmaps: { path: string; count: number }[];
  /**
   * Each target a kept document's Blocked row, in the unfiltered sections,
   * names that is not a kept document: `target` as `dependsOnLabel` writes it,
   * fragment included. In order of the Blocked rows, then their entries.
   */
  waitsOutside: { path: string; target: string }[];
  /** The canonical texts of the `path:` terms that match no path the index lists, in order. */
  unmatched: string[];
}

export interface FilteredPlanningSections {
  sections: PlanningSections;
  summary: PlanningFilterSummary;
}

/** One question's identity: its line is unique within its document. */
const questionKey = (ref: QuestionRef): string => `${ref.path}\n${ref.line}`;

/** How many entries a set of sections lists: the section bar's sum. */
function entryCount(sections: PlanningSections): number {
  return (
    sections.needsYou.length +
    (sections.unrouted?.length ?? 0) +
    sections.waiting.length +
    (sections.ready?.length ?? 0) +
    (sections.graduate?.length ?? 0) +
    (sections.disagrees?.length ?? 0) +
    sections.skipped.length +
    sections.unreadable.length
  );
}

/**
 * `sections` with what `filter` does not keep removed (§6.1, §6.2), and what
 * that hides, summed up.
 *
 * `sections` is `derivePlanningSections` over the whole of `index` (F2), under
 * whichever roadmap is chosen. The result has its shape and its order, and the
 * chosen roadmap, the roadmaps' states and `stagesDeclared` are its own. A
 * question entry is kept by `filterKeepsQuestion`; a document's row (a Blocked
 * document, a stage row, a Too large or an Unreadable path) when a `path:`
 * term matches its own path and the filter has no `is:` term, since a row has
 * no question state to match (§5.3). Each roadmap's `needsYouCount` and
 * `nothingNeedsYou` are counted again over kept questions only.
 */
export function applyPlanningFilter(
  index: PlanningIndex,
  sections: PlanningSections,
  filter: UnderstoodPlanningFilter,
): FilteredPlanningSections {
  const c = compiled(filter);
  const keepsRef = (ref: QuestionRef): boolean => {
    if (!c.keepsPath(ref.path)) return false;
    if (c.states === null) return true;
    const state = questionFor(index, ref)?.state;
    return state !== undefined && c.states.has(state);
  };
  const keepsRow = (path: string): boolean =>
    c.states === null && c.keepsPath(path);
  const rows = (paths: string[] | null): string[] | null =>
    paths === null ? null : paths.filter(keepsRow);

  const needsYou = sections.needsYou.filter(keepsRef);
  const onOtherRoadmaps = sections.onOtherRoadmaps.filter(keepsRef);
  const unrouted =
    sections.unrouted === null ? null : sections.unrouted.filter(keepsRef);
  /** Each routing roadmap's kept questions that need you, in its order. */
  const keptRoutes = new Map(
    sections.roadmaps
      .filter((roadmap) => roadmap.state === "routes")
      .map(({ path }) => [
        path,
        routeQuestions(index, path).filter((ref) => {
          const state = questionFor(index, ref)?.state;
          return (
            (state === "open" || state === "answered") &&
            filterKeepsQuestion(filter, { path: ref.path, state })
          );
        }),
      ]),
  );
  const filtered: PlanningSections = {
    roadmaps: sections.roadmaps.map((roadmap) => {
      const kept = keptRoutes.get(roadmap.path);
      return kept === undefined
        ? roadmap
        : { ...roadmap, needsYouCount: kept.length };
    }),
    chosenRoadmap: sections.chosenRoadmap,
    stagesDeclared: sections.stagesDeclared,
    nothingNeedsYou: !index.documents.some(
      (doc) =>
        isLive(index, doc) &&
        doc.questions.some(
          (q) => q.state === "open" && filterKeepsQuestion(filter, q),
        ),
    ),
    needsYou,
    onOtherRoadmaps,
    unrouted,
    waiting: sections.waiting.filter((entry) =>
      entry.kind === "document"
        ? keepsRow(entry.path)
        : keepsRef(entry.question),
    ),
    ready: rows(sections.ready),
    graduate: rows(sections.graduate),
    disagrees: rows(sections.disagrees),
    skipped: sections.skipped.filter((entry) => keepsRow(entry.path)),
    unreadable: sections.unreadable.filter((entry) => keepsRow(entry.path)),
  };

  const listed = [
    ...index.documents,
    ...index.skipped,
    ...index.unreadable,
  ].map((entry) => entry.path);
  const unmatched = c.paths
    .filter((term) => !listed.some((path) => term.matches(path)))
    .map((term) => term.text);
  const kept = filter.terms.filter((term) => !unmatched.includes(term.text));
  const requestText =
    unmatched.length === 0
      ? filter.canonical
      : kept.some((term) => term.key === "path")
        ? kept.map((term) => term.text).join(" ")
        : null;

  const isOpenRef = (ref: QuestionRef) =>
    questionFor(index, ref)?.state === "open";
  // Every roadmap but the chosen one that routes a kept question the chosen
  // one does not list, with how many it routes (§6.2). A question two of them
  // route counts once in `onOtherRoadmaps` and once under each roadmap here.
  const elsewhere = new Set(onOtherRoadmaps.map(questionKey));
  const otherRoadmaps = sections.roadmaps.flatMap(({ path }) => {
    if (path === sections.chosenRoadmap) return [];
    const count = (keptRoutes.get(path) ?? []).filter((ref) =>
      elsewhere.has(questionKey(ref)),
    ).length;
    return count === 0 ? [] : [{ path, count }];
  });
  const waitsOutside: PlanningFilterSummary["waitsOutside"] = [];
  let blockedLeftOut = 0;
  for (const entry of sections.waiting) {
    if (entry.kind === "question") {
      if (c.keepsPath(entry.question.path) && !keepsRef(entry.question)) {
        blockedLeftOut++;
      }
      continue;
    }
    if (!c.keepsPath(entry.path)) continue;
    for (const on of entry.waitingOn) {
      // `waits` keeps only entries naming a live document of the index.
      if (on.target !== null && !c.keepsPath(on.target)) {
        waitsOutside.push({ path: entry.path, target: dependsOnLabel(on) });
      }
    }
  }

  return {
    sections: filtered,
    summary: {
      canonical: filter.canonical,
      requestText,
      entries: { shown: entryCount(filtered), of: entryCount(sections) },
      documents: {
        kept: listed.filter((path) => c.keepsPath(path)).length,
        of: listed.length,
      },
      openQuestions: [...needsYou, ...(unrouted ?? [])].filter(isOpenRef)
        .length,
      blockedLeftOut,
      onOtherRoadmaps: onOtherRoadmaps.length,
      otherRoadmaps,
      waitsOutside,
      unmatched,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Links
 * ------------------------------------------------------------------ */

/** The characters a planning link writes bare (§9.2). */
const BARE_IN_QUERY = /^[A-Za-z0-9\-._~:/]$/;

/**
 * A value as a planning link writes it (§9.2): everything but `A–Z a–z 0–9
 * - . _ ~ : /` percent-encoded as UTF-8, and a space as `+`. So `*` is `%2A`,
 * which Markdown and chat clients cannot read as emphasis; `#`, `&`, `+` and
 * `"` cannot cut the value short; and `:` and `/` stay readable.
 * `URLSearchParams` reads it back to exactly `value`.
 */
export function encodePlanningQueryValue(value: string): string {
  let out = "";
  for (const c of value) {
    if (c === " ") out += "+";
    else if (BARE_IN_QUERY.test(c)) out += c;
    else if (isLoneSurrogate(c)) {
      // A lone surrogate, which `encodeURIComponent` throws on: U+FFFD, as
      // `URLSearchParams` writes it.
      out += "%EF%BF%BD";
    } else {
      const encoded = encodeURIComponent(c);
      // `encodeURIComponent` leaves `! ' ( ) *` bare.
      out +=
        encoded === c
          ? `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
          : encoded;
    }
  }
  return out;
}

/**
 * A link to the planning page filtered by `canonical`: `path`, by default the
 * root-relative `/.vantage/planning`, then `?filter=<canonical>`, then
 * `&roadmap=<roadmap>` when one is given, each written by
 * `encodePlanningQueryValue`. An empty `canonical` is no filter, and gets no
 * parameter (§5.1).
 */
export function planningLink(
  canonical: string,
  options: { roadmap?: string | null; path?: string } = {},
): string {
  const params: string[] = [];
  if (canonical !== "") {
    params.push(
      `${PLANNING_FILTER_PARAM}=${encodePlanningQueryValue(canonical)}`,
    );
  }
  if (options.roadmap !== undefined && options.roadmap !== null) {
    params.push(
      `${PLANNING_ROADMAP_PARAM}=${encodePlanningQueryValue(options.roadmap)}`,
    );
  }
  const base = options.path ?? PLANNING_PAGE_PATH;
  return params.length === 0 ? base : `${base}?${params.join("&")}`;
}

/**
 * The filter that keeps one document, `path:/<path>`, in canonical text
 * (§5.6): `path:plans/design.md`, `path:/roadmap.md`, or quoted where the path
 * holds a character a bare pattern may not, such as a space or a `*`. `null`
 * when even quoted it is not understood, as for a path holding a control
 * character.
 */
export function documentFilter(path: string): string | null {
  const parsed = parsePlanningFilter(`path:"/${escapeQuoted(path)}"`);
  return parsed.kind === "understood" ? parsed.canonical : null;
}

/** Where a planning link's path starts in a pasted run of text. */
const PAGE_PATH_AT = new RegExp(
  `${PLANNING_PAGE_PATH.replace(/\./g, "\\.")}(?=[/?#]|$)`,
);

/**
 * The first planning link in pasted text (§7), or `null` when it holds none:
 * the first run of characters up to white space that holds
 * `/.vantage/planning`, whatever comes before it in the run (a scheme, a
 * host, a port), with its query after. Its `filter` values joined with one
 * space, `""` when it has none, decoded as the page decodes its own URL; and
 * its `roadmap`, or `null`. Its repository segment, its page parameters and
 * its fragment are ignored.
 *
 * The run ends at the grammar's white space only, so a link wrapped in
 * backticks or followed by a period keeps them, and its filter then reads as
 * written. What counts as a pasted link may only widen (§10.3).
 */
export function readPastedPlanningLink(
  text: string,
): { filter: string; roadmap: string | null } | null {
  let run = "";
  const runs: string[] = [];
  for (const c of text) {
    if (isSpace(c)) {
      if (run !== "") runs.push(run);
      run = "";
    } else {
      run += c;
    }
  }
  if (run !== "") runs.push(run);
  for (const candidate of runs) {
    const at = PAGE_PATH_AT.exec(candidate);
    if (at === null) continue;
    let url: URL;
    try {
      url = new URL(candidate.slice(at.index), "http://vantage.invalid");
    } catch {
      continue;
    }
    const { searchParams } = url;
    const roadmap = searchParams.get(PLANNING_ROADMAP_PARAM);
    return {
      filter: searchParams.getAll(PLANNING_FILTER_PARAM).join(" "),
      roadmap: roadmap === null || roadmap === "" ? null : roadmap,
    };
  }
  return null;
}
