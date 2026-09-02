/**
 * A consumer of the *published* package, type-checked against the built
 * `dist/` rather than `src/`.
 *
 * This is the contract that actually matters. Everything inside this repo
 * imports vantage-md's TypeScript source — the frontend through a Vite alias,
 * vantage-check by relative path — so nothing here would notice if the emitted
 * declarations were wrong. npm consumers see only `dist/`.
 *
 * It exists to be compiled, not run. `scripts/typecheck-published.mjs` checks
 * it under the oldest TypeScript we support as well as the current one.
 */
import {
  buildPipeline,
  parseFrontmatter,
  parseLineAnchor,
  renderMarkdown,
  renderMermaidBlocks,
  resolveLinks,
  sanitizeSchema,
  STYLE_GUIDE,
} from "vantage-md";
import type {
  Pipeline,
  PipelineOptions,
  RenderMermaidOptions,
  RenderOptions,
  RenderResult,
} from "vantage-md";

export async function render(md: string): Promise<string> {
  const options: RenderOptions = {};
  const result: RenderResult = await renderMarkdown(md, options);
  return result.html;
}

export function pipeline(options: PipelineOptions): Pipeline {
  return buildPipeline(options);
}

export async function mermaid(
  container: HTMLElement,
  options: RenderMermaidOptions,
): Promise<void> {
  await renderMermaidBlocks(container, options);
}

export function misc(md: string): unknown {
  return {
    anchor: parseLineAnchor("#L12"),
    frontmatter: parseFrontmatter(md),
    links: resolveLinks,
    schema: sanitizeSchema,
    guide: STYLE_GUIDE.length,
  };
}
