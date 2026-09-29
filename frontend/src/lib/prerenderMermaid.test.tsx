/**
 * Drawing a Mermaid diagram before the card that holds it renders
 * (`docs/design/planning-index-at-scale.md` §10.3): the planning page reads
 * each fence out of a card block with `mermaidFences`, draws it with
 * `prerenderMermaid` into the SVG cache `MermaidDiagram` reads on mount, and
 * only then commits the card, so the diagram is at its full size on its first
 * paint.
 *
 * Two halves, and each one only works if it agrees with the viewer: a fence
 * the viewer draws and the reader misses is drawn late, and a code that
 * differs by a character is a cache miss, drawn late just the same.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { mermaidFences, prerenderMermaid } from "vantage-md/react";
import { MarkdownViewer } from "../components/MarkdownViewer";
import {
  clearMermaidCache,
  getCachedSvg,
  setCachedSvg,
} from "../../../packages/vantage-md/src/mermaidCache";
import { getMermaid } from "../../../packages/vantage-md/src/mermaidLoader";

/** Every code the viewer hands its diagram component, in render order. */
const drawnByViewer = vi.hoisted(() => [] as string[]);

vi.mock("vantage-md/react", async () => {
  const actual = await vi.importActual("vantage-md/react");
  return {
    ...actual,
    MermaidDiagram: ({ code }: { code: string }) => {
      drawnByViewer.push(code);
      return <pre data-testid="diagram">{code}</pre>;
    },
  };
});

vi.mock("../../../packages/vantage-md/src/mermaidLoader", () => ({
  getMermaid: vi.fn(),
}));

afterEach(() => {
  cleanup();
  clearMermaidCache();
  document.documentElement.classList.remove("dark");
});

/* ------------------------------------------------------------------ *
 * Reading the fences
 * ------------------------------------------------------------------ */

const SAMPLES: Record<string, string> = {
  "a root-level fence": ["```mermaid", "graph LR", "  A --> B", "```"].join(
    "\n",
  ),
  "a fence in a list item, indented": [
    "1. 💬 **OQ-M1: Which shape?**",
    "",
    "   ```mermaid",
    "   graph TD",
    "     A --> B",
    "   ```",
    "",
    "   _Leaning:_ this one.",
  ].join("\n"),
  "a fence in a blockquote": [
    "> ```mermaid",
    "> sequenceDiagram",
    ">   A->>B: hi",
    "> ```",
  ].join("\n"),
  "a tilde fence with an info string's meta": [
    "~~~mermaid title=x",
    "pie",
    '  "a" : 1',
    "~~~",
  ].join("\n"),
  "two fences and one that is not a diagram": [
    "```mermaid",
    "graph LR; A-->B",
    "```",
    "",
    "```js",
    "const mermaid = 1;",
    "```",
    "",
    "```mermaid",
    "graph LR; C-->D",
    "```",
  ].join("\n"),
  "a word that starts with mermaid, and one that is not it": [
    "```mermaid-js",
    "graph LR; E-->F",
    "```",
    "",
    "```Mermaid",
    "graph LR; G-->H",
    "```",
  ].join("\n"),
};

describe("mermaidFences", () => {
  beforeEach(() => {
    drawnByViewer.length = 0;
  });

  it.each(Object.entries(SAMPLES))(
    "reads %s as the viewer does",
    (_name, markdown) => {
      render(
        <BrowserRouter>
          <MarkdownViewer content={markdown} currentPath="x.md" embedded />
        </BrowserRouter>,
      );
      expect(mermaidFences(markdown)).toEqual(drawnByViewer);
    },
  );

  it("finds the samples' diagrams at all", () => {
    expect(mermaidFences(SAMPLES["a fence in a list item, indented"])).toEqual([
      "graph TD\n  A --> B",
    ]);
    expect(
      mermaidFences(SAMPLES["two fences and one that is not a diagram"]),
    ).toHaveLength(2);
  });

  it("reads nothing out of text that never says mermaid", () => {
    expect(mermaidFences("```js\nconst x = 1;\n```\n")).toEqual([]);
    expect(mermaidFences("")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Drawing ahead
 * ------------------------------------------------------------------ */

describe("prerenderMermaid", () => {
  const draw = vi.fn(async (_id: string, code: string) => ({
    svg: `<svg data-code="${code}"></svg>`,
  }));

  beforeEach(() => {
    draw.mockClear();
    vi.mocked(getMermaid).mockReset();
    vi.mocked(getMermaid).mockResolvedValue({ render: draw } as never);
  });

  it("puts the diagram in the cache the viewer's diagrams read", async () => {
    await prerenderMermaid("graph LR; A-->B");
    expect(getCachedSvg("graph LR; A-->B")).toBe(
      '<svg data-code="graph LR; A-->B"></svg>',
    );
    expect(getMermaid).toHaveBeenCalledTimes(1);
  });

  it("draws a diagram once however often it is asked for", async () => {
    await Promise.all([
      prerenderMermaid("graph LR; A-->B"),
      prerenderMermaid("graph LR; A-->B"),
    ]);
    await prerenderMermaid("graph LR; A-->B");
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("loads nothing for a diagram already drawn, or for an empty one", async () => {
    setCachedSvg("graph LR; C-->D", "<svg></svg>");
    await prerenderMermaid("graph LR; C-->D");
    await prerenderMermaid("  \n");
    expect(getMermaid).not.toHaveBeenCalled();
  });

  it("draws for the palette it is asked for", async () => {
    document.documentElement.classList.add("dark");
    await prerenderMermaid("graph LR; A-->B");
    expect(getCachedSvg("graph LR; A-->B")).toBeDefined();
    document.documentElement.classList.remove("dark");
    expect(getCachedSvg("graph LR; A-->B")).toBeUndefined();
  });

  it("caches nothing when the page changed palette while Mermaid loaded", async () => {
    let loaded!: () => void;
    vi.mocked(getMermaid).mockReturnValue(
      new Promise((resolve) => {
        loaded = () => resolve({ render: draw } as never);
      }),
    );
    const drawing = prerenderMermaid("graph LR; A-->B");
    document.documentElement.classList.add("dark");
    await act(async () => {
      loaded();
      await drawing;
    });
    expect(draw).not.toHaveBeenCalled();
    expect(getCachedSvg("graph LR; A-->B", "default")).toBeUndefined();
  });

  it("rejects, and caches nothing, when Mermaid cannot draw it", async () => {
    draw.mockRejectedValueOnce(new Error("Parse error on line 1"));
    await expect(prerenderMermaid("graph ???")).rejects.toThrow("Parse error");
    expect(getCachedSvg("graph ???")).toBeUndefined();
    // And a later ask tries again.
    await prerenderMermaid("graph ???");
    expect(draw).toHaveBeenCalledTimes(2);
  });
});
