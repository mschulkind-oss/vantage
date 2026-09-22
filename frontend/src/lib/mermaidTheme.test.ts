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
import {
  act,
  render as renderComponent,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";

const initialize = vi.fn();
const render = vi.fn(async (id: string, code: string) => ({
  svg: `<svg data-id="${id}" data-code="${code}"></svg>`,
}));

// The heavy real module never loads: the loader imports it lazily, so a mock at
// the bare specifier is all it ever sees.
vi.mock("mermaid", () => ({ default: { initialize, render } }));

const cache = await import("../../../packages/vantage-md/src/mermaidCache");
const loader = await import("../../../packages/vantage-md/src/mermaidLoader");
const theme = await import("../../../packages/vantage-md/src/mermaidTheme");
const { MermaidDiagram } =
  await import("../../../packages/vantage-md/src/MermaidDiagram");

const setDark = (on: boolean) =>
  document.documentElement.classList.toggle("dark", on);

/** What the app does once a colour theme's stylesheet is live; `null` clears. */
const setColorTheme = (id: string | null) =>
  id === null
    ? document.documentElement.removeAttribute(theme.COLOR_THEME_ATTRIBUTE)
    : document.documentElement.setAttribute(theme.COLOR_THEME_ATTRIBUTE, id);

beforeEach(() => {
  cache.clearMermaidCache();
  loader.resetMermaidLoader();
  initialize.mockClear();
  render.mockClear();
  setDark(false);
});

afterEach(() => {
  setDark(false);
  setColorTheme(null);
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

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

/**
 * Colour themes add a second input to "which palette is this diagram in": the
 * theme id on `<html>`. Everything keyed on light/dark has to key on it too, or
 * switching theme leaves diagrams in the previous theme's colours exactly the
 * way a light/dark flip used to. And with no theme, every key and every value
 * has to be what it was before themes existed — that is the zero-change
 * guarantee, and the cache and the loader both compare these strings.
 */
describe("the palette key", () => {
  it("is exactly the old mode name when no colour theme is active", () => {
    expect(theme.currentMermaidPalette()).toBe("default");
    setDark(true);
    expect(theme.currentMermaidPalette()).toBe("dark");
  });

  it("adds the colour theme's id when one is active", () => {
    setColorTheme("catppuccin");
    expect(theme.currentMermaidPalette()).toBe("default catppuccin");
    setDark(true);
    expect(theme.currentMermaidPalette()).toBe("dark catppuccin");
  });

  it("marks a user theme, so one replacing the same-id built-in is a new palette", () => {
    setColorTheme("catppuccin");
    document.documentElement.setAttribute(
      theme.COLOR_THEME_SOURCE_ATTRIBUTE,
      "built-in",
    );
    expect(theme.currentMermaidPalette()).toBe("default catppuccin");
    document.documentElement.setAttribute(
      theme.COLOR_THEME_SOURCE_ATTRIBUTE,
      "user",
    );
    expect(theme.currentMermaidPalette()).toBe("default catppuccin user");
    expect(theme.mermaidThemeOf("dark catppuccin user")).toBe("dark");
    document.documentElement.removeAttribute(
      theme.COLOR_THEME_SOURCE_ATTRIBUTE,
    );
  });

  it("still names the mermaid theme it was built from", () => {
    for (const [palette, name] of [
      ["default", "default"],
      ["dark", "dark"],
      ["default catppuccin", "default"],
      ["dark catppuccin", "dark"],
    ]) {
      expect(theme.mermaidThemeOf(palette)).toBe(name);
    }
  });
});

describe("the diagram's theme variables", () => {
  /** The measured constants from before colour themes; see mermaidTheme.ts. */
  const BUILT_IN = {
    dark: {
      background: "#1d293d",
      mainBkg: "#314158",
      nodeBorder: "#90a1b9",
      nodeTextColor: "#f1f5f9",
      lineColor: "#90a1b9",
      textColor: "#e2e8f0",
      edgeLabelBackground: "#1d293d",
    },
    default: {
      background: "#f8fafc",
      mainBkg: "#f1f5f9",
      nodeBorder: "#62748e",
      nodeTextColor: "#0f172b",
      lineColor: "#62748e",
      textColor: "#1d293d",
      edgeLabelBackground: "#f8fafc",
    },
  } as const;

  /**
   * A 2D context that "paints" whatever `fillStyle` names from a lookup, so the
   * resolution path can be exercised in jsdom, which has no canvas at all. The
   * probe's computed colour comes back from jsdom as the literal `var(--x)`
   * string (it resolves no `var()`), which is what the lookup is keyed by.
   */
  function fakeCanvas(bytes: Record<string, [number, number, number]>) {
    let fill = "";
    const ctx = {
      set fillStyle(value: string) {
        fill = value;
      },
      get fillStyle() {
        return fill;
      },
      fillRect: () => {},
      getImageData: () => ({
        data: Uint8ClampedArray.from([...(bytes[fill] ?? [0, 0, 0]), 255]),
      }),
    };
    return vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  }

  it.each(["dark", "default"] as const)(
    "are the exact built-in hex in %s mode with no colour theme",
    (mode) => {
      // No DOM read either: every step is declared and a canvas would answer,
      // and neither is asked.
      for (const step of [50, 100, 200, 400, 500, 700, 800, 900]) {
        document.documentElement.style.setProperty(
          `--color-slate-${step}`,
          "#000000",
        );
      }
      const getContext = fakeCanvas({});
      expect(theme.mermaidThemeVariables(mode)).toEqual(BUILT_IN[mode]);
      expect(getContext).not.toHaveBeenCalled();
    },
  );

  it.each(["dark", "default"] as const)(
    "fall back to the built-in hex under a theme when there is no canvas (%s)",
    (mode) => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      document.documentElement.style.setProperty(
        "--color-slate-800",
        "#010203",
      );
      setColorTheme("catppuccin");
      expect(theme.mermaidThemeVariables(mode)).toEqual(BUILT_IN[mode]);
    },
  );

  it("come from the page's slate steps under a theme", () => {
    const root = document.documentElement.style;
    root.setProperty("--color-slate-700", "#313244");
    root.setProperty("--color-slate-800", "#1e1e2e");
    fakeCanvas({
      "var(--color-slate-700)": [0x31, 0x32, 0x44],
      "var(--color-slate-800)": [0x1e, 0x1e, 0x2e],
    });
    setColorTheme("catppuccin");

    const vars = theme.mermaidThemeVariables("dark");
    expect(vars.mainBkg).toBe("#313244");
    expect(vars.background).toBe("#1e1e2e");
    expect(vars.edgeLabelBackground).toBe("#1e1e2e");
    // A step the page does not declare keeps its built-in value rather than
    // inheriting whatever colour the probe's parent has.
    expect(vars.textColor).toBe(BUILT_IN.dark.textColor);
    // Same keys, so the "structural only" rule still holds under a theme.
    expect(Object.keys(vars).sort()).toEqual(Object.keys(BUILT_IN.dark).sort());
  });
});

describe("resolveCssColor", () => {
  it("is null without a canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    document.documentElement.style.setProperty("--color-slate-50", "#abcdef");
    expect(theme.resolveCssColor("--color-slate-50")).toBeNull();
  });

  it("is null when getContext throws, as a locked-down embed's can", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        throw new Error("blocked");
      },
    );
    document.documentElement.style.setProperty("--color-slate-50", "#abcdef");
    expect(theme.resolveCssColor("--color-slate-50")).toBeNull();
  });

  it("is null for a property the page never declared, before any canvas", () => {
    // `color: var(--unset)` inherits instead, which would turn into the page's
    // text colour — plausible hex, wrong diagram.
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    expect(theme.resolveCssColor("--color-never-declared")).toBeNull();
    expect(getContext).not.toHaveBeenCalled();
  });

  it("leaves no probe element behind", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    document.documentElement.style.setProperty("--color-slate-50", "#abcdef");
    const before = document.documentElement.childElementCount;
    theme.resolveCssColor("--color-slate-50");
    expect(document.documentElement.childElementCount).toBe(before);
  });
});

describe("a colour-theme switch", () => {
  it("is a cache miss, and switching back is a hit", () => {
    cache.setCachedSvg("g", "<svg>vantage</svg>");
    setColorTheme("catppuccin");
    expect(cache.getCachedSvg("g")).toBeUndefined();

    cache.setCachedSvg("g", "<svg>catppuccin</svg>");
    setColorTheme("nord");
    expect(cache.getCachedSvg("g")).toBeUndefined();

    setColorTheme("catppuccin");
    expect(cache.getCachedSvg("g")).toBe("<svg>catppuccin</svg>");
    setColorTheme(null);
    expect(cache.getCachedSvg("g")).toBe("<svg>vantage</svg>");
  });

  it("keys the built-in look exactly as before themes existed", () => {
    // An explicit "dark" from an older caller still finds the same entry.
    setDark(true);
    cache.setCachedSvg("g", "<svg>dark</svg>");
    expect(cache.getCachedSvg("g", "dark")).toBe("<svg>dark</svg>");
  });

  it("re-configures the loader, keeping mermaid's own theme name", async () => {
    setDark(true);
    await loader.getMermaid();
    setColorTheme("catppuccin");
    await loader.getMermaid();

    expect(initialize).toHaveBeenCalledTimes(2);
    // Mermaid only knows "dark" and "default"; the theme is in the variables.
    expect(initialize.mock.calls[1][0]).toMatchObject({ theme: "dark" });
  });

  it("does not re-configure while the theme holds still", async () => {
    setColorTheme("catppuccin");
    await loader.getMermaid();
    await loader.getMermaid();

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("redraws a mounted diagram in the new palette", async () => {
    // The component watches `<html>` through a MutationObserver; without the
    // theme attribute in its filter, the key changes but nothing re-reads it.
    const code = "graph LR\n A --> B";
    const { unmount } = renderComponent(
      createElement(MermaidDiagram, { code }),
    );
    await waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(cache.getCachedSvg(code, "default")).toBeDefined();

    act(() => setColorTheme("catppuccin"));
    await waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(cache.getCachedSvg(code, "default catppuccin")).toBeDefined(),
    );
    unmount();
  });
});
