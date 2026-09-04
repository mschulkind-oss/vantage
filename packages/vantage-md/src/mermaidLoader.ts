import type mermaidAPI from "mermaid";
import { currentMermaidTheme, mermaidThemeVariables } from "./mermaidTheme.js";
import type { MermaidThemeName } from "./mermaidTheme.js";

let mermaidInstance: typeof mermaidAPI | null = null;
let mermaidLoading: Promise<typeof mermaidAPI> | null = null;
/** The theme the loaded instance was last configured for, `null` until loaded. */
let configuredTheme: MermaidThemeName | null = null;

function configure(m: typeof mermaidAPI, theme: MermaidThemeName) {
  m.initialize({
    startOnLoad: false,
    theme,
    themeVariables: mermaidThemeVariables(theme),
    securityLevel: "strict",
    suppressErrorRendering: true,
  });
  configuredTheme = theme;
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
  const theme = currentMermaidTheme();
  if (mermaidInstance) {
    if (configuredTheme !== theme) configure(mermaidInstance, theme);
    return mermaidInstance;
  }
  if (!mermaidLoading) {
    mermaidLoading = import("mermaid").then((mod) => {
      const m = mod.default;
      configure(m, currentMermaidTheme());
      mermaidInstance = m;
      return m;
    });
  }
  const loaded = await mermaidLoading;
  const wanted = currentMermaidTheme();
  if (configuredTheme !== wanted) configure(loaded, wanted);
  return loaded;
}

export function resetMermaidLoader() {
  mermaidInstance = null;
  mermaidLoading = null;
  configuredTheme = null;
}
