import type { Nodes, Paragraph, Text } from "mdast";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import type { Collector, FilePosition } from "../core/collector.js";
import { fileLine } from "../core/document.js";

/**
 * `prose/*` — how a paragraph is written, where the parsed tree can settle it.
 *
 * Most of the checker asks whether something works. This family asks whether
 * a reader can follow it, so its findings are warnings: each reports a shape,
 * not a fault, and a shape can be meant.
 *
 * `prose/inline-list` is the one rule: a paragraph that runs an enumeration —
 * `(a) … (b) … (c)` — into one sentence, with nothing to set the items apart.
 * Three or more enumerators, each the next in its sequence from the first and
 * each after the text of the item before it, is a list written as prose, and
 * the fix is a Markdown list. Two is not enough to say so: "either (a) or (b)"
 * reads fine in a sentence. Nor is a run with no item text between its terms,
 * as in "certified (a), (b) or (c)": that names items written somewhere else,
 * or the notation itself, and a list of it would hold nothing.
 */

/** The enumeration styles: `(a)`, `(A)`, `(1)` and `(i)`. */
const STYLES = ["lower", "upper", "number", "roman"] as const;
type Style = (typeof STYLES)[number];

/**
 * Lowercase roman numerals, 1 to 39: `i` to `xxxix`. Far past any enumeration
 * written in a sentence, and short of `l`, which is a letter far more often.
 */
const ROMAN = /^x{0,3}(?:ix|iv|v?i{0,3})$/;

/** The value of a lowercase roman numeral `ROMAN` accepts. */
function romanValue(numeral: string): number {
  const digits: Record<string, number> = { i: 1, v: 5, x: 10 };
  let total = 0;
  for (let index = 0; index < numeral.length; index++) {
    const value = digits[numeral[index] as string] ?? 0;
    const next = digits[numeral[index + 1] as string] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

/**
 * The place an enumerator's label holds in each style it can belong to,
 * counting from 1: `(c)` is third in `lower`, and `(i)` is ninth in `lower`
 * and first in `roman`.
 */
function placesOf(label: string): Partial<Record<Style, number>> {
  const places: Partial<Record<Style, number>> = {};
  if (/^[a-z]$/.test(label)) places.lower = label.charCodeAt(0) - 96;
  if (/^[A-Z]$/.test(label)) places.upper = label.charCodeAt(0) - 64;
  if (/^[1-9][0-9]?$/.test(label)) places.number = Number(label);
  if (label !== "" && ROMAN.test(label)) places.roman = romanValue(label);
  return places;
}

/**
 * What stands in the paragraph's text for what is not prose.
 *
 * Inline code and math are *opaque words*: their text is ignored, so a
 * `` `(a)` `` is no enumerator, but they still sit against a parenthesis the
 * way a word does, so `` `f`(a) `` is a call and not an enumerator either, and
 * they count as an item's text. The same goes for everything from an inline
 * HTML `<code>`, `<kbd>` or `<samp>` tag to its closing tag. Any other HTML
 * tag, an image or a footnote reference is space. A hard line break ends a
 * rendered line, and so does a `<br>` tag, so a run whose every term after the
 * first follows one is already set apart.
 */
const OPAQUE = "\uFFFC";
const HARD_BREAK = "\u2028";

/** An inline HTML tag that opens a specimen, as a backtick does. */
const SPECIMEN_TAG = /^<(code|kbd|samp)(?:\s[^>]*)?>$/i;

/** An inline HTML tag that breaks the line. */
const BREAK_TAG = /^<br\s*\/?>$/i;

/**
 * A parenthesized label with no word against either side of it, so `f(a)` and
 * `file(s)` are not enumerators and `(a)` and `(a),` are.
 */
const ENUMERATOR =
  /(?<![\p{L}\p{N}_\uFFFC])\(([a-zA-Z]|[1-9][0-9]?|[ivx]{1,6})\)(?![\p{L}\p{N}_\uFFFC])/gu;

/** One stretch of the paragraph's text, and the text node it came from. */
interface Piece {
  /** Where it starts in the paragraph's text. */
  start: number;
  /** The text node, or undefined for something standing in for a node. */
  node: Text | undefined;
}

/**
 * A paragraph's text as the rule reads it: its text nodes in order, through
 * emphasis and link labels, with the stand-ins above for everything else, and
 * where each text node landed in it.
 *
 * A link whose label is its own destination — an autolink, `<https://…>` or a
 * bare URL GFM linked — is a destination, and opaque.
 */
function paragraphText(paragraph: Paragraph): {
  text: string;
  pieces: Piece[];
} {
  let text = "";
  const pieces: Piece[] = [];
  const add = (value: string, node?: Text) => {
    pieces.push({ start: text.length, node });
    text += value;
  };
  const walk = (node: Nodes): void => {
    switch (node.type) {
      case "text":
        add(node.value, node);
        return;
      case "inlineCode":
      case "inlineMath":
        add(OPAQUE);
        return;
      case "break":
        add(HARD_BREAK);
        return;
      case "link":
        if (isAutolink(node.url, toString(node))) {
          add(OPAQUE);
          return;
        }
        break;
      case "html":
        add(BREAK_TAG.test(node.value.trim()) ? HARD_BREAK : " ");
        return;
      case "image":
      case "imageReference":
      case "footnoteReference":
        add(" ");
        return;
    }
    if (!("children" in node)) return;
    // The closing tag of the specimen tag being passed over, if any. A tag
    // left open runs to the end of its parent, as the browser renders it.
    let closing: RegExp | undefined;
    for (const child of node.children as Nodes[]) {
      if (closing !== undefined) {
        if (child.type === "html" && closing.test(child.value.trim())) {
          closing = undefined;
        }
        continue;
      }
      const name =
        child.type === "html"
          ? SPECIMEN_TAG.exec(child.value.trim())?.[1]
          : undefined;
      if (name === undefined) {
        walk(child);
        continue;
      }
      add(OPAQUE);
      closing = new RegExp(`^</${name}\\s*>$`, "i");
    }
  };
  walk(paragraph);
  return { text, pieces };
}

/** Whether a link's label is its own destination. */
function isAutolink(url: string, label: string): boolean {
  return (
    url === label ||
    url === `mailto:${label}` ||
    url === `http://${label}` ||
    url === `https://${label}`
  );
}

/** One enumerator in a paragraph's text. */
interface Enumerator {
  label: string;
  /** Where its `(` is in the paragraph's text. */
  offset: number;
  /** Where the text after its `)` starts. */
  end: number;
  places: Partial<Record<Style, number>>;
}

/** A word, a number, or code standing in for one. */
const WORD = /[\p{L}\p{M}\p{N}_\uFFFC]+/gu;

/** The words that join terms rather than say anything of an item. */
const CONNECTORS = new Set(["and", "or", "nor"]);

/**
 * Whether the text between two terms holds an item: a word other than `and`,
 * `or` or `nor`, a number, or code. Space, punctuation and those three words
 * alone, as in "(a), (b) or (c)", name items rather than write them.
 */
function holdsItem(between: string): boolean {
  for (const [word] of between.matchAll(WORD)) {
    if (!CONNECTORS.has(word.toLowerCase())) return true;
  }
  return false;
}

/** The fewest terms that make a run. */
const RUN = 3;

/**
 * The first run of three or more in `enumerators`: in one style, starting at
 * its first term, each the next term, in the order they are written, and each
 * after an item's text (`holdsItem`).
 *
 * A term out of turn, or one with no item between it and the term before,
 * starts the count again, at one if it is the first term and at nothing
 * otherwise, so `(a) (c) (b)` is no run and the `(a) (b) (c)` after a stray
 * `(c) 2026` is one. Terms of another style in between are passed over: `(i)`
 * sits in the middle of `(h) (i) (j)` as a letter.
 */
function firstRun(
  text: string,
  enumerators: readonly Enumerator[],
): Enumerator[] {
  let found: Enumerator[] = [];
  for (const style of STYLES) {
    const run = runIn(text, enumerators, style);
    const [first] = run;
    if (first === undefined) continue;
    if (found[0] === undefined || first.offset < found[0].offset) found = run;
  }
  return found;
}

/** The first run of one style, or none. */
function runIn(
  text: string,
  enumerators: readonly Enumerator[],
  style: Style,
): Enumerator[] {
  let run: Enumerator[] = [];
  for (const enumerator of enumerators) {
    const place = enumerator.places[style];
    if (place === undefined) continue;
    const previous = run.at(-1);
    const next =
      previous === undefined
        ? place === 1
        : place === run.length + 1 &&
          holdsItem(text.slice(previous.end, enumerator.offset));
    if (next) {
      run.push(enumerator);
      continue;
    }
    if (run.length >= RUN) break;
    run = place === 1 ? [enumerator] : [];
  }
  return run.length >= RUN ? run : [];
}

/**
 * Whether every term after the first starts a line of its own, after a hard
 * line break and nothing but space: a run already set apart, if not as a list.
 */
function setApart(text: string, run: readonly Enumerator[]): boolean {
  return run.slice(1).every((enumerator) => {
    const before = text.slice(0, enumerator.offset).replace(/[ \t\n]+$/, "");
    return before.endsWith(HARD_BREAK);
  });
}

/**
 * Where an offset in the paragraph's text is in the file.
 *
 * A text node's value is its source less what the container put in front of
 * each line after the first — a list item's indent, a quote's `>` — so the line
 * comes from counting newlines and the column from finding the enumerator on
 * that line of the source, escaped (`\(a\)`) or not, since the value holds
 * both alike. The column is the `(`'s, and if the source line somehow lacks
 * the enumerator, it falls back to an estimate.
 */
function positionOf(
  collector: Collector,
  pieces: readonly Piece[],
  offset: number,
  label: string,
): FilePosition | undefined {
  let piece: Piece | undefined;
  for (const candidate of pieces) {
    if (candidate.start > offset) break;
    piece = candidate;
  }
  const node = piece?.node;
  const start = node?.position?.start;
  if (piece === undefined || node === undefined || start === undefined) {
    return undefined;
  }

  const within = offset - piece.start;
  const before = node.value.slice(0, within);
  const newlines = before.split("\n").length - 1;
  const line = fileLine(collector.doc, start.line + newlines);
  const lineStart = newlines === 0 ? 0 : before.lastIndexOf("\n") + 1;
  const earlier =
    node.value.slice(lineStart, within).split(`(${label})`).length - 1;

  const source = collector.doc.lines[line - 1] ?? "";
  const from = newlines === 0 ? start.column - 1 : 0;
  const estimate = newlines === 0 ? from + within : from;
  // The label is a letter, digits or a roman numeral, safe in a pattern.
  const token = new RegExp(`(\\\\?)\\(${label}\\\\?\\)`, "g");
  token.lastIndex = from;
  for (let seen = 0; ; seen++) {
    const match = token.exec(source);
    if (match === null) return { line, column: estimate + 1 };
    if (seen === earlier) {
      return { line, column: match.index + (match[1] as string).length + 1 };
    }
  }
}

/**
 * `prose/inline-list` — a paragraph that runs three or more enumerators
 * together, as `(a) … (b) … (c)`.
 *
 * Every paragraph in the tree, so one in a list item, a quote, an alert or a
 * footnote too, and nothing else: a heading or a table cell holds no paragraph
 * (and GFM cannot put a list in a cell), and code, math and HTML blocks are
 * specimens. Reported once per paragraph, at its run's first term.
 */
export function checkInlineLists(collector: Collector): void {
  const rule = "prose/inline-list";
  if (!collector.enabled(rule)) return;

  visit(collector.doc.mdast, "paragraph", (paragraph: Paragraph) => {
    const { text, pieces } = paragraphText(paragraph);
    if (!text.includes("(")) return;

    const enumerators: Enumerator[] = [];
    for (const match of text.matchAll(ENUMERATOR)) {
      const label = match[1] as string;
      const places = placesOf(label);
      if (Object.keys(places).length === 0) continue;
      const end = match.index + match[0].length;
      enumerators.push({ label, offset: match.index, end, places });
    }
    if (enumerators.length < RUN) return;

    const run = firstRun(text, enumerators);
    const [first] = run;
    if (first === undefined || setApart(text, run)) return;

    const at =
      positionOf(collector, pieces, first.offset, first.label) ??
      collector.at(paragraph);
    const named = run
      .slice(0, RUN)
      .map((enumerator) => `(${enumerator.label})`)
      .join(", ");
    collector.report(
      rule,
      at,
      `This paragraph runs ${named} together; write them as a list, one item per line.`,
    );
  });
}

/** Every `prose/*` rule. */
export function checkProse(collector: Collector): void {
  checkInlineLists(collector);
}
