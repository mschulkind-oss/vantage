/**
 * What an inline `style` is allowed to do, and what an inline `<svg>` is.
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
 *    sanitizer and that fails loudly, instead of math quietly losing its layout.
 *
 * The "class allowlist" block is the same threat as the first by another
 * attribute: the app ships Tailwind's utilities, so a class can lay a document
 * over the window as well as a `style` could. A document's `class` keeps only
 * the names the pipeline itself emits, and that list is measured on both sides
 * of the sanitizer in the real chain rather than asserted from memory.
 *
 * The "inline SVG" block is a fourth job: a drawing survives as drawing —
 * every allowlisted attribute in the spelling an author writes, on every
 * admitted element — and nothing survives that runs, fetches, references, or
 * sets the page's title. Most of it is table-driven over the schema itself,
 * and two tests pin the tables to it — the attribute table's length and the
 * list of admitted children — so widening the allowlist fails until a table
 * covers the new entry. The few cases that only React can show (the SVG
 * namespace, `<title>` hoisting) render through `vantage-md/react`.
 */
import type { Element, Root } from "hast";
import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import { cleanup, render } from "@testing-library/react";
import type { PluggableList } from "unified";
import { describe, it, expect } from "vitest";
import {
  buildPipeline,
  renderMarkdown,
  SAFE_STYLE,
  sanitizeSchema,
} from "vantage-md";
import { MarkdownViewer } from "vantage-md/react";

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
    // only ever sees author HTML (math is rendered after the sanitizer), and
    // nothing in a document needs to position itself: this is a Markdown
    // viewer, not a layout API.
    //
    // `absolute` is the case that matters, and it is not the modest "overlaps
    // its neighbors" residual it reads as. Measured in Chrome against the
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

  it("does not filter math at all, because KaTeX renders after the sanitizer", async () => {
    // The load-bearing fact, asserted end to end. `buildRehypePlugins` pushes
    // `rehypeSanitize` and only then `rehypeKatex`, so no KaTeX `style` value is
    // ever tested against `SAFE_STYLE`. This is the doc's own example formula,
    // and the attribute it emits is one the filter now rejects — so if anyone
    // moves `rehypeKatex` ahead of the sanitizer, this fails loudly instead of
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
    // filter rejects. If `rehypeKatex` ever moved ahead of the sanitizer, the
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

  it("keeps a document's style off a task-list checkbox", async () => {
    // `styles/task-list.css` positions `.task-list-item > input` itself, so
    // `top` and `left` on the checkbox move a box the stylesheet placed.
    // Measured in Chromium at 1280x800 while it was positioned absolutely, these
    // declarations covered the whole content pane in white, and the pane stayed
    // covered after scrolling to the end. GFM never writes a style on the
    // checkbox it emits, so an `input` keeps none. The second document writes no
    // class at all: GFM puts `task-list-item` on the item, and the checkbox
    // typed into its text is a child of that item too.
    const cover =
      "top:-3000px;left:-3000px;width:9000px;height:9000px;background-color:white";
    for (const markdown of [
      `<ul class="contains-task-list" style="color:red"><li class="task-list-item" style="color:red"><input type="checkbox" disabled style="${cover}">covered</li></ul>`,
      `- [ ] <input type="checkbox" style="${cover}"> a task`,
    ]) {
      const host = document.createElement("div");
      host.innerHTML = await styled(markdown);
      const inputs = Array.from(
        host.querySelectorAll("li.task-list-item > input"),
      );
      expect(inputs.length, markdown).toBeGreaterThan(0);
      for (const input of inputs) {
        expect(input.getAttribute("style"), markdown).toBeNull();
      }
    }
    // The list and its item around the checkbox keep theirs: only `input` lost
    // the attribute.
    const html = await styled(
      `<ul style="color:red"><li class="task-list-item" style="color:red"><input type="checkbox" style="color:red">x</li></ul>`,
    );
    expect(html).toContain(`<ul style="color:red"`);
    expect(html).toContain(`<li class="task-list-item" style="color:red"`);
    expect(html).toMatch(/<input(?![^>]*style=)[^>]*>/);
  });

  it("lets every admitted element but input take a filtered style", () => {
    // `style` is listed on each element rather than on `*`. `hast-util-sanitize`
    // consults `*` whenever an element's own entry yields nothing, so an entry
    // on `input` could never refuse what an entry on `*` admits.
    const attributes = sanitizeSchema.attributes ?? {};
    const styleEntries = (tag: string) =>
      (attributes[tag] ?? []).filter(
        (definition) =>
          (typeof definition === "string" ? definition : definition[0]) ===
          "style",
      );
    expect(styleEntries("*")).toEqual([]);
    expect(styleEntries("input")).toEqual([]);
    const tags = new Set(sanitizeSchema.tagNames ?? []);
    expect(tags.has("input")).toBe(true);
    for (const tag of tags) {
      if (tag === "input") continue;
      expect(styleEntries(tag), tag).toEqual([["style", SAFE_STYLE]]);
    }
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
    // serializer: `hast` escapes the value, and no protocol check applies to a
    // non-URL attribute, so there is nothing to break out of.
    const leaning = `<img src=x onerror=alert(1)> & say "no" to 'it'`;
    const html = await styled(
      `<p data-vantage-leaning="&lt;img src=x onerror=alert(1)&gt; &amp; say &quot;no&quot; to 'it'">x</p>`,
    );

    // Measured, not assumed: the serializer escapes `"` and `&` — which is what
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

describe("the class allowlist", () => {
  // Utilities the app's stylesheet ships because the app's own markup uses
  // them. Written on one element of a document they are a full-window overlay,
  // and `SAFE_STYLE`'s ban on `position` never sees them: a class is not a
  // `style`.
  const OVERLAY = "fixed inset-0 z-50 bg-white";
  const OVERLAY_SELECTOR = OVERLAY.split(" ")
    .map((name) => `.${name}`)
    .join(", ");

  // The class GFM puts on the footnote label, spelled in halves. It is a
  // Tailwind utility, and Tailwind generates a utility for every class name it
  // finds in the files it scans, this one included. Written whole here, it
  // generated that utility, which hides the label in the app. See
  // `PIPELINE_CLASSES`.
  const FOOTNOTE_LABEL = ["sr", "only"].join("-");

  /** `renderMarkdown`'s output, parsed the way a browser would. */
  const parsed = async (markdown: string) => {
    const host = document.createElement("div");
    host.innerHTML = await styled(markdown);
    return host;
  };

  /**
   * Every element in `root` with a non-empty `class`, as `tag.class` with the
   * attribute verbatim. An element whose own entry filtered every class away
   * still serializes `class=""`, which is no class at all.
   */
  const classed = (root: ParentNode) =>
    Array.from(root.querySelectorAll("[class]"))
      .filter((el) => el.getAttribute("class")!.trim() !== "")
      .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute("class")}`);

  it.each([
    ["div", `<div class="${OVERLAY}">x</div>`],
    ["span", `<span class="${OVERLAY}">x</span>`],
    ["a", `<a href="#x" class="${OVERLAY}">x</a>`],
    ["code", `<code class="${OVERLAY}">x</code>`],
    ["pre", `<pre class="${OVERLAY}"><code class="${OVERLAY}">x</code></pre>`],
    ["p", `<p class="${OVERLAY}">x</p>`],
    ["img", `<img src="x.png" alt="x" class="${OVERLAY}">`],
    [
      "svg",
      `<svg class="${OVERLAY}" viewBox="0 0 1 1"><g class="${OVERLAY}"><rect class="${OVERLAY}" width="1" height="1"/></g></svg>`,
    ],
    ["h2", `<h2 class="${OVERLAY}">x</h2>`],
    ["ul", `<ul class="${OVERLAY}"><li class="${OVERLAY}">x</li></ul>`],
    ["ol", `<ol class="${OVERLAY}"><li>x</li></ol>`],
    ["section", `<section class="${OVERLAY}">x</section>`],
    ["blockquote", `<blockquote class="${OVERLAY}">x</blockquote>`],
    [
      "table",
      `<table class="${OVERLAY}"><tr><td class="${OVERLAY}">x</td></tr></table>`,
    ],
    [
      "details",
      `<details class="${OVERLAY}"><summary class="${OVERLAY}">x</summary>y</details>`,
    ],
  ])("drops overlay utilities a document writes on %s", async (tag, markup) => {
    const host = await parsed(markup);
    // The element stays; only its class goes.
    expect(host.querySelector(tag)).not.toBeNull();
    expect(host.querySelector(OVERLAY_SELECTOR)).toBeNull();
    expect(classed(host)).toEqual([]);
  });

  it.each([
    // The pipeline's names, on an element the pipeline never puts them on.
    `<span class="vantage-alert-title">x</span>`,
    `<p class="task-list-item">x</p>`,
    `<div class="contains-task-list">x</div>`,
    `<div class="footnotes">x</div>`,
    `<div class="${FOOTNOTE_LABEL}">x</div>`,
    `<span class="data-footnote-backref">x</span>`,
    `<span class="language-js">x</span>`,
    // Classes the viewer's stylesheet selects on that are added *after* the
    // sanitizer, by `rehype-highlight`, `rehype-katex` and the app's own
    // components. They need no entry, so a document cannot borrow them.
    `<span class="hljs-keyword">x</span>`,
    `<span class="katex-display">x</span>`,
    `<div class="mermaid">x</div>`,
    `<span class="heading-anchor">x</span>`,
    `<div class="review-inline-comment">x</div>`,
  ])("drops %s", async (markup) => {
    expect(classed(await parsed(markup))).toEqual([]);
  });

  it("keeps a pipeline name where the pipeline puts it, and nothing beside it", async () => {
    // A document may write the pipeline's own names on the elements that carry
    // them: by the time the sanitizer runs, a hand-written one and the
    // pipeline's are the same node, and none of them can lay an element over
    // anything outside the scroll container (`e2e/task_list.spec.ts` measures
    // the one that could). What the document writes next to them goes.
    const host = await parsed(
      [
        `<div class="vantage-alert-title ${OVERLAY}">Note</div>`,
        "",
        `<pre><code class="language-diff ${OVERLAY}">+ x</code></pre>`,
        "",
        `<h2 class="${FOOTNOTE_LABEL} ${OVERLAY}">Footnotes</h2>`,
        "",
        `<section class="footnotes ${OVERLAY}"><ol class="contains-task-list ${OVERLAY}"><li class="task-list-item ${OVERLAY}"><a href="#x" class="data-footnote-backref ${OVERLAY}">↩</a></li></ol></section>`,
      ].join("\n"),
    );
    expect(host.querySelector(OVERLAY_SELECTOR)).toBeNull();
    expect(classed(host)).toEqual([
      "div.vantage-alert-title",
      // `hljs` and the token spans are `rehype-highlight`'s, added after the
      // sanitizer from the language the document named.
      "code.hljs language-diff",
      "span.hljs-addition",
      `h2.${FOOTNOTE_LABEL}`,
      "section.footnotes",
      "ol.contains-task-list",
      "li.task-list-item",
      "a.data-footnote-backref",
    ]);
  });

  it("takes no class from anything the pipeline emits, save the two nothing reads", () => {
    // The allowlist is meant to be exactly what the pipeline itself writes
    // before `rehypeSanitize`, so this measures both sides of the sanitizer in
    // the real chain: every class on the tree going in, and every class coming
    // out, over a document that uses every feature that emits one.
    //
    // The `before` list is pinned in full, so a plugin that starts emitting a
    // new class fails here instead of losing it silently in every renderer.
    // `math-display` and `math-inline` are `remark-math`'s, and the sanitizer
    // has always dropped them: `rehype-katex` keys on `language-math` alone,
    // and tells display from inline by whether the `code` sits in a `pre`.
    const features = [
      "```js",
      "const x = 1;",
      "```",
      "",
      "```mermaid",
      "graph TD; A-->B",
      "```",
      "",
      "```math",
      "x^2",
      "```",
      "",
      "$$",
      "y^2",
      "$$",
      "",
      "Inline $$z$$ math, and a claim.[^1]",
      "",
      "- [ ] open",
      "- [x] done",
      "",
      "1. [ ] ordered",
      "",
      "> [!WARNING]",
      "> Careful.",
      "",
      "<!-- vantage: block tone=warning -->",
      "Toned.",
      "",
      "| a | b |",
      "| :-: | --: |",
      "| 1 | 2 |",
      "",
      "[^1]: The note.",
      "",
    ].join("\n");

    const record = (into: Set<string>) => () => (tree: Root) => {
      const walk = (parent: Root | Element) => {
        for (const child of parent.children) {
          if (child.type !== "element") continue;
          const names = child.properties.className;
          if (Array.isArray(names)) {
            for (const name of names) into.add(`${child.tagName}.${name}`);
          }
          walk(child);
        }
      };
      walk(tree);
    };

    const before = new Set<string>();
    const after = new Set<string>();
    const { remarkPlugins, rehypePlugins } = buildPipeline();
    const at = rehypePlugins.findIndex(
      (entry) => Array.isArray(entry) && entry[1] === sanitizeSchema,
    );
    expect(at).toBeGreaterThan(0);
    const instrumented: PluggableList = [
      ...rehypePlugins.slice(0, at),
      record(before),
      rehypePlugins[at],
      record(after),
      ...rehypePlugins.slice(at + 1),
    ];
    try {
      render(
        createElement(ReactMarkdown, {
          remarkPlugins,
          rehypePlugins: instrumented,
          children: features,
        }),
      );
    } finally {
      cleanup();
    }

    expect([...before].sort()).toEqual([
      "a.data-footnote-backref",
      "code.language-js",
      "code.language-math",
      "code.language-mermaid",
      "code.math-display",
      "code.math-inline",
      "div.vantage-alert-title",
      `h2.${FOOTNOTE_LABEL}`,
      "li.task-list-item",
      "ol.contains-task-list",
      "section.footnotes",
      "ul.contains-task-list",
    ]);
    expect([...after].sort()).toEqual(
      [...before].filter((name) => !name.startsWith("code.math-")).sort(),
    );
  });

  it("admits a class on no element without a value list", () => {
    // `hast-util-sanitize` reads a bare `"className"`, or a tuple with no
    // values, as "any value at all", and it takes an element's own entry
    // before `*`'s — so the rule has two halves. Nothing takes a class by
    // default, and every element that does names what it takes.
    const attributes = sanitizeSchema.attributes ?? {};
    const classEntries = (tag: string) =>
      (attributes[tag] ?? []).filter(
        (definition) =>
          (typeof definition === "string" ? definition : definition[0]) ===
          "className",
      );
    expect(classEntries("*")).toEqual([]);
    const tags = Object.keys(attributes).filter(
      (tag) => classEntries(tag).length > 0,
    );
    expect(tags.sort()).toEqual([
      "a",
      "code",
      "div",
      "h2",
      "li",
      "ol",
      "section",
      "ul",
    ]);
    for (const tag of tags) {
      const entries = classEntries(tag);
      expect(entries, tag).toHaveLength(1);
      expect(typeof entries[0], tag).not.toBe("string");
      expect((entries[0] as unknown[]).length, tag).toBeGreaterThan(1);
    }
  });
});

describe("inline SVG", () => {
  // Shaped like the diagrams people actually paste: a wrapping div, shapes,
  // text with a quoted font stack, and an accessible name.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const HTML_NS = "http://www.w3.org/1999/xhtml";

  const diagram = `<div class="diagram">
<svg xmlns="http://www.w3.org/2000/svg" width="282" height="152" viewBox="0 0 282 152" role="img" aria-label="A and B" font-family="system-ui, 'Segoe UI', sans-serif">
<title>A and B</title>
<rect x="2" y="2" width="278" height="148" rx="12" fill="#EFF6FF" stroke="#BFDBFE"/>
<path d="M26 33 V121" stroke="#2563EB" stroke-opacity="0.45" stroke-width="1.5" fill="none"/>
<text x="33" y="26" font-size="12" font-weight="700" fill="#FFFFFF" text-anchor="middle" letter-spacing="0.5">ALL</text>
</svg>
</div>`;

  it("keeps a static diagram intact", async () => {
    const host = document.createElement("div");
    host.innerHTML = await styled(diagram);
    const svg = host.querySelector("svg")!;
    expect(Array.from(svg.children, (el) => el.tagName)).toEqual([
      "rect",
      "path",
      "text",
    ]);
    expect(svg.getAttribute("viewBox")).toBe("0 0 282 152");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("A and B");
    expect(svg.getAttribute("font-family")).toBe(
      "system-ui, 'Segoe UI', sans-serif",
    );
    // The `<title>` is stripped; `aria-label` is the accessible name.
    expect(svg.querySelector("title")).toBeNull();
    expect(svg.textContent).not.toContain("A and B");
    expect(svg.querySelector("rect")!.getAttribute("fill")).toBe("#EFF6FF");
    const path = svg.querySelector("path")!;
    expect(path.getAttribute("d")).toBe("M26 33 V121");
    expect(path.getAttribute("stroke-width")).toBe("1.5");
    expect(path.getAttribute("stroke-opacity")).toBe("0.45");
    const text = svg.querySelector("text")!;
    expect(text.textContent).toBe("ALL");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("letter-spacing")).toBe("0.5");
  });

  it("creates the diagram in the SVG namespace through React", () => {
    // The namespace is React's decision, not the parser's: `innerHTML` puts an
    // `<svg>` in the SVG namespace whatever the sanitizer did, so only a React
    // render says anything. Every element from the root down must be SVG, and
    // the root must sit in the HTML `div` the document wrapped it in.
    const { container } = render(
      createElement(MarkdownViewer, { content: diagram + "\n" }),
    );
    try {
      const svg = container.querySelector("svg")!;
      const drawing = [svg, ...Array.from(svg.querySelectorAll("*"))];
      expect(drawing.map((el) => el.tagName)).toEqual([
        "svg",
        "rect",
        "path",
        "text",
      ]);
      for (const el of drawing) {
        expect(el.namespaceURI, el.tagName).toBe(SVG_NS);
      }
      expect(svg.parentElement!.namespaceURI).toBe(HTML_NS);
      expect(svg.parentElement!.tagName).toBe("DIV");
    } finally {
      cleanup();
    }
  });

  it("refuses everything in SVG that runs, fetches, or references", async () => {
    const html = await styled(`<svg viewBox="0 0 10 10" onload="alert(1)">
<script>alert(1)</script>
<foreignObject><iframe src="https://attacker.example/f"></iframe></foreignObject>
<image href="https://attacker.example/i.png"/>
<use href="https://attacker.example/s.svg#x"/>
<a xlink:href="javascript:alert(1)"><rect width="1" height="1"/></a>
<animate attributeName="href" to="javascript:alert(1)"/>
<rect width="1" height="1" fill="url(https://attacker.example/p)" filter="url(#f)" onclick="alert(1)"/>
</svg>`);
    for (const needle of [
      "onload",
      "onclick",
      "<script",
      "alert(1)</script",
      "foreignObject",
      "iframe",
      "<image",
      "<use",
      "animate",
      "javascript:",
      "attacker.example",
      "filter=",
      "url(",
    ]) {
      expect(html, needle).not.toContain(needle);
    }
    // And what is left is exactly the drawing, stripped of every attribute that
    // was not geometry: the `a` unwrapped of its `xlink:href`, and two bare
    // rects.
    const host = document.createElement("div");
    host.innerHTML = html;
    const svg = host.querySelector("svg")!;
    expect(
      [svg, ...Array.from(svg.querySelectorAll("*"))].map((el) =>
        [el.tagName, ...Array.from(el.attributes, (a) => a.name).sort()].join(
          " ",
        ),
      ),
    ).toEqual(["svg viewBox", "a", "rect height width", "rect height width"]);
  });

  /** Sanitize, then re-parse the string the way a browser would. */
  const parsed = async (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = await styled(html);
    return host;
  };

  /** Every `rect` in `root` as `x,y,width,height,fill`, in tree order. */
  const rects = (root: ParentNode) =>
    Array.from(root.querySelectorAll("rect")).map((rect) =>
      ["x", "y", "width", "height", "fill"]
        .map((name) => rect.getAttribute(name) ?? "")
        .join(","),
    );

  it("removes a Figma export's clip path instead of painting it", async () => {
    // Figma's default export: the drawing clipped to its frame, and the clip
    // shape declared in `<defs>`. Unwrapped, that white clip rect was painted
    // on top of everything before it and the drawing rendered as a blank box.
    const host = await parsed(`<div>
<svg width="200" height="100" viewBox="0 0 200 100" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip0_1_2)"><rect width="200" height="100" rx="12" fill="#2563EB"/><text x="100" y="55" fill="white" text-anchor="middle">Diagram</text></g><defs><clipPath id="clip0_1_2"><rect width="200" height="100" fill="white"/></clipPath></defs></svg>
</div>`);
    const svg = host.querySelector("svg")!;
    expect(rects(svg)).toEqual([",,200,100,#2563EB"]);
    expect(svg.querySelector("text")!.textContent).toBe("Diagram");
    expect(
      Array.from(svg.children).map((el) => el.tagName.toLowerCase()),
    ).toEqual(["g"]);
  });

  it("renders a draw.io export's fallback text, not its HTML labels", async () => {
    // draw.io writes every label twice inside a `switch`: as HTML in a
    // `foreignObject`, and as a `<text>` fallback. It then appends a second
    // `switch` whose fallback branch is a "Text is not SVG" notice.
    const host = await parsed(`<div>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="121px" height="61px" viewBox="-0.5 -0.5 121 61"><defs/><g><rect x="0" y="0" width="120" height="60" rx="9" ry="9" fill="#dae8fc" stroke="#6c8ebf" pointer-events="all"/><g transform="translate(-0.5 -0.5)"><switch><foreignObject pointer-events="none" width="100%" height="100%" requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility" style="overflow: visible; text-align: left;"><div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; align-items: unsafe center; width: 118px; height: 1px; padding-top: 30px; margin-left: 1px;"><div style="box-sizing: border-box; font-size: 0px; text-align: center;"><div style="display: inline-block; font-size: 12px; font-family: Helvetica; color: rgb(0, 0, 0);"><p>Start</p></div></div></div></foreignObject><text x="60" y="34" fill="rgb(0, 0, 0)" font-family="Helvetica" font-size="12px" text-anchor="middle">Start</text></switch></g></g><switch><g requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility"/><a transform="translate(0,-5)" xlink:href="https://www.drawio.com/doc/faq/svg-export-text-problems" target="_blank"><text text-anchor="middle" font-size="10px" x="50%" y="100%">Text is not SVG - cannot display</text></a></switch></svg>
</div>`);
    // Nothing escaped the svg: re-parsing an HTML `div` inside it used to break
    // out of the drawing and spill the rest of it into the page.
    expect(host.firstElementChild!.children).toHaveLength(1);
    const svg = host.querySelector("svg")!;
    expect(svg.querySelectorAll("div, p")).toHaveLength(0);
    expect(svg.querySelector("foreignObject")).toBeNull();
    expect(rects(svg)).toEqual(["0,0,120,60,#dae8fc"]);
    // A `switch` renders its first child whose conditions hold. With the
    // `foreignObject` gone and `requiredFeatures` refused, that is the label's
    // `<text>` in the first, and the empty `g` — not the notice — in the second.
    const [label, notice] = Array.from(svg.querySelectorAll("switch"));
    expect(label.firstElementChild!.tagName).toBe("text");
    expect(label.firstElementChild!.textContent).toBe("Start");
    expect(notice.firstElementChild!.tagName).toBe("g");
    expect(notice.firstElementChild!.hasAttribute("requiredFeatures")).toBe(
      false,
    );
  });

  it.each([
    ["defs", `<defs><rect width="9" height="9"/></defs>`],
    ["clipPath", `<clipPath id="c"><rect width="9" height="9"/></clipPath>`],
    ["mask", `<mask id="m"><rect width="9" height="9" fill="white"/></mask>`],
    [
      "pattern",
      `<pattern id="p" width="1" height="1"><rect width="9" height="9"/></pattern>`,
    ],
    [
      "marker",
      `<marker id="a" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><rect width="9" height="9"/></marker>`,
    ],
    [
      "symbol",
      `<symbol id="s" viewBox="0 0 9 9"><rect width="9" height="9"/></symbol>`,
    ],
    [
      "linearGradient",
      `<linearGradient id="g"><stop offset="0" stop-color="red"/><rect width="9" height="9"/></linearGradient>`,
    ],
    [
      "radialGradient",
      `<radialGradient id="r"><stop offset="1" stop-color="blue"/><rect width="9" height="9"/></radialGradient>`,
    ],
    [
      "filter",
      `<filter id="f"><feFlood flood-color="red"/><rect width="9" height="9"/></filter>`,
    ],
    [
      "metadata",
      `<metadata><rdf:RDF><cc:Work><dc:title>Drawing</dc:title></cc:Work></rdf:RDF><rect width="9" height="9"/></metadata>`,
    ],
    [
      "foreignObject",
      `<foreignObject width="9" height="9"><rect width="9" height="9"/></foreignObject>`,
    ],
  ])("removes a %s with its contents", async (tag, inner) => {
    const host = await parsed(
      `<div>\n<svg viewBox="0 0 9 9"><circle r="1"/>${inner}</svg>\n</div>`,
    );
    const svg = host.querySelector("svg")!;
    // Only the circle drawn beside the container survives: no painted rect,
    // no stop, no primitive, and no exporter text.
    expect(
      Array.from(svg.querySelectorAll("*")).map((el) => el.tagName),
    ).toEqual(["circle"]);
    expect(svg.textContent).toBe("");
    expect(host.innerHTML).not.toContain(tag);
  });

  /**
   * Every `SVG_ATTRIBUTES` entry, spelled the way an author writes it.
   *
   * The schema lists hast *property* names, and the only way to know one is
   * right is to feed the sanitizer the attribute and see it come out. Four of
   * the original entries (`strokeLinecap` and friends) were camel-cased by hand
   * and matched nothing. None of these is also on the schema's `*` list, so each
   * survives only through its own entry — which is why the length check below
   * proves the table covers the whole list.
   */
  const SVG_ATTRIBUTE_SPELLINGS: [string, string][] = [
    ["fill", "#2563eb"],
    ["stroke", "red"],
    ["fill-opacity", "0.5"],
    ["fill-rule", "evenodd"],
    ["stroke-opacity", "0.25"],
    ["stroke-width", "2"],
    ["stroke-linecap", "round"],
    ["stroke-linejoin", "bevel"],
    ["opacity", "0.9"],
    ["transform", "rotate(10 5 5)"],
    ["font-family", "Georgia, 'Times New Roman', serif"],
    ["font-size", "12"],
    ["font-weight", "700"],
    ["font-style", "italic"],
    ["letter-spacing", "0.5"],
    ["text-anchor", "middle"],
    ["dominant-baseline", "central"],
    ["x", "1"],
    ["y", "2"],
    ["x1", "3"],
    ["y1", "4"],
    ["x2", "5"],
    ["y2", "6"],
    ["cx", "7"],
    ["cy", "8"],
    ["r", "9"],
    ["rx", "10"],
    ["ry", "11"],
    ["dx", "12"],
    ["dy", "13"],
    ["d", "M0 0 L9 9"],
    ["points", "0,0 9,9"],
  ];

  /** The admitted SVG children: every tag whose required ancestor is `svg`. */
  const SVG_CHILD_TAGS = Object.entries(sanitizeSchema.ancestors ?? {})
    .filter(([, required]) => required.includes("svg"))
    .map(([tag]) => tag);

  it("spells out every SVG_ATTRIBUTES entry", () => {
    // `rect` carries exactly `SVG_ATTRIBUTES`, as every admitted child does,
    // plus the `style` entry every admitted element but `input` has.
    const own = sanitizeSchema.attributes!.rect!.filter(
      (definition) => !(Array.isArray(definition) && definition[0] === "style"),
    );
    expect(own).toHaveLength(sanitizeSchema.attributes!.rect!.length - 1);
    expect(SVG_ATTRIBUTE_SPELLINGS).toHaveLength(own.length);
  });

  it.each(SVG_CHILD_TAGS)(
    "keeps every SVG_ATTRIBUTES entry on <%s>",
    async (tag) => {
      const written = SVG_ATTRIBUTE_SPELLINGS.map(
        ([name, value]) => `${name}="${value}"`,
      ).join(" ");
      const host = await parsed(
        `<div>\n<svg viewBox="0 0 9 9"><${tag} ${written}></${tag}></svg>\n</div>`,
      );
      const element = host.querySelector("svg")!.firstElementChild!;
      expect(element.tagName).toBe(tag);
      for (const [name, value] of SVG_ATTRIBUTE_SPELLINGS) {
        expect(element.getAttribute(name), name).toBe(value);
      }
    },
  );

  it("admits exactly these SVG children", () => {
    // Pinned so that widening the allowlist is a change someone has to make to
    // a test as well, and every table here that iterates the admitted children
    // demonstrably covers the whole set.
    expect([...SVG_CHILD_TAGS].sort()).toEqual([
      "circle",
      "ellipse",
      "g",
      "line",
      "path",
      "polygon",
      "polyline",
      "rect",
      "switch",
      "text",
      "tspan",
    ]);
  });

  const HANDLERS = `onload="alert(1)" onclick="alert(1)" onmouseover="alert(1)" onfocusin="alert(1)" onbegin="alert(1)" onerror="alert(1)"`;

  it.each(["svg", ...SVG_CHILD_TAGS])(
    "refuses every event handler on <%s>",
    async (tag) => {
      const markup =
        tag === "svg"
          ? `<svg viewBox="0 0 9 9" ${HANDLERS}></svg>`
          : `<svg viewBox="0 0 9 9"><${tag} ${HANDLERS}></${tag}></svg>`;
      const host = await parsed(`<div>\n${markup}\n</div>`);
      const svg = host.querySelector("svg")!;
      const element = tag === "svg" ? svg : svg.firstElementChild!;
      expect(element.tagName).toBe(tag);
      expect(Array.from(element.attributes, (a) => a.name)).toEqual(
        tag === "svg" ? ["viewBox"] : [],
      );
    },
  );

  /**
   * Attributes refused on a drawing element, each written on a `rect` that
   * must otherwise survive intact. Most take a `url(…)` — a fetch, or a
   * reference into the document — and the paint rows are the price of
   * refusing parentheses: `rgb()` and `hsl()` go with `url()`.
   */
  it.each([
    ["mask", `mask="url(#m)"`],
    ["clip-path", `clip-path="url(#c)"`],
    ["filter", `filter="url(#f)"`],
    ["marker-start", `marker-start="url(#a)"`],
    ["marker-mid", `marker-mid="url(#a)"`],
    ["marker-end", `marker-end="url(#a)"`],
    ["cursor", `cursor="url(https://attacker.example/c.png), auto"`],
    ["fill", `fill="url(#g)"`],
    ["stroke", `stroke="url(https://attacker.example/p)"`],
    ["fill", `fill="rgb(219, 234, 254)"`],
    ["fill", `fill="rgba(0, 0, 0, 0.5)"`],
    ["stroke", `stroke="hsl(210 50% 50%)"`],
    ["stroke", `stroke="hsla(210, 50%, 50%, 0.5)"`],
    ["fill", `fill="red url(#g)"`],
    ["fill", `fill="var(--brand)"`],
    ["style", `style="fill:url(#g)"`],
    // Refused for its property list alone, with no parenthesis to trip on:
    // `SAFE_STYLE` has no `fill` or `stroke`. This is how Inkscape and
    // matplotlib write paint.
    ["style", `style="fill:none;stroke:#1f77b4"`],
    ["href", `href="https://attacker.example/"`],
    ["xlink:href", `xlink:href="https://attacker.example/"`],
    [
      "requiredFeatures",
      `requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility"`,
    ],
    ["systemLanguage", `systemLanguage="en"`],
    ["stroke-dasharray", `stroke-dasharray="4 2"`],
  ])("refuses %s (%s)", async (name, written) => {
    const host = await parsed(
      `<div>\n<svg viewBox="0 0 9 9"><rect width="9" height="9" ${written}/></svg>\n</div>`,
    );
    const rect = host.querySelector("rect")!;
    expect(rect.hasAttribute(name)).toBe(false);
    expect(Array.from(rect.attributes, (a) => a.name).sort()).toEqual([
      "height",
      "width",
    ]);
  });

  /**
   * Elements refused inside a drawing, each written beside a circle that must
   * be all that survives. The animation family can rewrite any attribute after
   * the sanitizer has looked; the rest fetch, or pull in markup from elsewhere.
   */
  it.each([
    ["set", `<set attributeName="fill" to="red" begin="0s"/>`],
    ["animate", `<animate attributeName="href" to="javascript:alert(1)"/>`],
    [
      "animateTransform",
      `<animateTransform attributeName="transform" type="scale" to="80"/>`,
    ],
    [
      "animateMotion",
      `<animateMotion dur="1s" path="M0 0 H9"><mpath href="#p"/></animateMotion>`,
    ],
    [
      "image",
      `<image href="https://attacker.example/i.png" width="9" height="9"/>`,
    ],
    ["use", `<use href="https://attacker.example/s.svg#x"/>`],
    ["feImage", `<feImage href="https://attacker.example/i.png"/>`],
    ["iframe", `<iframe src="https://attacker.example/f"></iframe>`],
    ["script", `<script>alert(1)</script>`],
  ])("refuses <%s>", async (tag, written) => {
    const html = await styled(
      `<div>\n<svg viewBox="0 0 9 9"><circle r="1"/>${written}</svg>\n</div>`,
    );
    expect(html).not.toContain(`<${tag}`);
    expect(html).not.toContain("attacker.example");
    expect(html).not.toContain("alert(1)");
    const host = document.createElement("div");
    host.innerHTML = html;
    const svg = host.querySelector("svg")!;
    expect(Array.from(svg.querySelectorAll("*"), (el) => el.tagName)).toEqual([
      "circle",
    ]);
  });

  it("keeps a link inside a drawing, protocol-filtered like any link", async () => {
    const host = await parsed(`<div>
<svg viewBox="0 0 9 9"><a href="https://example.com/x"><rect width="9" height="9"/></a><a href="javascript:alert(1)"><circle r="1"/></a></svg>
</div>`);
    const [kept, filtered] = Array.from(host.querySelectorAll("svg > a"));
    expect(kept.getAttribute("href")).toBe("https://example.com/x");
    expect(kept.firstElementChild!.tagName).toBe("rect");
    expect(Array.from(filtered.attributes)).toEqual([]);
    expect(filtered.firstElementChild!.tagName).toBe("circle");
  });

  it("keeps currentColor paint, on the root and on a child", async () => {
    // What the reference tells an author to write for a drawing that has to
    // read in both themes.
    const host = await parsed(`<div>
<svg viewBox="0 0 9 9" fill="currentColor" stroke="currentColor"><rect width="9" height="9" fill="currentColor" stroke="currentColor"/></svg>
</div>`);
    for (const element of [
      host.querySelector("svg")!,
      host.querySelector("rect")!,
    ]) {
      expect(element.getAttribute("fill"), element.tagName).toBe(
        "currentColor",
      );
      expect(element.getAttribute("stroke"), element.tagName).toBe(
        "currentColor",
      );
    }
  });

  /**
   * The shape the reference recommends, and the one it says works without a
   * wrapper: whether a drawing reaches the sanitizer whole is decided by
   * Markdown's HTML-block rules before any of this code runs. `*adj*` is the
   * witness — read as a paragraph instead, it became emphasis and closed the
   * `svg` there.
   */
  it.each([
    [
      "a div around a multi-line start tag",
      `<div>
<svg
   xmlns="http://www.w3.org/2000/svg"
   viewBox="0 0 80 40"
   role="img"
   aria-label="p-value">
  <text x="4" y="20">p_value *adj*</text>
</svg>
</div>`,
    ],
    [
      "a single-line start tag with no div",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" role="img" aria-label="p-value">
  <text x="4" y="20">p_value *adj*</text>
</svg>`,
    ],
  ])("keeps a drawing whole when written as %s", async (_, markup) => {
    const host = await parsed(markup);
    expect(host.querySelectorAll("svg")).toHaveLength(1);
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 40");
    expect(svg.getAttribute("aria-label")).toBe("p-value");
    expect(svg.querySelector("em")).toBeNull();
    expect(svg.querySelector("text")!.textContent).toBe("p_value *adj*");
    expect(host.querySelector("p")).toBeNull();
  });

  it("unwraps a textPath to its text, without the path it pointed at", async () => {
    const host = await parsed(
      `<div>\n<svg viewBox="0 0 9 9"><text x="1" y="5"><textPath href="#p">Along</textPath></text></svg>\n</div>`,
    );
    const text = host.querySelector("text")!;
    expect(text.children).toHaveLength(0);
    expect(text.textContent).toBe("Along");
  });

  it("refuses stroke-dasharray, whose paint cost the document controls", async () => {
    // Dash count is path length over dash period, both in user units the
    // document picks. Fifty short paths with a 0.0011 dash took 21 s to paint
    // in headless Chromium, and scaling the user units defeats any floor on
    // the dash length. See `SVG_ATTRIBUTES`.
    const host = await parsed(`<div>
<svg viewBox="0 0 1000 300"><path d="M0 1 H1000" stroke="red" stroke-width="50" stroke-dasharray="0.0011" stroke-dashoffset="1"/></svg>
</div>`);
    const path = host.querySelector("path")!;
    expect(path.getAttribute("stroke-width")).toBe("50");
    expect(path.hasAttribute("stroke-dasharray")).toBe(false);
    expect(path.hasAttribute("stroke-dashoffset")).toBe(false);
  });

  /**
   * Every shape that let a document's `<title>` become the page's title.
   *
   * `title` and `desc` are removed with their contents inside a drawing, and
   * every route here is inside one, so none has a title left to hoist or
   * re-parse. The first is the React route: an `svg` under `math` keeps MathML
   * context, and React hoists a `title` anywhere outside SVG context into
   * `<head>`. The other three are the string route: each re-parses into an
   * HTML-namespace `title`.
   */
  const TITLE_ROUTES: [string, string][] = [
    ["math > svg > title", `<math><svg><title>Hijacked</title></svg></math>`],
    [
      "svg > desc > title",
      `<div>\n<svg><desc><title>Hijacked</title></desc></svg>\n</div>`,
    ],
    [
      "svg > foreignObject > div > title",
      `<div>\n<svg><foreignObject><div><title>Hijacked</title></div></foreignObject></svg>\n</div>`,
    ],
    [
      "svg > title > title",
      `<div>\n<svg><title><title>Hijacked</title></title></svg>\n</div>`,
    ],
  ];

  it.each(TITLE_ROUTES)(
    "leaves %s no title in the string output",
    async (_, markup) => {
      const html = await styled(markup);
      expect(html).not.toContain("<title");
      expect(html).not.toContain("Hijacked");
      // Inserted into a page with no title of its own, the way a `{@html}`
      // consumer of `renderMarkdown` would.
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.append(host);
      try {
        expect(document.title).toBe("");
      } finally {
        host.remove();
      }
    },
  );

  it.each(TITLE_ROUTES)(
    "leaves %s nothing for React to hoist into <head>",
    (_, markup) => {
      document.title = "Vantage";
      try {
        render(createElement(MarkdownViewer, { content: markup + "\n" }));
        expect(document.title).toBe("Vantage");
        // Not merely outranked by the page's own: no second title anywhere.
        expect(
          Array.from(document.querySelectorAll("title"), (t) => t.textContent),
        ).toEqual(["Vantage"]);
      } finally {
        cleanup();
        document.head.querySelectorAll("title").forEach((t) => t.remove());
      }
    },
  );

  it("strips desc with its contents", async () => {
    // `desc` is an HTML integration point like `title`: whatever HTML it holds
    // would otherwise survive inside the svg.
    const host = await parsed(
      `<div>\n<svg viewBox="0 0 9 9"><desc><p>Start</p>A drawing</desc><rect width="9" height="9"/></svg>\n</div>`,
    );
    const svg = host.querySelector("svg")!;
    expect(Array.from(svg.children, (el) => el.tagName)).toEqual(["rect"]);
    expect(svg.textContent).toBe("");
  });

  it("keeps transform off the root svg, and on its children", async () => {
    // On the root, `transform` is a CSS transform of an in-flow box: this one
    // lays out at 10px and paints at 800px over the paragraphs around it.
    const host = await parsed(`<div>
<svg width="10" height="10" viewBox="0 0 10 10" transform="translate(-300 -300) scale(80)"><g transform="rotate(45 5 5)"><rect width="10" height="10" transform="scale(0.5)"/></g></svg>
</div>`);
    const svg = host.querySelector("svg")!;
    expect(svg.hasAttribute("transform")).toBe(false);
    expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(svg.querySelector("g")!.getAttribute("transform")).toBe(
      "rotate(45 5 5)",
    );
    expect(svg.querySelector("rect")!.getAttribute("transform")).toBe(
      "scale(0.5)",
    );
  });

  /**
   * The root's `role`, pinned to the values that describe a drawing. Any other
   * lets a document present its picture to assistive technology as an alert,
   * a button or a dialog, under a label it wrote itself — "Session expired:
   * sign in again at …", announced the moment the page renders.
   */
  it.each(["img", "presentation", "none"])(
    'keeps role="%s" on the root svg',
    async (role) => {
      const host = await parsed(
        `<div>\n<svg viewBox="0 0 9 9" role="${role}" aria-label="Dot"><circle r="1"/></svg>\n</div>`,
      );
      expect(host.querySelector("svg")!.getAttribute("role")).toBe(role);
    },
  );

  // `alert img` is a fallback list: a browser takes the first role it knows.
  it.each([
    "alert",
    "button",
    "link",
    "heading",
    "dialog",
    "status",
    "alert img",
  ])('refuses role="%s" on the root svg', async (role) => {
    const host = await parsed(
      `<div>\n<svg viewBox="0 0 9 9" role="${role}" aria-label="Session expired: sign in again at evil.test"><circle r="1"/></svg>\n</div>`,
    );
    const svg = host.querySelector("svg")!;
    expect(svg.hasAttribute("role")).toBe(false);
    expect(Array.from(svg.attributes, (a) => a.name).sort()).toEqual([
      "aria-label",
      "viewBox",
    ]);
  });

  it("keeps every other SVG_ATTRIBUTES entry on the root svg", async () => {
    const written = SVG_ATTRIBUTE_SPELLINGS.map(
      ([name, value]) => `${name}="${value}"`,
    ).join(" ");
    const host = await parsed(`<div>\n<svg ${written}></svg>\n</div>`);
    const svg = host.querySelector("svg")!;
    for (const [name, value] of SVG_ATTRIBUTE_SPELLINGS) {
      if (name === "transform") continue;
      expect(svg.getAttribute(name), name).toBe(value);
    }
  });

  it.each([...SVG_CHILD_TAGS, "title", "desc"])(
    "does not admit <%s> outside an svg",
    async (tag) => {
      const html = await styled(`<div><${tag} x="1">In prose</${tag}></div>`);
      expect(html).not.toContain(`<${tag}`);
    },
  );

  /**
   * What the containers removed inside a drawing do in prose: they are
   * unwrapped there, like any other tag the schema does not know.
   *
   * Removing them in prose too lost the rest of the document. A bare
   * `<pattern>` on a line of its own is an HTML element nothing closes, so
   * every Markdown block after it was parsed into it and went with it — in all
   * three renderers, with `vantage-check` silent. Inside an `<svg>` the same
   * container is bounded by the drawing, because a Markdown paragraph or
   * heading breaks out of SVG.
   */
  const STRIPPED_IN_SVG = [
    "defs",
    "clipPath",
    "mask",
    "pattern",
    "marker",
    "symbol",
    "linearGradient",
    "radialGradient",
    "filter",
    "metadata",
    "foreignObject",
    "title",
    "desc",
  ];

  it.each(STRIPPED_IN_SVG)(
    "keeps every block after a bare <%s> on a line of its own",
    async (tag) => {
      const html = await styled(
        `Intro\n\n<${tag}>\n\nPara one.\n\n## Later\n\n- item\n\nEnd.`,
      );
      expect(html).not.toContain(`<${tag}`);
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(host.querySelector("h2")?.textContent).toBe("Later");
      expect(host.querySelector("li")?.textContent).toBe("item");
      expect(host.textContent).toContain("Para one.");
      expect(host.textContent).toContain("End.");
    },
  );

  it("keeps the section a link points at when a bare <pattern> precedes it", async () => {
    const html = await styled(
      "# Probe\n\nSee [the later section](#later-heading).\n\nSearch with this form:\n\n<pattern>\n\nPara one.\n\n## Later heading\n\nPara two.",
    );
    expect(html).toBe(
      [
        `<h1 data-source-line="1" id="probe">Probe</h1>`,
        `<p data-source-line="3">See <a href="#later-heading">the later section</a>.</p>`,
        `<p data-source-line="5">Search with this form:</p>`,
        // Where the `<pattern>` stood: the tag goes, its newline stays.
        ``,
        `<p data-source-line="9">Para one.</p>`,
        `<h2 data-source-line="11" id="later-heading">Later heading</h2>`,
        `<p data-source-line="13">Para two.</p>`,
      ].join("\n"),
    );
  });

  it.each([
    [
      "a placeholder in a sentence",
      "Replace <pattern> with a regex, and <filter> too.",
      `<p data-source-line="1">Replace  with a regex, and  too.</p>`,
    ],
    [
      "a title with its text",
      "A stray <title>x</title> here.",
      `<p data-source-line="1">A stray x here.</p>`,
    ],
    [
      // Nothing closes it, and removing it took the rest of the sentence.
      "an unclosed title",
      "Use the <title> element to name a page.",
      `<p data-source-line="1">Use the  element to name a page.</p>`,
    ],
    [
      "tag names in code spans",
      "Write `<pattern>` and `<title>` in code.",
      `<p data-source-line="1">Write <code>&#x3C;pattern></code> and <code>&#x3C;title></code> in code.</p>`,
    ],
  ])("loses only the tag of %s in prose", async (_, markdown, expected) => {
    expect(await styled(markdown)).toBe(expected);
  });
});
