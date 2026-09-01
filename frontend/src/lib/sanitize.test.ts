/**
 * What an inline `style` is allowed to do.
 *
 * The code under test lives in `packages/vantage-md`, which has no test runner
 * of its own; the frontend resolves `vantage-md` to that package's TypeScript
 * source (see `vite.config.ts`), so these run against the real thing.
 *
 * `style` cannot simply be dropped — KaTeX positions every glyph with it — so
 * the schema filters values instead. These tests pin both halves of that
 * bargain: the attacks stay out, and everything KaTeX emits stays in. The
 * second half matters most, because a KaTeX release that starts using a new
 * property would otherwise silently lose the whole attribute and render maths
 * wrong, with nothing failing.
 */
import { describe, it, expect } from "vitest";
import katex from "katex";
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

  it("keeps ordinary typographic styling", async () => {
    expect(await styled(`<span style="color: red">x</span>`)).toContain(
      `style="color: red"`,
    );
    expect(await styled(`<div style="text-align:center">x</div>`)).toContain(
      `style="text-align:center"`,
    );
    // KaTeX needs relative and absolute; only fixed and sticky escape the page.
    expect(
      await styled(`<span style="position:relative;top:-2px">x</span>`),
    ).toContain(`style="position:relative;top:-2px"`);
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
    // docs/design/inline-markup.md has the measurements and the cause.
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

  it("accepts every style KaTeX emits", () => {
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
    ];
    const rejected: string[] = [];
    let examined = 0;
    for (const formula of formulas) {
      const html = katex.renderToString(formula, {
        throwOnError: true,
        displayMode: true,
      });
      // A leading space, so `displaystyle="true"` is not mistaken for a style.
      for (const match of html.matchAll(/\sstyle="([^"]*)"/g)) {
        examined++;
        if (!SAFE_STYLE.test(match[1])) rejected.push(match[1]);
      }
    }
    expect(examined).toBeGreaterThan(200);
    expect(rejected).toEqual([]);
  });

  it("leaves table alignment alone, which uses attributes rather than CSS", async () => {
    const html = await styled("| a | b |\n| :-: | --: |\n| 1 | 2 |");
    expect(html).toContain(`<th align="center">`);
    expect(html).toContain(`<th align="right">`);
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
