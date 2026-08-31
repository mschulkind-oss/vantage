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
