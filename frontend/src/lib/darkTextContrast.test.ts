/**
 * No text in dark mode may sit on a dark surface at a contrast a reader cannot
 * resolve.
 *
 * The bug this pins was systemic rather than local: a muted label was written
 * as `text-slate-500 dark:text-slate-600`, stepping the ink *darker* for dark
 * mode when the surface had gone dark too. Twenty-odd sites did it, and the
 * worst — the sidebar's "no Markdown in here" directories, which also carried
 * `opacity-40` — landed at 1.6:1, an entry the reader had switched on and then
 * could not read.
 *
 * ## What a test can and cannot decide from a class name
 *
 * The class says the colour; it does not say whether the text is a label, a
 * sentence, or the `·` between two timestamps. WCAG asks 4.5:1 of body text and
 * 3:1 of an incidental glyph, so the **floor** is what this guards: every shade
 * the app puts on a dark surface must clear 3:1 there. The 4.5:1 cases were
 * found by measuring the running app in Chrome — `slate-400` and lighter is
 * what clears it, and that is what the muted labels now use.
 *
 * Ratios below are against `slate-800` (#1d293d — the header, the sidebar and
 * every panel), which is the *lighter* of the two dark surfaces and therefore
 * the harder one; the content column is `slate-900` and every shade scores
 * better there.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RELATIVE_SRC_ROOT = "..";

/**
 * Tailwind v4 declares these in oklch; the sRGB below is what Chrome resolves
 * them to, read off `var(--color-slate-N)` in the running app.
 */
const SLATE: Record<number, string> = {
  50: "#f8fafc",
  100: "#f1f5f9",
  200: "#e2e8f0",
  300: "#cad5e2",
  400: "#90a1b9",
  500: "#62748e",
  600: "#45556c",
  700: "#314158",
  800: "#1d293d",
  900: "#0f172b",
  950: "#000000",
};

/** The lighter of the app's two dark surfaces: header, sidebar, every panel. */
const DARK_SURFACE = SLATE[800];

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Every `.ts`/`.tsx` under `src/`, tests excluded — they assert, they do not
 * render.
 *
 * The root is resolved through a variable, not a literal `new URL(…,
 * import.meta.url)`: Vite rewrites the literal form into an asset URL that `fs`
 * cannot open. `directiveCssWiring.test.ts` reads the stylesheet the same way.
 */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sources(path, found);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

const SRC_ROOT = fileURLToPath(new URL(RELATIVE_SRC_ROOT, import.meta.url));

interface Usage {
  file: string;
  line: number;
  shade: number;
  surface: string;
  text: string;
}

/**
 * What this line's ink sits on in dark mode.
 *
 * `null` means "cannot tell": the line paints its own dark-mode background out
 * of some palette other than slate — an alert wash, a tinted diff row — and the
 * guard has no colour to measure against, so it says nothing rather than
 * guessing. A line that names a slate background is measured against *that*,
 * which is what lets a chip invert (`dark:bg-slate-100 dark:text-slate-900`)
 * without tripping a rule about dark surfaces.
 */
function surfaceOf(text: string): string | null {
  const slate = text.match(/(?<![-\w])dark:bg-slate-(\d+)(?![-\w/])/);
  if (slate) return SLATE[Number(slate[1])] ?? null;
  if (/(?<![-\w])dark:bg-/.test(text)) return null;
  return DARK_SURFACE;
}

/**
 * Slate text shades that apply in dark mode: the `dark:` ones, plus the bare
 * ones on a line that names no `dark:text-` at all — those are one colour for
 * both themes, so the dark surface gets them too.
 *
 * The line is the unit because a Tailwind class list is written as one string;
 * a `dark:` variant lives beside the base class it overrides, and so does the
 * background the pair sits on.
 */
function darkModeSlateText(): Usage[] {
  const usages: Usage[] = [];
  for (const file of sources(SRC_ROOT)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      const surface = surfaceOf(text);
      if (surface === null) return;
      const add = (shade: number) =>
        usages.push({
          file,
          line: index + 1,
          shade,
          surface,
          text: text.trim(),
        });
      const dark = [...text.matchAll(/(?<![-\w])dark:text-slate-(\d+)\b/g)];
      for (const match of dark) add(Number(match[1]));
      if (dark.length > 0 || /(?<![-\w])dark:text-/.test(text)) return;
      for (const match of text.matchAll(/(?<![-\w:])text-slate-(\d+)\b/g)) {
        add(Number(match[1]));
      }
    });
  }
  return usages;
}

describe("slate text on a dark surface", () => {
  it("has a palette whose shades bracket the two thresholds", () => {
    // The numbers the rule below is chosen from, stated rather than implied.
    expect(+contrast(SLATE[300], DARK_SURFACE).toFixed(2)).toBe(9.83);
    expect(+contrast(SLATE[400], DARK_SURFACE).toFixed(2)).toBe(5.56);
    expect(+contrast(SLATE[500], DARK_SURFACE).toFixed(2)).toBe(3.07);
    expect(+contrast(SLATE[600], DARK_SURFACE).toFixed(2)).toBe(1.93);
  });

  it("never steps darker than slate-500, the 3:1 floor", () => {
    const tooDark = darkModeSlateText().filter(
      (usage) => contrast(SLATE[usage.shade], usage.surface) < 3,
    );

    expect(
      tooDark.map(
        (usage) =>
          `${usage.file.replace(/.*\/src\//, "src/")}:${usage.line} ` +
          `slate-${usage.shade} is ${contrast(SLATE[usage.shade], usage.surface).toFixed(2)}:1 — ${usage.text.slice(0, 70)}`,
      ),
    ).toEqual([]);
  });

  it("reads the sources it claims to, so an empty pass is not a green one", () => {
    const usages = darkModeSlateText();
    expect(usages.length).toBeGreaterThan(20);
    expect(new Set(usages.map((u) => u.file)).size).toBeGreaterThan(5);
  });
});
