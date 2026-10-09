// vantage-md — framework-agnostic markdown rendering with line anchors
//
// Usage:
//   import { renderMarkdown, rehypeSourceLines, scrollToLineAnchor } from "vantage-md";
//   import "vantage-md/styles";
//
// Directives (`<!-- vantage: … -->`), the render chain and the sanitizer —
// architecture and invariants: docs/reference/inline-markup.md
// `renderMarkdown`'s `tree` option, which lets vantage-check's rules share the
// parse of each file — architecture and invariants:
// docs/reference/check-performance.md

export { renderMarkdown } from "./renderMarkdown.js";
// GFM alerts: the vocabulary and its labels, so a consumer styling them reads
// the same closed list the plugin compiles against.
export {
  ALERT_TITLES,
  VANTAGE_ALERTS,
  rehypeVantageAlerts,
} from "./rehypeVantageAlerts.js";
export type { VantageAlert } from "./rehypeVantageAlerts.js";
export type { RenderOptions, RenderResult } from "./renderMarkdown.js";

export { default as rehypeSourceLines } from "./rehypeSourceLines.js";

export { default as rehypeVantageDirectives } from "./rehypeVantageDirectives.js";
export { default as rehypeVantageAnchors } from "./rehypeVantageAnchors.js";

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
  VANTAGE_OQ_HOST_TARGETS,
  VANTAGE_OQ_STATUS,
  VANTAGE_OQ_STATUS_LABEL,
  VANTAGE_QUESTION_NAMES,
  VANTAGE_RUNS,
  VANTAGE_SENTINEL,
  VANTAGE_TONES,
  hasVantageSentinel,
  isQuestionDirective,
  parseVantageDirective,
  questionOffersTake,
  vantageOqStatus,
} from "./vantageDirectives.js";
// The rendered-attribute contract for questions, which the viewer and any
// other reader of this package's markup find a question by: every question
// carries `data-vantage-question`, one declared with `oq` carries
// `data-vantage-oq` besides, and its leaning is `data-vantage-leaning`.
export {
  VANTAGE_LEANING_ATTRIBUTE,
  VANTAGE_OQ_ATTRIBUTE,
  VANTAGE_QUESTION_ATTRIBUTE,
  VANTAGE_QUESTION_SELECTOR,
} from "./vantageDirectives.js";
export type {
  DirectiveParse,
  DirectivePair,
  DirectiveVocabulary,
  KeyTable,
  KeyVocabulary,
  MalformedDirective,
  ParsedDirective,
  VantageOqStatus,
  VantageQuestionName,
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

// The `vantage:` frontmatter key — file-scoped chrome. Same split as the
// directive vocabulary above: one reader, shared by the viewers and (by relative
// path, not by package name) the CLI checker.
export {
  DOC_STATUSES,
  DOC_STATUS_TONES,
  VANTAGE_FRONTMATTER_KEYS,
  isDocStatus,
  readVantageFrontmatter,
} from "./vantageFrontmatter.js";
export type {
  DocStatus,
  VantageFrontmatter,
  VantageFrontmatterIssue,
} from "./vantageFrontmatter.js";

export { sanitizeSchema, SAFE_STYLE } from "./sanitize.js";

export { renderMermaidBlocks } from "./renderMermaidBlocks.js";
// The attributes on `<html>` that name the active color theme. The viewer sets
// them and the mermaid code reads them to key and redraw diagrams, so both
// sides import one copy: a rename on only one side would silently stop
// diagrams following a theme switch.
export {
  COLOR_THEME_ATTRIBUTE,
  COLOR_THEME_SOURCE_ATTRIBUTE,
  currentColorTheme,
} from "./mermaidTheme.js";
export type { RenderMermaidOptions } from "./renderMermaidBlocks.js";

export { resolveLinks } from "./resolveLinks.js";
export type { ResolveLinkOptions } from "./resolveLinks.js";

export {
  STYLE_GUIDE,
  ANSWER_PROCESSING_GUIDE,
  COMPACTION_RULE,
} from "./styleGuide.js";
