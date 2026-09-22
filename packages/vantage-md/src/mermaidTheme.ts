/**
 * Which mermaid theme the page is asking for, and what to hand mermaid so a
 * diagram sits on a Vantage surface rather than on the one mermaid assumes.
 *
 * `.dark` on `<html>` is the app's dark selector — the same switch
 * `styles/directives.css` reads for the tone palette — so a package consumer
 * gets dark diagrams by toggling the class it already toggles.
 *
 * ## Why the variables exist at all
 *
 * Mermaid's stock `dark` theme is built for a near-black page: `mainBkg` is
 * `#1f2020`, which against Vantage's `slate-900` content column (`#0f172b`) is
 * 1.28:1. Every node box vanished, and a flowchart read as floating labels
 * joined by lines. Its `edgeLabelBackground` is a mid-grey `#585858` that
 * matched no surface in either theme, so every edge label wore a grey chip.
 *
 * So the two palettes below are the app's own slate steps, chosen the way the
 * rest of the dark audit was: a node box one step off its surface so the box is
 * visible, ink and borders at 4.5:1 or better against that box. They are stated
 * here rather than read out of the page because mermaid wants hex strings at
 * `initialize()` time, before any diagram exists to measure.
 *
 * The set is deliberately **structural only** — the surface, the node box, its
 * border and ink, the lines, the edge-label chip. `primaryColor` and its two
 * siblings are left alone on purpose: mermaid derives the categorical series
 * from them, so overriding them with slate turned a pie chart into three
 * near-black wedges. What is wrong in the stock dark theme is where a diagram
 * sits, not which colours it tells things apart with.
 */
export type MermaidThemeName = "dark" | "default";

/** Whether the document is asking for the dark palette right now. */
export function currentMermaidTheme(): MermaidThemeName {
  return typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
    ? "dark"
    : "default";
}

/**
 * The attribute on `<html>` naming the active colour theme. Absent means the
 * built-in look. The app sets it only once the theme's stylesheet has loaded,
 * so a reader of this attribute can trust the theme's variables are in effect.
 */
export const COLOR_THEME_ATTRIBUTE = "data-vantage-theme";

/**
 * The attribute on `<html>` saying where the active theme came from: `"user"`
 * for a stylesheet in the reader's themes directory, `"built-in"` for one the
 * app ships. Set with {@link COLOR_THEME_ATTRIBUTE}, and absent with it.
 *
 * It exists because an id alone is not a palette. A user theme may share a
 * built-in's id — that is how a reader tweaks one — and the app applies the
 * stored built-in synchronously, then swaps in the same-id user file once
 * /api/themes answers. Keyed on the id, the diagrams drawn in between kept the
 * built-in's colours: the key did not change, so neither the cache nor
 * `useSyncExternalStore` saw a reason to redraw.
 */
export const COLOR_THEME_SOURCE_ATTRIBUTE = "data-vantage-theme-source";

/** The active colour theme's id, or `""` for the built-in look. */
export function currentColorTheme(): string {
  if (typeof document === "undefined") return "";
  return document.documentElement.getAttribute(COLOR_THEME_ATTRIBUTE) ?? "";
}

/**
 * Everything a rendered diagram's colours depend on, as one string: the
 * light/dark mode, plus the colour theme when one is active.
 *
 * A diagram is baked at render time, so anything that changes its colours has
 * to change this key — it is what the SVG cache and the loader's "configured
 * for" check compare. Under the built-in look it is exactly the mode name,
 * which is what both keyed on before colour themes existed.
 */
export function currentMermaidPalette(): string {
  const theme = currentColorTheme();
  if (!theme) return currentMermaidTheme();
  // Only a user theme is marked, so a built-in's key stays "mode id".
  const user =
    document.documentElement.getAttribute(COLOR_THEME_SOURCE_ATTRIBUTE) ===
    "user";
  return `${currentMermaidTheme()} ${theme}${user ? " user" : ""}`;
}

/** The mermaid theme name a palette key was built from. */
export function mermaidThemeOf(palette: string): MermaidThemeName {
  return palette.startsWith("dark") ? "dark" : "default";
}

/**
 * Theme variables per theme. Mermaid derives most of its palette from these, so
 * the set is deliberately small: the surfaces, the ink, and the lines.
 */
const THEME_VARIABLES: Record<MermaidThemeName, Record<string, string>> = {
  dark: {
    // slate-800: the fence the app leaves around a rendered diagram.
    background: "#1d293d",
    // slate-700 boxes on that fence, outlined in slate-400 — the outline is
    // what makes a node read as a box, and slate-100 ink sits at 11:1 inside it.
    mainBkg: "#314158",
    nodeBorder: "#90a1b9",
    nodeTextColor: "#f1f5f9",
    // slate-400: 5.6:1 on the fence, so an edge is a line and not a smudge.
    lineColor: "#90a1b9",
    textColor: "#e2e8f0",
    // The chip under a label on an edge. Matching the surface behind the
    // diagram is what makes it read as a gap in the line rather than as a tag.
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
};

/**
 * Where each variable comes from under a colour theme: the palette step the
 * built-in value was chosen from. The hex above IS that step in Tailwind's own
 * palette, so reading the step back out of the page gives the same diagram
 * under the built-in look and the theme's colours under any other.
 */
const THEME_SOURCES: Record<MermaidThemeName, Record<string, string>> = {
  dark: {
    background: "--color-slate-800",
    mainBkg: "--color-slate-700",
    nodeBorder: "--color-slate-400",
    nodeTextColor: "--color-slate-100",
    lineColor: "--color-slate-400",
    textColor: "--color-slate-200",
    edgeLabelBackground: "--color-slate-800",
  },
  default: {
    background: "--color-slate-50",
    mainBkg: "--color-slate-100",
    nodeBorder: "--color-slate-500",
    nodeTextColor: "--color-slate-900",
    lineColor: "--color-slate-500",
    textColor: "--color-slate-800",
    edgeLabelBackground: "--color-slate-50",
  },
};

export function mermaidThemeVariables(
  theme: MermaidThemeName,
): Record<string, string> {
  const fixed = THEME_VARIABLES[theme];
  // The built-in look keeps its measured constants verbatim: no DOM reads, and
  // nothing a colour conversion could round.
  if (!currentColorTheme()) return fixed;
  const out: Record<string, string> = {};
  for (const [key, hex] of Object.entries(fixed)) {
    out[key] = resolveCssColor(THEME_SOURCES[theme][key]) ?? hex;
  }
  return out;
}

/**
 * A custom property's colour as `#rrggbb`, or `null` when it cannot be read.
 *
 * Mermaid wants hex at `initialize()` time, and a theme's value can be any CSS
 * colour — `oklch()`, `color-mix()`, a `var()` of another variable. So the
 * browser does the work: a probe element resolves the property to a computed
 * colour, and a 1×1 canvas turns that into sRGB bytes whatever syntax it came
 * back in. No canvas (jsdom, a locked-down embed) is `null`, and the caller
 * falls back to the built-in value.
 *
 * A property nobody declared is `null` too, and has to be checked for up
 * front: `color: var(--unset)` is invalid at computed-value time, so the probe
 * *inherits* its colour instead — the page's text colour, which the canvas
 * would dutifully turn into a plausible hex and mermaid would paint every node
 * box with.
 */
export function resolveCssColor(property: string): string | null {
  if (typeof document === "undefined") return null;
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue(property)
    .trim();
  if (!declared) return null;
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${property})`;
  document.documentElement.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  if (!computed) return null;

  const ctx = pixelContext();
  if (!ctx) return null;
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A 1×1 2D context to read a colour back from, or `null` where there is none. */
function pixelContext(): CanvasRenderingContext2D | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    return canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    return null;
  }
}
