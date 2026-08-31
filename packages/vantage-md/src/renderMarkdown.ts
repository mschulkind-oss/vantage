/**
 * Framework-agnostic markdown -> HTML rendering pipeline.
 * Uses the same remark/rehype chain as the Vantage viewer.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { buildPipeline } from "./pipeline.js";
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

  // One chain, defined in ./pipeline.ts and shared with both React viewers —
  // the checker must not render through a different pipeline than the app.
  const { remarkPlugins, rehypePlugins } = buildPipeline({
    gfm,
    math,
    highlight,
    sourceLines,
    sanitize,
    bodyLineOffset: parsed.bodyLineOffset,
  });

  // `allowDangerousHtml` is why raw HTML reaches `rehypeRaw` at all.
  const processor = unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypePlugins)
    .use(rehypeStringify);

  const result = await processor.process(parsed.body);

  return {
    html: String(result),
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}
