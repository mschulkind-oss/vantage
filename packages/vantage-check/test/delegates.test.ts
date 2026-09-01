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

  /**
   * The discriminator, stated as a test: a pair of horizontal rules with prose
   * between them is not frontmatter, however that prose happens to parse. YAML
   * reads a single line with a colon in it as a mapping, so `Note: this is a
   * draft` between two rules parses to `{Note: "this is a draft"}` — and the
   * region above the closing delimiter is the *only* thing that tells the two
   * shapes apart: real frontmatter abuts its delimiters, which is what makes
   * the keys a setext heading. Following the finding's advice on one of these
   * would be destructive: moving the prose below the closing `---` turns it
   * into frontmatter for real and deletes the paragraph from the page.
   */
  it("says nothing about two horizontal rules whose prose parses as YAML", async () => {
    const root = makeTree({
      "colon.md": [
        "<!-- markdownlint-disable -->",
        "",
        "---",
        "",
        "Note: this is a draft",
        "",
        "---",
        "",
        "More prose.",
      ].join("\n"),
      // The same shape under nothing but a stray blank line.
      "blank.md": ["", "---", "", "Author: Matt", "", "---", "", "prose"].join(
        "\n",
      ),
      // Several lines, each of which YAML reads as a key.
      "pair.md": [
        "<!-- x -->",
        "",
        "---",
        "",
        "Author: Matt",
        "Date: today",
        "",
        "---",
      ].join("\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);

    // Measured: nothing is lost. Both delimiters are thematic breaks and the
    // prose is on the page, so there is no missing metadata to report.
    const rendered = await renderMarkdown(
      "<!-- markdownlint-disable -->\n\n---\n\nNote: this is a draft\n\n---\n\nMore prose.\n",
    );
    expect(rendered.frontmatter).toEqual({});
    expect(rendered.html.match(/<hr\b/g)).toHaveLength(2);
    expect(rendered.html).toContain("Note: this is a draft");
  });

  it("still reports misplaced frontmatter that has a blank line inside it", async () => {
    // The delimiters are abutted, so the keys really are a setext heading and
    // the fields really are gone — an internal blank line does not change that.
    const root = makeTree({
      "index.md": [
        "<!-- prettier-ignore -->",
        "---",
        'title: "Doc"',
        "",
        "tags: [a]",
        "---",
        "",
        "# Title",
      ].join("\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual(["frontmatter/not-at-top"]);
  });

  it("names a byte-order mark as the thing above the frontmatter", async () => {
    // A BOM is whitespace to `\s` and invisible in every editor, so blaming "a
    // blank line" sends the author looking for a line that is not there.
    const root = makeTree({
      "index.md": '\uFEFF---\ntitle: "Doc"\n---\n\n# Title\n',
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["frontmatter/not-at-top"]);
    expect(report.findings[0]?.message).toContain("byte-order mark");
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
