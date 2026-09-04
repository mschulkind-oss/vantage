/**
 * `renderMermaidBlocks` replaces the `<pre>` a fence rendered to, and a splice
 * that drops attributes drops the stamps the pipeline put there.
 *
 * The same shape of bug `rehypeVantageMathStamps` exists for: a mermaid diagram
 * inside a toned section drew no slice of the section's vertical rule, so the
 * rule had a hole as tall as the diagram; `collapsed=true` left the diagram on
 * the page under a closed heading; and `#L42` pointing at the fence resolved to
 * nothing.
 *
 * Every case here pre-seeds `svgCache`, which is what keeps mermaid itself —
 * the heaviest dependency in the package — out of the test: `renderMermaidBlocks`
 * loads it on the first cache miss and not before.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderMermaidBlocks } from "vantage-md";
import {
  svgCache,
  clearMermaidCache,
} from "../../../packages/vantage-md/src/mermaidCache";

const CODE = "graph LR\n  A --> B";
const SVG = '<svg id="rendered"></svg>';

/** One fence, as `renderMarkdown` emits it, with whatever stamps a test wants. */
function fence(attributes: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML =
    `<p>Before.</p>` +
    `<pre ${attributes}><code class="language-mermaid">${CODE}</code></pre>` +
    `<p>After.</p>`;
  return container;
}

describe("renderMermaidBlocks carries the pipeline's stamps across the splice", () => {
  beforeEach(() => {
    clearMermaidCache();
    svgCache.set(CODE, SVG);
  });

  it("replaces the fence with the rendered diagram", async () => {
    const container = fence("");
    await renderMermaidBlocks(container);

    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("div.mermaid svg")).not.toBeNull();
  });

  it("keeps the diagram a member of its section's run", async () => {
    const container = fence(
      'data-vantage-tone="note" data-vantage-run="middle"',
    );
    await renderMermaidBlocks(container);

    const wrapper = container.querySelector("div.mermaid")!;
    expect(wrapper.getAttribute("data-vantage-tone")).toBe("note");
    expect(wrapper.getAttribute("data-vantage-run")).toBe("middle");
  });

  it("keeps a collapsed diagram hidden with the rest of its group", async () => {
    const container = fence(
      'data-vantage-collapsed="true" data-vantage-collapse-group="3"',
    );
    await renderMermaidBlocks(container);

    const wrapper = container.querySelector("div.mermaid")!;
    expect(wrapper.getAttribute("data-vantage-collapsed")).toBe("true");
    expect(wrapper.getAttribute("data-vantage-collapse-group")).toBe("3");
  });

  it("keeps the line anchor, so `#L42` still resolves", async () => {
    const container = fence('data-source-line="42"');
    await renderMermaidBlocks(container);

    expect(
      container.querySelector("div.mermaid")!.getAttribute("data-source-line"),
    ).toBe("42");
  });

  it("keeps the emphasis, which sets the slice's width", async () => {
    const container = fence('data-vantage-emphasis="strong"');
    await renderMermaidBlocks(container);

    expect(
      container
        .querySelector("div.mermaid")!
        .getAttribute("data-vantage-emphasis"),
    ).toBe("strong");
  });

  it("takes the caller's class rather than the fence's", async () => {
    const container = fence('class="hljs" data-vantage-tone="tip"');
    await renderMermaidBlocks(container, { className: "diagram" });

    const wrapper = container.querySelector("div.diagram")!;
    expect(wrapper.className).toBe("diagram");
    expect(wrapper.getAttribute("data-vantage-tone")).toBe("tip");
  });

  it("stamps nothing on a fence that carried nothing", async () => {
    const container = fence("");
    await renderMermaidBlocks(container);

    const wrapper = container.querySelector("div.mermaid")!;
    expect(wrapper.getAttributeNames()).toEqual(["class"]);
  });
});
