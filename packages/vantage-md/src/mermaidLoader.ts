import type mermaidAPI from "mermaid";
import {
  currentMermaidPalette,
  mermaidThemeOf,
  mermaidThemeVariables,
} from "./mermaidTheme.js";

let mermaidInstance: typeof mermaidAPI | null = null;
let mermaidLoading: Promise<typeof mermaidAPI> | null = null;
/**
 * The palette key (`currentMermaidPalette`) the loaded instance was last
 * configured for, `null` until loaded.
 */
let configuredTheme: string | null = null;

/**
 * The configuration keys a diagram's own source may not set, from an `init`
 * directive or from frontmatter: Mermaid's default list, then the three
 * that write a diagram's stylesheet.
 *
 * **A diagram's stylesheet reaches past the diagram.** Mermaid puts every
 * selector of it under the diagram's id, but leaves the names of its
 * `@keyframes` global, so a diagram that defined `flash-update` redefined the
 * animation the viewer plays on a block that just changed. Given
 * `position: fixed` at the size of the window, the next flash laid that block,
 * and the link it held, over the header and the sidebar. The same stylesheet
 * fetched images from any host, which is why `SAFE_STYLE` refuses parentheses.
 *
 * - `themeCSS` is a stylesheet, and Mermaid checks only that its braces pair.
 * - `fontFamily` is copied into `themeVariables` *after* Mermaid's check on
 *   theme variables has run, and lands in the stylesheet as a declaration's
 *   value, where a nested block becomes a rule of its own.
 * - `altFontFamily` lands in a rule the browser parses first, which drops
 *   what does not belong. It is refused anyway: nothing needs it, and that
 *   parse is all that stands in the way.
 *
 * Mermaid applies the list at every depth, so `themeVariables.fontFamily` in
 * a diagram is refused too. The list is spelled whole rather than relying on
 * Mermaid merging it with its default. `frontend/e2e/mermaid.spec.ts` measures
 * all four routes; see "Mermaid" in `docs/reference/inline-markup.md`.
 */
const MERMAID_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "themeCSS",
  "fontFamily",
  "altFontFamily",
];

function configure(m: typeof mermaidAPI, palette: string) {
  const theme = mermaidThemeOf(palette);
  m.initialize({
    startOnLoad: false,
    theme,
    themeVariables: mermaidThemeVariables(theme),
    securityLevel: "strict",
    suppressErrorRendering: true,
    secure: MERMAID_SECURE_KEYS,
  });
  configuredTheme = palette;
}

/**
 * The mermaid module, configured for the theme the page is asking for *now*.
 *
 * Re-configuring on a theme change is the point. `initialize` used to run once,
 * on first import, so every diagram rendered after a light/dark switch still
 * came out in the palette the session started in — a white slab of a flowchart
 * on the dark page, or a black one on the light page. `initialize` merges into
 * mermaid's global config, so calling it again is how the next `render` picks
 * the new palette up; the cache is keyed by theme so the old SVGs are not
 * served instead (`mermaidCache.ts`).
 */
export async function getMermaid(): Promise<typeof mermaidAPI> {
  const theme = currentMermaidPalette();
  if (mermaidInstance) {
    if (configuredTheme !== theme) configure(mermaidInstance, theme);
    return mermaidInstance;
  }
  if (!mermaidLoading) {
    mermaidLoading = import("mermaid").then((mod) => {
      const m = mod.default;
      configure(m, currentMermaidPalette());
      mermaidInstance = m;
      return m;
    });
  }
  const loaded = await mermaidLoading;
  const wanted = currentMermaidPalette();
  if (configuredTheme !== wanted) configure(loaded, wanted);
  return loaded;
}

export function resetMermaidLoader() {
  mermaidInstance = null;
  mermaidLoading = null;
  configuredTheme = null;
}
