/**
 * Line numbering for `data-source-line` / `#L42` anchors.
 *
 * The code under test lives in `packages/vantage-md`, which has no test runner
 * of its own; the frontend resolves `vantage-md` to that package's TypeScript
 * source (see `vite.config.ts`), so these run against the real thing.
 */
import { describe, it, expect } from "vitest";
import { parseFrontmatter, renderMarkdown } from "vantage-md";

// Heading on file line 10: 8 lines of frontmatter, one blank, then the `#`.
const WITH_FRONTMATTER = [
  "---", // 1
  'title: "Local STT Engine Architecture"', // 2
  'author: "Matthew Schulkind"', // 3
  "date: 2026-08-15", // 4
  "status: in-review", // 5
  "tags: [design, stt]", // 6
  'summary: "Design document."', // 7
  "---", // 8
  "", // 9
  "# Local STT Engine Architecture", // 10
  "", // 11
  "**Status:** DESIGN & BENCHMARK RFC.", // 12
].join("\n");

describe("parseFrontmatter bodyLineOffset", () => {
  it("counts the source lines the frontmatter consumed", () => {
    const { body, bodyLineOffset } = parseFrontmatter(WITH_FRONTMATTER);

    expect(bodyLineOffset).toBe(8);
    // The heading is body line 2 and file line 10.
    expect(body.split("\n")[1]).toBe("# Local STT Engine Architecture");
    expect(2 + bodyLineOffset).toBe(10);
  });

  it("counts TOML frontmatter the same way", () => {
    const content = ["+++", 'title = "T"', "+++", "", "# Heading"].join("\n");
    const { bodyLineOffset } = parseFrontmatter(content);

    expect(bodyLineOffset).toBe(3);
  });

  it("is zero when there is no frontmatter", () => {
    const { body, bodyLineOffset } = parseFrontmatter("# Heading\n\ntext\n");

    expect(bodyLineOffset).toBe(0);
    expect(body).toBe("# Heading\n\ntext\n");
  });

  it("is zero when the frontmatter never terminates", () => {
    const content = "---\ntitle: unterminated\n\n# Heading\n";
    const { body, bodyLineOffset } = parseFrontmatter(content);

    expect(bodyLineOffset).toBe(0);
    expect(body).toBe(content);
  });

  it("is zero when the frontmatter fails to parse", () => {
    const content = ["---", "title: [unclosed", "---", "", "# Heading"].join(
      "\n",
    );
    const { body, bodyLineOffset } = parseFrontmatter(content);

    expect(bodyLineOffset).toBe(0);
    expect(body).toBe(content);
  });
});

describe("renderMarkdown data-source-line", () => {
  const lineOf = (html: string, tag: string) =>
    html.match(new RegExp(`<${tag}[^>]*data-source-line="(\\d+)"`))?.[1];

  it("numbers blocks by their line in the file, not in the stripped body", async () => {
    const { html } = await renderMarkdown(WITH_FRONTMATTER, {
      highlight: false,
      math: false,
    });

    expect(lineOf(html, "h1")).toBe("10");
    expect(lineOf(html, "p")).toBe("12");
  });

  it("leaves a frontmatter-free document unshifted", async () => {
    const { html } = await renderMarkdown("# Heading\n\ntext\n", {
      highlight: false,
      math: false,
    });

    expect(lineOf(html, "h1")).toBe("1");
    expect(lineOf(html, "p")).toBe("3");
  });

  it("does not shift when frontmatter parsing is turned off", async () => {
    const { html } = await renderMarkdown(WITH_FRONTMATTER, {
      frontmatter: false,
      highlight: false,
      math: false,
    });

    // The frontmatter is rendered as content, so the heading keeps file line 10
    // by virtue of nothing having been stripped.
    expect(lineOf(html, "h1")).toBe("10");
  });
});
