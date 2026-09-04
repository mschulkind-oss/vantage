/**
 * A diagram is an SVG baked at render time, so it is the one thing on the page
 * that does not restyle when the theme flips — it has to be drawn again, in the
 * other palette.
 *
 * Two things used to stop that happening, and either alone was enough to leave
 * a white slab of a flowchart on the dark page for the life of the session:
 * `mermaid.initialize()` ran once on first import, so every later render still
 * used the palette the session started in; and the SVG cache was keyed by fence
 * text alone, so even a correctly re-configured render was never reached.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const initialize = vi.fn();
const render = vi.fn(async (id: string, code: string) => ({
  svg: `<svg data-id="${id}" data-code="${code}"></svg>`,
}));

// The heavy real module never loads: the loader imports it lazily, so a mock at
// the bare specifier is all it ever sees.
vi.mock("mermaid", () => ({ default: { initialize, render } }));

const cache = await import("../../../packages/vantage-md/src/mermaidCache");
const loader = await import("../../../packages/vantage-md/src/mermaidLoader");

const setDark = (on: boolean) =>
  document.documentElement.classList.toggle("dark", on);

beforeEach(() => {
  cache.clearMermaidCache();
  loader.resetMermaidLoader();
  initialize.mockClear();
  render.mockClear();
  setDark(false);
});

afterEach(() => setDark(false));

describe("the rendered-SVG cache", () => {
  it("does not serve one theme's diagram to the other", () => {
    setDark(true);
    cache.setCachedSvg("graph LR\n A --> B", "<svg>dark</svg>");

    setDark(false);
    expect(cache.getCachedSvg("graph LR\n A --> B")).toBeUndefined();
    expect(cache.hasCachedSvg("graph LR\n A --> B")).toBe(false);
  });

  it("still has the first theme's diagram when the reader flips back", () => {
    setDark(true);
    cache.setCachedSvg("graph LR\n A --> B", "<svg>dark</svg>");
    setDark(false);
    cache.setCachedSvg("graph LR\n A --> B", "<svg>light</svg>");

    expect(cache.getCachedSvg("graph LR\n A --> B")).toBe("<svg>light</svg>");
    setDark(true);
    expect(cache.getCachedSvg("graph LR\n A --> B")).toBe("<svg>dark</svg>");
  });

  it("takes an explicit theme, for a caller that knows which one it wants", () => {
    cache.setCachedSvg("g", "<svg>dark</svg>", "dark");

    expect(cache.getCachedSvg("g", "dark")).toBe("<svg>dark</svg>");
    expect(cache.getCachedSvg("g", "default")).toBeUndefined();
  });
});

describe("the mermaid loader", () => {
  it("configures the theme the page is asking for", async () => {
    setDark(true);
    await loader.getMermaid();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.calls[0][0]).toMatchObject({ theme: "dark" });
  });

  it("re-configures when the theme changed since the last call", async () => {
    setDark(true);
    await loader.getMermaid();
    setDark(false);
    await loader.getMermaid();

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize.mock.calls[1][0]).toMatchObject({ theme: "default" });
  });

  it("configures once while the theme holds still", async () => {
    setDark(true);
    await loader.getMermaid();
    await loader.getMermaid();
    await loader.getMermaid();

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("catches a theme that changed while the module was still loading", async () => {
    setDark(true);
    const pending = loader.getMermaid();
    setDark(false);
    await pending;

    expect(initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
  });

  it("hands mermaid a surface its stock theme does not have", async () => {
    // Mermaid's own dark theme paints nodes `#1f2020` and edge-label chips
    // `#585858` — 1.28:1 and a mid-grey tag against the slate-800 fence the app
    // draws a diagram in. The variables are what put it on a Vantage surface.
    setDark(true);
    await loader.getMermaid();

    const config = initialize.mock.calls[0][0] as {
      themeVariables: Record<string, string>;
    };
    expect(config.themeVariables.mainBkg).toBe("#314158");
    expect(config.themeVariables.background).toBe("#1d293d");
    expect(config.themeVariables.edgeLabelBackground).toBe("#1d293d");
    // And leaves the categorical series alone: slate wedges are not a pie.
    expect(config.themeVariables).not.toHaveProperty("primaryColor");
    expect(config.themeVariables).not.toHaveProperty("secondaryColor");
  });
});
