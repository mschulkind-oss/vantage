// vantage-md — framework-agnostic markdown rendering with line anchors
//
// Usage:
//   import { renderMarkdown, rehypeSourceLines, scrollToLineAnchor } from "vantage-md";
//   import "vantage-md/styles";

export { renderMarkdown } from "./renderMarkdown.js";
export type { RenderOptions, RenderResult } from "./renderMarkdown.js";

export { default as rehypeSourceLines } from "./rehypeSourceLines.js";

export { buildPipeline, buildRemarkPlugins } from "./pipeline.js";
export type { Pipeline, PipelineOptions } from "./pipeline.js";

export {
  scrollToLineAnchor,
  clearLineAnchorHighlights,
} from "./scrollToLineAnchor.js";

export { parseLineAnchor } from "./lineAnchor.js";

export { parseFrontmatter } from "./frontmatter.js";
export type {
  ParsedFrontmatter,
  FrontmatterFormat,
  FrontmatterProblem,
} from "./frontmatter.js";

export { sanitizeSchema, SAFE_STYLE } from "./sanitize.js";

export { renderMermaidBlocks } from "./renderMermaidBlocks.js";
export type { RenderMermaidOptions } from "./renderMermaidBlocks.js";

export { resolveLinks } from "./resolveLinks.js";
export type { ResolveLinkOptions } from "./resolveLinks.js";

export { STYLE_GUIDE } from "./styleGuide.js";
