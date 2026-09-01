import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../vantage-md/src/renderMarkdown.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

/**
 * Every delegated validator owes the same three answers: a valid document
 * produces nothing, an invalid one produces exactly one finding in the
 * delegate's own words, and a delegate that cannot run produces a failure
 * rather than a finding. The third is the one that matters — see
 * mermaid.test.ts, where it is not hypothetical.
 */

describe("frontmatter", () => {
  it("says nothing about frontmatter that parses", async () => {
    const root = makeTree({
      "yaml.md": [
        "---",
        'title: "Doc"',
        "tags: [a, b]",
        "---",
        "",
        "# Title",
      ].join("\n"),
      "toml.md": ["+++", 'title = "Doc"', "+++", "", "# Title"].join("\n"),
      "none.md": "# No frontmatter here\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("reports YAML that does not parse, with the parser's own message", async () => {
    const root = makeTree({
      "index.md": [
        "---",
        'title: "unclosed',
        "tags: [a",
        "---",
        "",
        "# Title",
      ].join("\n"),
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["frontmatter/parse"]);
    expect(report.findings[0]?.severity).toBe("error");
    expect(report.findings[0]?.detail).toBeTruthy();
  });

  it("reports TOML that does not parse", async () => {
    const root = makeTree({
      "index.md": ["+++", "title = ", "+++", "", "# Title"].join("\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual(["frontmatter/parse"]);
  });

  it("reports an unterminated block as a warning", async () => {
    const root = makeTree({
      "index.md": ["---", 'title: "Doc"', "", "# Title"].join("\n"),
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["frontmatter/unterminated"]);
    expect(report.findings[0]?.severity).toBe("warning");
  });

  // A document that opens with a horizontal rule is read as frontmatter by the
  // viewer, and the "metadata" it extracts is a bare string.
  it("reports frontmatter that parses to something other than a table", async () => {
    const root = makeTree({
      "index.md": ["---", "just some text", "---", "", "# Title"].join("\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual([
      "frontmatter/not-a-mapping",
    ]);
  });

  /**
   * The one frontmatter failure the parser cannot report, because from its point
   * of view there is no frontmatter at all: the block has to be the *first bytes*
   * of the file, so anything above the opening `---` — a directive, an editorial
   * comment, a stray blank line — turns the whole block into body text. It
   * renders as a horizontal rule plus a setext heading of the raw keys, and every
   * `key: value` in it is gone: no metadata card, no status chip, no `vantage:`
   * settings. Measured identical in `marked` and in bare CommonMark, so this is
   * not a Vantage quirk — which is exactly why the parser stays start-anchored
   * (GitHub, Hugo and gray-matter all agree) and the checker reports instead.
   */
  it("reports frontmatter that is not the first bytes of the file", async () => {
    const root = makeTree({
      "directive.md": [
        "<!-- vantage: section tone=note -->",
        "---",
        'title: "Doc"',
        "status: draft",
        "---",
        "",
        "# Title",
      ].join("\n"),
      "comment.md": [
        "<!-- prettier-ignore -->",
        "---",
        'title: "Doc"',
        "---",
        "",
        "# Title",
      ].join("\n"),
      "blank.md": ["", "---", 'title: "Doc"', "---", "", "# Title"].join("\n"),
      "toml.md": ["<!-- x -->", "+++", 'title = "Doc"', "+++", "", "# T"].join(
        "\n",
      ),
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([
      "frontmatter/not-at-top",
      "frontmatter/not-at-top",
      "frontmatter/not-at-top",
      "frontmatter/not-at-top",
    ]);
    for (const finding of report.findings) {
      expect(finding.severity).toBe("error");
      expect(finding.line).toBe(1);
      expect(finding.column).toBe(1);
      expect(finding.message).toContain("first bytes");
    }
    // The directive case additionally stamps the `<hr>` the block became, which
    // is what makes the mistake look deliberate — worth saying so.
    const stamped = report.findings.find((f) => f.file === "directive.md");
    expect(stamped?.message).toContain("directive");

    // The measured consequence, pinned beside the finding: no fields at all, and
    // the keys on the page as a heading.
    const broken = await renderMarkdown(
      '<!-- vantage: section tone=note -->\n---\ntitle: "Doc"\nstatus: draft\n---\n\n# Title\n',
    );
    expect(broken.frontmatter).toEqual({});
    expect(broken.html).toContain("<hr");
    expect(broken.html).toContain("data-vantage-tone=");
    expect(broken.html).toContain("status: draft</h2>");

    // And the same document with the directive moved below the block.
    const fixed = await renderMarkdown(
      '---\ntitle: "Doc"\nstatus: draft\n---\n\n<!-- vantage: section tone=note -->\n\n# Title\n',
    );
    expect(fixed.frontmatter).toEqual({ title: "Doc", status: "draft" });
    expect(fixed.html).not.toContain("<hr");
  });

  it("says nothing about the `---` shapes that are not misplaced frontmatter", async () => {
    const root = makeTree({
      // A leading comment and a real horizontal rule, which is not frontmatter:
      // there is no `key: value` block between two delimiters.
      "rule.md": [
        "<!-- prettier-ignore -->",
        "---",
        "",
        "Some prose.",
        "",
        "---",
        "",
        "More prose.",
      ].join("\n"),
      // Frontmatter where it belongs, with a directive under it.
      "fine.md": [
        "---",
        'title: "Doc"',
        "---",
        "",
        "<!-- vantage: section tone=note -->",
        "",
        "## Head",
        "",
        "body",
      ].join("\n"),
      // A thematic break in the middle of a document.
      "mid.md": ["# Title", "", "prose", "", "---", "", "more prose"].join(
        "\n",
      ),
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });
});

describe("katex", () => {
  it("says nothing about formulas KaTeX accepts", async () => {
    const root = makeTree({
      "index.md": [
        "Inline $$E = mc^2$$ in a sentence.",
        "",
        "$$",
        "\\frac{1}{2} \\sum_{i=1}^{n} x_i",
        "$$",
      ].join("\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("reports a formula KaTeX rejects, in KaTeX's words", async () => {
    const root = makeTree({
      "index.md": ["$$", "\\frac{1}{", "$$"].join("\n"),
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["katex/parse"]);
    expect(report.findings[0]?.detail).toContain("KaTeX parse error");
  });

  it("leaves single dollars alone, exactly as the viewer does", async () => {
    const root = makeTree({
      "index.md": "Set $HOME and pay $100 for \\frac{unclosed$.\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });
});
