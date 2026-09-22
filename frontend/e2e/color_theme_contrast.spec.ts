/**
 * No colour theme may make the app's text illegible, and picking one must
 * actually recolour the page.
 *
 * `src/lib/textContrast.test.ts` already holds the 3:1 floor, but it holds it
 * against the reference palette — it reads class names out of the sources, so it
 * can say *which* colour the app paints a label in and *what* surface sits
 * behind it, and nothing at all about what a theme replaces those colours with.
 * A theme is a stylesheet that redefines `--color-<family>-<step>`, so it can
 * move a shipped ink to 2:1, or turn the high end of an accent ramp into a wash
 * that its own selected row then writes text in, and every existing test stays
 * green. That last one was live at 1.27:1.
 *
 * This has to be a browser, not vitest. A theme's steps are written as
 * `color-mix(in oklab, var(--ctp-text) 85%, black)`, `oklch(…)` and `var()`
 * chains several links long; jsdom computes none of them, so a unit test here
 * would either read the declaration verbatim and assert nothing, or need a
 * colour-space implementation of our own to be wrong in. Chrome already has one.
 *
 * What travels between the two guards is `src/lib/contrast.ts`: the WCAG
 * arithmetic, the floor, the ink/surface pairs the app paints, and the reference
 * palette. This file cannot scan a class name from inside a browser and that
 * file cannot resolve a colour, so the pairs are stated once and the vitest
 * guard fails if they drift from the sources.
 *
 * Two things are asked of a theme, because the pairs come in two kinds:
 *
 * - `TEXT_PAIRS` — a known surface, so the floor applies outright. The reference
 *   palette clears every one of them, the closest at 3.07:1.
 * - `ACCENT_ON_CHROME` — accent ink with no background of its own: tree status
 *   glyphs, spinners, check marks. The reference palette misses the floor in ten
 *   of these itself (`amber-400` on light chrome is 1.57:1), so what a theme is
 *   held to is that it not be the one that breaks them: where the default look
 *   clears the floor, a theme must too. Flooring them outright would fail the
 *   default look, which is the one thing a theme guard must never do.
 *
 * The themes are enumerated from the "Colours" select rather than listed here,
 * so a palette added to `src/themes/` is covered the day it ships without
 * touching this spec. In this fixture the select offers the built-ins alone: the
 * suite runs the backend under a scratch `$HOME` (see `playwright.config.ts`),
 * so there is no themes directory and no user theme.
 *
 * The `Justfile` runs this through `just e2e` with the rest of the suite; on its
 * own it is `cd frontend && npx playwright test color_theme_contrast`.
 */
import { test as base, expect, type Page } from "@playwright/test";
import {
  ACCENT_ON_CHROME,
  CONTRAST_FLOOR,
  CONTRAST_MODES,
  REFERENCE_COLORS,
  TEXT_PAIRS,
  colorVariable,
  contrast,
  measuredTokens,
  pairKey,
  type ColorToken,
  type ContrastMode,
  type TextPair,
} from "../src/lib/contrast";

/** Set on `<html>` only once the theme's variables are live. See `colorTheme.ts`. */
const THEME_ATTRIBUTE = "data-vantage-theme";

/** The id that means "no stylesheet", and so carries no attribute either — the reference look. */
const DEFAULT_THEME = "default";

/** Every token the pair lists name, plus the reference ramp. */
const TOKENS = measuredTokens();

/** What one theme looks like in one mode. */
interface Measured {
  /** `--color-<token>` as `#rrggbb`, or `null` when it could not be resolved. */
  colors: Record<ColorToken, string | null>;
  /** Computed colours of real elements, to prove the page moved at all. */
  page: Record<string, string>;
}

interface Theme {
  id: string;
  label: string;
  modes: Partial<Record<ContrastMode, Measured>>;
}

function settingsMenu(page: Page) {
  return page.getByRole("menu", { name: "Settings" });
}

/** Open the settings menu if it is not already open; it stays open throughout. */
async function openSettings(page: Page): Promise<void> {
  const menu = settingsMenu(page);
  if (await menu.isVisible()) return;
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(menu).toBeVisible();
}

/**
 * The themes the app offers, read off the select itself.
 *
 * A label ending in "(light only)" is a theme with no `:root.dark` rule, which
 * the picker says so about; in dark mode it renders its light palette on a page
 * the reader asked to be dark, and that is a property of the theme file rather
 * than something a contrast floor can usefully report. Those are measured in
 * light mode only. This fixture has none — the built-ins all declare both
 * halves — so the branch exists for a user theme, not for a green pass here.
 */
async function offeredThemes(page: Page): Promise<Theme[]> {
  await openSettings(page);
  const select = settingsMenu(page).getByLabel("Colours");
  await expect(select).toBeVisible();
  const options = await select.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((o) => ({
      id: o.value,
      label: o.textContent?.trim() ?? "",
    })),
  );
  return options.map((o) => ({ ...o, modes: {} }));
}

function hasDark(theme: Theme): boolean {
  return !/\(light only\)$/.test(theme.label);
}

/** Pick `id` the way a reader does, and wait until its variables are in effect. */
async function chooseTheme(page: Page, id: string): Promise<void> {
  await openSettings(page);
  await settingsMenu(page).getByLabel("Colours").selectOption(id);
  const html = page.locator("html");
  // The attribute is the app's own signal that the stylesheet has loaded — it
  // is set in the `<link>`'s load handler, never before. Reading variables
  // without waiting for it races a half-applied theme.
  if (id === DEFAULT_THEME) {
    await expect(html).not.toHaveAttribute(THEME_ATTRIBUTE, /./);
  } else {
    await expect(html).toHaveAttribute(THEME_ATTRIBUTE, id);
  }
}

/** Switch light/dark through the menu, the way the reader's own click does. */
async function chooseMode(page: Page, mode: ContrastMode): Promise<void> {
  await openSettings(page);
  const label = mode === "dark" ? "Dark" : "Light";
  await settingsMenu(page).getByRole("button", { name: label }).click();
  const html = page.locator("html");
  if (mode === "dark") await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
}

/**
 * Each token as sRGB bytes, plus a few real elements' computed colours.
 *
 * `getComputedStyle().getPropertyValue()` hands a custom property back
 * verbatim — `color-mix(in oklab, …)` stays that string — so this resolves them
 * the way `mermaidTheme.ts`'s `resolveCssColor` does: a probe element takes
 * `color: var(--token)`, which forces the engine to compute it, and a 1×1 canvas
 * turns whatever syntax came back into bytes.
 *
 * Two traps that function documents and this shares:
 *
 * - A property nobody declared has to be caught before the probe. `color:
 *   var(--unset)` is invalid at computed-value time, so the probe *inherits*
 *   the page's text colour and the canvas reports a plausible hex for a token
 *   that does not exist. Hence the empty-declaration check first, and a `null`
 *   the caller reports rather than measures.
 * - The canvas is per token, not per scan. An invalid `fillStyle` assignment is
 *   silently ignored, which on a shared context means the *previous* token's
 *   colour read back as this one's. A fresh context starts from black, so a
 *   colour that cannot be painted reads as black and fails loudly.
 */
async function measure(page: Page): Promise<Measured> {
  // The property names are built out here rather than in the page, so the
  // `--color-` convention has one definition and it is the shared module's.
  const properties = TOKENS.map(
    (token) => [token, colorVariable(token)] as const,
  );
  return page.evaluate((tokens: readonly (readonly string[])[]): Measured => {
    const root = document.documentElement;
    const resolve = (property: string): string | null => {
      const declared = getComputedStyle(root).getPropertyValue(property).trim();
      if (!declared) return null;
      const probe = document.createElement("span");
      probe.style.display = "none";
      probe.style.color = `var(${property})`;
      root.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      if (!computed) return null;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `#${[r, g, b]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")}`;
    };

    const colors: Record<string, string | null> = {};
    for (const [token, property] of tokens) colors[token] = resolve(property);

    // Painted surfaces rather than variables: a theme that sets every variable
    // and reaches no element is the failure these catch.
    const read = (selector: string, property: "color" | "backgroundColor") => {
      const el = document.querySelector(selector);
      if (!el) return "missing";
      return getComputedStyle(el)[property];
    };
    return {
      colors,
      page: {
        "sidebar background": read(
          '[data-testid="sidebar"]',
          "backgroundColor",
        ),
        "sidebar text": read('[data-testid="sidebar"]', "color"),
        "body background": read("body", "backgroundColor"),
        "body text": read("body", "color"),
      },
    };
  }, properties);
}

/**
 * Drive the picker over every theme the app offers, in both modes, and bring
 * back what each one resolved to. One pass, one page: nothing here reloads, so
 * the reader's own sequence of clicks is what the measurements come from.
 */
async function scanThemes(page: Page): Promise<Theme[]> {
  await page.goto("/");
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

  const themes = await offeredThemes(page);
  expect(
    themes.map((t) => t.id),
    "the Colours select offered nothing to measure",
  ).toContain(DEFAULT_THEME);

  for (const theme of themes) {
    await chooseTheme(page, theme.id);
    for (const mode of CONTRAST_MODES) {
      if (mode === "dark" && !hasDark(theme)) continue;
      await chooseMode(page, mode);
      theme.modes[mode] = await measure(page);
    }
  }
  return themes;
}

/**
 * The scan is worker-scoped: every test below asks the same questions of the
 * same measurements, and driving the picker over seven themes and both modes
 * once per test would be the slowest thing in the suite for no added coverage.
 */
type WorkerFixtures = { palettes: Theme[] };

const test = base.extend<Record<string, never>, WorkerFixtures>({
  palettes: [
    // The second parameter is Playwright's `use`, renamed: eslint's
    // react-hooks rules read a call to `use` as React's, and a fixture that
    // needs a page closed after it cannot then say so in a try/finally.
    async ({ browser }, runTests) => {
      const page = await browser.newPage();
      const themes = await scanThemes(page);
      // Nothing below touches the page — every colour is already read — so it
      // closes here rather than being held open for the whole worker.
      await page.close();
      await runTests(themes);
    },
    { scope: "worker" },
  ],
});

/**
 * Two decimals, truncated rather than rounded.
 *
 * A ratio of 2.995 is a failure, and a failure message that reports it as
 * `3.00:1` reads like a bug in the guard rather than a defect in the palette —
 * which is exactly what one theme's raised-row ink measured.
 */
function format(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2);
}

/** The ratio a pair resolves to, or `null` when either end could not be read. */
function ratioOf(measured: Measured, [ink, surface]: TextPair): number | null {
  const a = measured.colors[ink];
  const b = measured.colors[surface];
  return a && b ? contrast(a, b) : null;
}

/** `blue-900 #4c4f69 on blue-50 #dcd0f0 is 1.27:1`, or why it cannot be read. */
function describePair(measured: Measured, pair: TextPair): string {
  const [ink, surface] = pair;
  const ratio = ratioOf(measured, pair);
  if (ratio === null) {
    return (
      `${ink} (${measured.colors[ink] ?? "unresolved"}) on ` +
      `${surface} (${measured.colors[surface] ?? "unresolved"}) could not be measured`
    );
  }
  return `${ink} ${measured.colors[ink]} on ${surface} ${measured.colors[surface]} is ${format(ratio)}:1`;
}

/** One line per theme and mode, plus the worst pair in it — the table's summary. */
function summarise(
  theme: Theme,
  mode: ContrastMode,
  pairs: readonly TextPair[],
): string {
  const measured = theme.modes[mode];
  if (!measured) return `${theme.id} ${mode}: skipped (light only)`;
  let worst: { pair: TextPair; ratio: number } | null = null;
  for (const pair of pairs) {
    const ratio = ratioOf(measured, pair);
    if (ratio === null) continue;
    if (!worst || ratio < worst.ratio) worst = { pair, ratio };
  }
  const tail = worst
    ? `worst ${pairKey(worst.pair)} at ${format(worst.ratio)}:1`
    : "nothing measurable";
  return `${theme.id} ${mode}: ${pairs.length} pairs, ${tail}`;
}

test.describe("every colour theme keeps the app's text legible", () => {
  test(`no pair with a known surface falls below ${CONTRAST_FLOOR}:1`, async ({
    palettes,
  }) => {
    const table: string[] = [];
    const failures: string[] = [];
    for (const theme of palettes) {
      for (const mode of CONTRAST_MODES) {
        table.push(summarise(theme, mode, TEXT_PAIRS[mode]));
        const measured = theme.modes[mode];
        if (!measured) continue;
        for (const pair of TEXT_PAIRS[mode]) {
          const ratio = ratioOf(measured, pair);
          if (ratio !== null && ratio >= CONTRAST_FLOOR) continue;
          // The theme and the mode lead, because the fix is in one palette's
          // file and one of its two rules — a ratio on its own names neither.
          const line = `${theme.id} (${mode}): ${describePair(measured, pair)}`;
          failures.push(line);
          table.push(`  FAIL ${line}`);
        }
      }
    }
    console.log(["", ...table].join("\n"));

    expect(failures).toEqual([]);
  });

  test("never flattens an accent the default look keeps legible", async ({
    palettes,
  }) => {
    const reference = palettes.find((t) => t.id === DEFAULT_THEME);
    expect(reference, "no default look to compare against").toBeDefined();

    const table: string[] = [];
    const failures: string[] = [];
    for (const mode of CONTRAST_MODES) {
      for (const pair of ACCENT_ON_CHROME[mode]) {
        const base = ratioOf(reference!.modes[mode]!, pair);
        // The pairs the app's own class names already fail are reported and
        // left alone: no palette can fix `text-amber-500` on a light panel, and
        // failing every theme for it would say nothing about any of them.
        if (base === null || base < CONTRAST_FLOOR) {
          table.push(
            `skip ${mode} ${pairKey(pair)}: the default look is ` +
              `${base === null ? "?" : format(base)}:1, below the floor itself`,
          );
          continue;
        }
        for (const theme of palettes) {
          const measured = theme.modes[mode];
          if (!measured || theme.id === DEFAULT_THEME) continue;
          const ratio = ratioOf(measured, pair);
          if (ratio !== null && ratio >= CONTRAST_FLOOR) continue;
          const line =
            `${theme.id} (${mode}): ${describePair(measured, pair)} — ` +
            `the default look reads ${format(base)}:1 here`;
          failures.push(line);
          table.push(`  FAIL ${line}`);
        }
      }
    }
    console.log(["", ...table].join("\n"));

    expect(failures).toEqual([]);
  });

  test("resolves every token it measures, in every theme and mode", async ({
    palettes,
  }) => {
    // The built-ins, at least, are all here: a select that silently offered one
    // option would otherwise pass every assertion above.
    expect(palettes.length).toBeGreaterThanOrEqual(3);
    for (const theme of palettes) {
      for (const mode of CONTRAST_MODES) {
        const measured = theme.modes[mode];
        if (!measured) continue;
        expect(
          TOKENS.filter((token) => !measured.colors[token]),
          `${theme.id} (${mode}) resolved no colour for these tokens`,
        ).toEqual([]);
      }
    }
  });

  test("still resolves the default look to the constants the unit guard measures", async ({
    palettes,
  }) => {
    // `REFERENCE_COLORS` is Tailwind's palette as Chrome computes it from
    // `oklch()`, which is why it is not written anywhere in the repo. The unit
    // guard's whole arithmetic rests on it, so this is where it is checked
    // against the engine — a byte of slack per channel, because a browser
    // upgrade may round a conversion differently without changing a colour.
    const reference = palettes.find((t) => t.id === DEFAULT_THEME)!;
    const drifted: string[] = [];
    for (const [token, expected] of Object.entries(REFERENCE_COLORS)) {
      // Light mode: the reference values are Tailwind's `:root` declarations,
      // which is what the default look paints with in both modes.
      const actual = reference.modes.light!.colors[token];
      const channels = (hex: string) =>
        [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
      if (
        !actual ||
        channels(actual).some((v, i) => Math.abs(v - channels(expected)[i]) > 2)
      ) {
        drifted.push(`${token}: expected ${expected}, Chrome says ${actual}`);
      }
    }
    expect(drifted).toEqual([]);
  });
});

test.describe("a colour theme reaches the page", () => {
  test("recolours real elements, and still switches light to dark", async ({
    palettes,
  }) => {
    const fingerprint = (m: Measured) => JSON.stringify(m.page);
    const base = palettes.find((t) => t.id === DEFAULT_THEME);
    expect(base, "no default theme to compare against").toBeDefined();

    for (const theme of palettes) {
      for (const mode of CONTRAST_MODES) {
        const measured = theme.modes[mode];
        if (!measured) continue;
        // Not "missing": a selector that stopped matching would make every
        // comparison below trivially equal and prove nothing.
        expect(
          Object.entries(measured.page).filter(([, v]) => v === "missing"),
          `${theme.id} (${mode}) could not find an element to measure`,
        ).toEqual([]);
      }

      // Light and dark are separate rules in the same sheet, and a theme that
      // declares only `:root` applies it in both. Under every theme the modes
      // must still look different.
      if (hasDark(theme)) {
        expect(
          fingerprint(theme.modes.light!),
          `${theme.id} paints the same colours in light and dark`,
        ).not.toEqual(fingerprint(theme.modes.dark!));
      }

      // The attribute is not the point: a theme whose variables reached no
      // element would set it and change nothing a reader can see.
      if (theme.id === DEFAULT_THEME) continue;
      for (const mode of CONTRAST_MODES) {
        const measured = theme.modes[mode];
        if (!measured) continue;
        expect(
          fingerprint(measured),
          `${theme.id} (${mode}) paints exactly what the default look paints`,
        ).not.toEqual(fingerprint(base!.modes[mode]!));
      }
    }
  });
});
