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
import {
  DEFAULT_PLANNING_CONFIG,
  buildPlanningIndex,
  derivePlanningSections,
  scanPlanningDocument,
} from "vantage-md/planning";
import type {
  PlanningDocument,
  PlanningSections,
} from "vantage-md/planning";

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

/** The planning entry, consumed the way an npm user would: from `dist/`. */
export function scanPlan(md: string): PlanningDocument | null {
  const result = scanPlanningDocument("docs/design/example.md", md, false);
  return result.kind === "planning" ? result.document : null;
}

export function planSections(
  files: { path: string; content: string }[],
): PlanningSections {
  return derivePlanningSections(
    buildPlanningIndex({
      config: DEFAULT_PLANNING_CONFIG,
      candidateCount: files.length,
      refused: false,
      files,
      skipped: [],
      unreadable: [],
    }),
  );
}
