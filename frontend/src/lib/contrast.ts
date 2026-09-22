/**
 * WCAG contrast arithmetic, the floor the app's text is held to, and the
 * ink/surface pairs that floor applies to.
 *
 * Two tests hold that floor, and neither can do the other's job:
 *
 * - `textContrast.test.ts` reads the sources and answers "which colour does the
 *   app paint this text in, on what surface" — a question only the class names
 *   can answer. It measures against the reference palette below, so it says
 *   nothing about a colour theme that replaces those values.
 * - `e2e/color_theme_contrast.spec.ts` asks a browser what each of those tokens
 *   actually resolves to under every theme — `color-mix(in oklab, …)` and
 *   `oklch()` are real engine work — but from inside a page it cannot see a
 *   class name.
 *
 * So the pairs travel from the first to the second as constants, and the first
 * asserts they still match what it scans: a colour the app starts painting text
 * in fails in vitest, naming the pair to add, before the browser guard is ever
 * asked about it. This module is the only thing both import; it is deliberately
 * free of `node:*` and of the DOM, because `tsconfig.app.json` type-checks
 * everything under `src/` with the browser's type set and the e2e spec runs it
 * in Node.
 */

/**
 * The ratio every shade of text must clear on its surface.
 *
 * WCAG asks 4.5:1 of body text and 3:1 of incidental glyphs, and neither test
 * can tell which a given line is — see `textContrast.test.ts`'s header. 3:1 is
 * therefore the floor both guard, not the standard the app aims at.
 */
export const CONTRAST_FLOOR = 3;

/** Light and dark are separate palettes, and a token means a different colour in each. */
export type ContrastMode = "light" | "dark";

export const CONTRAST_MODES: readonly ContrastMode[] = ["light", "dark"];

/**
 * A Tailwind colour name — `slate-500`, `blue-50`, `white`. Every one of them is
 * a `--color-<token>` custom property, which is what makes a theme able to
 * replace it and this guard able to read it back.
 */
export type ColorToken = string;

/** Ink and the surface behind it. */
export type TextPair = readonly [ink: ColorToken, surface: ColorToken];

/** `blue-900 on blue-50`, for a message or a set comparison. */
export function pairKey([ink, surface]: TextPair): string {
  return `${ink} on ${surface}`;
}

export function colorVariable(token: ColorToken): string {
  return `--color-${token}`;
}

/**
 * The hardest surface the app paints text on, per mode: `slate-100` for light
 * (a chip or a panel; the page itself is white and scores better) and
 * `slate-800` for dark (the header, the sidebar and every menu; the content
 * column is `slate-900` and scores better). The app's chrome, in short.
 */
export const SURFACE: Record<ContrastMode, ColorToken> = {
  light: "slate-100",
  dark: "slate-800",
};

/**
 * Every pair the app paints whose surface is known, and which therefore carries
 * the floor outright. Scanned out of `frontend/src` rather than chosen —
 * `textContrast.test.ts` fails if this drifts from what the class names say.
 *
 * Two kinds of pair qualify, and the second is what extends this guard past the
 * grey ramp:
 *
 * - A slate ink with no background of its own, measured against the mode's
 *   chrome. The app's own layout guarantees that surface.
 * - An ink whose background is named *beside it*, in any family:
 *   `bg-blue-50 … text-blue-900` is the selected row of both pickers, and the
 *   pair is as certain as a pair can be from a class list. This is the case
 *   that catches a theme which turns an accent's high steps into washes — the
 *   ink and the wash stop being on opposite sides of the ramp and the row goes
 *   invisible — and the reference palette clears every one of them, the closest
 *   (`green-600` on `green-50`) at 3.07:1, so the floor here is the app's own
 *   standard rather than an ambition.
 *
 * Dark mode has no accent pair, and that is the sources speaking: every tinted
 * row writes its dark half with an opacity modifier (`dark:bg-blue-900/30`), so
 * the surface is that wash composited over whatever is behind it and no class
 * name says what the result is. Those lines are skipped rather than guessed at.
 */
export const TEXT_PAIRS: Record<ContrastMode, readonly TextPair[]> = {
  light: [
    ["amber-600", "amber-50"],
    ["amber-700", "amber-50"],
    ["blue-600", "blue-50"],
    ["blue-700", "blue-100"],
    ["blue-700", "blue-50"],
    ["blue-900", "blue-50"],
    ["green-600", "green-50"],
    ["purple-600", "purple-50"],
    ["red-600", "red-50"],
    ["slate-500", "slate-100"],
    ["slate-500", "slate-50"],
    ["slate-500", "white"],
    ["slate-600", "slate-100"],
    ["slate-600", "white"],
    ["slate-700", "slate-100"],
    ["slate-700", "slate-200"],
    ["slate-700", "slate-50"],
    ["slate-700", "white"],
    ["slate-800", "slate-100"],
    ["slate-800", "white"],
    ["slate-900", "slate-100"],
    ["slate-900", "slate-50"],
  ],
  dark: [
    ["slate-100", "slate-800"],
    ["slate-100", "slate-900"],
    ["slate-200", "slate-600"],
    ["slate-200", "slate-700"],
    ["slate-200", "slate-800"],
    ["slate-200", "slate-900"],
    ["slate-300", "slate-700"],
    ["slate-300", "slate-800"],
    ["slate-300", "slate-900"],
    ["slate-400", "slate-700"],
    ["slate-400", "slate-800"],
    ["slate-400", "slate-900"],
    ["slate-900", "slate-100"],
  ],
};

/**
 * Accent ink the app paints with no background of its own: status glyphs in the
 * tree, spinners, check marks, the file picker's matched characters, a diff
 * gutter's `+`/`−`. Their surface is the mode's chrome, so the pair is
 * measurable — but the floor cannot be applied to them, because **the reference
 * palette itself misses it in ten of these pairs**, `amber-400` on light chrome
 * reading 1.57:1 and `blue-600` on dark chrome 2.79:1.
 *
 * That is real debt, and it is the app's, not a theme's: it lives in the class
 * names (`text-amber-500` with no `dark:` half and no darker light half), so no
 * palette can fix it and a floor here would fail the default look — the one
 * thing a theme guard must never do. What the browser guard asks of these
 * instead is that **no theme be the one that breaks them**: where the reference
 * palette clears the floor, every theme must too. A theme that flattens an
 * accent into a wash fails; a theme that inherits the app's own debt does not.
 *
 * Scanned, like the pairs above, so a new accent the app inks lands here rather
 * than going unmeasured.
 */
export const ACCENT_ON_CHROME: Record<ContrastMode, readonly TextPair[]> = {
  light: [
    ["amber-400", "slate-100"],
    ["amber-500", "slate-100"],
    ["amber-600", "slate-100"],
    ["amber-700", "slate-100"],
    ["blue-400", "slate-100"],
    ["blue-500", "slate-100"],
    ["blue-600", "slate-100"],
    ["green-400", "slate-100"],
    ["green-500", "slate-100"],
    ["green-600", "slate-100"],
    ["green-700", "slate-100"],
    ["red-200", "slate-100"],
    ["red-400", "slate-100"],
    ["red-500", "slate-100"],
    ["red-600", "slate-100"],
    ["red-700", "slate-100"],
  ],
  dark: [
    ["amber-400", "slate-800"],
    ["amber-500", "slate-800"],
    ["blue-400", "slate-800"],
    ["blue-500", "slate-800"],
    ["blue-600", "slate-800"],
    ["green-400", "slate-800"],
    ["green-500", "slate-800"],
    ["red-200", "slate-800"],
    ["red-300", "slate-800"],
    ["red-400", "slate-800"],
    ["red-500", "slate-800"],
  ],
};

/**
 * The default look: what Chrome resolves each token to with no theme in the
 * page. Tailwind v4 declares its palette in `oklch`, so these are not written
 * anywhere in the repo — they were read off the running app, and the browser
 * guard asserts the default look still resolves to them, which is what keeps
 * the unit guard's arithmetic measuring the same colours the reader sees.
 *
 * It is also the reference every theme is compared against for the accent pairs
 * above, and the reason that comparison can be honest: these values are the
 * app's own design, not an ideal.
 */
export const REFERENCE_COLORS: Record<ColorToken, string> = {
  white: "#ffffff",
  "slate-50": "#f8fafc",
  "slate-100": "#f1f5f9",
  "slate-200": "#e2e8f0",
  "slate-300": "#cad5e2",
  "slate-400": "#90a1b9",
  "slate-500": "#62748e",
  "slate-600": "#45556c",
  "slate-700": "#314158",
  "slate-800": "#1d293d",
  "slate-900": "#0f172b",
  "slate-950": "#020618",
  "amber-50": "#fffbeb",
  "amber-400": "#ffb900",
  "amber-500": "#fe9a00",
  "amber-600": "#e17100",
  "amber-700": "#bb4d00",
  "blue-50": "#eff6ff",
  "blue-100": "#dbeafe",
  "blue-400": "#50a2ff",
  "blue-500": "#2b7fff",
  "blue-600": "#155dfc",
  "blue-700": "#1447e6",
  "blue-900": "#1c398e",
  "green-50": "#f0fdf4",
  "green-400": "#05df72",
  "green-500": "#00c950",
  "green-600": "#00a63e",
  "green-700": "#008236",
  "purple-50": "#faf5ff",
  "purple-600": "#9810fa",
  "red-50": "#fef2f2",
  "red-200": "#ffc9c9",
  "red-300": "#ffa2a2",
  "red-400": "#ff6467",
  "red-500": "#fb2c36",
  "red-600": "#e7000b",
  "red-700": "#c10007",
};

/** Every token the two lists name, plus the whole reference ramp. */
export function measuredTokens(): ColorToken[] {
  const tokens = new Set<ColorToken>(Object.keys(REFERENCE_COLORS));
  for (const mode of CONTRAST_MODES) {
    for (const [ink, surface] of [
      ...TEXT_PAIRS[mode],
      ...ACCENT_ON_CHROME[mode],
    ]) {
      tokens.add(ink);
      tokens.add(surface);
    }
  }
  return [...tokens];
}

/** WCAG 2.1 relative luminance of an opaque `#rrggbb`. */
export function luminance(hex: string): number {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
