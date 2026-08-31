// vantage-md/react — React components and hooks
//
// Usage:
//   import { MarkdownViewer, useLineAnchor } from "vantage-md/react";
//   import "vantage-md/styles";

export { MarkdownViewer } from "./MarkdownViewer.js";
export type { MarkdownViewerProps } from "./MarkdownViewer.js";

export { useLineAnchor } from "./useLineAnchor.js";

export { MermaidDiagram } from "./MermaidDiagram.js";
export { FrontmatterDisplay } from "./FrontmatterDisplay.js";

// Re-export core utilities so React consumers don't need a second import
export {
  renderMarkdown,
  rehypeSourceLines,
  buildPipeline,
  buildRemarkPlugins,
  scrollToLineAnchor,
  clearLineAnchorHighlights,
  parseLineAnchor,
  parseFrontmatter,
  sanitizeSchema,
  renderMermaidBlocks,
  resolveLinks,
} from "./index.js";

export type {
  RenderOptions,
  RenderResult,
  Pipeline,
  PipelineOptions,
  ParsedFrontmatter,
  FrontmatterFormat,
  RenderMermaidOptions,
  ResolveLinkOptions,
} from "./index.js";
