/**
 * Framework-agnostic markdown -> HTML rendering pipeline.
 * Uses the same remark/rehype chain as the Vantage viewer.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import rehypeSourceLines from "./rehypeSourceLines.js";
import { sanitizeSchema } from "./sanitize.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { ParsedFrontmatter } from "./frontmatter.js";

export interface RenderOptions {
  /** Enable GFM tables, strikethrough, task lists (default: true) */
  gfm?: boolean;
  /** Enable KaTeX math rendering (default: true) */
  math?: boolean;
  /** Enable syntax highlighting (default: true) */
  highlight?: boolean;
  /** Add data-source-line attributes for line anchors (default: true) */
  sourceLines?: boolean;
  /** Enable XSS sanitization (default: true) */
  sanitize?: boolean;
  /** Parse and strip frontmatter (default: true) */
  frontmatter?: boolean;
}

export interface RenderResult {
  /** The rendered HTML string */
  html: string;
  /** Parsed frontmatter (empty object if none or disabled) */
  frontmatter: Record<string, unknown>;
  /** The markdown body with frontmatter stripped */
  body: string;
}

/**
 * Render a markdown string to HTML using the full Vantage pipeline.
 *
 * Features (all enabled by default):
 * - GitHub Flavored Markdown (tables, strikethrough, task lists)
 * - KaTeX math rendering, inline and block ($$...$$ only; single $ is not a delimiter)
 * - Syntax highlighting via highlight.js
 * - `data-source-line` attributes for line anchors
 * - XSS sanitization
 * - Heading slugs/anchors
 * - YAML/TOML frontmatter parsing
 *
 * Mermaid diagrams are NOT rendered server-side (they require a browser).
 * Mermaid code blocks are preserved as `<pre><code class="language-mermaid">`.
 * Use the React `<MarkdownViewer>` component for client-side mermaid rendering.
 */
export async function renderMarkdown(
  content: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const {
    gfm = true,
    math = true,
    highlight = true,
    sourceLines = true,
    sanitize = true,
    frontmatter: parseFm = true,
  } = options;

  // Parse frontmatter
  let parsed: ParsedFrontmatter;
  if (parseFm) {
    parsed = parseFrontmatter(content);
  } else {
    parsed = {
      frontmatter: {},
      body: content,
      format: "none",
      bodyLineOffset: 0,
    };
  }

  // Build the unified pipeline using a single chain.
  // We use `any` for the processor to avoid unified's strict generic
  // type constraints that make conditional plugin registration painful.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const remarkPlugins: [any, ...any[]][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rehypePlugins: [any, ...any[]][] = [];

  if (gfm) remarkPlugins.push([remarkGfm, { singleTilde: false }]);
  if (math) remarkPlugins.push([remarkMath, { singleDollarTextMath: false }]);

  rehypePlugins.push([rehypeRaw]);
  if (sourceLines)
    rehypePlugins.push([
      rehypeSourceLines,
      { offset: parsed.bodyLineOffset },
    ]);
  if (sanitize) rehypePlugins.push([rehypeSanitize, sanitizeSchema]);
  rehypePlugins.push([rehypeSlug]);
  if (highlight) rehypePlugins.push([rehypeHighlight]);
  if (math) rehypePlugins.push([rehypeKatex]);

  // Build the processor. We type as `any` because unified's generic
  // Processor type changes shape with every .use() call, making
  // conditional plugin registration impractical with strict types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processor: any = unified().use(remarkParse);
  for (const [plugin, ...args] of remarkPlugins) {
    processor = processor.use(plugin, ...args);
  }
  processor = processor.use(remarkRehype, { allowDangerousHtml: true });
  for (const [plugin, ...args] of rehypePlugins) {
    processor = processor.use(plugin, ...args);
  }
  processor = processor.use(rehypeStringify);

  const result = await processor.process(parsed.body);

  return {
    html: String(result),
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}
