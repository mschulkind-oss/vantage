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
 * The class says the color; it does not say whether the text is a label, a
 * sentence, or a separator glyph. WCAG asks 4.5:1 of body text and 3:1 of an
 * incidental glyph, so the **floor** is what this guards: every ink the app puts
 * on a surface must clear 3:1 there, in both themes. The 4.5:1 cases were
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
 * ## Scope, stated so its edges are not mistaken for coverage
 *
 * `frontend/src`, un-prefixed or `dark:`-prefixed classes, and **every color
 * family, not only slate** — an accent's high steps are ink and its low steps
 * are washes, and a pair of them named together (`bg-blue-50 …
 * text-blue-900`, the selected row of both pickers) is as measurable as any
 * gray. What stays out is anything whose surface a class name cannot settle:
 * a background with an opacity modifier (`dark:bg-blue-900/30` is a wash over
 * something this test cannot see), a background painted by an ancestor element
 * rather than the line's own class list, and accent ink with no background at
 * all — the last of which is measured against the chrome but *reported* rather
 * than floored, because the reference palette misses the floor there itself.
 * See `ACCENT_ON_CHROME` in `contrast.ts`.
 *
 * The colors a document can reach (tone washes, alert inks, syntax
 * highlighting) are declared in CSS rather than in a class name, so they are
 * answerable only to a measurement of the running page.
 *
 * ## The other half of this guard
 *
 * Every constant here is shared with `e2e/color_theme_contrast.spec.ts`, which
 * measures the same pairs in a real browser under every color theme — a theme
 * replaces these values with `oklch()` and `color-mix()` expressions that only
 * an engine resolves. This file is what keeps the shared pair lists honest: a
 * color the app starts painting text in fails here first.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCENT_ON_CHROME,
  CONTRAST_FLOOR,
  CONTRAST_MODES,
  REFERENCE_COLORS,
  SURFACE,
  TEXT_PAIRS,
  contrast,
  pairKey,
  type ColorToken,
  type ContrastMode,
  type TextPair,
} from "./contrast";

const RELATIVE_SRC_ROOT = "..";

/** A slate step of the reference palette, by number. */
function slate(step: number): string {
  return REFERENCE_COLORS[`slate-${step}`];
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
  mode: ContrastMode;
  ink: ColorToken;
  surface: ColorToken;
  /** Whether the line names the background itself, rather than inheriting the chrome. */
  named: boolean;
  text: string;
}

/**
 * What this line's ink sits on, in one mode.
 *
 * `null` means "cannot tell", and it is the answer whenever the line paints a
 * background this test cannot resolve to a single color: an opacity modifier
 * (`bg-red-900/30`), an arbitrary value, a gradient. A line that names a
 * background in any family is measured against *that*, which is both what lets
 * a chip invert (`dark:bg-slate-100 dark:text-slate-900`) and what makes an
 * accent row's ink measurable at all.
 *
 * `named: false` is the fallback: no background on this line, so the ink is on
 * the app's chrome.
 */
function surfaceOf(
  text: string,
  mode: ContrastMode,
): { token: ColorToken; named: boolean } | null {
  // The light lookbehind has to reject a `:` as well as a word character, or
  // `dark:bg-slate-900` answers the question the light mode asked.
  const prefix = mode === "dark" ? "(?<![-\\w])dark:" : "(?<![-\\w:])";
  const named = new RegExp(`${prefix}bg-([a-z]+-\\d+|white)(?![-\\w/])`).exec(
    text,
  );
  if (named) return { token: named[1], named: true };
  // A bare `bg-*` also paints in dark mode, unless a `dark:bg-*` overrides it.
  // Reaching here means whichever applies was not a color this test can name.
  const bare = /(?<![-\w:])bg-(?!white\b)[a-z]+-\d+/.test(text);
  const dark = /(?<![-\w])dark:bg-/.test(text);
  if (mode === "dark" ? dark || bare : bare) return null;
  return { token: SURFACE[mode], named: false };
}

/**
 * Every ink the app paints, and the mode each one paints in.
 *
 * A bare `text-<color>` is the light value *and* the dark value unless a
 * `dark:text-…` on the same line overrides it. The line is the unit because a
 * Tailwind class list is written as one string: a `dark:` variant lives beside
 * the base class it overrides, and so does the background the pair sits on.
 *
 * Variant-prefixed shades (`hover:`, `prose-p:`) are out of scope — a hover
 * state is not the resting appearance, and the prose colors are body ink that
 * `@tailwindcss/typography` already steps per theme.
 */
function textUsages(): Usage[] {
  const usages: Usage[] = [];
  for (const file of sources(SRC_ROOT)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      const add = (mode: ContrastMode, ink: ColorToken) => {
        const surface = surfaceOf(text, mode);
        if (surface === null) return;
        usages.push({
          file,
          line: index + 1,
          mode,
          ink,
          surface: surface.token,
          named: surface.named,
          text: text.trim(),
        });
      };
      const base = [...text.matchAll(/(?<![-\w:])text-([a-z]+-\d+)\b/g)];
      for (const match of base) add("light", match[1]);

      const dark = [...text.matchAll(/(?<![-\w])dark:text-([a-z]+-\d+)\b/g)];
      for (const match of dark) add("dark", match[1]);
      if (dark.length > 0 || /(?<![-\w])dark:text-/.test(text)) return;
      for (const match of base) add("dark", match[1]);
    });
  }
  return usages;
}

const SRC_ROOT = fileURLToPath(new URL(RELATIVE_SRC_ROOT, import.meta.url));

function family(token: ColorToken): string {
  return token.replace(/-\d+$/, "");
}

/**
 * A usage the floor applies to: its surface is either named beside the ink or,
 * for a gray, guaranteed by the app's own layout. The rest is accent ink on the
 * chrome, which is measured but not floored — see `ACCENT_ON_CHROME`.
 */
function floored(usage: Usage): boolean {
  return usage.named || family(usage.ink) === "slate";
}

/** The distinct pairs of a set of usages, as `TEXT_PAIRS` writes them. */
function pairsOf(
  usages: Usage[],
  mode: ContrastMode,
  keep: (usage: Usage) => boolean,
): string[] {
  const keys = usages
    .filter((usage) => usage.mode === mode && keep(usage))
    .map((usage) => pairKey([usage.ink, usage.surface]));
  return [...new Set(keys)].sort();
}

function declared(pairs: readonly TextPair[]): string[] {
  return pairs.map(pairKey).sort();
}

/** The one muted token, and the shades either side of it that do not work. */
const MUTED = { light: 500, dark: 400 } as const;

describe("text against the surface it sits on", () => {
  it("has a ramp whose steps bracket the floor in both directions", () => {
    // The numbers the single muted token is chosen from, stated rather than
    // implied. Light wants a darker shade and dark a lighter one, and the two
    // fail from opposite ends: there is no shade that is muted in both.
    expect(
      +contrast(slate(400), REFERENCE_COLORS[SURFACE.light]).toFixed(2),
    ).toBe(2.4);
    expect(
      +contrast(slate(500), REFERENCE_COLORS[SURFACE.light]).toFixed(2),
    ).toBe(4.35);
    expect(
      +contrast(slate(400), REFERENCE_COLORS[SURFACE.dark]).toFixed(2),
    ).toBe(5.56);
    expect(
      +contrast(slate(500), REFERENCE_COLORS[SURFACE.dark]).toFixed(2),
    ).toBe(3.07);
    expect(
      +contrast(slate(600), REFERENCE_COLORS[SURFACE.dark]).toFixed(2),
    ).toBe(1.93);
  });

  it("names a muted token that clears the floor in both themes", () => {
    expect(
      contrast(slate(MUTED.light), REFERENCE_COLORS[SURFACE.light]),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    expect(
      contrast(slate(MUTED.dark), REFERENCE_COLORS[SURFACE.dark]),
    ).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });

  it("never puts an ink below 3:1 on the surface behind it", () => {
    const tooFaint = textUsages()
      .filter(floored)
      .filter(
        (usage) =>
          contrast(
            REFERENCE_COLORS[usage.ink],
            REFERENCE_COLORS[usage.surface],
          ) < CONTRAST_FLOOR,
      );

    expect(
      tooFaint.map(
        (usage) =>
          `${usage.file.replace(/.*\/src\//, "src/")}:${usage.line} ` +
          `${usage.mode} ${usage.ink} on ${usage.surface} is ` +
          `${contrast(REFERENCE_COLORS[usage.ink], REFERENCE_COLORS[usage.surface]).toFixed(2)}:1 — ` +
          usage.text.slice(0, 64),
      ),
    ).toEqual([]);
  });

  it("paints text in exactly the pairs the browser guard measures", () => {
    // The browser guard cannot see a class name, so the pair lists live in
    // `contrast.ts` and this is what keeps them true. A color the app starts
    // inking fails here first, naming the pair to add — to `TEXT_PAIRS` if its
    // surface is known, to `ACCENT_ON_CHROME` if it is an accent on the chrome.
    const usages = textUsages();
    for (const mode of CONTRAST_MODES) {
      expect(
        pairsOf(usages, mode, floored),
        `${mode}: pairs the floor applies to`,
      ).toEqual(declared(TEXT_PAIRS[mode]));
      expect(
        pairsOf(usages, mode, (usage) => !floored(usage)),
        `${mode}: accent ink on the chrome`,
      ).toEqual(declared(ACCENT_ON_CHROME[mode]));
    }
  });

  it("has a reference color for every token it measures", () => {
    // A token with no entry would silently measure `undefined` against
    // `undefined` and pass, which is the one way this file can lie.
    const missing = new Set<string>();
    for (const usage of textUsages()) {
      for (const token of [usage.ink, usage.surface]) {
        if (!REFERENCE_COLORS[token]) missing.add(token);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("reads the sources it claims to, so an empty pass is not a green one", () => {
    const usages = textUsages();
    expect(usages.filter((u) => u.mode === "light").length).toBeGreaterThan(20);
    expect(usages.filter((u) => u.mode === "dark").length).toBeGreaterThan(20);
    expect(new Set(usages.map((u) => u.file)).size).toBeGreaterThan(5);
    // And past the gray ramp, which is all this guard covered until the themes
    // arrived: the accent pair below was a live 1.27:1 under one of them.
    expect(
      pairsOf(usages, "light", floored).filter(
        (key) => !key.startsWith("slate"),
      ),
    ).toContain("blue-900 on blue-50");
  });
});
