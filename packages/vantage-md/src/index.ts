// vantage-md — framework-agnostic markdown rendering with line anchors
//
// Usage:
//   import { renderMarkdown, rehypeSourceLines, scrollToLineAnchor } from "vantage-md";
//   import "vantage-md/styles";

export { renderMarkdown } from "./renderMarkdown.js";
export type { RenderOptions, RenderResult } from "./renderMarkdown.js";

export { default as rehypeSourceLines } from "./rehypeSourceLines.js";

export { default as rehypeVantageDirectives } from "./rehypeVantageDirectives.js";

// The directive grammar and vocabulary, with no renderer attached. The CLI
// checker imports the module by relative path (it must not depend on this
// package's build), so these re-exports are for the frontend and for anyone
// validating directives without a hast tree.
export {
  DIRECTIVE_NAMES,
  DIRECTIVE_VOCABULARY,
  VANTAGE_BADGES,
  VANTAGE_COLLAPSED,
  VANTAGE_EMPHASIS,
  VANTAGE_RUNS,
  VANTAGE_SENTINEL,
  VANTAGE_TONES,
  hasVantageSentinel,
  parseVantageDirective,
} from "./vantageDirectives.js";
export type {
  DirectiveParse,
  DirectivePair,
  DirectiveVocabulary,
  KeyTable,
  KeyVocabulary,
  MalformedDirective,
  ParsedDirective,
} from "./vantageDirectives.js";

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
