/**
 * Rehype plugin that compiles `<!-- vantage: … -->` directives into
 * `data-vantage-*` attributes on the block that follows them.
 *
 * It has to run between `rehype-raw` — which turns the comment into a hast node
 * — and `rehype-sanitize`, which deletes every comment node. That is the only
 * window in which the information exists (`docs/design/inline-markup.md` §2.2),
 * and `pipeline.ts` is where the slot is spelled out.
 *
 * The grammar and the vocabulary live in `./vantageDirectives.js`, which the
 * CLI checker imports too: one parser, two callers, so a directive cannot mean
 * one thing in the viewer and another in the tool that validates it (D5).
 *
 * Nothing here throws and nothing logs. An unknown name drops the whole
 * directive, an unknown key or value drops that pair only, and a directive with
 * no block after it does nothing at all (P3/D2/D6). The comment node is left
 * where it is: the sanitiser removes it, which is why no Vantage-specific
 * markup other than these attributes ever reaches the DOM.
 */

import type { Element, Parents, Properties, RootContent, Root } from "hast";
import type { Plugin } from "unified";
import {
  DIRECTIVE_VOCABULARY,
  parseVantageDirective,
} from "./vantageDirectives.js";
import type { KeyVocabulary, ParsedDirective } from "./vantageDirectives.js";

/**
 * What a `section`/`block` directive may stamp.
 *
 * Deliberately `rehypeSourceLines`'s `BLOCK_TAGS`: a stamped block should also
 * be a block with a `data-source-line`, so the styling surface and the anchor
 * surface coincide. It also keeps an inline directive from stamping the `<em>`
 * that happens to follow it inside a paragraph.
 */
const STYLE_TARGET_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "table",
  "tr",
  "ul",
  "ol",
  "hr",
  "div",
]);

/**
 * What an `oq` directive may stamp — strictly the tags the review system can
 * resolve an anchor on (`ANCHOR_TAGS` in the app's `MarkdownViewer`, and the
 * block map in `useReviewHighlights`). `ul`, `ol`, `tr`, `hr` and `div` are in
 * neither, so a button on one of them would build an anchor no review pass can
 * find — the "mis-wired button" D6 forbids.
 */
const ANCHOR_TARGET_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "table",
]);

const HEADING_DEPTHS = new Map([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
  ["h5", 5],
  ["h6", 6],
]);

/**
 * Key → hast property. A camelCase hast property serialises to the kebab-case
 * attribute, so `dataVantageTone` is `data-vantage-tone` in every renderer.
 *
 * `collapsed` is absent on purpose: it needs the toggle and group ids and the
 * click handler that ship with it, and an attribute that hides content with no
 * way to reveal it is content loss (P1/D8). Its vocabulary entry exists, so the
 * checker already validates `collapsed=true`; only the stamping is later work.
 */
const STYLE_PROPERTIES = new Map([
  ["tone", "dataVantageTone"],
  ["emphasis", "dataVantageEmphasis"],
  ["badge", "dataVantageBadge"],
]);

const RUN_PROPERTY = "dataVantageRun";
const OQ_PROPERTY = "dataVantageOq";
const LEANING_PROPERTY = "dataVantageLeaning";

/** A review-comment body, not prose. Bounds the attribute; 500 is generous. */
const MAX_LEANING = 500;

/**
 * Nodes that may sit between a directive and its target.
 *
 * A whitespace-only `text` node always does — measured, with or without a blank
 * line in the source. Comments do too, and an unrelated `<!-- TODO -->` must not
 * break the chain: it is invisible in every renderer and deleted by the
 * sanitiser, so letting it change a directive's meaning would make behaviour
 * depend on something no reader can see.
 */
function isSkippable(node: RootContent): boolean {
  if (node.type === "comment" || node.type === "doctype") return true;
  if (node.type === "text") return node.value.trim() === "";
  return false;
}

function headingDepth(node: RootContent): number | undefined {
  if (node.type !== "element") return undefined;
  return HEADING_DEPTHS.get(node.tagName);
}

function setProperty(element: Element, property: string, value: string) {
  element.properties = element.properties ?? ({} as Properties);
  element.properties[property] = value;
}

/**
 * Where a member sits in a stamped run: `only` for a lone block, otherwise
 * `start`, `middle`, `end`. See `VANTAGE_RUNS`.
 */
function runValue(index: number, length: number): string {
  if (length === 1) return "only";
  if (index === 0) return "start";
  return index === length - 1 ? "end" : "middle";
}

/** The closed value set for one key, or `undefined` when the key is unknown. */
function vocabularyOf(name: string, key: string): KeyVocabulary | undefined {
  return DIRECTIVE_VOCABULARY[name]?.[key];
}

function accepts(name: string, key: string, value: string): boolean {
  const values = vocabularyOf(name, key);
  if (values === undefined) return false;
  return values === null || values.includes(value);
}

/**
 * The nodes one style directive reaches, as indexes into its own parent's
 * children — never outside that array, so a directive inside a blockquote or a
 * list item cannot stamp past it.
 *
 * Position picks the target (the next sibling element); the name picks how far
 * the stamp goes. `section` before a heading takes the heading and every
 * following sibling until the first heading of the same or shallower depth;
 * `section` before anything else degrades to that one block, and `block` is
 * always that one block. A heading nested inside a stamped `blockquote` or
 * `li` does not end the section: the walk never descends.
 */
function styleRange(
  children: RootContent[],
  targetIndex: number,
  name: string,
): number[] {
  const range = [targetIndex];
  const depth =
    name === "section" ? headingDepth(children[targetIndex]) : undefined;
  if (depth === undefined) return range;

  for (let i = targetIndex + 1; i < children.length; i++) {
    const node = children[i];
    const nodeDepth = headingDepth(node);
    if (nodeDepth !== undefined && nodeDepth <= depth) break;
    if (node.type === "element" && STYLE_TARGET_TAGS.has(node.tagName)) {
      range.push(i);
    }
  }
  return range;
}

function stampStyle(
  children: RootContent[],
  targetIndex: number,
  name: string,
  pairs: Map<string, string>,
) {
  const target = children[targetIndex] as Element;
  if (!STYLE_TARGET_TAGS.has(target.tagName)) return;

  // Resolve before stamping: a directive whose every key was dropped stamps
  // nothing at all, not even a run marker, so `<!-- vantage: section -->` and
  // `<!-- vantage: section tone=chartreuse -->` are both plain documents.
  const resolved: [string, string][] = [];
  for (const [key, value] of pairs) {
    const property = STYLE_PROPERTIES.get(key);
    if (property === undefined) continue;
    if (!accepts(name, key, value)) continue;
    resolved.push([property, value]);
  }
  if (resolved.length === 0) return;

  const range = styleRange(children, targetIndex, name);
  for (let i = 0; i < range.length; i++) {
    const element = children[range[i]] as Element;
    for (const [property, value] of resolved) {
      setProperty(element, property, value);
    }
    setProperty(element, RUN_PROPERTY, runValue(i, range.length));
  }
}

function stampOq(target: Element, pairs: Map<string, string>) {
  // The string, never the boolean: `rehype-stringify` emits a bare
  // `data-vantage-oq` for `true` while react-markdown emits `="true"`, and D5
  // requires every renderer to emit the same markup.
  setProperty(target, OQ_PROPERTY, "true");

  // `id` resolves and is deliberately not stamped: nothing in the DOM reads it
  // — the button finds its block by `[data-vantage-oq]` and its text by
  // `data-vantage-leaning` — and an attribute nobody reads is a sanitiser entry
  // bought for nothing. It stays in the source for the checker and for `rg`.
  const leaning = pairs.get("leaning");
  if (leaning === undefined) return;
  // A wrapped directive puts newlines and indentation in the value, and this is
  // about to become the body of a review comment, so collapse and cap it.
  const text = leaning.replace(/\s+/g, " ").trim().slice(0, MAX_LEANING);
  if (text !== "") setProperty(target, LEANING_PROPERTY, text);
}

/**
 * Merge one run of directives onto one target, then stamp.
 *
 * Merging is defined on the tree, not on the source: every directive comment up
 * to the target merges, last-key-wins, whether or not blank lines separate
 * them. Measured — adjacent comments and comments separated by a blank line
 * produce byte-identical trees, so a rule that told them apart would have to
 * re-read line numbers to do it.
 */
function stampRun(
  children: RootContent[],
  targetIndex: number,
  run: ParsedDirective[],
) {
  const target = children[targetIndex] as Element;
  const style = new Map<string, string>();
  const oq = new Map<string, string>();
  // The last style directive in the run decides the extent, on the same
  // last-one-wins principle that resolves a repeated key.
  let styleName: string | undefined;
  let hasOq = false;

  for (const directive of run) {
    if (directive.name === "section" || directive.name === "block") {
      styleName = directive.name;
      for (const pair of directive.pairs) style.set(pair.key, pair.value);
    } else if (directive.name === "oq") {
      hasOq = true;
      for (const pair of directive.pairs) oq.set(pair.key, pair.value);
    }
    // Any other name drops the whole directive: there is no target semantics
    // without a name.
  }

  if (styleName !== undefined) {
    stampStyle(children, targetIndex, styleName, style);
  }
  if (hasOq && ANCHOR_TARGET_TAGS.has(target.tagName)) {
    stampOq(target, oq);
  }
}

/** A directive comment, or `undefined` for anything else — malformed included. */
function directiveOf(node: RootContent): ParsedDirective | undefined {
  if (node.type !== "comment") return undefined;
  const parsed = parseVantageDirective(node.value);
  return parsed !== null && parsed.kind === "directive" ? parsed : undefined;
}

/**
 * One left-to-right pass over a parent's children, recursing into elements.
 *
 * The whole tree, not just the root: `rehype-raw` leaves comment nodes inside
 * `blockquote`, inside `li`, inside `td` and inline inside `p`, and the real
 * Open Questions layout puts the `oq` directive inside a list item — so a
 * root-only walk finds none of them.
 *
 * Pass order is also what resolves a nested section: an inner heading's
 * directive necessarily sits at a higher child index than the outer directive
 * that ranged over it, so each property is simply last-write-wins.
 */
function processChildren(parent: Parents) {
  const children = parent.children;
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node.type === "element") {
      processChildren(node);
      i++;
      continue;
    }

    const first = directiveOf(node);
    if (first === undefined) {
      i++;
      continue;
    }

    // Consume the run forward to the first element (the target) or the first
    // non-whitespace text (no target — the directive is inert). One pass, so a
    // run is never processed twice and document order is preserved.
    const run = [first];
    let j = i + 1;
    let targetIndex = -1;
    for (; j < children.length; j++) {
      const next = children[j];
      if (next.type === "element") {
        targetIndex = j;
        break;
      }
      if (!isSkippable(next)) break;
      const directive = directiveOf(next);
      if (directive !== undefined) run.push(directive);
    }

    if (targetIndex >= 0) stampRun(children, targetIndex, run);
    i = j; // resume at the target, or at the blocker — never inside the run
  }
}

const rehypeVantageDirectives: Plugin<[], Root> = () => {
  return (tree: Root) => {
    processChildren(tree);
  };
};

export default rehypeVantageDirectives;
