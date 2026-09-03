/**
 * Both ends of the directive stylesheet's wiring, and the source order it
 * depends on.
 *
 * `directives.css` lives in `packages/vantage-md` and has to be reached twice:
 * by the app through a relative source path, and by the package's own
 * `styles/index.css` so the published package and the package's exported viewer
 * are styled too. Each half fails silently without the other — package-only CSS
 * reaches nobody in this repo, and app-only CSS leaves every external consumer
 * of `vantage-md/styles` unstyled while the app looks perfect (D5).
 *
 * The order assertion is the fragile one. The lone-block tone wash is
 * deliberately one-class specificity so the review and line-anchor state
 * backgrounds — also one class — win the tie by being declared later. That is
 * true only because the import sits near the top of `index.css`, and nothing
 * about the code says so at the point where someone would move it.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * `fs`, not `?raw`: vitest stubs CSS imports to `""` unless `test.css` is on.
 * The path stays a variable — Vite rewrites a literal
 * `new URL("./x", import.meta.url)` into an asset URL that `fs` cannot open.
 */
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const appCss = read("../index.css");
const packageCss = read("../../../packages/vantage-md/src/styles/index.css");

const IMPORT_LINE =
  '@import "../../packages/vantage-md/src/styles/directives.css";';

/** The value of one declaration inside the first rule matching `selector`. */
function declaration(css: string, selector: string, property: string): string {
  const head = `${selector} {`;
  const start = css.indexOf(head);
  expect(start, `no \`${head}\` rule`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start + head.length, css.indexOf("}", start));
  const match = new RegExp(`${property}:\\s*([^;]+);`).exec(block);
  expect(match, `no \`${property}\` in \`${selector}\``).not.toBeNull();
  return match![1].trim();
}

describe("the app imports the package's directive stylesheet", () => {
  it("imports it by relative source path", () => {
    // `@import "vantage-md/styles/directives.css"` does not resolve — the
    // package's `exports` map has no such subpath — and the one that does,
    // `vantage-md/styles`, points at the gitignored, publish-only
    // `dist/styles.css`: green off a stale local build, broken in CI and in a
    // fresh clone.
    expect(appCss).toContain(IMPORT_LINE);
  });

  it("imports it before the app's own rules", () => {
    // Every `@import` must precede the style rules per the CSS spec, and this
    // one must also precede the transient-state backgrounds it ties with.
    const at = appCss.indexOf(IMPORT_LINE);
    expect(at).toBeLessThan(appCss.indexOf("body {"));
    expect(at).toBeLessThan(appCss.indexOf(".line-anchor-highlight {"));
    expect(at).toBeLessThan(appCss.indexOf(".review-highlight-block {"));
  });

  it("imports it before `@plugin` and `@custom-variant`, or it is dropped", () => {
    // The one that actually bit. CSS requires `@import` to precede other
    // at-rules, and Tailwind's importer enforces it by *silently discarding*
    // the file: with this line below `@plugin`, `vantage-chip` appears 24 times
    // in `dist/assets/*.css`; above it, zero. No vite warning, no failing test,
    // no styled directive anywhere in the built app. Measured both ways with
    // `npm run build`, which is the only place it shows — dev and vitest never
    // load this stylesheet at all.
    const at = appCss.indexOf(IMPORT_LINE);
    expect(at).toBeGreaterThan(appCss.indexOf('@import "tailwindcss";'));
    expect(at).toBeLessThan(appCss.indexOf("@plugin "));
    expect(at).toBeLessThan(appCss.indexOf("@custom-variant "));
    expect(at).toBeLessThan(appCss.indexOf("@source "));
  });

  it("does not wrap the import in a cascade layer", () => {
    // Unlayered is the whole mechanism: a layered `@import … layer(…)` loses to
    // every `@tailwindcss/typography` utility regardless of specificity.
    expect(appCss).not.toMatch(/@import\s+[^;]*vantage-md[^;]*layer\(/);
  });
});

describe("the toned-heading gutter cancels the ¶-anchor shift exactly", () => {
  it("sets the gutter only on toned headings", () => {
    expect(appCss).toContain(
      ".prose :is(h1, h2, h3, h4, h5, h6)[data-vantage-tone] {",
    );
  });

  it("matches the heading `padding-left` it exists to cancel", () => {
    // Both are `em`, so both resolve per heading level — which is the only way
    // h2, h3 and p land their slice of one section rule on the same pixel. If
    // someone retunes the ¶ gutter and not this, the rule bends at every
    // heading.
    const gutter = declaration(
      appCss,
      ".prose :is(h1, h2, h3, h4, h5, h6)[data-vantage-tone]",
      "--vantage-tone-heading-gutter",
    );
    const padding = declaration(
      appCss,
      ".prose :is(h1, h2, h3, h4, h5, h6)",
      "padding-left",
    );
    expect(gutter).toBe(padding);
    expect(parseFloat(gutter)).toBeGreaterThan(0);
    expect(gutter.endsWith("em")).toBe(true);
  });
});

describe("a member's own left border is compensated, so the rule stays straight", () => {
  /**
   * `left` on the rule's pseudo-element resolves from the member's PADDING
   * edge, so any member carrying a left border draws its slice that far right
   * of the rest of the run. Measured before this existed: plain blockquotes at
   * 312 and code fences at 309 against 308 for everything else, which on a 5px
   * slice reads as the rule breaking rather than bending. CSS cannot read an
   * element's own border width, so each bordered case declares the
   * compensation, and each declaration has to equal the border it cancels.
   */
  it("cancels typography's blockquote border", () => {
    const compensation = declaration(
      appCss,
      ".prose blockquote[data-vantage-tone]:not([data-vantage-alert])",
      "--vantage-tone-border-compensation",
    );
    // The border is a Tailwind class on the component
    // (`prose-blockquote:border-l-[0.25em]` in MarkdownViewer), so the value is
    // pinned here rather than read from CSS. Change one and this fails.
    expect(compensation).toBe("0.25em");
  });

  it("cancels the code fence's border", () => {
    expect(
      declaration(
        appCss,
        ".prose pre[data-vantage-tone]",
        "--vantage-tone-border-compensation",
      ),
    ).toBe("1px");
  });

  it("leaves the alert's own border to the package that declares it", () => {
    // Ownership, not duplication: vantage-md draws the alert's left border, so
    // vantage-md cancels it. The app compensating a border it does not set
    // would silently double up if the package ever retuned the width.
    const packageDirectives = read(
      "../../../packages/vantage-md/src/styles/directives.css",
    );
    expect(
      declaration(
        packageDirectives,
        "[data-vantage-alert]",
        "--vantage-tone-border-compensation",
      ),
    ).toBe("var(--vantage-alert-rule-width)");
    // And the app must not also claim it.
    expect(appCss).not.toContain("[data-vantage-alert] {");
  });

  it("defaults to zero, so an unbordered member is unaffected", () => {
    const packageDirectives = read(
      "../../../packages/vantage-md/src/styles/directives.css",
    );
    expect(packageDirectives).toContain(
      "var(--vantage-tone-border-compensation, 0px)",
    );
  });
});

describe("the package ships the stylesheet too", () => {
  it("re-exports it from `styles/index.css`", () => {
    // Without this line `import "vantage-md/styles"` — the package's documented
    // entry point, and what its own <MarkdownViewer> is used with — carries no
    // directive CSS at all, while this app is styled correctly. A D5 break with
    // no symptom anywhere anyone in this repo would look.
    expect(packageCss).toContain('@import "./directives.css";');
  });
});
