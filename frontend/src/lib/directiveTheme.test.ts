/**
 * Drift guards over `packages/vantage-md/src/styles/directives.css`.
 *
 * These are text assertions on purpose. Everything visual about the directive
 * theme is unobservable under vitest, measured against the real file in
 * jsdom 27.4:
 *
 *   - `getComputedStyle(el, "::before")` throws "Not implemented", so the tone
 *     rule and the badge chip — both pseudo-elements — cannot be inspected at
 *     all;
 *   - `var()` indirection is not resolved. The lone-block wash reads back the
 *     literal string `"var(--vantage-tone-wash)"`, so a jsdom test asserting
 *     that string still passes after the token it names is renamed on the other
 *     side, which is exactly the drift these tests exist to catch;
 *   - `@media` is not evaluated, so neither print block is reachable.
 *
 * What is guarded here instead is the wiring between the CSS and the two things
 * that can silently disagree with it: the plugin's vocabulary, and the
 * sanitiser's allowlist. Both failure modes are invisible — a palette entry for
 * a token no document can name renders nothing, and a rule that styles an
 * attribute the sanitiser strips renders nothing, in every renderer, with no
 * error anywhere.
 *
 * The geometry was measured once, in Chrome, over the real Tailwind build of
 * this file (all 87 prose classes from `MarkdownViewer`, a 9-block stamped run):
 * every member's rule lands on the same x to a tenth of a pixel — h2, h3, p,
 * ul, pre, blockquote and table, whose boxes start at three different x — the
 * largest internal gap is 28px against a 40px bleed, an unrecognised tone
 * computes `rgba(0, 0, 0, 0)` for both rule and wash, `emphasis=strong` leaves
 * an h2 at 600 while taking a p to 500, and a lone toned block that is also
 * line-anchor-highlighted keeps the line-anchor background. None of that is
 * re-checked by any suite: `Justfile` never invokes playwright, so an e2e spec
 * would document rather than guard, and it cannot even be run in the dev
 * container (no browsers installed). Re-measure by hand if the geometry moves.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  VANTAGE_BADGES,
  VANTAGE_EMPHASIS,
  VANTAGE_TONES,
  sanitizeSchema,
} from "vantage-md";

/**
 * Read with `fs`, not `import … ?raw`: vitest stubs CSS imports to the empty
 * string unless `test.css` is enabled, and it does so for the `?raw` form too —
 * which would make every assertion below pass vacuously.
 *
 * The path goes through a variable because Vite statically rewrites a *literal*
 * `new URL("./x", import.meta.url)` into an asset URL, which `fs` then rejects
 * with `ERR_INVALID_URL_SCHEME`. An unanalysable argument is left alone.
 */
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/**
 * The declarations only. The file's comments explain the traps by naming them —
 * `@layer`, `!important`, the negated run selector — so a scan of the raw text
 * would fail on the documentation of the rule it is enforcing.
 */
const css = read(
  "../../../packages/vantage-md/src/styles/directives.css",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The four properties every tone must define. */
const TONE_CHANNELS = ["accent", "wash", "chip", "ink"] as const;

/**
 * Attributes the CSS may select on that never pass through the sanitiser
 * because no document can write them: the toggle JS sets them on the prose
 * container at runtime. Anything else in the stylesheet has to be allowlisted
 * or the rule is dead markup.
 */
const JS_SET_MARKERS = new Set(["collapse-ready"]);

/** The body of the first `<selector> { … }` rule, without the braces. */
function blockOf(selector: string): string {
  const head = `${selector} {`;
  const start = css.indexOf(head);
  expect(start, `no \`${head}\` rule in directives.css`).toBeGreaterThanOrEqual(
    0,
  );
  const end = css.indexOf("}", start);
  return css.slice(start + head.length, end);
}

/** Every distinct capture of `pattern`'s first group, in the whole file. */
function captures(pattern: RegExp): Set<string> {
  return new Set(Array.from(css.matchAll(pattern), (match) => match[1]));
}

/** `data-vantage-run` → `dataVantageRun`, the hast property the sanitiser lists. */
function hastProperty(attribute: string): string {
  return `data-vantage-${attribute}`.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

/** The `*` allowlist's names, dropping each entry's value allowlist. */
function starAttributeNames(): Set<string> {
  const entries = sanitizeSchema.attributes?.["*"] ?? [];
  return new Set(
    entries.map((entry) => (Array.isArray(entry) ? String(entry[0]) : entry)),
  );
}

describe("the tone palette covers exactly the plugin's vocabulary", () => {
  const light = blockOf(":root");
  const dark = blockOf(".dark");

  for (const tone of VANTAGE_TONES) {
    it(`defines all four \`${tone}\` properties in light and in dark`, () => {
      for (const channel of TONE_CHANNELS) {
        const property = `--vantage-tone-${tone}-${channel}: `;
        expect(light).toContain(property);
        expect(dark).toContain(property);
      }
    });

    it(`resolves \`tone=${tone}\` onto the tone-agnostic properties`, () => {
      const block = blockOf(`[data-vantage-tone="${tone}"]`);
      for (const channel of TONE_CHANNELS) {
        expect(block).toContain(
          `--vantage-tone-${channel}: var(--vantage-tone-${tone}-${channel})`,
        );
      }
    });
  }

  it("has no palette entry for a token the plugin will never emit", () => {
    const painted = captures(
      /--vantage-tone-([a-z]+)-(?:accent|wash|chip|ink)/g,
    );
    expect([...painted].sort()).toEqual([...VANTAGE_TONES].sort());
  });

  it("styles every badge in the vocabulary and no others", () => {
    const styled = captures(/\[data-vantage-badge="([a-z]+)"\]/g);
    expect([...styled].sort()).toEqual([...VANTAGE_BADGES].sort());
  });

  it("styles every emphasis token except `normal`, which is the default", () => {
    const styled = captures(/\[data-vantage-emphasis="([a-z]+)"\]/g);
    // `normal` deliberately has no rule: it means "no emphasis treatment", and
    // a rule that restored the defaults would have to know what they were.
    expect([...styled].sort()).toEqual(
      VANTAGE_EMPHASIS.filter((token) => token !== "normal")
        .slice()
        .sort(),
    );
    expect(styled.has("normal")).toBe(false);
  });

  it("gives each badge its own chip class for the frontmatter chip to reuse", () => {
    // The `badge=` chip is a pseudo-element and the frontmatter status chip is a
    // real element; a pseudo cannot take a class, so the two share a declaration
    // block by selector list. The modifier names are the tone names, and this is
    // what keeps the two halves naming the same tokens.
    for (const tone of VANTAGE_TONES) {
      expect(css).toContain(`.vantage-chip--${tone} {`);
    }
  });
});

describe("every styled attribute survives the sanitiser", () => {
  // The silent failure mode of the whole design: CSS that selects on an
  // attribute `rehype-sanitize` strips renders nothing, in the app, in the
  // static export and in the CLI checker's HTML, with no error anywhere. This
  // is the assertion that would have caught `data-vantage-run` being absent
  // from the design doc's allowlist.
  const allowed = starAttributeNames();

  for (const attribute of captures(/\[data-vantage-([a-z-]+)[\]=]/g)) {
    it(`allowlists \`data-vantage-${attribute}\``, () => {
      if (JS_SET_MARKERS.has(attribute)) return;
      expect(allowed).toContain(hastProperty(attribute));
    });
  }
});

describe("the mechanisms the treatment rests on", () => {
  it("wins by being unlayered, so it is never wrapped in `@layer`", () => {
    // Every `@tailwindcss/typography` variant utility flattens to one class of
    // specificity and sits in `@layer utilities`; unlayered normal declarations
    // outrank every layer. Wrapping this file in a layer "to be tidy" makes it
    // lose to every prose utility, which is not a subtle regression but it is
    // an invisible cause.
    expect(css).not.toMatch(/@layer/);
  });

  it("needs no `!important` anywhere", () => {
    expect(css).not.toContain("!important");
  });

  it("gives the accent no `var()` fallback — the absence is what makes an unknown tone inert", () => {
    // With no fallback an unrecognised token leaves the variable unset, the
    // declaration is invalid at computed-value time, and the rule computes to
    // `transparent`. A well-meaning fallback would paint every typo'd token
    // grey, which is the opposite of "unknown markup is inert" (D2).
    expect(css).not.toMatch(/var\(--vantage-tone-accent,/);
    expect(css).not.toMatch(/var\(--vantage-tone-wash,/);
  });

  it("paints with the `background-color` longhand, never the shorthand", () => {
    // An invalid-at-computed-value-time failure on `background` would reset
    // `background-image` and friends along with the colour.
    expect(css).not.toMatch(/^\s*background:/m);
    expect(css).toContain("background-color: var(--vantage-tone-accent);");
  });

  it("detects a run with a positive selector, never a negated one", () => {
    // `:not([data-vantage-run="start"])` would bleed the first member's rule
    // 40px above its heading whenever the attribute is missing entirely — an
    // older plugin against newer CSS, which is the compatibility case D3 is
    // about. The positive form degrades to N separate short marks instead.
    expect(css).toContain('[data-vantage-run="middle"]');
    expect(css).toContain('[data-vantage-run="end"]');
    expect(css).not.toMatch(/:not\(\s*\[data-vantage-run/);
  });

  it("holds the lone-block wash at one-class specificity", () => {
    // A tie with `.line-anchor-highlight`, `.review-highlight-block` and
    // `.review-block-hovered`, all of which are declared later in the host
    // stylesheet — so the transient state wins and the standing tone yields.
    // Dropping the `:where()` makes this two classes and silently eats them.
    expect(css).toContain(
      '[data-vantage-tone]:where([data-vantage-run="only"])',
    );
    expect(css).not.toContain('[data-vantage-tone][data-vantage-run="only"]');
  });

  it("excludes headings, `pre` and `table` from the weight bump", () => {
    // Unlayered `font-weight: 500` beats the layered
    // `prose-headings:font-semibold`, so without this exclusion a toned+strong
    // heading is *de-bolded* from 600 to 500 — emphasis making a heading quieter.
    expect(css).toContain(
      '[data-vantage-emphasis="strong"]:not(:is(h1, h2, h3, h4, h5, h6, pre, table))',
    );
  });

  it("sets no `color` on prose, which print would discard anyway", () => {
    // The host stylesheet's print block forces `.prose, .prose *` to #1a1a1a
    // with `!important`. A tone that expressed itself as text colour would
    // therefore vanish in one of the three renderings D5 covers — and dark mode
    // already tunes body text for contrast. Only the chip and the print
    // overrides set `color`, and both are pseudo-elements or chips.
    const proseColour =
      /\[data-vantage-(?:tone|emphasis)="?[a-z]*"?\]\s*\{[^}]*\bcolor:/;
    expect(css).not.toMatch(proseColour);
  });
});
