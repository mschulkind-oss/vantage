import { describe, expect, it } from "vitest";
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
