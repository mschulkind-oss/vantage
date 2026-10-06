/**
 * The planning filter (`docs/reference/planning-index.md` §6.11): one line
 * of text, such as `generator path:docs/design is:open`, deciding which
 * entries of the planning page's sections are shown.
 *
 * The one reader of that text (F1). The page's Filter box and its `filter=`
 * parameter, and `vantage-check index --filter`, all parse it here, apply it
 * here, and print a link to the filtered page with the function here, so a
 * link an agent prints is a filter the human could have typed.
 *
 * The language is a search box's (§6.12): words and `"quoted phrases"` search
 * what the index holds about each entry, as case-insensitive substrings;
 * `path:` narrows to the paths that hold its text, as GitHub's code search
 * reads it, and `is:open` to open questions; a leading `-` excludes. What it
 * promises:
 *
 * - **Malformed text applies nothing (F3).** A text holding a term this
 *   module cannot read (§6.14) is not understood, and is applied not at all,
 *   since dropping the term could hide entries the reader asked for.
 * - **Only remove (F2).** A filter takes in sections derived from the whole
 *   index and returns them with entries removed, in the same order. It never
 *   reaches into the index, so Blocked and routing still see what it hides.
 * - **One meaning within a release (P7).** The page and the checker both read
 *   it here, and both suites hold it to `filterForms.json`. Nothing freezes
 *   it across releases (§6.19, OQ-PF7): a later release may read a text
 *   differently.
 *
 * Plain data only crosses this boundary (`planning/index.ts`): a parsed filter
 * holds no compiled matcher. Its matchers are compiled once per filter object,
 * and the searched fields are lowercased once per question, document and
 * entry object the index holds, each kept beside its object in a `WeakMap`.
 */

import { dependsOnLabel } from "./guide.js";
import { findDocument, type PlanningIndex } from "./model.js";
import type {
  PlanningDocument,
  PlanningQuestion,
  QuestionState,
} from "./scan.js";
import {
  isLive,
  questionFor,
  routeQuestions,
  type PlanningSections,
  type QuestionRef,
  type WaitingEntry,
} from "./sections.js";
import {
  PLANNING_FILTER_LIMITS,
  type PlanningFilterLimits,
} from "./filterLimits.js";

export { PLANNING_FILTER_LIMITS };
export type { PlanningFilterLimits };

/** The planning page's URL parameter that carries a filter (§6.11). */
export const PLANNING_FILTER_PARAM = "filter";
/** The planning page's URL parameter that names the chosen roadmap. */
export const PLANNING_ROADMAP_PARAM = "roadmap";
/** The planning page's route, before any repository segment. */
export const PLANNING_PAGE_PATH = "/.vantage/planning";

/**
 * The keys a qualifier may have (§6.12): a term is a qualifier exactly when
 * the part before its first `:` is one of them.
 */
export const PLANNING_FILTER_KEYS: readonly string[] = Object.freeze([
  "path",
  "is",
]);

/**
 * One term of an understood filter. In each, `text` is the canonical term,
 * its leading `-` included, and `exclude` says it has one: an exclusion drops
 * every entry the same term without the `-` would keep (§6.12).
 */
export type PlanningFilterTerm =
  /**
   * `value` is unquoted, unescaped, and has §6.14 rule 2 applied, in its own
   * case. `quoted` says the canonical term is quoted, so a `*` in its value
   * is a `*` and no wildcard.
   */
  | {
      key: "path";
      text: string;
      value: string;
      quoted: boolean;
      exclude: boolean;
    }
  | {
      key: "is";
      text: "is:open" | "-is:open";
      value: "open";
      exclude: boolean;
    }
  /**
   * A word or a quoted phrase (§6.12). `value` is what it searches for,
   * unquoted and unescaped, in its own case; `quoted` says the canonical term
   * is quoted. `unknownKey` is the word before its first `:` when that word
   * draws the notice's *Not a key* line, as `stage` in `stage:ready`, and
   * `null` otherwise.
   */
  | {
      key: "text";
      text: string;
      value: string;
      quoted: boolean;
      exclude: boolean;
      unknownKey: string | null;
    };

/** Why a filter is not understood where there is no term to name (§6.18). */
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
      /**
       * Each text term's `unknownKey`, once, in the order written: the words
       * the notice says are not filter keys.
       */
      unknownKeys: readonly string[];
    }
  /** `text` as written; exactly one of `term` and `reason` is non-null. */
  | {
      kind: "not-understood";
      text: string;
      /** The first term it cannot read, as written. */
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
 * White space, as the grammar has it (§6.12): space, tab, CR and LF only.
 * JavaScript's `\s` also matches U+00A0 and U+2000 to U+200A, which here are
 * characters a term holds, a word and a bare `path:` value alike.
 */
const isSpace = (c: string): boolean =>
  c === " " || c === "\t" || c === "\r" || c === "\n";

/**
 * The excluded code points (§6.14): controls and invisible format characters,
 * which no term may hold. A fixed table, never the engine's Unicode data, so
 * a browser and the checker agree on every one.
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
 * Whether no term may hold `c`: an excluded code point, or a lone surrogate,
 * which the table does not list and which is not understood for the same
 * reason a control is not.
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
 * quotes (§6.12), and whether the text went on past them (`cut`). A `"` opens
 * a quote anywhere in a term. Inside quotes a `\` takes the character after
 * it with it, so `\"` does not close them, and an unclosed quote runs to the
 * end of the text.
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

/** §6.14 rule 2: one leading `./` becomes `/`, which means the same. */
const rootedDot = (value: string): string =>
  value.startsWith("./") ? `/${value.slice(2)}` : value;

/**
 * A quoted value's text, unescaped, or `null` when it is not one the
 * language reads: it must close on its last character, hold at least one
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

/** `"` and `\` escaped, and nothing else (§6.14 rule 6). */
const escapeQuoted = (value: string): string =>
  value.replace(/[\\"]/g, (c) => `\\${c}`);

type PathTerm = Extract<PlanningFilterTerm, { key: "path" }>;
type TextTerm = Extract<PlanningFilterTerm, { key: "text" }>;

/**
 * Whether a `path:` value reads the same written bare as quoted (§6.14 rule
 * 3): it holds no white space, no `"`, and no `*`, which bare is a wildcard.
 */
const pathReadsBare = (value: string): boolean =>
  ![...value].some((c) => isSpace(c) || c === '"' || c === "*");

/**
 * One `path:` value read, without its `-`, or `null` when it is not
 * understood (§6.14): an empty value, or a quote that does not wrap the whole
 * of it. Any other character it may hold, bare or quoted, is its own.
 */
function readPathValue(raw: string): Omit<PathTerm, "exclude"> | null {
  if (raw === "") return null;
  if (raw.startsWith('"')) {
    const literal = unquote(raw);
    if (literal === null) return null;
    const value = rootedDot(literal);
    return pathReadsBare(value)
      ? { key: "path", text: `path:${value}`, value, quoted: false }
      : {
          key: "path",
          text: `path:"${escapeQuoted(value)}"`,
          value,
          quoted: true,
        };
  }
  // A quote may only wrap a whole value (§6.14): `path:docs/"a".md`.
  if (raw.includes('"')) return null;
  const value = rootedDot(raw);
  return { key: "path", text: `path:${value}`, value, quoted: false };
}

/**
 * The word before a bare text term's first `:`, when it draws the notice's
 * *Not a key* line (§6.12): one or more ASCII lowercase letters, not a key,
 * and no `/` straight after the `:`. So `stage:ready` and `title:` draw one,
 * and `http://x`, `Note:` and `Path:x` do not.
 */
function unknownKeyOf(word: string): string | null {
  const key = /^([a-z]+):(?!\/)/.exec(word)?.[1];
  return key === undefined || PLANNING_FILTER_KEYS.includes(key) ? null : key;
}

/**
 * Whether a quoted phrase, written bare, reads as the same text term and
 * draws no hint (§6.14 rule 4): it holds no white space, no `"` and no `:`,
 * and does not start with `-`.
 */
const readsBare = (phrase: string): boolean =>
  !phrase.startsWith("-") &&
  ![...phrase].some((c) => isSpace(c) || c === '"' || c === ":");

/** One text term read, without its `-`, or `null` when it is not understood. */
function readText(raw: string): Omit<TextTerm, "exclude"> | null {
  if (raw.startsWith('"')) {
    const phrase = unquote(raw);
    if (phrase === null) return null;
    const quoted = !readsBare(phrase);
    return {
      key: "text",
      text: quoted ? `"${escapeQuoted(phrase)}"` : phrase,
      value: phrase,
      quoted,
      unknownKey: null,
    };
  }
  // A quote may only wrap a whole value (§6.14): `a"b"`, `stage:"ready"`.
  if (raw.includes('"')) return null;
  return {
    key: "text",
    text: raw,
    value: raw,
    quoted: false,
    unknownKey: unknownKeyOf(raw),
  };
}

/** One term read, or `null` when it is not understood (§6.12, §6.14). */
function readTerm(raw: string): PlanningFilterTerm | null {
  if ([...raw].some(isExcluded)) return null;
  // One leading `-` is the exclusion's, and what follows is read as a term on
  // its own, so `--x` excludes the text `-x`; a lone `-` excludes nothing.
  const exclude = raw.startsWith("-");
  const body = exclude ? raw.slice(1) : raw;
  if (body === "") return null;
  const dash = exclude ? "-" : "";
  const colon = body.indexOf(":");
  // The colon rule: a qualifier exactly when the part before the first `:`
  // is a key, and then it must read as one.
  switch (colon === -1 ? null : body.slice(0, colon)) {
    case "path": {
      const path = readPathValue(body.slice(colon + 1));
      return path === null
        ? null
        : { ...path, text: `${dash}${path.text}`, exclude };
    }
    case "is":
      // `open` is the only value the language reads (OQ-PF1), and only bare.
      return body.slice(colon + 1) === "open"
        ? {
            key: "is",
            text: exclude ? "-is:open" : "is:open",
            value: "open",
            exclude,
          }
        : null;
    default: {
      const text = readText(body);
      return text === null
        ? null
        : { ...text, text: `${dash}${text.text}`, exclude };
    }
  }
}

/**
 * Read one filter text: the box's, or every `filter=` or `--filter` value
 * joined with one space (§6.11). `limits` is for tests, which configure the
 * limits down rather than build long inputs.
 *
 * A not-understood filter names the first term it cannot read (§6.14), and
 * gives a reason only where there is no term to name (§6.18): past the
 * code-point limit, then past the term limit (repeats counted), then an
 * unclosed quote. So no more than `limits.codePoints` code points are ever
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
  const unknownKeys: string[] = [];
  for (const term of terms) {
    if (term.key !== "text" || term.unknownKey === null) continue;
    if (!unknownKeys.includes(term.unknownKey)) {
      unknownKeys.push(term.unknownKey);
    }
  }
  return {
    kind: "understood",
    canonical: terms.map((term) => term.text).join(" "),
    terms,
    unknownKeys,
  };
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/**
 * A bare `path:` value's steps (§6.13), one per UTF-16 code unit of its text,
 * which `globMatcher` walks: a code unit is itself, and the rest stand for
 * runs of the path's.
 */
const NAME = -1; // `*`: any run of code units holding no `/`.
const ANY = -2; // `**` elsewhere: any run at all.
// A `**` that is a whole folder name, with the `/` after it: zero or more
// folders, each with its `/`. Written as three steps, this one, then `ANY`
// and a `/`, which it may skip together for none.
const FOLDERS = -3;
const SLASH = 0x2f;

/**
 * `text`'s steps, and whether they must match from the path's start: a
 * value's first `**` that is a whole folder name stands for the folders
 * that lead the path, as a leading `/` would pin it.
 */
function globSteps(text: string): { steps: number[]; leads: boolean } {
  const steps: number[] = [];
  let leads = false;
  for (let i = 0; i < text.length;) {
    if (text.charCodeAt(i) !== 0x2a) {
      steps.push(text.charCodeAt(i));
      i++;
      continue;
    }
    let end = i;
    while (text.charCodeAt(end) === 0x2a) end++;
    const startsName = i === 0 || text.charCodeAt(i - 1) === SLASH;
    if (end - i >= 2 && startsName && text.charCodeAt(end) === SLASH) {
      steps.push(FOLDERS, ANY, SLASH);
      if (i === 0) leads = true;
      i = end + 1;
    } else {
      steps.push(end - i === 1 ? NAME : ANY);
      i = end;
    }
  }
  return { steps, leads };
}

/**
 * Whether `steps` match a run of a path's code units, from its start when
 * `pinned`, and anywhere otherwise: a value need not reach the path's end.
 *
 * Every place the steps could have reached is tracked at once, one code unit
 * of the path at a time, so it takes time in proportion to the path's length
 * times the steps' count, whatever they hold. A regular expression backtracks
 * instead, and `**a**a…b` against a path of repeated `a`s took seconds.
 */
function globMatcher(
  steps: readonly number[],
  pinned: boolean,
): (lowered: string) => boolean {
  const end = steps.length;
  return (path) => {
    let at = new Uint8Array(end + 1);
    let next = new Uint8Array(end + 1);
    let live: number[] = [];
    let after: number[] = [];
    const pending: number[] = [];
    // `step` and every step reachable from it without reading a code unit,
    // into `set`: true once the steps' end is among them, which is a match.
    const reach = (step: number, set: Uint8Array, into: number[]): boolean => {
      pending.push(step);
      while (pending.length > 0) {
        const s = pending.pop()!;
        if (set[s] === 1) continue;
        set[s] = 1;
        if (s === end) {
          pending.length = 0;
          return true;
        }
        into.push(s);
        const kind = steps[s];
        if (kind === NAME || kind === ANY) pending.push(s + 1);
        else if (kind === FOLDERS) pending.push(s + 1, s + 3);
      }
      return false;
    };
    if (reach(0, at, live)) return true;
    for (let i = 0; i < path.length; i++) {
      const c = path.charCodeAt(i);
      for (const s of live) {
        const kind = steps[s];
        if (kind === c) {
          if (reach(s + 1, next, after)) return true;
        } else if (kind === ANY || (kind === NAME && c !== SLASH)) {
          if (reach(s, next, after)) return true;
        }
      }
      if (!pinned && reach(0, next, after)) return true;
      for (const s of live) at[s] = 0;
      [at, next, live, after] = [next, at, after, live];
      after.length = 0;
      if (live.length === 0) return false;
    }
    return false;
  };
}

/**
 * A `path:` value's matcher (§6.13), over a path already lowercased: the value,
 * lowercased too, found anywhere in the path. A leading `/` pins it to the
 * path's start. Bare, a `*` stands for any characters within one folder or
 * file name, and two or more for any characters across folders, except where
 * they are a whole folder name, between two `/` or leading the value with a
 * `/` after them: there they stand for zero or more folders. Quoted, every
 * character is itself.
 */
function pathMatcher(
  value: string,
  quoted: boolean,
): (lowered: string) => boolean {
  const lowered = value.toLowerCase();
  const pinned = lowered.startsWith("/");
  const text = pinned ? lowered.slice(1) : lowered;
  if (quoted || !text.includes("*")) {
    return pinned
      ? (path) => path.startsWith(text)
      : (path) => path.includes(text);
  }
  const { steps, leads } = globSteps(text);
  return globMatcher(steps, pinned || leads);
}

/** A filter's terms, compiled. */
interface Compiled {
  /**
   * One matcher per `path:` term, with or without its `-`, in order, each
   * over a path already lowercased.
   */
  paths: {
    text: string;
    exclude: boolean;
    matches: (lowered: string) => boolean;
  }[];
  /** The states its `is:` terms keep; `null` when it has none. */
  states: ReadonlySet<QuestionState> | null;
  /** The states its `-is:` terms drop; empty when it has none. */
  dropsStates: ReadonlySet<QuestionState>;
  /** Its text terms' values, lowercased: every one must match. */
  needles: readonly string[];
  /** Its `-` text terms' values, lowercased: none may match. */
  excludedNeedles: readonly string[];
  /**
   * Whether a path is a kept document: one `path:` term matches it, or there
   * are none, and no `-path:` term matches it. Each path's answer is kept,
   * since a page tests one path once per entry it holds.
   */
  keepsPath: (path: string) => boolean;
}

const compiledFilters = new WeakMap<UnderstoodPlanningFilter, Compiled>();

/** `filter`'s matchers, compiled once per filter object. */
function compiled(filter: UnderstoodPlanningFilter): Compiled {
  const known = compiledFilters.get(filter);
  if (known !== undefined) return known;
  const paths: Compiled["paths"] = [];
  let states: Set<QuestionState> | null = null;
  const dropsStates = new Set<QuestionState>();
  const needles: string[] = [];
  const excludedNeedles: string[] = [];
  for (const term of filter.terms) {
    switch (term.key) {
      case "path":
        paths.push({
          text: term.text,
          exclude: term.exclude,
          matches: pathMatcher(term.value, term.quoted),
        });
        break;
      case "is":
        if (term.exclude) {
          dropsStates.add(term.value);
        } else {
          states ??= new Set();
          states.add(term.value);
        }
        break;
      case "text":
        (term.exclude ? excludedNeedles : needles).push(
          term.value.toLowerCase(),
        );
        break;
    }
  }
  const kept = paths.filter((p) => !p.exclude);
  const dropped = paths.filter((p) => p.exclude);
  const verdicts = new Map<string, boolean>();
  const keepsPath =
    paths.length === 0
      ? () => true
      : (path: string) => {
          let verdict = verdicts.get(path);
          if (verdict === undefined) {
            const lowered = path.toLowerCase();
            verdict =
              (kept.length === 0 || kept.some((p) => p.matches(lowered))) &&
              !dropped.some((p) => p.matches(lowered));
            verdicts.set(path, verdict);
          }
          return verdict;
        };
  const made: Compiled = {
    paths,
    states,
    dropsStates,
    needles,
    excludedNeedles,
    keepsPath,
  };
  compiledFilters.set(filter, made);
  return made;
}

/**
 * Each object's searched fields (§6.12), lowercased once: a question's id,
 * title, leaning and path; a document's path, `stage` and `next`; a Too
 * large or Unreadable entry's path. A field the index holds as `null` is
 * left out, since it matches nothing. Kept beside the index's own objects,
 * so typing lowercases nothing twice, and an index update that keeps an
 * object keeps its fields.
 */
const searchedFields = new WeakMap<object, readonly string[]>();

function fieldsOf(
  owner: object,
  fields: () => readonly (string | null)[],
): readonly string[] {
  let lowered = searchedFields.get(owner);
  if (lowered === undefined) {
    lowered = fields()
      .filter((field): field is string => field !== null)
      .map((field) => field.toLowerCase());
    searchedFields.set(owner, lowered);
  }
  return lowered;
}

/** What a text term reads of a question. */
export type PlanningFilterQuestion = Pick<
  PlanningQuestion,
  "path" | "id" | "title" | "leaning" | "state"
>;

const questionFields = (q: PlanningFilterQuestion) =>
  fieldsOf(q, () => [q.id, q.title, q.leaning, q.path]);

const documentFields = (doc: PlanningDocument) =>
  fieldsOf(doc, () => [doc.path, doc.stage, doc.next]);

/**
 * Whether the text terms keep an entry with these fields: every text term is
 * a substring of one of them, and no `-` text term is. Each field is compared
 * on its own, so no term spans two.
 */
function textKeeps(c: Compiled, fields: () => readonly string[]): boolean {
  if (c.needles.length === 0 && c.excludedNeedles.length === 0) return true;
  const own = fields();
  const holds = (needle: string) => own.some((field) => field.includes(needle));
  return c.needles.every(holds) && !c.excludedNeedles.some(holds);
}

/**
 * The state test of §6.12: no `is:` term, or one that matches; and no `-is:`
 * term that matches. `null` is a question the index cannot resolve, whose
 * state is unknown: any `is:` term drops it, and no `-is:` term does.
 */
function stateKeeps(c: Compiled, state: QuestionState | null): boolean {
  if (c.states !== null && (state === null || !c.states.has(state))) {
    return false;
  }
  return state === null || !c.dropsStates.has(state);
}

/** The four tests of §6.12, for a question. */
function keepsQuestionWith(c: Compiled, q: PlanningFilterQuestion): boolean {
  return (
    c.keepsPath(q.path) &&
    stateKeeps(c, q.state) &&
    textKeeps(c, () => questionFields(q))
  );
}

/**
 * The four tests of §6.12, for a row: a document's, or a Too large or
 * Unreadable path's. A row has no state, so any `is:` term drops it, and a
 * `-is:` term never does.
 */
function keepsRowWith(
  c: Compiled,
  path: string,
  fields: () => readonly string[],
): boolean {
  return c.states === null && c.keepsPath(path) && textKeeps(c, fields);
}

/**
 * Whether `filter` keeps a question (§6.12): its path is a kept document, its
 * state passes the `is:` and `-is:` terms, every text term matches one of its
 * id, title, leaning and path, and no `-` text term matches any of them.
 * Same key OR, different keys AND.
 */
export function filterKeepsQuestion(
  filter: UnderstoodPlanningFilter,
  question: PlanningFilterQuestion,
): boolean {
  return keepsQuestionWith(compiled(filter), question);
}

/**
 * Whether `path` is a document `filter` keeps (§2, *Kept document*): one of
 * its `path:` terms matches it, or it has none, and none of its `-path:`
 * terms does. Text and `is:` terms never change which documents are kept.
 */
export function filterKeepsDocument(
  filter: UnderstoodPlanningFilter,
  path: string,
): boolean {
  return compiled(filter).keepsPath(path);
}

/* ------------------------------------------------------------------ *
 * Applying it to the sections
 * ------------------------------------------------------------------ */

/**
 * What a filter does to one set of sections, in numbers and names: what the
 * filter notice (§6.18), the request's `Filter:` line (§6.2) and the
 * checker's JSON `filter` key (§13.4) say.
 */
export interface PlanningFilterSummary {
  canonical: string;
  /**
   * `canonical` less its unmatched terms (§6.2): the text the request's
   * `Filter:` line carries, which `--filter` accepts and which keeps the same
   * entries. `null` when it has a `path:` term without a `-` and every such
   * term is unmatched, since dropping them all would keep more, and nothing
   * is kept. `""` when every term is an unmatched `-path:` term, which
   * excludes nothing: the request is then the unfiltered one.
   */
  requestText: string | null;
  /** Entries the filtered sections list, of those the unfiltered ones do. */
  entries: { shown: number; of: number };
  /** Kept documents, of every path the index lists. */
  documents: { kept: number; of: number };
  /** How many shown entries are open questions. */
  openQuestions: number;
  /**
   * 🔒 questions Blocked lists that every term but the `is:` terms keeps,
   * and an `is:` term leaves out (§6.18).
   */
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
  /**
   * The canonical texts of the `path:` terms, with or without their `-`, that
   * match no path the index lists, in order.
   */
  unmatched: string[];
  /**
   * Each unknown key (§6.12), once, in the order written, with the canonical
   * texts of the terms it opens: what the notice's *Not a key* lines say.
   * The checker's JSON lists the keys alone.
   */
  unknownKeys: { key: string; terms: string[] }[];
  /**
   * Why it keeps no entry in any section, when it keeps none: what the page
   * shows and the checker prints in place of the sections, after *Nothing
   * matches* and the filter. `null` when it keeps an entry. The checker's JSON
   * does not carry it.
   */
  nothingMatches: PlanningNothingMatches | null;
}

/**
 * What a filter that keeps no entry would keep with some of its terms left
 * out: the `entries` the sections would list, and the questions that need
 * you that only other roadmaps route, which are counted and not listed:
 * `onOtherRoadmaps` of them, each once, on `otherRoadmaps` roadmaps other
 * than the chosen one.
 */
export interface PlanningKeptCount {
  entries: number;
  onOtherRoadmaps: number;
  otherRoadmaps: number;
}

/**
 * Why an applied filter keeps no entry in any section: the first of these
 * that holds, in this order, each a reason line of its own
 * (`PLANNING_NOTICES.nothingMatches`).
 */
export type PlanningNothingMatches =
  /**
   * Questions it keeps need you, and only other roadmaps route them, so they
   * are counted and not listed: the summary's `onOtherRoadmaps` and
   * `otherRoadmaps`. The only kind under which it keeps something, so the
   * only one whose headline is *Nothing on this roadmap matches*.
   */
  | {
      kind: "other-roadmaps";
      onOtherRoadmaps: number;
      otherRoadmaps: { path: string; count: number }[];
    }
  /** The sections list no entry even without it. */
  | { kind: "no-entries" }
  /**
   * Its `path:` and `-path:` terms alone keep no entry: the `documents` they
   * keep, which may be none, list nothing on the page, as a document whose
   * stage has the `done` role does, or one with no question and no stage row.
   * With none, the summary's `unmatched` terms are the reason given, when it
   * has any.
   */
  | { kind: "documents"; documents: number }
  /**
   * Its `is:` terms leave out every entry the rest of it keeps: `terms`, their
   * canonical texts in the order written, and what it would keep without
   * them.
   */
  | ({ kind: "state"; terms: string[] } & PlanningKeptCount)
  /**
   * Its `-` words and quoted phrases leave out every entry the rest of it
   * keeps: `terms`, their canonical texts in the order written, and what it
   * would keep without them. `withState` when its `is:` terms are among
   * `terms`, which is when neither they nor the `-` terms alone leave out
   * every entry, and both together do.
   */
  | ({
      kind: "excluded";
      terms: string[];
      withState: boolean;
    } & PlanningKeptCount)
  /**
   * Its words and quoted phrases keep none of what the rest of it keeps. No
   * other kind is left by then, so the filter has at least one word or
   * phrase without a `-`.
   */
  | { kind: "words" };

export interface FilteredPlanningSections {
  sections: PlanningSections;
  summary: PlanningFilterSummary;
}

/** One question's identity: its line is unique within its document. */
const questionKey = (ref: QuestionRef): string => `${ref.path}\n${ref.line}`;

/** Each index's questions by path, then line, built once per index object. */
const questionsByLine = new WeakMap<
  PlanningIndex,
  Map<string, Map<number, PlanningQuestion>>
>();

/**
 * `questionFor(index, ref)`, in constant time: a page lays its sections out
 * again per keystroke, and the sections' references are many. A line holds
 * one question; where the line's question is not the reference's, the
 * search `questionFor` makes decides.
 */
function questionOf(
  index: PlanningIndex,
  ref: QuestionRef,
): PlanningQuestion | undefined {
  let byPath = questionsByLine.get(index);
  if (byPath === undefined) {
    byPath = new Map();
    for (const doc of index.documents) {
      const byLine = new Map<number, PlanningQuestion>();
      for (const q of doc.questions) {
        if (!byLine.has(q.line)) byLine.set(q.line, q);
      }
      byPath.set(doc.path, byLine);
    }
    questionsByLine.set(index, byPath);
  }
  const q = byPath.get(ref.path)?.get(ref.line);
  return q !== undefined && q.id === ref.id ? q : questionFor(index, ref);
}

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

/** What a compiled filter keeps of each kind of entry the sections list. */
interface EntryTests {
  /** A question entry: Needs you, Not on a roadmap, a Blocked question. */
  keepsRef: (ref: QuestionRef) => boolean;
  /** A document's row: a Blocked document, or a stage section's row. */
  keepsDocumentRow: (path: string) => boolean;
  /** A Blocked entry, a question's or a document's. */
  keepsWaiting: (entry: WaitingEntry) => boolean;
  /** A Too large or Unreadable entry. */
  keepsEntry: (entry: { path: string }) => boolean;
}

/**
 * The tests of §6.12 for each kind of entry, over `index`: a question by its
 * own fields, a document's row by the document's path, `stage` and `next`,
 * and a Too large or Unreadable entry by its path.
 */
function entryTests(index: PlanningIndex, c: Compiled): EntryTests {
  /** A question the index cannot resolve has its reference's fields alone. */
  const unresolved = (ref: QuestionRef) =>
    fieldsOf(ref, () => [ref.id, ref.path]);
  const keepsRef = (ref: QuestionRef): boolean => {
    const q = questionOf(index, ref);
    if (q !== undefined) return keepsQuestionWith(c, q);
    return (
      c.keepsPath(ref.path) &&
      stateKeeps(c, null) &&
      textKeeps(c, () => unresolved(ref))
    );
  };
  const keepsDocumentRow = (path: string): boolean =>
    keepsRowWith(c, path, () => {
      const doc = findDocument(index, path);
      return doc === undefined ? [path.toLowerCase()] : documentFields(doc);
    });
  return {
    keepsRef,
    keepsDocumentRow,
    keepsWaiting: (entry) =>
      entry.kind === "document"
        ? keepsDocumentRow(entry.path)
        : keepsRef(entry.question),
    keepsEntry: (entry) =>
      keepsRowWith(c, entry.path, () => fieldsOf(entry, () => [entry.path])),
  };
}

/**
 * What `c` keeps of `sections`: `entryCount` of the sections
 * `applyPlanningFilter` would leave, and the questions only other roadmaps
 * route, counted without building them.
 */
function keptCount(
  index: PlanningIndex,
  sections: PlanningSections,
  c: Compiled,
): PlanningKeptCount {
  const tests = entryTests(index, c);
  const kept = <T>(
    entries: readonly T[] | null,
    keeps: (entry: T) => boolean,
  ): number =>
    entries === null
      ? 0
      : entries.reduce((n, entry) => (keeps(entry) ? n + 1 : n), 0);
  const elsewhere = sections.onOtherRoadmaps.filter(tests.keepsRef);
  return {
    entries:
      kept(sections.needsYou, tests.keepsRef) +
      kept(sections.unrouted, tests.keepsRef) +
      kept(sections.waiting, tests.keepsWaiting) +
      kept(sections.ready, tests.keepsDocumentRow) +
      kept(sections.graduate, tests.keepsDocumentRow) +
      kept(sections.disagrees, tests.keepsDocumentRow) +
      kept(sections.skipped, tests.keepsEntry) +
      kept(sections.unreadable, tests.keepsEntry),
    onOtherRoadmaps: elsewhere.length,
    otherRoadmaps: new Set(elsewhere.map((ref) => ref.roadmap)).size,
  };
}

/** Whether a count keeps anything, listed or on another roadmap. */
const keepsAny = (count: PlanningKeptCount): boolean =>
  count.entries + count.onOtherRoadmaps > 0;

/**
 * Why `filter` keeps no entry of `sections`, the first reason that holds
 * (`PlanningNothingMatches`). `otherRoadmaps` is the summary's, `of` its
 * unfiltered entries and `documents` its kept documents.
 *
 * Each later reason is the filter run again with terms left out, counting
 * what other roadmaps route as kept, since a question there is one the
 * left-out terms would bring back: without its words, phrases and `is:`
 * terms, what its `path:` terms keep; without its `is:` terms, what the rest
 * keeps; then without its `-` words and phrases, and without both. Only an
 * empty result is asked why, so typing pays for none of these runs.
 */
function whyNothingMatches(
  index: PlanningIndex,
  sections: PlanningSections,
  filter: UnderstoodPlanningFilter,
  c: Compiled,
  counts: {
    onOtherRoadmaps: number;
    otherRoadmaps: { path: string; count: number }[];
    of: number;
    documents: number;
  },
): PlanningNothingMatches {
  if (counts.onOtherRoadmaps > 0) {
    return {
      kind: "other-roadmaps",
      onOtherRoadmaps: counts.onOtherRoadmaps,
      otherRoadmaps: counts.otherRoadmaps,
    };
  }
  if (counts.of === 0) return { kind: "no-entries" };
  const stateless: Compiled = { ...c, states: null, dropsStates: new Set() };
  const pathsAlone: Compiled = {
    ...stateless,
    needles: [],
    excludedNeedles: [],
  };
  if (c.paths.length > 0 && !keepsAny(keptCount(index, sections, pathsAlone))) {
    return { kind: "documents", documents: counts.documents };
  }
  const states = filter.terms.filter((term) => term.key === "is");
  if (states.length > 0) {
    const kept = keptCount(index, sections, stateless);
    if (keepsAny(kept)) {
      return { kind: "state", terms: states.map((t) => t.text), ...kept };
    }
  }
  const excluded = filter.terms.filter(
    (term) => term.key === "text" && term.exclude,
  );
  if (excluded.length > 0) {
    const kept = keptCount(index, sections, { ...c, excludedNeedles: [] });
    if (keepsAny(kept)) {
      return {
        kind: "excluded",
        terms: excluded.map((t) => t.text),
        withState: false,
        ...kept,
      };
    }
    if (states.length > 0) {
      const both = keptCount(index, sections, {
        ...stateless,
        excludedNeedles: [],
      });
      if (keepsAny(both)) {
        return {
          kind: "excluded",
          terms: filter.terms
            .filter((t) => t.key === "is" || excluded.includes(t))
            .map((t) => t.text),
          withState: true,
          ...both,
        };
      }
    }
  }
  return { kind: "words" };
}

/**
 * `sections` with what `filter` does not keep removed (§6.11, §6.15), and what
 * that hides, summed up.
 *
 * `sections` is `derivePlanningSections` over the whole of `index` (F2), under
 * whichever roadmap is chosen. The result has its shape and its order, and the
 * chosen roadmap, the roadmaps' states and `stagesDeclared` are its own. A
 * question entry is kept by the four tests of §6.12 over the question's own
 * fields; a document's row (a Blocked document, a stage row) by them over the
 * document's path, `stage` and `next`; a Too large or Unreadable entry by
 * them over its path. A row has no state, so any `is:` term drops it. Each
 * roadmap's `needsYouCount` and `nothingNeedsYou` are counted again over kept
 * questions only.
 */
export function applyPlanningFilter(
  index: PlanningIndex,
  sections: PlanningSections,
  filter: UnderstoodPlanningFilter,
): FilteredPlanningSections {
  const c = compiled(filter);
  const { keepsRef, keepsDocumentRow, keepsWaiting, keepsEntry } = entryTests(
    index,
    c,
  );
  const rows = (paths: string[] | null): string[] | null =>
    paths === null ? null : paths.filter(keepsDocumentRow);

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
          const q = questionOf(index, ref);
          return (
            q !== undefined &&
            (q.state === "open" || q.state === "answered") &&
            keepsQuestionWith(c, q)
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
          (q) => q.state === "open" && keepsQuestionWith(c, q),
        ),
    ),
    needsYou,
    onOtherRoadmaps,
    unrouted,
    waiting: sections.waiting.filter(keepsWaiting),
    ready: rows(sections.ready),
    graduate: rows(sections.graduate),
    disagrees: rows(sections.disagrees),
    skipped: sections.skipped.filter(keepsEntry),
    unreadable: sections.unreadable.filter(keepsEntry),
  };

  const listed = [
    ...index.documents,
    ...index.skipped,
    ...index.unreadable,
  ].map((entry) => entry.path);
  const lowered =
    c.paths.length === 0 ? [] : listed.map((path) => path.toLowerCase());
  const unmatched = c.paths
    .filter((term) => !lowered.some((path) => term.matches(path)))
    .map((term) => term.text);
  // An unmatched `path:` term keeps nothing and an unmatched `-path:` term
  // excludes nothing, so leaving them out keeps the same entries, unless
  // every `path:` term without a `-` is unmatched: then nothing is kept.
  const keeping = c.paths.filter((term) => !term.exclude);
  const requestText =
    unmatched.length === 0
      ? filter.canonical
      : keeping.length > 0 &&
          keeping.every((term) => unmatched.includes(term.text))
        ? null
        : filter.terms
            .filter((term) => !unmatched.includes(term.text))
            .map((term) => term.text)
            .join(" ");

  const isOpenRef = (ref: QuestionRef) =>
    questionOf(index, ref)?.state === "open";
  // Every roadmap but the chosen one that routes a kept question the chosen
  // one does not list, with how many it routes (§6.15). A question two of them
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
      // Kept by every term but the `is:` terms, and left out by one of them.
      const q = questionOf(index, entry.question);
      if (
        q !== undefined &&
        c.keepsPath(q.path) &&
        textKeeps(c, () => questionFields(q)) &&
        !stateKeeps(c, q.state)
      ) {
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

  const unknownKeys = filter.unknownKeys.map((key) => ({
    key,
    terms: filter.terms
      .filter((term) => term.key === "text" && term.unknownKey === key)
      .map((term) => term.text),
  }));

  const entries = { shown: entryCount(filtered), of: entryCount(sections) };
  const documents = {
    kept: listed.filter((path) => c.keepsPath(path)).length,
    of: listed.length,
  };
  return {
    sections: filtered,
    summary: {
      canonical: filter.canonical,
      requestText,
      entries,
      documents,
      openQuestions: [...needsYou, ...(unrouted ?? [])].filter(isOpenRef)
        .length,
      blockedLeftOut,
      onOtherRoadmaps: onOtherRoadmaps.length,
      otherRoadmaps,
      waitsOutside,
      unmatched,
      unknownKeys,
      nothingMatches:
        entries.shown > 0
          ? null
          : whyNothingMatches(index, sections, filter, c, {
              onOtherRoadmaps: onOtherRoadmaps.length,
              otherRoadmaps,
              of: entries.of,
              documents: documents.kept,
            }),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Links
 * ------------------------------------------------------------------ */

/** The characters a planning link writes bare (§13.5). */
const BARE_IN_QUERY = /^[A-Za-z0-9\-._~:/]$/;
/** Those of them a pasted link's end drops (`TRAILING`, below). */
const DROPPED_AT_END = /^[._~:]$/;

/**
 * A value as a planning link writes it (§13.5): everything but `A–Z a–z 0–9
 * - . _ ~ : /` percent-encoded as UTF-8, and a space as `+`. So `*` is `%2A`,
 * which Markdown and chat clients cannot read as emphasis; `#`, `&`, `+` and
 * `"` cannot cut the value short; and `:` and `/` stay readable.
 * `URLSearchParams` reads it back to exactly `value`.
 *
 * With `ends`, the value ends what is written, so a last `.`, `_`, `~` or `:`
 * is escaped too: a pasted link loses those at its end, as a sentence's
 * punctuation (`readPastedPlanningLink`), so the link must not end with one.
 */
export function encodePlanningQueryValue(value: string, ends = false): string {
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
  const last = out.at(-1);
  return ends && last !== undefined && DROPPED_AT_END.test(last)
    ? `${out.slice(0, -1)}%${last.charCodeAt(0).toString(16).toUpperCase()}`
    : out;
}

/**
 * A link to the planning page filtered by `canonical`: `path`, by default the
 * root-relative `/.vantage/planning`, then `?filter=<canonical>`, then
 * `&roadmap=<roadmap>` when one is given, each written by
 * `encodePlanningQueryValue`, the last as the link's end. An empty
 * `canonical` is no filter, and gets no parameter (§6.11).
 */
export function planningLink(
  canonical: string,
  options: { roadmap?: string | null; path?: string } = {},
): string {
  const roadmap = options.roadmap ?? null;
  const params: string[] = [];
  if (canonical !== "") {
    params.push(
      `${PLANNING_FILTER_PARAM}=${encodePlanningQueryValue(canonical, roadmap === null)}`,
    );
  }
  if (roadmap !== null) {
    params.push(
      `${PLANNING_ROADMAP_PARAM}=${encodePlanningQueryValue(roadmap, true)}`,
    );
  }
  const base = options.path ?? PLANNING_PAGE_PATH;
  return params.length === 0 ? base : `${base}?${params.join("&")}`;
}

/**
 * The filter that keeps one document, `path:/<path>`, in canonical text
 * (§6.14): `path:/plans/design.md`, or quoted where the path holds a space, a
 * `"` or a `*`. It keeps every path that starts with that one's text too, as
 * `plans/design.md/x.md` or `plans/design.mdx`. `null` when even quoted it is
 * not understood, as for a path holding a control character.
 */
export function documentFilter(path: string): string | null {
  const parsed = parsePlanningFilter(`path:"/${escapeQuoted(path)}"`);
  return parsed.kind === "understood" ? parsed.canonical : null;
}

/**
 * A planning link's path from `/.vantage/planning` on, up to its query: its
 * repository segment holds what the page's `planningPath`
 * (`encodeURIComponent`, which leaves `! ' ( ) *` bare) and the server's
 * startup tip (Go's `url.PathEscape`, which leaves `$ & + : = @` bare) write,
 * which is RFC 3986's path characters and the escapes.
 */
const LINK_PATH = /^[A-Za-z0-9\-._~%!$&'()*+,;=:@/]*/;
/**
 * Its query and fragment: what `encodePlanningQueryValue` leaves bare, the
 * percent escapes and `+` it writes, the `*` that `URLSearchParams` leaves
 * bare, and the URL's own `? & = #`.
 */
const LINK_QUERY = /^[A-Za-z0-9\-._~:/%+?&=#*]*/;
/**
 * The trailing punctuation GFM's extended autolinks leave out that a link can
 * hold, but `*`, which is the link's own unless it closes emphasis.
 */
const TRAILING = /^[?.,:_~]$/;

/** Where a planning link's path starts in a pasted run of text. */
const PAGE_PATH_AT = new RegExp(
  `${PLANNING_PAGE_PATH.replace(/\./g, "\\.")}(?=[/?#]|$)`,
);

/**
 * The first planning link in pasted text (§6.17), or `null` when it holds none:
 * the first run of characters up to white space that holds
 * `/.vantage/planning`, whatever comes before it in the run (a scheme, a
 * host, a port), with its query after. Its `filter` values joined with one
 * space, `""` when it has none, decoded as the page decodes its own URL; and
 * its `roadmap`, or `null`. Its repository segment, its page parameters and
 * its fragment are ignored.
 *
 * The link ends where the run does, or earlier, at the first character a
 * planning link never holds unencoded, so the backtick or the parenthesis a
 * chat wraps it in is not read as part of it: in its query, one outside what
 * `encodePlanningQueryValue` and `URLSearchParams` write bare; in its
 * repository segment, one outside a path's. Then the trailing punctuation
 * GitHub's autolinks leave out (`?`, `.`, `,`, `:`, `_` and `~`; GFM's
 * extended autolink rule) is dropped, so a sentence's period after it is too,
 * and so is a trailing `*` for each `*` before the link in its run, which
 * opened emphasis around it.
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
    const tail = candidate.slice(at.index);
    const path = LINK_PATH.exec(tail)?.[0] ?? "";
    let link = path + (LINK_QUERY.exec(tail.slice(path.length))?.[0] ?? "");
    // A `*` at its end is the link's own unless one opened emphasis before it.
    let emphasis = [...candidate.slice(0, at.index)].filter(
      (c) => c === "*",
    ).length;
    for (;;) {
      const last = link.at(-1);
      if (last === undefined) break;
      if (last === "*" && emphasis > 0) emphasis -= 1;
      else if (!TRAILING.test(last)) break;
      link = link.slice(0, -1);
    }
    let url: URL;
    try {
      url = new URL(link, "http://vantage.invalid");
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
