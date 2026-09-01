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
 * is the whole reason `rehypeSlug` runs after the sanitiser), that math renders
 * while a bare `$` does not, and that the sanitiser filtered the style.
 */
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { renderMarkdown } from "vantage-md";
import { MarkdownViewer as PackageMarkdownViewer } from "vantage-md/react";
import { MarkdownViewer as AppMarkdownViewer } from "../components/MarkdownViewer";

// Store writes fire command requests via axios; the app viewer pulls the store in.
vi.mock("axios");

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

async function throughRenderMarkdown(content = FIXTURE): Promise<Rendered> {
  const { html } = await renderMarkdown(content);
  const host = document.createElement("div");
  host.innerHTML = html;
  return describeTree(host);
}

function throughPackageViewer(content = FIXTURE): Rendered {
  const { container } = render(<PackageMarkdownViewer content={content} />);
  return describeTree(container);
}

function throughAppViewer(content = FIXTURE): Rendered {
  const { container } = render(
    <BrowserRouter>
      <AppMarkdownViewer content={content} currentPath="t.md" />
    </BrowserRouter>,
  );
  return describeTree(container);
}

describe("every renderer runs the same chain", () => {
  it("agrees on file-relative data-source-line numbers", async () => {
    // Body lines 2, 4, 6, 8, 8, 10, 12, 14 → file lines 6, 8, 10, 12, 12, 14,
    // 16, 18. The two 12s are the table and its header row.
    const expected = ["10", "12", "12", "14", "16", "18", "6", "8"];

    expect((await throughRenderMarkdown()).sourceLines).toEqual(expected);
    expect(throughPackageViewer().sourceLines).toEqual(expected);
    expect(throughAppViewer().sourceLines).toEqual(expected);
  });

  it("agrees on the heading id, with no user-content- prefix", async () => {
    // `rehypeSlug` runs after `rehypeSanitize` in all three, so the sanitiser's
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

  it("agrees that the sanitiser filtered position:fixed off the div", async () => {
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
    // The test that catches a boolean: `dataVantageOq: true` serialises as a
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

  it("agrees on the rendered prose text", async () => {
    // The app's viewer decorates headings with a hover `#` anchor link through
    // ReactMarkdown's `components` prop (`MarkdownViewer.tsx`'s heading
    // factory). That is a viewer affordance, not part of the chain, so it is
    // the one difference this comparison is allowed to ignore.
    const normalise = (text: string) =>
      text.replace(/\s+/g, " ").replace(/^#/, "").trim();
    const viaRenderMarkdown = normalise((await throughRenderMarkdown()).text);

    expect(normalise(throughPackageViewer().text)).toBe(viaRenderMarkdown);
    expect(normalise(throughAppViewer().text)).toBe(viaRenderMarkdown);
  });
});
