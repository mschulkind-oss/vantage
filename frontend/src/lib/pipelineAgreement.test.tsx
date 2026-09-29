/**
 * D5: every renderer agrees.
 *
 * The reason `buildPipeline` exists is that three call sites used to hand-write
 * the same plugin list, so a plugin could land in the app and not in the CLI
 * checker — a document that styles in the viewer and renders bare through the
 * tool that is supposed to validate it, with no error anywhere. This test runs
 * one fixture through all three and asserts they still say the same thing.
 *
 * It deliberately checks the properties a chain divergence would break first:
 * the `data-source-line` numbers a `#L42` link and every review anchor are read
 * against, the heading id every in-document link points at (unprefixed, which
 * is the whole reason `rehypeSlug` runs after the sanitizer), that math renders
 * while a bare `$` does not, and that the sanitizer filtered the style.
 */
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { renderMarkdown } from "vantage-md";
import { MarkdownViewer as PackageMarkdownViewer } from "vantage-md/react";
import { MarkdownViewer as AppMarkdownViewer } from "../components/MarkdownViewer";

// Store writes fire command requests via axios; the app viewer pulls the store in.
vi.mock("axios");
// The planning index is its own suites' subject (usePlanningStore.test.ts,
// usePlanningLinkBadges.test.tsx). Here it stays idle, so rendering the viewer
// issues no planning request and draws no badge.
vi.mock("../stores/usePlanningStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/usePlanningStore")>()),
  usePlanningIndex: () => ({ status: "idle" }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Four lines of frontmatter, so every body line is offset by 4 and a renderer
// that forgets `bodyLineOffset` disagrees loudly instead of subtly.
const FIXTURE = [
  "---", // 1
  "title: Agreement fixture", // 2
  "status: draft", // 3
  "---", // 4
  "", // 5
  "## Section One", // 6
  "", // 7
  "Text with $HOME in it.", // 8
  "", // 9
  "$$E = mc^2$$", // 10
  "", // 11
  "| a | b |", // 12
  "| - | - |", // 13
  "| 1 | 2 |", // 14
  "", // 15
  '<div style="position:fixed;color:red">z</div>', // 16
  "", // 17
  "[to section](#section-one)", // 18
  "", // 19
].join("\n");

/** A directive-carrying fixture, kept separate so the line numbers above stay put. */
const DIRECTIVE_FIXTURE = [
  "<!-- vantage: section tone=warning collapsed=true -->", // 1
  "", // 2
  "## Stamped section", // 3
  "", // 4
  '<!-- vantage: oq leaning="Back of the queue" -->', // 5
  "", // 6
  "_Leaning:_ back of the queue.", // 7
  "", // 8
].join("\n");

/**
 * Inline SVG, kept separate for the same reason. The first drawing is shaped
 * like a draw.io export — every label is a `switch` holding HTML in a
 * `foreignObject` and a `<text>` fallback — which is the shape where the string
 * output and the React viewers used to disagree: re-parsing `renderMarkdown`'s
 * HTML broke out of the svg at the first `div`, leaving one rect and no text in
 * the drawing and the rest of it loose in the page. The second is a small
 * drawing inline in a sentence, with a `desc` that holds HTML.
 *
 * draw.io wraps its closing "Text is not SVG" notice in an `<a>` whose only
 * link is an `xlink:href`, which the sanitizer refuses, so every renderer holds
 * an `<a>` with no attributes there. That link was once left out of this
 * fixture, because both React viewers' link overrides spread react-markdown's
 * `node` prop onto the element, as `node="[object Object]"`, and gave an `<a>`
 * with no `href` an empty one. `OVERRIDE_FIXTURE` below is that bug's own test;
 * this one keeps the drawing whole.
 */
const SVG_FIXTURE = [
  "## Drawing", // 1
  "", // 2
  "<div>", // 3
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="241px" height="61px" viewBox="-0.5 -0.5 241 61"><defs/><g><rect x="0" y="0" width="120" height="60" rx="9" ry="9" fill="#dae8fc" stroke="#6c8ebf" pointer-events="all"/><g transform="translate(-0.5 -0.5)"><switch><foreignObject pointer-events="none" width="100%" height="100%" requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility" style="overflow: visible; text-align: left;"><div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; width: 118px;"><div style="box-sizing: border-box; text-align: center;"><div style="display: inline-block; font-size: 12px;"><p>Start</p></div></div></div></foreignObject><text x="60" y="34" fill="rgb(0, 0, 0)" font-family="Helvetica" font-size="12px" text-anchor="middle">Start</text></switch></g><rect x="120" y="0" width="120" height="60" fill="#d5e8d4" stroke="#82b366" pointer-events="all"/></g><switch><g requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility"/><a transform="translate(0,-5)" xlink:href="https://www.drawio.com/doc/faq/svg-export-text-problems" target="_blank"><text text-anchor="middle" font-size="10px" x="50%" y="100%">Text is not SVG - cannot display</text></a></switch></svg>', // 4
  "</div>", // 5
  "", // 6
  'An icon <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="dot"><desc><p>Dot</p></desc><circle cx="8" cy="8" r="6" fill="currentColor"/></svg> in a sentence.', // 7
  "", // 8
].join("\n");

/**
 * Classes a document writes, kept separate for the same reason. Tailwind
 * utilities the app's stylesheet ships, on a block, in a sentence and on a
 * drawing, beside two features that keep a class of their own: an alert's
 * title and a fence's language.
 */
const CLASS_FIXTURE = [
  "## Classes", // 1
  "", // 2
  '<div class="fixed inset-0 z-50 bg-white">Overlay</div>', // 3
  "", // 4
  'A <span class="fixed inset-0">word</span> and a <svg class="fixed inset-0" width="8" height="8" viewBox="0 0 8 8" role="img" aria-label="dot"><circle cx="4" cy="4" r="3"/></svg>.', // 5
  "", // 6
  "> [!NOTE]", // 7
  "> Noted.", // 8
  "", // 9
  "```js", // 10
  "const x = 1;", // 11
  "```", // 12
  "", // 13
].join("\n");

/**
 * Every element a React viewer renders through a `components` override, kept
 * separate for the same reason: the six headings (the app's `#` anchor), a
 * Markdown link, a raw HTML link, an `<a>` with no `href`, a link inside a
 * drawing, inline code and a fence (both viewers' `code`).
 *
 * The drawing's link is shaped the way draw.io writes one. The sanitizer
 * refuses `xlink:href`, so it reaches every renderer as an `<a>` with no
 * `href` at all.
 */
const OVERRIDE_FIXTURE = [
  "# One", // 1
  "", // 2
  "## Two", // 3
  "", // 4
  "### Three", // 5
  "", // 6
  "#### Four", // 7
  "", // 8
  "##### Five", // 9
  "", // 10
  "###### Six", // 11
  "", // 12
  "A [Markdown link](https://example.com/md) and `inline code`,", // 13
  '<a href="https://example.com/raw">a raw link</a> and <a>a bare anchor</a>.', // 14
  "", // 15
  '<svg width="8" height="8" viewBox="0 0 8 8" role="img" aria-label="linked"><a xlink:href="https://example.com/svg" target="_blank"><text x="0" y="8">t</text></a></svg>', // 16
  "", // 17
  "```js", // 18
  "const x = 1;", // 19
  "```", // 20
  "", // 21
].join("\n");

/** Every svg in `root`, as its tag, attributes and children, recursively. */
function describeSvgs(root: HTMLElement): string[] {
  const describe = (el: Element): string => {
    const attributes = Array.from(el.attributes, (a) => `${a.name}=${a.value}`)
      .sort()
      .join(" ");
    const children = Array.from(el.childNodes, (node) =>
      node.nodeType === Node.ELEMENT_NODE
        ? describe(node as Element)
        : JSON.stringify(node.textContent),
    ).join(",");
    return `${el.namespaceURI === SVG_NS ? "" : "(not SVG)"}${el.tagName}[${attributes}](${children})`;
  };
  return Array.from(root.querySelectorAll("svg"), describe);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Markers a post-render pass sets at runtime, which no renderer's HTML carries.
 *
 * `collapse-armed` belongs here for the same reason `collapse-ready` does: it
 * says a control exists for this block, which is true only where the toggle JS
 * ran. The renderers must differ on it and must agree on everything the plugin
 * stamped.
 */
const JS_SET_MARKERS = new Set([
  "data-vantage-collapse-ready",
  "data-vantage-collapse-armed",
  "data-vantage-collapse-id",
]);

interface Rendered {
  sourceLines: string[];
  headingId: string | null;
  hasKatex: boolean;
  text: string;
  styleAttributesOnDiv: (string | null)[];
  /** Every `data-vantage-*` attribute, as `tag name="value"`, in tree order. */
  directives: string[];
}

function describeTree(root: HTMLElement): Rendered {
  const sourceLines = Array.from(root.querySelectorAll("[data-source-line]"))
    .map((el) => el.getAttribute("data-source-line")!)
    .sort();
  const heading = root.querySelector("h2");
  // The metadata card is rendered by the two React viewers and not by
  // `renderMarkdown`, and it sits in the same container as the prose. Compare
  // the heading and everything after it, which is exactly the Markdown body.
  const proseText: string[] = [];
  for (let el = heading; el; el = el.nextElementSibling as HTMLElement | null) {
    proseText.push(el.textContent ?? "");
  }

  const directives: string[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    // The app viewer additionally runs the collapse pass, which injects a caret,
    // marks the container `data-vantage-collapse-ready` and mints an `id` for
    // `aria-controls` where a block had none. That difference is the design: the
    // marker is what the hiding CSS is gated on, so the renderers *must* differ
    // there — and must agree on everything the plugin stamped.
    if (el.hasAttribute("data-vantage-collapse-caret")) continue;
    for (const attribute of Array.from(el.attributes)) {
      if (JS_SET_MARKERS.has(attribute.name)) continue;
      if (attribute.name.startsWith("data-vantage-")) {
        directives.push(
          `${el.tagName.toLowerCase()} ${attribute.name}="${attribute.value}"`,
        );
      }
    }
  }

  return {
    sourceLines,
    directives,
    headingId: heading?.getAttribute("id") ?? null,
    hasKatex: root.querySelector(".katex") !== null,
    text: proseText.join(" "),
    styleAttributesOnDiv: Array.from(root.querySelectorAll("div")).map((el) =>
      el.getAttribute("style"),
    ),
  };
}

afterEach(cleanup);

/** `renderMarkdown`'s string output, parsed the way a browser would. */
async function renderedHost(content: string): Promise<HTMLElement> {
  const { html } = await renderMarkdown(content);
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

function packageViewerHost(content: string): HTMLElement {
  return render(<PackageMarkdownViewer content={content} />).container;
}

function appViewerHost(content: string): HTMLElement {
  return render(
    <BrowserRouter>
      <AppMarkdownViewer content={content} currentPath="t.md" />
    </BrowserRouter>,
  ).container;
}

async function throughRenderMarkdown(content = FIXTURE): Promise<Rendered> {
  return describeTree(await renderedHost(content));
}

function throughPackageViewer(content = FIXTURE): Rendered {
  return describeTree(packageViewerHost(content));
}

function throughAppViewer(content = FIXTURE): Rendered {
  return describeTree(appViewerHost(content));
}

describe("every renderer runs the same chain", () => {
  it("agrees on file-relative data-source-line numbers", async () => {
    // File lines 6, 8, 10, 12, 14, 16, 18, sorted as strings. Line 12 appears
    // four times — the table, its header row, and that row's two cells — and 14
    // three times, for the body row and its two cells. Cells are stamped so a
    // review comment can anchor to one, which is what makes a line name several
    // blocks at once.
    const expected = [
      "10",
      "12",
      "12",
      "12",
      "12",
      "14",
      "14",
      "14",
      "16",
      "18",
      "6",
      "8",
    ];

    expect((await throughRenderMarkdown()).sourceLines).toEqual(expected);
    expect(throughPackageViewer().sourceLines).toEqual(expected);
    expect(throughAppViewer().sourceLines).toEqual(expected);
  });

  it("agrees on the heading id, with no user-content- prefix", async () => {
    // `rehypeSlug` runs after `rehypeSanitize` in all three, so the sanitizer's
    // `clobberPrefix` never touches a generated id.
    for (const rendered of [
      await throughRenderMarkdown(),
      throughPackageViewer(),
      throughAppViewer(),
    ]) {
      expect(rendered.headingId).toBe("section-one");
    }
  });

  it("agrees that $$…$$ is math and a lone $ is not", async () => {
    for (const rendered of [
      await throughRenderMarkdown(),
      throughPackageViewer(),
      throughAppViewer(),
    ]) {
      expect(rendered.hasKatex).toBe(true);
      expect(rendered.text).toContain("$HOME");
    }
  });

  it("agrees that the sanitizer filtered position:fixed off the div", async () => {
    for (const rendered of [
      await throughRenderMarkdown(),
      throughPackageViewer(),
      throughAppViewer(),
    ]) {
      expect(rendered.styleAttributesOnDiv).not.toContain(
        "position:fixed;color:red",
      );
      for (const style of rendered.styleAttributesOnDiv) {
        expect(style ?? "").not.toContain("position");
      }
    }
  });

  it("agrees on every data-vantage-* attribute a directive compiles to", async () => {
    // The test that catches a boolean: `dataVantageOq: true` serializes as a
    // bare `data-vantage-oq` through `rehype-stringify` and as
    // `data-vantage-oq="true"` through react-markdown, so a directive would
    // mean one thing in the app and another in the CLI checker with nothing
    // failing anywhere. It also pins that the app's heading override still
    // spreads its props: stop spreading and section stamping silently vanishes
    // in the app while still working in the checker.
    const expected = [
      'h2 data-vantage-tone="warning"',
      'h2 data-vantage-run="start"',
      'h2 data-vantage-collapse-toggle="1"',
      'p data-vantage-tone="warning"',
      'p data-vantage-run="end"',
      'p data-vantage-collapsed="true"',
      'p data-vantage-collapse-group="1"',
      'p data-vantage-oq="true"',
      'p data-vantage-leaning="Back of the queue"',
    ];

    expect((await throughRenderMarkdown(DIRECTIVE_FIXTURE)).directives).toEqual(
      expected,
    );
    expect(throughPackageViewer(DIRECTIVE_FIXTURE).directives).toEqual(
      expected,
    );
    expect(throughAppViewer(DIRECTIVE_FIXTURE).directives).toEqual(expected);
  });

  it("agrees on an inline SVG, element for element", async () => {
    const viaRenderMarkdown = describeSvgs(await renderedHost(SVG_FIXTURE));
    // Both drawings, whole: the draw.io one with both rects and its label's
    // text fallback inside the svg, and nothing from the refused containers.
    expect(viaRenderMarkdown).toHaveLength(2);
    expect(viaRenderMarkdown[0]).toContain('"Start"');
    expect(viaRenderMarkdown[0].match(/rect\[/g)).toHaveLength(2);
    for (const drawing of viaRenderMarkdown) {
      expect(drawing).not.toContain("(not SVG)");
      expect(drawing).not.toMatch(/foreignObject|desc|defs|\bdiv\b|\bp\[/);
    }

    expect(describeSvgs(packageViewerHost(SVG_FIXTURE))).toEqual(
      viaRenderMarkdown,
    );
    expect(describeSvgs(appViewerHost(SVG_FIXTURE))).toEqual(viaRenderMarkdown);
  });

  it("agrees that an overridden element carries only the attributes the chain gave it", async () => {
    // react-markdown hands every override the hast element it renders, as a
    // `node` prop. Spread onto the DOM element with the rest, it became
    // `node="[object Object]"` on every link, code and (in the app) heading,
    // and each viewer's link override gave an `<a>` with no `href` an empty
    // one — a link to the page itself, where `renderMarkdown` has none.
    const hosts = {
      renderMarkdown: await renderedHost(OVERRIDE_FIXTURE),
      "package viewer": packageViewerHost(OVERRIDE_FIXTURE),
      "app viewer": appViewerHost(OVERRIDE_FIXTURE),
    };
    // Gathered for every renderer and compared once, so a failing run names
    // each renderer that leaks rather than only the first.
    const found: Record<string, unknown> = {};
    for (const [renderer, host] of Object.entries(hosts)) {
      // The fixture reached every override, or the rest proves nothing.
      for (const selector of [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        'a[href="https://example.com/md"]',
        'a[href="https://example.com/raw"]',
        "p > code",
        "pre > code.language-js",
        "svg a",
      ]) {
        expect(
          host.querySelector(selector),
          `${renderer}: ${selector}`,
        ).not.toBeNull();
      }

      const leaked = Array.from(host.querySelectorAll("*")).flatMap((el) =>
        Array.from(el.attributes)
          .filter((a) => a.name === "node" || a.value === "[object Object]")
          .map((a) => `${el.tagName.toLowerCase()} ${a.name}="${a.value}"`),
      );

      const bare = Array.from(host.querySelectorAll("a")).find(
        (a) => a.textContent === "a bare anchor",
      );
      expect(bare, renderer).toBeTruthy();
      found[renderer] = {
        leaked,
        bareAnchorHasHref: bare!.hasAttribute("href"),
        svgAnchorHasHref: host.querySelector("svg a")!.hasAttribute("href"),
      };
    }
    const clean = {
      leaked: [],
      bareAnchorHasHref: false,
      svgAnchorHasHref: false,
    };
    expect(found).toEqual({
      renderMarkdown: clean,
      "package viewer": clean,
      "app viewer": clean,
    });
  });

  it("agrees that a document's class carries only the pipeline's own names", async () => {
    // The overlay is the React viewers' problem first: the app ships the
    // utilities, and `fixed inset-0 z-50` on a document's div covered the
    // whole window, header and sidebar included. So all three renderers must
    // drop what the document wrote, and keep the classes the pipeline emits.
    for (const host of [
      await renderedHost(CLASS_FIXTURE),
      packageViewerHost(CLASS_FIXTURE),
      appViewerHost(CLASS_FIXTURE),
    ]) {
      const byText = (selector: string, text: string) =>
        Array.from(host.querySelectorAll(selector)).find(
          (el) => el.textContent === text,
        );
      const written = [
        byText("div", "Overlay"),
        byText("span", "word"),
        host.querySelector('svg[aria-label="dot"]'),
      ];
      for (const el of written) {
        expect(el).toBeTruthy();
        expect(el!.getAttribute("class") ?? "").toBe("");
      }
      expect(host.querySelector(".vantage-alert-title")?.textContent).toBe(
        "Note",
      );
      expect(host.querySelector("pre code.language-js")).not.toBeNull();
    }
  });

  it("agrees that a bare <pattern> in prose loses nothing after it", async () => {
    // Stripping the SVG containers everywhere, rather than only inside a
    // drawing, removed everything after this `<pattern>` in all three — the
    // heading the link points at included.
    const content = [
      "## Before",
      "",
      "See [the later section](#later-heading). Search with this form:",
      "",
      "<pattern>",
      "",
      "Para one.",
      "",
      "## Later heading",
      "",
      "Para two.",
      "",
    ].join("\n");
    for (const host of [
      await renderedHost(content),
      packageViewerHost(content),
      appViewerHost(content),
    ]) {
      expect(Array.from(host.querySelectorAll("h2"), (h) => h.id)).toEqual([
        "before",
        "later-heading",
      ]);
      expect(host.textContent).toContain("Para one.");
      expect(host.textContent).toContain("Para two.");
      expect(host.querySelector("pattern")).toBeNull();
    }
  });

  it("agrees on the rendered prose text", async () => {
    // The app's viewer decorates headings with a hover `#` anchor link through
    // ReactMarkdown's `components` prop (`MarkdownViewer.tsx`'s heading
    // factory). That is a viewer affordance, not part of the chain, so it is
    // the one difference this comparison is allowed to ignore.
    const normalize = (text: string) =>
      text.replace(/\s+/g, " ").replace(/^#/, "").trim();
    const viaRenderMarkdown = normalize((await throughRenderMarkdown()).text);

    expect(normalize(throughPackageViewer().text)).toBe(viaRenderMarkdown);
    expect(normalize(throughAppViewer().text)).toBe(viaRenderMarkdown);
  });
});
