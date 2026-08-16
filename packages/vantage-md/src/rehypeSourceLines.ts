/**
 * Rehype plugin that adds `data-source-line` attributes to block-level
 * elements based on their position in the original markdown source.
 *
 * This enables GitHub-style line anchors (#L42, #L42-L50) by giving
 * each rendered block a traceable line number from the source.
 */

import type { Root, Element } from "hast";
import type { Plugin } from "unified";

const BLOCK_TAGS = new Set([
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

export interface RehypeSourceLinesOptions {
  /**
   * Lines stripped off the front of the file before parsing — frontmatter,
   * essentially. Added to every emitted line number so `data-source-line`
   * names a line in the *file* rather than in the parsed body, which is what
   * a `#L42` link written against the file means. Defaults to 0.
   */
  offset?: number;
}

function visit(node: Root | Element, offset: number) {
  if ("children" in node) {
    for (const child of node.children) {
      if (child.type === "element") {
        if (BLOCK_TAGS.has(child.tagName) && child.position?.start?.line) {
          child.properties = child.properties || {};
          child.properties["dataSourceLine"] =
            child.position.start.line + offset;
        }
        visit(child, offset);
      }
    }
  }
}

const rehypeSourceLines: Plugin<[RehypeSourceLinesOptions?], Root> = (
  options,
) => {
  const offset = options?.offset ?? 0;
  return (tree: Root) => {
    visit(tree, offset);
  };
};

export default rehypeSourceLines;
