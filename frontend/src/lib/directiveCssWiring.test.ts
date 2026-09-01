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

describe("the package ships the stylesheet too", () => {
  it("re-exports it from `styles/index.css`", () => {
    // Without this line `import "vantage-md/styles"` — the package's documented
    // entry point, and what its own <MarkdownViewer> is used with — carries no
    // directive CSS at all, while this app is styled correctly. A D5 break with
    // no symptom anywhere anyone in this repo would look.
    expect(packageCss).toContain('@import "./directives.css";');
  });
});
