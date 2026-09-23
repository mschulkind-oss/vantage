// Rendered SVGs, kept so a re-render of the same document does not re-run
// mermaid. Keyed by theme as well as code: the same fence renders to a
// different SVG in each palette, and a cache keyed by code alone served the
// light diagram — white boxes, black ink — onto the dark page after a theme
// switch, and the dark one onto the light page.
//
// "Theme" here is the palette key (`currentMermaidPalette`): the mode, plus the
// color theme when one is active, since switching color themes changes a
// diagram's colors exactly as a light/dark flip does.
import { currentMermaidPalette } from "./mermaidTheme.js";

const svgCache = new Map<string, string>();

// The separator is written as an escape on purpose: a literal NUL byte in the
// source makes git call this file binary, so every change to it arrives as
// "Binary files differ" with no diff to review. It is still a NUL at runtime —
// the one byte neither a palette key nor a fence's code can contain.
const cacheKey = (code: string, theme: string) => `${theme}\u0000${code}`;

/** The SVG for this fence in the theme the page is currently asking for. */
export function getCachedSvg(
  code: string,
  theme: string = currentMermaidPalette(),
): string | undefined {
  return svgCache.get(cacheKey(code, theme));
}

export function hasCachedSvg(
  code: string,
  theme: string = currentMermaidPalette(),
): boolean {
  return svgCache.has(cacheKey(code, theme));
}

export function setCachedSvg(
  code: string,
  svg: string,
  theme: string = currentMermaidPalette(),
): void {
  svgCache.set(cacheKey(code, theme), svg);
}

export function clearMermaidCache() {
  svgCache.clear();
}
