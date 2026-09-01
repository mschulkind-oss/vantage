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
  VANTAGE_ANCHOR_TARGETS,
  VANTAGE_STYLE_TARGETS,
} from "./vantageDirectives.js";
import type { KeyVocabulary, ParsedDirective } from "./vantageDirectives.js";

/**
 * What a `section`/`block` and an `oq` directive may stamp.
 *
 * Both lists live in `vantageDirectives.ts`, with the reasoning for each tag,
 * because the CLI checker resolves the same question over mdast and must reach
 * the same answer (D5).
 */
const STYLE_TARGET_TAGS = new Set<string>(VANTAGE_STYLE_TARGETS);
const ANCHOR_TARGET_TAGS = new Set<string>(VANTAGE_ANCHOR_TARGETS);

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
 * `collapsed` is not here because it is not one property on one block: it puts a
 * toggle on the heading and a collapsed flag plus a group id on every block the
 * heading hides, which `stampStyle` does with the three properties below.
 */
const STYLE_PROPERTIES = new Map([
  ["tone", "dataVantageTone"],
  ["emphasis", "dataVantageEmphasis"],
  ["badge", "dataVantageBadge"],
]);

const RUN_PROPERTY = "dataVantageRun";
const OQ_PROPERTY = "dataVantageOq";
const LEANING_PROPERTY = "dataVantageLeaning";

/**
 * The three properties `collapsed=true` stamps across a section.
 *
 * The heading takes a *different* attribute from the blocks it hides, and that
 * asymmetry is the whole design (A3): a nested `###` inside a collapsed `##` is
 * both a hidden member of the outer group and the toggle for its own, so one
 * shared attribute would make it permanently invisible and unreachable by
 * either toggle. There is no `<details>` and no wrapper — the run stays a flat
 * list of siblings, which is what keeps review comment cards, the typography
 * plugin's `h2 + *` margin resets and the anchor surface working.
 *
 * Hiding is CSS, and that CSS is gated on a readiness marker the toggle JS sets
 * (`docs/design/inline-markup.md` §4.3): a renderer without the JS — the CLI
 * checker's HTML, an external consumer of this package — shows every block.
 */
const COLLAPSED_PROPERTY = "dataVantageCollapsed";
const COLLAPSE_GROUP_PROPERTY = "dataVantageCollapseGroup";
const COLLAPSE_TOGGLE_PROPERTY = "dataVantageCollapseToggle";

/** A review-comment body, not prose. Bounds the attribute; 500 is generous. */
const MAX_LEANING = 500;

/**
 * Per-tree state. Group ids are `1`, `2`, `3`… in the document order of the
 * headings that own them, so the same document always numbers the same way and
 * an inner section always draws a higher number than the section enclosing it.
 *
 * It lives in the transformer's closure rather than at module scope: a counter
 * shared between trees would renumber a document because another one rendered
 * first, and `renderMarkdown` running twice in one process has to produce
 * byte-identical HTML.
 */
interface CollapseState {
  nextGroup: number;
}

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

/**
 * Whether this directive collapses its section — three ways to say no.
 *
 * `collapsed=false` is a no-op: the token exists so an inner section can cancel
 * an enclosing one, and stamping "not collapsed" is not a thing an attribute can
 * say. A `block` scope is **dropped**, and so is a `section` that degraded onto
 * a non-heading, because both would hide a lone paragraph with nothing left
 * behind to reveal it — content that is simply gone, which is the P1/D8 failure
 * the readiness gate exists to prevent. Only a heading can be a summary.
 */
function collapsesSection(
  name: string,
  pairs: Map<string, string>,
  target: RootContent,
): boolean {
  if (name !== "section") return false;
  if (pairs.get("collapsed") !== "true") return false;
  return headingDepth(target) !== undefined;
}

function stampStyle(
  children: RootContent[],
  targetIndex: number,
  name: string,
  pairs: Map<string, string>,
  state: CollapseState,
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
  const collapses = collapsesSection(name, pairs, target);
  if (resolved.length === 0 && !collapses) return;

  const range = styleRange(children, targetIndex, name);
  // A heading with no body blocks gets no toggle: a caret that hides nothing is
  // an affordance that lies. The counter only advances for a group that exists,
  // so the ids stay dense.
  const group =
    collapses && range.length > 1 ? String(state.nextGroup++) : undefined;

  for (let i = 0; i < range.length; i++) {
    const element = children[range[i]] as Element;
    for (const [property, value] of resolved) {
      setProperty(element, property, value);
    }
    // Only where something was stamped to join up: `run` describes the extent of
    // a tone's rule, and a collapse-only section has no rule to draw.
    if (resolved.length > 0) {
      setProperty(element, RUN_PROPERTY, runValue(i, range.length));
    }
    if (group === undefined) continue;
    if (i === 0) {
      setProperty(element, COLLAPSE_TOGGLE_PROPERTY, group);
    } else {
      setProperty(element, COLLAPSED_PROPERTY, "true");
      setProperty(element, COLLAPSE_GROUP_PROPERTY, group);
    }
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
  state: CollapseState,
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
    stampStyle(children, targetIndex, styleName, style, state);
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
function processChildren(parent: Parents, state: CollapseState) {
  const children = parent.children;
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node.type === "element") {
      processChildren(node, state);
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

    if (targetIndex >= 0) stampRun(children, targetIndex, run, state);
    i = j; // resume at the target, or at the blocker — never inside the run
  }
}

const rehypeVantageDirectives: Plugin<[], Root> = () => {
  return (tree: Root) => {
    processChildren(tree, { nextGroup: 1 });
  };
};

export default rehypeVantageDirectives;
