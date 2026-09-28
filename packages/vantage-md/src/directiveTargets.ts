/**
 * Where a directive lands, read from mdast — the host-target rules.
 *
 * `rehypeVantageDirectives` resolves a directive over hast: skip whitespace and
 * comments among its parent's children, stop at the first element, and stamp it
 * if its tag is on the name's target list. Two callers have to predict that
 * answer from an mdast tree, where there is no hast to ask: the checker's
 * `vantage/orphan`, which reports a directive that stamps nothing, and the
 * planning index's scan, which counts an `oq` directive as a question only when
 * it yields a button. If the two predicted differently, the gate would pass a
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
