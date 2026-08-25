/**
 * Read-side analysis of the Vantage rendering pipeline.
 *
 * These functions run the *same* plugin chain the viewer uses and expose the
 * intermediate trees, so a consumer (the vantage-check CLI) can validate a
 * document against exactly what Vantage would render — not an approximation.
 *
 * Both take a markdown *body* (frontmatter already stripped) so they see
 * precisely what `renderMarkdown` renders.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { visit } from "unist-util-visit";
import type { Root as MdastRoot } from "mdast";
import type { Root as HastRoot } from "hast";
import { sanitizeSchema } from "./sanitize.js";

// The remark plugins the viewer enables (renderMarkdown defaults). Shared by
// both analyses so they agree on what a "document" parses to.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REMARK_PLUGINS: [any, ...any[]][] = [
  [remarkGfm, { singleTilde: false }],
  [remarkMath, { singleDollarTextMath: false }],
];

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Parse a markdown body into a mdast tree, with the viewer's remark plugins
 * (GFM + math) applied, so GFM autolinks and math nodes are present. This is
 * the tree the link rules walk.
 */
export function parseToMdast(body: string): MdastRoot {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processor: any = unified().use(remarkParse);
  for (const [plugin, ...args] of REMARK_PLUGINS) {
    processor = processor.use(plugin, ...args);
  }
  const tree = processor.parse(body);
  return processor.runSync(tree) as MdastRoot;
}

/**
 * Return the heading `id`s the Vantage viewer would assign to `body`, in
 * document order. Runs the viewer's exact remark→rehype chain through
 * `rehype-slug` and reads the ids off the resulting hast, so this is
 * byte-for-byte what the rendered page exposes — including the `-1`/`-2`
 * de-duplication of repeated heading text.
 */
export function headingIds(body: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processor: any = unified().use(remarkParse);
  for (const [plugin, ...args] of REMARK_PLUGINS) {
    processor = processor.use(plugin, ...args);
  }
  processor = processor.use(remarkRehype, { allowDangerousHtml: true });
  processor = processor.use(rehypeRaw);
  processor = processor.use(rehypeSanitize, sanitizeSchema);
  processor = processor.use(rehypeSlug);
  const tree = processor.parse(body);
  const hast = processor.runSync(tree) as HastRoot;

  const ids: string[] = [];
  visit(hast, "element", (node) => {
    if (!HEADING_TAGS.has(node.tagName)) return;
    const id = node.properties?.id;
    if (typeof id === "string") ids.push(id);
  });
  return ids;
}
