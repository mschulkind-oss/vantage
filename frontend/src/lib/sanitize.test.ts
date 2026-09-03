/**
 * What an inline `style` is allowed to do.
 *
 * The code under test lives in `packages/vantage-md`, which has no test runner
 * of its own; the frontend resolves `vantage-md` to that package's TypeScript
 * source (see `vite.config.ts`), so these run against the real thing.
 *
 * **The only content the filter ever sees is document-authored raw HTML.** That
 * is the whole reason `style` is allowlisted with a value filter rather than
 * dropped: a `<div style="…">` written into a Markdown file is untrusted input,
 * and it used to reach the page verbatim. KaTeX is *not* in this picture —
 * `rehypeKatex` runs after `rehypeSanitize` (see `pipeline.ts`), so math styles
 * are trusted by construction and never tested against `SAFE_STYLE` at all.
 *
 * So there are three things to pin, and they are different jobs:
 *
 * 1. Attacks in author HTML stay out, and ordinary typography stays in.
 * 2. Rejection is flat-time — a `style` value is document-controlled input to
 *    the CLI checker as well as to the viewer.
 * 3. Math is *unfiltered*, measured end to end rather than assumed. The KaTeX
 *    battery below no longer asks "would `SAFE_STYLE` accept this?" — a question
 *    the pipeline never asks. It renders the formulas through the real chain and
 *    requires that values the filter *rejects* are on the page, which is only
 *    true because math is outside its reach. Move `rehypeKatex` ahead of the
 *    sanitiser and that fails loudly, instead of math quietly losing its layout.
 */
import { describe, it, expect } from "vitest";
import { renderMarkdown, SAFE_STYLE } from "vantage-md";

const styled = async (html: string) => (await renderMarkdown(html + "\n")).html;

describe("inline style filtering", () => {
  it("strips a viewport takeover", async () => {
    const html = await styled(
      `<div style="position:fixed;inset:0;z-index:99999;background:#fff">x</div>`,
    );
    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("style=");
    expect(html).toContain(">x</div>");
  });

  it("strips a render-time network beacon", async () => {
    const html = await styled(
      `<span style="background:url(https://attacker.example/b.png)">x</span>`,
    );
    expect(html).not.toContain("attacker.example");
    expect(html).not.toContain("style=");
  });

  it("strips legacy script-in-CSS and sticky positioning", async () => {
    expect(
      await styled(`<span style="width:expression(alert(1))">x</span>`),
    ).not.toContain("style=");
    expect(
      await styled(`<span style="position:sticky;top:0">x</span>`),
    ).not.toContain("style=");
  });

  it("strips every form of positioning, absolute and relative included", async () => {
    // `position` is banned as a property, not enumerated by value. The filter
    // only ever sees author HTML (math is rendered after the sanitiser), and
    // nothing in a document needs to position itself: this is a Markdown
    // viewer, not a layout API.
    //
    // `absolute` is the case that matters, and it is not the modest "overlaps
    // its neighbours" residual it reads as. Measured in Chrome against the
    // viewer's own ancestor chain: the nearest positioned ancestor of the prose
    // container is `ViewerPage.tsx`'s `flex-1 flex min-h-0 relative`, which sits
    // *outside* the scroll container — so an author's
    // `position:absolute;top:0;left:0;width:100%;height:100%` is sized to the
    // whole content pane, is not clipped by the scroller, and does not scroll
    // away. That is the §8.1 overlay, one keyword over.
    for (const value of [
      "position:absolute;top:0;left:0;width:100%;height:100%",
      "position:relative;top:-2px",
      "position:static",
      "color:red;position:absolute",
    ]) {
      expect(SAFE_STYLE.test(value), value).toBe(false);
      expect(await styled(`<div style="${value}">x</div>`)).not.toContain(
        "style=",
      );
    }
  });

  it("keeps ordinary typographic styling", async () => {
    expect(await styled(`<span style="color: red">x</span>`)).toContain(
      `style="color: red"`,
    );
    expect(await styled(`<div style="text-align:center">x</div>`)).toContain(
      `style="text-align:center"`,
    );
    expect(
      await styled(
        `<span style="font-weight:600;letter-spacing:0.02em">x</span>`,
      ),
    ).toContain(`style="font-weight:600;letter-spacing:0.02em"`);
  });

  it("drops the whole attribute when any declaration is unsafe", async () => {
    // Failing closed: a partly-applied style is harder to reason about than
    // none, and the element still renders.
    const html = await styled(
      `<span style="color:red;background:url(https://attacker.example/b.png)">x</span>`,
    );
    expect(html).not.toContain("style=");
  });

  it("requires a semicolon between declarations", () => {
    // The grammar is `;`-delimited on purpose: a value may contain spaces
    // (`margin: 0 auto`), so if whitespace could *also* end a declaration the
    // two constructs would compete for the same characters and the match would
    // fork at every declaration. Keeping `;` the only separator is what makes
    // the regex unambiguous — see the flat-time test below.
    expect(SAFE_STYLE.test("margin: 0 auto")).toBe(true);
    expect(SAFE_STYLE.test("color:red;font-size:2px")).toBe(true);
    expect(SAFE_STYLE.test("color:red ; font-size:2px")).toBe(true);
    expect(SAFE_STYLE.test("color:red;")).toBe(true);
    expect(SAFE_STYLE.test("  color:red  ")).toBe(true);
    expect(SAFE_STYLE.test("")).toBe(true);
    // Two declarations run together, with a space or with nothing at all.
    expect(SAFE_STYLE.test("color:red font-size:2px")).toBe(false);
    expect(SAFE_STYLE.test("color:redcolor:red")).toBe(false);
    // An empty declaration is still not a declaration.
    expect(SAFE_STYLE.test(";")).toBe(false);
    expect(SAFE_STYLE.test("color:red;;font-size:2px")).toBe(false);
  });

  it("rejects a hostile style value in flat time, not exponential", () => {
    // A `style` value is document-controlled, and `renderMarkdown` runs
    // synchronously — in the viewer's render, in `vantage build`, and in the
    // `vantage-check` binary the pre-commit hook and CI run over every Markdown
    // file in the repo. So a value that takes super-linear time to *reject* is
    // not a slow render; it is a denial of service on the gate. An earlier form
    // of this regex was one: 121 chars of the first payload below took 12 ms,
    // 161 chars took 950 ms, 201 chars took 94 s. §8.4 of
    // docs/reference/inline-markup.md has the measurements and the cause.
    //
    // Both payloads end in a character the value class excludes, so the match
    // must fail — the expensive path is always the rejection.
    //
    // The budget is generous by three orders of magnitude: against the current
    // grammar the worst of these resolves in under a millisecond at 200 kB,
    // which is a thousand times the longest rung here. The ladder climbs in
    // small steps and asserts as it goes, so a
    // reintroduced ambiguity fails on an early rung in about a second instead of
    // wedging the suite on a later one — which is the same failure this test
    // exists to prevent.
    const budget = 250;
    for (const n of [8, 16, 24, 32, 40, 48, 64, 80, 96]) {
      for (const payload of [
        "color:red ".repeat(n) + "(",
        "color: red; ".repeat(n) + "background:url(x)",
      ]) {
        const started = performance.now();
        const kept = SAFE_STYLE.test(payload);
        const elapsed = performance.now() - started;
        expect(kept).toBe(false);
        expect(
          elapsed,
          `${payload.length} chars took ${elapsed}ms`,
        ).toBeLessThan(budget);
      }
    }
  });

  it("does not filter math at all, because KaTeX renders after the sanitiser", async () => {
    // The load-bearing fact, asserted end to end. `buildRehypePlugins` pushes
    // `rehypeSanitize` and only then `rehypeKatex`, so no KaTeX `style` value is
    // ever tested against `SAFE_STYLE`. This is the doc's own example formula,
    // and the attribute it emits is one the filter now rejects — so if anyone
    // moves `rehypeKatex` ahead of the sanitiser, this fails loudly instead of
    // math silently losing its layout.
    const { html } = await renderMarkdown("$$\n\\int_0^\\infty f(x)dx\n$$\n");
    const emitted = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]);
    const positioned = emitted.filter((v) => v.includes("position:relative"));
    expect(positioned.length).toBeGreaterThan(0);
    for (const value of positioned) expect(SAFE_STYLE.test(value)).toBe(false);
  });

  it("pins the volume of math styling, and that none of it is filtered", async () => {
    // This battery is not a check on `SAFE_STYLE` — it cannot be, since the
    // filter never runs on math. It measures the *rendered page*: how much
    // inline CSS math brings with it, and that some of that CSS is CSS the
    // filter rejects. If `rehypeKatex` ever moved ahead of the sanitiser, the
    // rejected values would be the first thing to vanish and the last assertion
    // here would fail.
    //
    // Deliberately no direct `katex.renderToString` comparison: the frontend's
    // own `katex` is 0.16 while the one `rehype-katex` renders with is
    // `vantage-md`'s 0.18, and the two disagree in the fourth decimal place. A
    // test that compares them is measuring the version skew, not the pipeline.
    const formulas = [
      String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
      String.raw`\frac{\sum_{i=1}^{n} x_i}{\int_0^\infty e^{-x}dx}`,
      String.raw`\sqrt[3]{\frac{a}{b}}`,
      String.raw`\overbrace{a+b}^{n} \underbrace{c+d}_{m}`,
      String.raw`\rule{2em}{1pt} \textcolor{red}{x} \colorbox{yellow}{y}`,
      String.raw`\begin{array}{c|c} 1 & 2 \\ \hline 3 & 4 \end{array}`,
      String.raw`\xrightarrow{f} \boxed{z} \binom{n}{k}`,
      String.raw`\left\{ \begin{matrix} a \\ b \end{matrix} \right.`,
      String.raw`\hspace{1em}\raisebox{2pt}{x}\phantom{abc}`,
      String.raw`\mathop{\mathrm{lim}}\limits_{x \to 0} \tfrac{1}{2}`,
      String.raw`\begin{cases} a & x<0 \\ b & x\ge0 \end{cases}`,
      String.raw`\overline{AB} \underline{CD} \vec{v} \widehat{xyz}`,
      // `\pmb` is here because it is the counter-example: it emits
      // `text-shadow`, which is not on the property allowlist, and it reaches
      // the page anyway. Under the old reading of this battery that was a bug
      // waiting to be reported; it is in fact the design working as built.
      String.raw`\pmb{x}`,
    ];
    // A leading space in the pattern, so MathML's `displaystyle="true"` on
    // `<mstyle>` is not counted as a CSS `style`. Any measurement of "what does
    // KaTeX put in `style`" that greps for `style="` counts those booleans and
    // concludes the filter is eating real declarations when it is not.
    const values = (html: string) =>
      [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]);

    let examined = 0;
    const properties = new Set<string>();
    const rejectedByTheFilter: string[] = [];
    for (const formula of formulas) {
      const { html } = await renderMarkdown(`$$\n${formula}\n$$\n`);
      for (const value of values(html)) {
        examined++;
        for (const declaration of value.split(";")) {
          if (declaration.trim()) {
            properties.add(declaration.split(":")[0].trim());
          }
        }
        if (!SAFE_STYLE.test(value)) rejectedByTheFilter.push(value);
      }
    }
    expect(examined).toBeGreaterThan(200);
    // Two properties named explicitly, because both are load-bearing to the
    // record: `position` is what the design once claimed forced the filter to
    // enumerate position values rather than ban the property, and `text-shadow`
    // has never been on the allowlist at all.
    expect(properties).toContain("position");
    expect(properties).toContain("text-shadow");
    // The proof: values the filter throws away, on the page. Four of the 261, as
    // measured — two `position:relative` and two `text-shadow` — so the
    // assertion is on the kinds rather than on the count, which would be a
    // KaTeX-version pin dressed up as a security check.
    expect(rejectedByTheFilter.some((v) => v.includes("position:"))).toBe(true);
    expect(rejectedByTheFilter.some((v) => v.includes("text-shadow"))).toBe(
      true,
    );
  });

  it("leaves table alignment alone, which uses attributes rather than CSS", async () => {
    const html = await styled("| a | b |\n| :-: | --: |\n| 1 | 2 |");
    // Matched without pinning the rest of the tag: a cell also carries a
    // `data-source-line` now, so a review comment can anchor to one.
    expect(html).toMatch(/<th align="center"[^>]*>/);
    expect(html).toMatch(/<th align="right"[^>]*>/);
  });
});

describe("the data-vantage-* allowlist", () => {
  it("admits the vocabulary and refuses everything else", async () => {
    // Directive attributes are named individually in the schema, with the token
    // sets imported from the module that defines them, so this is the second
    // gate on a value the plugin should never have emitted in the first place.
    expect(await styled(`<p data-vantage-tone="warning">x</p>`)).toContain(
      `data-vantage-tone="warning"`,
    );
    expect(await styled(`<p data-vantage-collapse-group="12">x</p>`)).toContain(
      `data-vantage-collapse-group="12"`,
    );
    for (const attribute of [
      `data-vantage-tone="url(https://attacker.example/x)"`,
      `data-vantage-emphasis="LOUD"`,
      `data-vantage-badge="secret"`,
      `data-vantage-collapsed="maybe"`,
      `data-vantage-run="everywhere"`,
      `data-vantage-oq="OQ-9"`,
      // The two collapse ids are pinned to digits by pattern rather than by
      // token list, because the toggle JS interpolates the value into a
      // selector.
      `data-vantage-collapse-group="one"`,
      `data-vantage-collapse-group="1'], p"`,
      `data-vantage-collapse-toggle="-1"`,
      // Nothing readmits an attribute by prefix, so a name we never allowlisted
      // is stripped whatever its value.
      `data-vantage-anythingelse="warning"`,
    ]) {
      expect(await styled(`<p ${attribute}>x</p>`)).not.toContain(
        "data-vantage",
      );
    }
  });

  it("keeps the free-text leaning, escaped rather than filtered", async () => {
    // `leaning` is the one value with no closed set — it is the body of a review
    // comment — so it is allowlisted by name only. What makes that safe is the
    // serialiser: `hast` escapes the value, and no protocol check applies to a
    // non-URL attribute, so there is nothing to break out of.
    const leaning = `<img src=x onerror=alert(1)> & say "no" to 'it'`;
    const html = await styled(
      `<p data-vantage-leaning="&lt;img src=x onerror=alert(1)&gt; &amp; say &quot;no&quot; to 'it'">x</p>`,
    );

    // Measured, not assumed: the serialiser escapes `"` and `&` — which is what
    // keeps a value inside its own quotes — and leaves `<` alone, which is
    // harmless inside a quoted attribute. So the value below survives verbatim
    // and still cannot become an element.
    expect(html).toContain("data-vantage-leaning=");
    expect(html).toContain("&#x22;no&#x22;");
    expect(html).toContain("&#x26; say");

    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("p")!.getAttribute("data-vantage-leaning")).toBe(
      leaning,
    );
    expect(host.querySelectorAll("img")).toHaveLength(0);
  });
});
