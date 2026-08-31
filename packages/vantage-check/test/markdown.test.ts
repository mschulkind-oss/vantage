import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/core/config.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

const settingsFor = (toml: string) => parseConfig(toml).settings;
const HYGIENE_ON = settingsFor(
  '[check.rules]\n"markdown/hygiene" = "warning"\n',
);

/** A document with a hard-break-spaces problem remark-lint will notice. */
const SLOPPY = ["# Title", "", "one   ", "two", ""].join("\n");

describe("markdown hygiene", () => {
  it("says nothing at all until it is switched on", async () => {
    const root = makeTree({ "index.md": SLOPPY });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("reports remark-lint's rules under their own ids once enabled", async () => {
    const root = makeTree({ "index.md": SLOPPY });

    const report = await checkTree(root, ["."], HYGIENE_ON);

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]?.rule).toMatch(/^markdown\//);
    expect(report.findings[0]?.severity).toBe("warning");
  });

  it("lets a single noisy rule be switched off by name", async () => {
    const root = makeTree({
      "index.md": ["# Title", "", "See https://example.com for more.", ""].join(
        "\n",
      ),
    });

    expect(ruleIds(await checkTree(root, ["."], HYGIENE_ON))).toContain(
      "markdown/no-literal-urls",
    );

    const tuned = settingsFor(
      [
        "[check.rules]",
        '"markdown/hygiene" = "warning"',
        '"markdown/no-literal-urls" = "off"',
      ].join("\n"),
    );
    expect(ruleIds(await checkTree(root, ["."], tuned))).toEqual([]);
  });

  // The style guide tells authors to write these, so the checker cannot spend
  // its credibility arguing with them.
  it("does not flag GitHub alert callouts as undefined references", async () => {
    const root = makeTree({
      "index.md": [
        "# Title",
        "",
        "> [!NOTE]",
        "> Background context.",
        "",
        "> [!CAUTION]",
        "> High-risk actions.",
        "",
      ].join("\n"),
    });

    expect(ruleIds(await checkTree(root, ["."], HYGIENE_ON))).toEqual([]);
  });

  it("lints the body only — frontmatter is not Markdown", async () => {
    const root = makeTree({
      "index.md": [
        "---",
        'title: "Doc"',
        "tags: [cli, agents, tooling]",
        "---",
        "",
        "# Title",
        "",
      ].join("\n"),
    });

    expect(ruleIds(await checkTree(root, ["."], HYGIENE_ON))).toEqual([]);
  });

  it("numbers findings by their line in the file, frontmatter included", async () => {
    const root = makeTree({
      "index.md": [
        "---",
        'title: "Doc"',
        "---",
        "",
        "# Title",
        "",
        "See https://example.com now.",
        "",
      ].join("\n"),
    });

    const report = await checkTree(root, ["."], HYGIENE_ON);

    expect(report.findings[0]?.line).toBe(7);
  });
});
