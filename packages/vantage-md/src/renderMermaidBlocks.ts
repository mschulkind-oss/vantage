/**
 * Client-side utility to find and render mermaid code blocks in a container.
 *
 * After calling `renderMarkdown()`, mermaid blocks come through as
 * `<pre><code class="language-mermaid">...</code></pre>`. This function
 * finds those blocks and replaces them with rendered SVG diagrams.
 *
 * It also draws diagrams ahead of a render: `mermaidFences` reads them out of
 * Markdown and `prerenderMermaid` puts each in the SVG cache, where the React
 * `MermaidDiagram` finds it on mount.
 *
 * Framework-agnostic — works in any browser environment.
 */

import type { Code } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { getCachedSvg, hasCachedSvg, setCachedSvg } from "./mermaidCache.js";
import { getMermaid } from "./mermaidLoader.js";
import { currentMermaidPalette } from "./mermaidTheme.js";
import { buildRemarkPlugins } from "./remarkPlugins.js";

export interface RenderMermaidOptions {
  /** CSS class to add to the SVG wrapper div (default: "mermaid") */
  className?: string;
  /** Called when a diagram fails to render */
  onError?: (code: string, error: Error) => void;
}

/**
 * Find all `<pre><code class="language-mermaid">` blocks in a container
 * and replace them with rendered SVG diagrams.
 *
 * @param container - DOM element containing rendered markdown HTML
 * @param options - Optional configuration
 * @returns Promise that resolves when all diagrams are rendered
 *
 * @example
 * ```ts
 * import { renderMarkdown, renderMermaidBlocks } from "vantage-md";
 *
 * const { html } = await renderMarkdown(content);
 * container.innerHTML = html;
 * await renderMermaidBlocks(container);
 * ```
 */
export async function renderMermaidBlocks(
  container: HTMLElement,
  options: RenderMermaidOptions = {},
): Promise<void> {
  const { className = "mermaid", onError } = options;

  const codeBlocks = container.querySelectorAll(
    'pre > code.language-mermaid, pre > code[class*="language-mermaid"]',
  );
  if (codeBlocks.length === 0) return;

  // Loaded on the first cache miss, not up front: mermaid is the heaviest
  // dependency in the package, and a container whose every diagram is already
  // in `svgCache` — the common case on a re-render — has no use for it.
  let loading: Promise<Awaited<ReturnType<typeof getMermaid>>> | undefined;
  const mermaidOnce = () => (loading ??= getMermaid());

  const renderPromises = Array.from(codeBlocks).map(async (codeEl) => {
    const preEl = codeEl.parentElement;
    if (!preEl) return;

    const code = codeEl.textContent || "";
    if (!code.trim()) return;

    // Check cache first. Keyed by theme as well as code — the same fence
    // renders to a different SVG in each palette.
    const cached = getCachedSvg(code);
    if (cached) {
      replaceWithSvg(preEl, cached, className);
      return;
    }

    try {
      const mermaid = await mermaidOnce();
      // Generate a stable ID from code hash
      let hash = 0;
      for (let i = 0; i < code.length; i++) {
        hash = (hash << 5) - hash + code.charCodeAt(i);
        hash = hash & hash;
      }
      const id = `mermaid-${Math.abs(hash).toString(36)}-${Date.now()}`;

      const { svg } = await mermaid.render(id, code);
      setCachedSvg(code, svg);
      replaceWithSvg(preEl, svg, className);
    } catch (err) {
      if (onError) {
        onError(code, err instanceof Error ? err : new Error(String(err)));
      }
    }
  });

  await Promise.all(renderPromises);
}

/**
 * Attributes the wrapper inherits from the `<pre>` it replaces.
 *
 * The splice is the same shape of problem `rehypeVantageMathStamps` solves for
 * KaTeX: the pipeline stamped the fence, and swapping the element out throws
 * the stamps away. A mermaid diagram inside a toned section then drew no slice
 * of the section's vertical rule, leaving a hole as tall as the diagram; a
 * collapsed section left the diagram visible under a closed heading; and a
 * `#L` anchor pointing at the fence resolved to nothing.
 *
 * Named individually rather than copied wholesale: `class` is the caller's
 * (`className`), and `id` would be duplicated onto a second element.
 */
const CARRIED_ATTRIBUTES = [
  "data-source-line",
  "data-vantage-tone",
  "data-vantage-emphasis",
  "data-vantage-run",
  "data-vantage-collapsed",
  "data-vantage-collapse-group",
];

function replaceWithSvg(
  preEl: HTMLElement,
  svg: string,
  className: string,
): void {
  const wrapper = document.createElement("div");
  wrapper.className = className;
  for (const name of CARRIED_ATTRIBUTES) {
    const value = preEl.getAttribute(name);
    if (value !== null) wrapper.setAttribute(name, value);
  }
  wrapper.innerHTML = svg;
  preEl.replaceWith(wrapper);
}

/* ------------------------------------------------------------------ *
 * Drawing ahead of a render
 * ------------------------------------------------------------------ */

/** The viewer's parser: the remark half of `buildPipeline`. */
const fenceParser = unified().use(remarkParse).use(buildRemarkPlugins());

/**
 * The code of every Mermaid fence in `markdown`, in source order, exactly as
 * a viewer's `MermaidDiagram` receives it: the fence's content, without its
 * container's indentation or its closing newline.
 *
 * A fence is a diagram when its info string's first word begins with the word
 * `mermaid`, which is the test the viewer applies to the `language-…` class
 * the fence renders with (`/language-(\w+)/`). Text that never says
 * `mermaid` is not parsed at all.
 */
export function mermaidFences(markdown: string): string[] {
  if (!markdown.includes("mermaid")) return [];
  const codes: string[] = [];
  visit(fenceParser.parse(markdown), "code", (node: Code) => {
    if (/^\w+/.exec(node.lang ?? "")?.[0] === "mermaid") codes.push(node.value);
  });
  return codes;
}

/** Draws under way, by palette and code, so asking twice draws once. */
const drawing = new Map<string, Promise<void>>();
let drawn = 0;

/**
 * Draw one diagram into the SVG cache that `MermaidDiagram` reads when it
 * mounts, so a diagram rendered after this has settled is drawn at its full
 * size on its first paint instead of growing into place once Mermaid answers.
 * The planning page draws every diagram of the cards it is about to show this
 * way, before it commits them.
 *
 * Mermaid is loaded through `getMermaid`, so the drawing is configured, and
 * made safe, exactly as every other diagram of the page is. `theme` is the
 * palette key (`currentMermaidPalette`) to draw for; when the page has moved
 * to another palette by the time Mermaid is ready, nothing is cached, since
 * Mermaid now draws for the page's palette and not for `theme`.
 *
 * Resolves once the diagram is in the cache, at once when it already was, and
 * rejects when Mermaid cannot draw it.
 */
export function prerenderMermaid(
  code: string,
  theme: string = currentMermaidPalette(),
): Promise<void> {
  if (!code.trim() || hasCachedSvg(code, theme)) return Promise.resolve();
  const key = `${theme}\u0000${code}`;
  let pending = drawing.get(key);
  if (pending === undefined) {
    pending = (async () => {
      const mermaid = await getMermaid();
      if (currentMermaidPalette() !== theme) return;
      const { svg } = await mermaid.render(
        `mermaid-ahead-${(++drawn).toString(36)}`,
        code,
      );
      setCachedSvg(code, svg, theme);
    })().finally(() => drawing.delete(key));
    drawing.set(key, pending);
  }
  return pending;
}
