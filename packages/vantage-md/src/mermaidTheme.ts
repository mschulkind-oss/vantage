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

export function mermaidThemeVariables(
  theme: MermaidThemeName,
): Record<string, string> {
  return THEME_VARIABLES[theme];
}
