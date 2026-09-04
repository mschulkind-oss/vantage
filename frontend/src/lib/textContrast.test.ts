/**
 * No text in either theme may sit on its surface at a contrast a reader cannot
 * resolve.
 *
 * Both halves of this were systemic rather than local, and each was invisible
 * from the other theme:
 *
 * - **Dark** stepped the ink the wrong way. A muted label was written
 *   `text-slate-500 dark:text-slate-600` in twenty-odd places — darker ink for
 *   a surface that had gone dark too — and the worst of them, the sidebar's
 *   "no Markdown in here" directories, also carried `opacity-40` and landed at
 *   1.6:1.
 * - **Light** never stepped at all. `text-slate-400` was the muted ink
 *   everywhere and is 2.4:1 on a light panel, so once dark was fixed light was
 *   the weaker theme: timestamps, breadcrumbs, file icons and the `·` between
 *   two metadata items were all fainter than their dark counterparts.
 *
 * ## What a test can and cannot decide from a class name
 *
 * The class says the colour; it does not say whether the text is a label, a
 * sentence, or a separator glyph. WCAG asks 4.5:1 of body text and 3:1 of an
 * incidental glyph, so the **floor** is what this guards: every shade the app
 * puts on a surface must clear 3:1 there, in both themes. The 4.5:1 cases were
 * settled by measuring the running app in Chrome, and the answer collapsed to
 * one muted token — `text-slate-500 dark:text-slate-400`, 4.4:1 and 5.6:1 —
 * because the slate ramp offers nothing between it and shades that fail the
 * floor outright.
 *
 * Each theme is measured against the **hardest surface the app paints text
 * on**, so the guard never flatters: `slate-100` for light (a chip or a panel;
 * the page itself is white and scores better) and `slate-800` for dark (the
 * header, the sidebar and every panel; the content column is `slate-900` and
 * scores better). A line that names its own background is measured against
 * that instead, which is what lets a chip invert.
 *
 * Scope, stated so its edges are not mistaken for coverage: `frontend/src`, the
 * `slate` ramp, and un-prefixed or `dark:`-prefixed classes. The app uses no
 * other grey ramp — `vantage-md`'s diagram chrome uses `gray`, and lives
 * outside this tree — and the colours a document can reach (tone washes, alert
 * inks, syntax highlighting) are declared in CSS rather than in a class name,
 * so they are answerable only to a measurement of the running page.
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

type Theme = "light" | "dark";

/** The hardest surface each theme paints text on. See the header. */
const SURFACE: Record<Theme, string> = {
  light: SLATE[100],
  dark: SLATE[800],
};

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

interface Usage {
  file: string;
  line: number;
  theme: Theme;
  shade: number;
  surface: string;
  text: string;
}

/**
 * What this line's ink sits on, in one theme.
 *
 * `null` means "cannot tell": the line paints its own background out of some
 * palette other than slate — an alert wash, a tinted diff row — and the guard
 * has no colour to measure against, so it says nothing rather than guessing. A
 * line that names a slate background is measured against *that*, which is what
 * lets a chip invert (`dark:bg-slate-100 dark:text-slate-900`) without tripping
 * a rule about dark surfaces.
 */
function surfaceOf(text: string, theme: Theme): string | null {
  // The light lookbehind has to reject a `:` as well as a word character, or
  // `dark:bg-slate-900` answers the question the light theme asked.
  const prefix = theme === "dark" ? "(?<![-\\w])dark:" : "(?<![-\\w:])";
  const slate = new RegExp(`${prefix}bg-slate-(\\d+)(?![-\\w/])`).exec(text);
  if (slate) return SLATE[Number(slate[1])] ?? null;
  if (new RegExp(`${prefix}bg-white(?![-\\w/])`).test(text)) return "#ffffff";
  // A bare `bg-*` in some other palette also paints in dark mode, unless a
  // `dark:bg-*` overrides it. Either way there is no colour to measure against.
  const bare = /(?<![-\w:])bg-(?!white\b)[a-z]+-\d+/.test(text);
  const dark = /(?<![-\w])dark:bg-/.test(text);
  if (theme === "dark" ? dark || bare : bare) return null;
  return SURFACE[theme];
}

/**
 * Slate text shades and the theme each one paints in.
 *
 * A bare `text-slate-N` is the light value *and* the dark value unless a
 * `dark:text-…` on the same line overrides it. The line is the unit because a
 * Tailwind class list is written as one string: a `dark:` variant lives beside
 * the base class it overrides, and so does the background the pair sits on.
 *
 * Variant-prefixed shades (`hover:`, `prose-p:`) are out of scope — a hover
 * state is not the resting appearance, and the prose colours are body ink that
 * `@tailwindcss/typography` already steps per theme.
 */
function slateText(): Usage[] {
  const usages: Usage[] = [];
  for (const file of sources(SRC_ROOT)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      const add = (theme: Theme, shade: number) => {
        const surface = surfaceOf(text, theme);
        if (surface === null) return;
        usages.push({
          file,
          line: index + 1,
          theme,
          shade,
          surface,
          text: text.trim(),
        });
      };
      const base = [...text.matchAll(/(?<![-\w:])text-slate-(\d+)\b/g)];
      for (const match of base) add("light", Number(match[1]));

      const dark = [...text.matchAll(/(?<![-\w])dark:text-slate-(\d+)\b/g)];
      for (const match of dark) add("dark", Number(match[1]));
      if (dark.length > 0 || /(?<![-\w])dark:text-/.test(text)) return;
      for (const match of base) add("dark", Number(match[1]));
    });
  }
  return usages;
}

const SRC_ROOT = fileURLToPath(new URL(RELATIVE_SRC_ROOT, import.meta.url));

/** The one muted token, and the shades either side of it that do not work. */
const MUTED = { light: 500, dark: 400 } as const;

describe("slate text against the surface it sits on", () => {
  it("has a ramp whose steps bracket the floor in both directions", () => {
    // The numbers the single muted token is chosen from, stated rather than
    // implied. Light wants a darker shade and dark a lighter one, and the two
    // fail from opposite ends: there is no shade that is muted in both.
    expect(+contrast(SLATE[400], SURFACE.light).toFixed(2)).toBe(2.4);
    expect(+contrast(SLATE[500], SURFACE.light).toFixed(2)).toBe(4.35);
    expect(+contrast(SLATE[400], SURFACE.dark).toFixed(2)).toBe(5.56);
    expect(+contrast(SLATE[500], SURFACE.dark).toFixed(2)).toBe(3.07);
    expect(+contrast(SLATE[600], SURFACE.dark).toFixed(2)).toBe(1.93);
  });

  it("names a muted token that clears the floor in both themes", () => {
    expect(contrast(SLATE[MUTED.light], SURFACE.light)).toBeGreaterThanOrEqual(
      3,
    );
    expect(contrast(SLATE[MUTED.dark], SURFACE.dark)).toBeGreaterThanOrEqual(3);
  });

  it("never puts a shade below 3:1 on the surface behind it", () => {
    const tooFaint = slateText().filter(
      (usage) => contrast(SLATE[usage.shade], usage.surface) < 3,
    );

    expect(
      tooFaint.map(
        (usage) =>
          `${usage.file.replace(/.*\/src\//, "src/")}:${usage.line} ` +
          `${usage.theme} slate-${usage.shade} on ${usage.surface} is ` +
          `${contrast(SLATE[usage.shade], usage.surface).toFixed(2)}:1 — ` +
          usage.text.slice(0, 64),
      ),
    ).toEqual([]);
  });

  it("reads the sources it claims to, so an empty pass is not a green one", () => {
    const usages = slateText();
    expect(usages.filter((u) => u.theme === "light").length).toBeGreaterThan(
      20,
    );
    expect(usages.filter((u) => u.theme === "dark").length).toBeGreaterThan(20);
    expect(new Set(usages.map((u) => u.file)).size).toBeGreaterThan(5);
  });
});
