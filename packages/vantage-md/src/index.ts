// vantage-md — framework-agnostic markdown rendering with line anchors
//
// Usage:
//   import { renderMarkdown, rehypeSourceLines, scrollToLineAnchor } from "vantage-md";
//   import "vantage-md/styles";

export { renderMarkdown } from "./renderMarkdown.js";
export type { RenderOptions, RenderResult } from "./renderMarkdown.js";

export { default as rehypeSourceLines } from "./rehypeSourceLines.js";

export {
  scrollToLineAnchor,
  clearLineAnchorHighlights,
  parseLineAnchor,
} from "./scrollToLineAnchor.js";

export { parseFrontmatter } from "./frontmatter.js";
export type { ParsedFrontmatter, FrontmatterFormat } from "./frontmatter.js";

export { sanitizeSchema } from "./sanitize.js";

export { renderMermaidBlocks } from "./renderMermaidBlocks.js";
export type { RenderMermaidOptions } from "./renderMermaidBlocks.js";

export { parseToMdast, headingIds } from "./analyze.js";

export { resolveLinks } from "./resolveLinks.js";
export type { ResolveLinkOptions } from "./resolveLinks.js";

export { STYLE_GUIDE_SNIPPET } from "./styleGuide.js";
