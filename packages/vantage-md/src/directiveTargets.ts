/**
 * Where a directive lands, read from mdast — the host-target rules.
 *
 * `rehypeVantageDirectives` resolves a directive over hast: skip whitespace and
 * comments among its parent's children, stop at the first element, and stamp it
 * if its tag is on the name's target list. Two callers have to predict that
 * answer from an mdast tree, where there is no hast to ask: the checker's
 * `vantage/orphan`, which reports a directive that stamps nothing, and the
 * planning index's scan, which counts a question directive (`oq` or
 * `question`) as a question only where an `oq` would yield a button. If the two
 * predicted differently, the gate would pass a
 * question the index could not see, or the reverse, so they share these
 * helpers (D5).
 *
 * Moved here from `vantage-check/src/rules/directives.ts`, unchanged, when the
 * planning scan became the second caller. Every rule below was measured against
 * the real chain when it was written there; the comments keep those notes.
 */

import type { List, RootContent } from "mdast";
import { scanComments } from "./htmlComments.js";
import type { Segment } from "./htmlComments.js";
import { VANTAGE_FALLBACK_TARGETS } from "./vantageDirectives.js";

/** mdast parents whose children become sibling *blocks* in hast. */
export const BLOCK_PARENTS = new Set([
  "root",
  "blockquote",
  "listItem",
  "footnoteDefinition",
]);

/** mdast parents whose children are inline, where nothing is ever stamped. */
export const PHRASING_PARENTS = new Set([
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
]);

/**
 * What comes after the last directive *inside its own html node*.
 *
 * `"end"` — nothing but whitespace and other comments, so the run continues
 * into the node's mdast siblings. `"text"` — literal text, which the plugin
 * stops at (measured: `<!-- vantage: block tone=note --> trailing` stamps
 * nothing). `"markup"` — a tag we cannot resolve from mdast; say nothing.
 */
export function nextContentInNode(
  segments: Segment[],
  lastDirective: number,
): "end" | "text" | "markup" {
  for (let i = lastDirective + 1; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined || segment.kind === "comment") continue;
    const rest = segment.value.trim();
    if (rest === "") continue;
    return rest.startsWith("<") ? "markup" : "text";
  }
  return "end";
}

/**
 * The sibling a directive attaches to, `undefined` for none, `"unknown"` when
 * the tree does not settle it.
 *
 * Two node types are skipped because `remark-rehype` does not leave them where
 * they were, both verified by running the real chain: a `definition`
 * (`[ref]: ./x.md`) produces no HTML at all, and a `footnoteDefinition` is
 * hoisted into a `<section>` at the end of the document. A comment-only `html`
 * sibling is skipped too — consecutive directives merge onto one target, and an
 * editorial `<!-- TODO -->` between a directive and its block must not change
 * what the directive means, because no reader can see it.
 */
export function nextBlock(
  children: RootContent[],
  index: number,
): RootContent | undefined | "unknown" {
  for (let i = index + 1; i < children.length; i++) {
    const sibling = children[i];
    if (sibling === undefined) return undefined;
    if (sibling.type === "definition") continue;
    if (sibling.type === "footnoteDefinition") continue;
    if (sibling.type === "html") {
      if (isCommentOnly(sibling.value)) continue;
      return "unknown";
    }
    return sibling;
  }
  return undefined;
}

/** Nothing but comments and whitespace, so hast sees no element here. */
export function isCommentOnly(raw: string): boolean {
  const segments = scanComments(raw);
  let comments = 0;
  for (const segment of segments) {
    if (segment.kind === "comment") {
      comments++;
      continue;
    }
    if (segment.value.trim() !== "") return false;
  }
  return comments > 0;
}

/**
 * The hast tag an mdast block becomes, or `undefined` when it is not worth
 * predicting.
 *
 * `math` is the interesting one: with math enabled — which is what both viewers
 * and this checker's own parser do — a `$$…$$` block renders as
 * `<span class="katex-display">`. That span *is* stamped (see `STYLE_TARGETS`),
 * so predicting it is not about reporting an orphan any more; it is about naming
 * the shape in the `oq` message, where a formula is still no host for a button.
 * Measured, not assumed.
 */
export function targetTag(node: RootContent): string | undefined {
  switch (node.type) {
    case "paragraph":
      return "p";
    case "heading":
      return `h${Math.min(Math.max(node.depth, 1), 6)}`;
    case "blockquote":
      return "blockquote";
    case "code":
      return "pre";
    case "list":
      return node.ordered === true ? "ol" : "ul";
    case "table":
      return "table";
    case "thematicBreak":
      return "hr";
    case "math":
      return "span";
    default:
      return undefined;
  }
}

/**
 * Is this list loose? `mdast-util-to-hast`'s own rule, copied deliberately.
 *
 * In a *tight* list the `<p>` wrapper around every item's paragraphs is
 * removed, so a directive inside a tight item has no paragraph to stamp. One
 * loose item makes the whole list loose, which is why this cannot be answered
 * from the item alone.
 */
export function listIsLoose(list: List): boolean {
  if (list.spread === true) return true;
  return list.children.some((item) =>
    item.spread === null || item.spread === undefined
      ? item.children.length > 1
      : item.spread,
  );
}

/**
 * What a `fallback` run withholds, as `targetTag` names it:
 * `VANTAGE_FALLBACK_TARGETS` plus `span`, which is display math and nothing
 * else. A `$$…$$` block is still a `<pre>` when the plugin runs, so a fallback
 * withholds it, and `targetTag` names it by what `rehype-katex` makes of it
 * afterwards.
 *
 * Two callers predict the plugin with it and must agree: the planning scan,
 * which reads no question and no link from a withheld block, and the
 * checker's `vantage/orphan`, which reports a fallback that withholds nothing.
 */
const FALLBACK_TAGS = new Set<string>([...VANTAGE_FALLBACK_TARGETS, "span"]);

/** Does a `fallback` run withhold a block `targetTag` names `tag`? */
export function isFallbackTarget(tag: string | undefined): boolean {
  return tag !== undefined && FALLBACK_TAGS.has(tag);
}

/**
 * The tag of the element raw HTML opens with, lowercased, or `undefined` when
 * it does not open with a tag: text, a closing tag, a declaration. That
 * element is what `rehype-raw` builds where the raw block stands, so it is
 * what a directive above the block lands on (Plan Q17: mdast cannot see
 * further into it).
 */
export function rawOpeningTag(raw: string): string | undefined {
  return /^<([A-Za-z][A-Za-z0-9-]*)/.exec(raw.trim())?.[1]?.toLowerCase();
}

/** Does a `fallback` run withhold a raw-HTML element with this tag? */
export function isRawFallbackTarget(tag: string | undefined): boolean {
  return tag !== undefined && RAW_FALLBACK_TAGS.has(tag);
}

/** `VANTAGE_FALLBACK_TARGETS` as raw HTML writes them: no math there. */
const RAW_FALLBACK_TAGS = new Set<string>(VANTAGE_FALLBACK_TARGETS);

/**
 * Tags on the fallback list whose element never reaches past its own node:
 * `hr` is void, and a `<p>` is closed by the parser at the first block a blank
 * line starts inside it.
 */
const OWN_NODE_TAGS = new Set(["hr", "p"]);

/**
 * The index of the last of `children` that the raw element opened at
 * `start` holds, counting from `from` in that node's text.
 *
 * Raw HTML with blank lines in it is several mdast siblings: the `html` node
 * that opens `<div>`, the Markdown blocks inside it, and the `html` node that
 * closes it. `rehype-raw` builds them into one element, so a `fallback` above
 * the opening tag withholds every one of them. The element ends where its tag
 * closes, counting the same tag nested inside it; one never closed runs to the
 * end of its parent, as the HTML parser keeps it open.
 */
export function rawElementEnd(
  children: RootContent[],
  start: number,
  tag: string,
  from = 0,
): number {
  if (OWN_NODE_TAGS.has(tag)) return start;
  const open = new RegExp(`<${tag}(?=[\\s/>])[^>]*?(/?)>`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 0;
  for (let i = start; i < children.length; i++) {
    const child = children[i];
    if (child?.type !== "html") continue;
    for (const segment of scanComments(child.value)) {
      if (segment.kind !== "text") continue;
      if (i === start && segment.offset < from) continue;
      const events: { at: number; delta: number }[] = [];
      for (const match of segment.value.matchAll(open)) {
        if (match[1] !== "/") events.push({ at: match.index, delta: 1 });
      }
      for (const match of segment.value.matchAll(close)) {
        events.push({ at: match.index, delta: -1 });
      }
      events.sort((a, b) => a.at - b.at);
      for (const { delta } of events) {
        depth += delta;
        if (depth <= 0) return i;
      }
    }
  }
  return children.length - 1;
}
