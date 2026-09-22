/**
 * Drift guards over the colour-theme half of `frontend/src/index.css` and the
 * built-in themes in `frontend/src/themes/`.
 *
 * The promise these rules make is two-sided, and each side fails silently:
 *
 *   - **with no theme, nothing moves.** The typography restatement has to be
 *     the plugin's own `prose-slate` values, one for one, or body text changes
 *     colour for every reader who never asked for a theme — and no test that
 *     renders in jsdom would notice, because jsdom does not resolve `var()`.
 *     So the expected values are *derived from the plugin's source* in
 *     `node_modules`, never typed out here: a plugin upgrade that moves a step
 *     fails this file instead of shifting the page.
 *   - **with a theme, everything the theme names is reached.** A code role
 *     scoped wrongly leaks into the built-in look (an unscoped rule would
 *     repaint GitHub's highlight palette for everyone); a role the built-in
 *     theme forgets falls back to a step of its palette, which renders — just
 *     not in the theme's colours.
 *
 * Text assertions, read with `fs`, for the reason `directiveTheme.test.ts`
 * gives: vitest stubs CSS imports to the empty string, `?raw` included, which
 * would make every assertion below pass vacuously.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

/** See `directiveTheme.test.ts`: a literal URL here is rewritten by Vite. */
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** Comments name the selectors and variables they explain, so drop them. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

const indexCss = stripComments(read("../index.css"));
const catppuccinCss = stripComments(read("../themes/catppuccin.css"));
const lilaCss = stripComments(read("../themes/lila.css"));

const require = createRequire(import.meta.url);

type CssMap = Record<string, string>;

/** The typography plugin's modifier table — the source the build inlines. */
const typography = require("@tailwindcss/typography/src/styles.js") as Record<
  string,
  { css: CssMap }
>;

/** Tailwind's palette, as the plugin itself imports it. */
const palette = require("tailwindcss/colors") as Record<
  string,
  string | Record<string, string>
>;

interface Rule {
  selectors: string[];
  body: string;
  /** Offset in the comment-stripped text, for order assertions. */
  at: number;
}

/**
 * Every flat `selectors { declarations }` rule. None of the rules under test
 * nest, and a nested at-rule's inner blocks still come out as flat rules —
 * with a junk selector that no assertion here looks for.
 */
function rules(css: string): Rule[] {
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({
    selectors: m[1]
      // Not inside parentheses: `:where(.dark, .dark *)` is one selector.
      .split(/,(?![^(]*\))/)
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean),
    body: m[2],
    at: m.index,
  }));
}

/** Custom-property declarations in a rule body, in source order. */
function declarations(body: string): CssMap {
  const out: CssMap = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    // Prettier breaks a long `color-mix(` over lines; compare it as one.
    out[m[1]] = m[2]
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\( /g, "(")
      .replace(/ \)/g, ")");
  }
  return out;
}

/** The one rule whose selector list is exactly `selectors`. */
function ruleFor(css: string, ...selectors: string[]): Rule {
  const found = rules(css).filter(
    (r) => r.selectors.join(",") === selectors.join(","),
  );
  expect(found, `rules for \`${selectors.join(", ")}\``).toHaveLength(1);
  return found[0];
}

/**
 * The plugin's value with every Tailwind palette literal replaced by the theme
 * variable that holds it — `oklch(37.2% …)` → `var(--color-slate-700)`,
 * `#fff` → `var(--color-white)`. Anything that is not a palette literal (the
 * two `rgb(… / N%)` alphas) is expected verbatim.
 */
function asVariables(value: string): string {
  const byLiteral = new Map<string, string>();
  for (const [family, steps] of Object.entries(palette)) {
    if (typeof steps === "string") {
      byLiteral.set(steps, `var(--color-${family})`);
      continue;
    }
    for (const [step, literal] of Object.entries(steps)) {
      // Slate is the palette `prose-slate` reads, so it wins any tie.
      if (!byLiteral.has(literal) || family === "slate") {
        byLiteral.set(literal, `var(--color-${family}-${step})`);
      }
    }
  }
  return value.replace(
    /oklch\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g,
    (literal) => byLiteral.get(literal) ?? literal,
  );
}

describe("the typography restatement (.prose-slate)", () => {
  const plugin = typography.slate.css;
  const restated = declarations(ruleFor(indexCss, ".prose-slate").body);

  it("restates exactly the variables the plugin's prose-slate sets", () => {
    expect(Object.keys(restated).sort()).toEqual(Object.keys(plugin).sort());
  });

  it.each(Object.keys(typography.slate.css))(
    "%s is the plugin's value, as the palette step it came from",
    (name) => {
      expect(restated[name]).toBe(asVariables(plugin[name]));
    },
  );

  it("reaches the palette through variables, not literals, wherever it can", () => {
    // The whole point of restating: 34 of the 36 values are a theme's to move.
    // The two that stay literal are the alpha-over-white/black the build
    // quantises to hex (see the comment above the rule in index.css).
    const literal = Object.entries(restated).filter(
      ([, value]) => !value.includes("var(--color-"),
    );
    expect(Object.fromEntries(literal)).toEqual({
      "--tw-prose-invert-kbd-shadows": plugin["--tw-prose-invert-kbd-shadows"],
      "--tw-prose-invert-pre-bg": plugin["--tw-prose-invert-pre-bg"],
    });
  });
});

describe("the invert re-assertion", () => {
  const invert = rules(indexCss).find((r) =>
    r.selectors.includes(".prose-invert"),
  );

  it("exists", () => {
    expect(invert).toBeDefined();
  });

  it("maps every variable the plugin's invert maps, the way it maps them", () => {
    expect(declarations(invert!.body)).toEqual(typography.invert.css);
  });

  it("covers every non-invert variable the restatement sets", () => {
    // Anything restated above and not re-asserted here would outrank the
    // plugin's invert in dark mode: light ink on the dark page.
    const restated = Object.keys(
      declarations(ruleFor(indexCss, ".prose-slate").body),
    ).filter((name) => !name.startsWith("--tw-prose-invert-"));
    expect(Object.keys(declarations(invert!.body)).sort()).toEqual(
      restated.sort(),
    );
  });

  it("comes after the restatement, which it must beat on source order", () => {
    expect(invert!.at).toBeGreaterThan(ruleFor(indexCss, ".prose-slate").at);
  });

  it("matches what `dark:prose-invert` compiles to under the app's dark variant", () => {
    const variant = /@custom-variant dark \((&[^;]*)\);/.exec(indexCss);
    expect(variant, "no `@custom-variant dark` in index.css").not.toBeNull();
    const compiled = variant![1].replace("&", ".dark\\:prose-invert");
    expect(invert!.selectors).toEqual([".prose-invert", compiled]);
  });
});

/** Every `--vantage-code-<role>` index.css reads, from the rules themselves. */
const CODE_ROLES = [
  ...new Set(
    Array.from(indexCss.matchAll(/var\((--vantage-code-[\w-]+)/g), (m) => m[1]),
  ),
].sort();

const codeRules = rules(indexCss).filter(
  (r) =>
    r.body.includes("--vantage-code-") ||
    r.selectors.some((s) => s.startsWith(":root[data-vantage-theme]")),
);

describe("the code-colour roles", () => {
  it("are the twelve the theme contract names", () => {
    expect(CODE_ROLES).toEqual(
      [
        "fg",
        "comment",
        "keyword",
        "string",
        "number",
        "title",
        "tag",
        "attr",
        "builtin",
        "meta",
        "addition",
        "deletion",
      ]
        .map((role) => `--vantage-code-${role}`)
        .sort(),
    );
  });

  it("apply only while a theme is active", () => {
    // Unscoped, one of these would repaint GitHub's palette for every reader.
    expect(codeRules.length).toBeGreaterThan(0);
    for (const rule of codeRules) {
      for (const selector of rule.selectors) {
        expect(selector).toMatch(/^:root\[data-vantage-theme\](\.dark)? /);
      }
    }
  });

  it("apply on screen only, so print keeps its own colours", () => {
    // Unscoped, `:root[data-vantage-theme] .hljs-keyword` outranked the print
    // block's `.prose * { color: … !important }`, and a theme's syntax
    // colours — Mocha's pastels in dark mode — printed on white.
    const open = indexCss.indexOf("@media screen {");
    expect(open, "no `@media screen` block in index.css").toBeGreaterThan(-1);
    let depth = 0;
    let close = open;
    for (let i = indexCss.indexOf("{", open); i < indexCss.length; i++) {
      if (indexCss[i] === "{") depth++;
      else if (indexCss[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    for (const rule of codeRules) {
      expect(rule.at, rule.selectors[0]).toBeGreaterThan(open);
      expect(rule.at, rule.selectors[0]).toBeLessThan(close);
    }
  });

  it("give every light selector a dark twin reading the same role", () => {
    // The dark twin is one class more specific, which is what lets it beat the
    // light rule — also `!important`, and also matching — in dark mode.
    const roleOf = (selector: string) =>
      codeRules
        .filter((r) => r.selectors.includes(selector))
        .map((r) => /var\((--vantage-code-[\w-]+)/.exec(r.body)?.[1])
        .filter(Boolean);
    const light = codeRules
      .flatMap((r) => r.selectors)
      .filter((s) => !s.startsWith(":root[data-vantage-theme].dark"))
      .filter((s) => roleOf(s).length > 0);
    for (const selector of light) {
      const twin = selector.replace(
        ":root[data-vantage-theme]",
        ":root[data-vantage-theme].dark",
      );
      expect(roleOf(twin), twin).toEqual(roleOf(selector));
    }
  });

  it("colour every token GitHub's highlight palette colours, in both modes", () => {
    // A token class the theme rules miss keeps GitHub's hex under every theme
    // — and in dark mode, the app's `.dark .hljs-*` override hex.
    const github = stripComments(
      readFileSync(require.resolve("highlight.js/styles/github.css"), "utf8"),
    );
    const darkOverride = rules(indexCss)
      .filter((r) => /\bcolor\s*:/.test(r.body))
      .flatMap((r) => r.selectors)
      .filter((s) => s.startsWith(".dark .hljs"));
    const coloured = new Set<string>();
    for (const rule of rules(github)) {
      if (!/\bcolor\s*:/.test(rule.body)) continue;
      for (const s of rule.selectors) {
        for (const m of s.matchAll(/\.(hljs[\w-]*)/g)) coloured.add(m[1]);
      }
    }
    for (const s of darkOverride) {
      for (const m of s.matchAll(/\.(hljs[\w-]*)/g)) coloured.add(m[1]);
    }

    const themed = (dark: boolean) =>
      new Set(
        codeRules
          .filter((r) => /\bcolor\s*:/.test(r.body))
          .flatMap((r) => r.selectors)
          .filter(
            (s) => s.startsWith(":root[data-vantage-theme].dark") === dark,
          )
          .map((s) => /\.(hljs[\w-]*)$/.exec(s)?.[1]),
      );
    for (const dark of [false, true]) {
      const reached = themed(dark);
      const missing = [...coloured].filter((c) => !reached.has(c));
      expect(missing, dark ? "dark" : "light").toEqual([]);
    }
  });
});

describe("the scrollbar", () => {
  // The hex these rules carried before themes existed. They are the fallback,
  // so they are what every reader without a theme still sees.
  it.each([
    ["::-webkit-scrollbar-thumb", "--vantage-scrollbar-thumb", "#d1d5db"],
    [
      "::-webkit-scrollbar-thumb:hover",
      "--vantage-scrollbar-thumb-hover",
      "#9ca3af",
    ],
    [".dark ::-webkit-scrollbar-thumb", "--vantage-scrollbar-thumb", "#4b5563"],
    [
      ".dark ::-webkit-scrollbar-thumb:hover",
      "--vantage-scrollbar-thumb-hover",
      "#6b7280",
    ],
  ])("%s falls back to its old hex", (selector, variable, hex) => {
    expect(ruleFor(indexCss, selector).body).toMatch(
      new RegExp(`background:\\s*var\\(${variable},\\s*${hex}\\);`),
    );
  });
});

describe("the built-in Catppuccin theme", () => {
  const lightRules = [
    ruleFor(catppuccinCss, ":root"),
    ruleFor(catppuccinCss, ":root", ":root.dark"),
  ];
  const darkRules = [
    ruleFor(catppuccinCss, ":root.dark"),
    ruleFor(catppuccinCss, ":root", ":root.dark"),
  ];
  const modes = {
    light: Object.assign({}, ...lightRules.map((r) => declarations(r.body))),
    dark: Object.assign({}, ...darkRules.map((r) => declarations(r.body))),
  } as Record<string, CssMap>;

  const RAMPS = ["slate", "blue", "purple", "red", "amber", "green"];
  const STEPS = Object.keys(palette.slate as Record<string, string>);

  it("has Tailwind's eleven steps to cover", () => {
    // Guards the loop below against a palette import that came back empty.
    expect(STEPS).toEqual([
      "50",
      "100",
      "200",
      "300",
      "400",
      "500",
      "600",
      "700",
      "800",
      "900",
      "950",
    ]);
  });

  describe.each(["light", "dark"])("in %s mode", (mode) => {
    it.each(RAMPS)("defines the full %s ramp", (family) => {
      const missing = STEPS.map((step) => `--color-${family}-${step}`).filter(
        (name) => !modes[mode][name],
      );
      expect(missing).toEqual([]);
    });

    it("names every code role", () => {
      expect(CODE_ROLES.filter((role) => !modes[mode][role])).toEqual([]);
    });

    it("names both scrollbar colours", () => {
      expect(modes[mode]["--vantage-scrollbar-thumb"]).toBeTruthy();
      expect(modes[mode]["--vantage-scrollbar-thumb-hover"]).toBeTruthy();
    });

    it("only reads swatches it defines", () => {
      // A `var(--ctp-typo)` is invalid at computed-value time, and whatever
      // reads it silently falls back to its inherited or initial colour.
      const defined = new Set(Object.keys(modes[mode]));
      const read = Object.values(modes[mode]).flatMap((value) =>
        Array.from(value.matchAll(/var\((--ctp-[\w-]+)\)/g), (m) => m[1]),
      );
      expect([...new Set(read)].filter((name) => !defined.has(name))).toEqual(
        [],
      );
    });
  });
});

describe("the built-in Lila theme", () => {
  const light = declarations(ruleFor(lilaCss, ":root").body);
  const dark = declarations(ruleFor(lilaCss, ":root.dark").body);

  it("gives every colour it sets in light mode a dark-mode value too", () => {
    // A step set in one mode only would carry its light value into dark mode
    // (the `:root` rule applies in both), or fall back to Tailwind's.
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(Object.keys(light).length).toBeGreaterThan(20);
  });

  it("recesses the dark chrome into mantle, below the content", () => {
    // The one deliberate break from Tailwind's order: `dark:bg-slate-800`
    // paints the sidebar, top bar and menus, `dark:bg-slate-900` the content,
    // and Lila puts the chrome *below* the content, as terminal panes sit.
    expect(dark["--color-slate-800"]).toBe("#181825");
    expect(dark["--color-slate-900"]).toBe("#1e1e2e");
  });

  it("uses mauve for the accent family in both modes", () => {
    expect(dark["--color-blue-500"]).toBe("#cba6f7");
    expect(light["--color-blue-500"]).toBe("#8839ef");
  });
});
