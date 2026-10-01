import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import { parseConfig } from "../src/core/config.js";
import type { Settings } from "../src/core/settings.js";
import { ruleMeta } from "../src/rules/registry.js";
import { checkTree, makeTree } from "./helpers.js";

const RULE = "prose/inline-list";

/** The `prose/inline-list` findings for one document, as `line:column`. */
async function inlineLists(
  source: string,
  settings?: Settings,
): Promise<string[]> {
  const root = makeTree({ "docs/a.md": source });
  const report = await checkTree(root, ["."], settings);
  return report.findings
    .filter((finding) => finding.rule === RULE)
    .map((finding) => `${finding.line}:${finding.column}`);
}

/** The one `prose/inline-list` finding's message for one document. */
async function messageOf(source: string): Promise<string> {
  const root = makeTree({ "docs/a.md": source });
  const report = await checkTree(root);
  const found = report.findings.filter((finding) => finding.rule === RULE);
  expect(found).toHaveLength(1);
  return found[0]?.message ?? "";
}

describe("prose/inline-list", () => {
  it("is registered as a warning", () => {
    expect(ruleMeta(RULE)?.default).toBe("warning");
  });

  it("is in the user guide's table of rules and in the style guide", () => {
    const guide = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../userguide/guides/vantage-check.md",
      ),
      "utf8",
    );

    expect(guide).toMatch(
      new RegExp(`^\\| \`${RULE}\` \\| .* \\| warning \\|$`, "m"),
    );
    expect(STYLE_GUIDE).toContain(`(\`${RULE}\`)`);
  });

  it("has nothing to say about the style guide that states it", async () => {
    expect(await inlineLists(STYLE_GUIDE)).toEqual([]);
  });

  describe("fires on three enumerators or more, in sequence", () => {
    it.each([
      ["letters", "(a) one, (b) two, (c) three", "(a), (b), (c)"],
      ["capitals", "(A) one, (B) two, (C) three", "(A), (B), (C)"],
      ["numbers", "(1) one, (2) two, (3) three", "(1), (2), (3)"],
      ["roman numerals", "(i) one, (ii) two, (iii) three", "(i), (ii), (iii)"],
    ])("in %s", async (_style, run, named) => {
      const source = `# Title\n\nWe could do ${run}.\n`;

      expect(await inlineLists(source)).toEqual(["3:13"]);
      expect(await messageOf(source)).toBe(
        `This paragraph runs ${named} together; write them as a list, one item per line.`,
      );
    });

    it("past three, and reports the paragraph once", async () => {
      expect(
        await inlineLists(
          "Pick (a) one, (b) two, (c) three, (d) four or (e) five.\n",
        ),
      ).toEqual(["1:6"]);
    });

    it("in a paragraph wrapped across lines", async () => {
      const source = [
        "The fix has three parts, and the first is the hardest: (a) parse the",
        "comment, (b) find the block it lands on, and",
        "(c) compare the two trees.",
        "",
      ].join("\n");

      expect(await inlineLists(source)).toEqual(["1:56"]);
    });

    it("from an enumerator on a wrapped line, at its own column", async () => {
      const source = [
        "- An item whose run starts on its second line,",
        "  where (a) one, (b) two and (c) three.",
        "",
      ].join("\n");

      expect(await inlineLists(source)).toEqual(["2:9"]);
    });

    it("on lines of their own with no hard break, which render as one", async () => {
      expect(
        await inlineLists("Three ways:\n(a) one,\n(b) two,\n(c) three.\n"),
      ).toEqual(["2:1"]);
    });

    it("inside a list item", async () => {
      expect(
        await inlineLists(
          "1. First.\n2. Then (a) one, (b) two and (c) three.\n",
        ),
      ).toEqual(["2:9"]);
    });

    it("inside a blockquote", async () => {
      expect(
        await inlineLists("> Either (a) one, (b) two or (c) three.\n"),
      ).toEqual(["1:10"]);
    });

    it("inside an alert", async () => {
      expect(
        await inlineLists(
          "> [!NOTE]\n> Either (a) one, (b) two or (c) three.\n",
        ),
      ).toEqual(["2:10"]);
    });

    it("with inline code between the enumerators", async () => {
      expect(
        await inlineLists(
          "Run (a) `just cli`, (b) `just check` and (c) `just done`.\n",
        ),
      ).toEqual(["1:5"]);
    });

    it("through emphasis and link labels", async () => {
      expect(
        await inlineLists(
          "Either **(a) one**, _(b) two_ or [(c) three](./a.md).\n",
        ),
      ).toEqual(["1:10"]);
    });

    it("after a stray enumerator that starts nothing", async () => {
      // `(c)` is out of turn, so the run starts again at the `(a)` after it.
      expect(
        await inlineLists("(c) 2026. Then (a) one, (b) two and (c) three.\n"),
      ).toEqual(["1:16"]);
    });

    it("after an escaped enumerator, at the run's own column", async () => {
      expect(
        await inlineLists("\\(a\\) x (a) one, (b) two, (c) three.\n"),
      ).toEqual(["1:9"]);
      expect(
        await inlineLists(
          "Either \\(a\\) one, \\(b\\) two or \\(c\\) three.\n",
        ),
      ).toEqual(["1:9"]);
    });

    it("with only a number or a word of code for each item", async () => {
      expect(
        await inlineLists("Set (a) 1, (b) 2 and (c) <code>3</code>.\n"),
      ).toEqual(["1:5"]);
    });

    it("after the frontmatter, at the file's own line", async () => {
      expect(
        await inlineLists(
          "---\ntitle: A\n---\n\n# A\n\nEither (a) one, (b) two or (c) three.\n",
        ),
      ).toEqual(["7:8"]);
    });
  });

  describe("leaves alone", () => {
    it.each([
      ["two enumerators", "Either (a) one or (b) two, and nothing else.\n"],
      ["a run out of order", "Either (a) one, (c) three or (b) two.\n"],
      [
        "a run that does not start at the first",
        "(b) two, (c) three, (d) four.\n",
      ],
      ["a copyright sign", "Copyright (c) 2026, and (C) 2025.\n"],
      ["a lone reference", "See (1) above, and (2) below.\n"],
      ["function calls", "Call f(a), then g(b), then h(c).\n"],
      ["a plural in parentheses", "The file(s) (a) one and (b) two.\n"],
      [
        "styles that never continue each other",
        "(a) one, (2) two, (iii) three.\n",
      ],
      [
        "enumerators inside inline code",
        "The pattern `(a) (b) (c)` is what the rule looks for.\n",
      ],
      [
        "one enumerator of three inside inline code",
        "Either (a) one, (b) two or `(c)` three.\n",
      ],
      ["a fenced code block", "```text\n(a) one, (b) two, (c) three\n```\n"],
      ["an indented code block", "    (a) one, (b) two, (c) three\n"],
      ["a heading", "# (a) one, (b) two, (c) three\n"],
      [
        "a table cell",
        "| Steps |\n| :--- |\n| (a) one, (b) two, (c) three |\n",
      ],
      ["a math block", "$$\n(a) + (b) + (c)\n$$\n"],
      ["inline math", "Either $$(a) + (b) + (c)$$ or nothing.\n"],
      ["an HTML block", "<div>\n(a) one, (b) two, (c) three\n</div>\n"],
      [
        "link destinations",
        "See [one](./x(a).md), [two](./y(b).md) and [three](./z(c).md).\n",
      ],
      [
        "a run already written as a list",
        "- (a) one\n- (b) two\n- (c) three\n",
      ],
      [
        "enumerators split across paragraphs",
        "Either (a) one\n\nor (b) two\n\nor (c) three.\n",
      ],
      [
        "a run set on lines of its own by hard breaks",
        "Three ways:\\\n(a) one,\\\n(b) two,\\\n(c) three.\n",
      ],
      [
        "a run set on lines of its own by <br> tags",
        "Three:<br>\n(a) one<br>\n(b) two<br>\n(c) three.\n",
      ],
      [
        "a run set on lines of its own by <br/> tags",
        "Three:<br/>(a) one<br/>(b) two<br/>(c) three.\n",
      ],
      // A run is items, so each term after the first follows the text of the
      // one before it. Terms with only `,`, `or` or `and` between them name
      // items written somewhere else, or the notation itself.
      [
        "a reference to items listed elsewhere",
        "The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I have not modified it.\n",
      ],
      [
        "a reference to numbered equations",
        "Equations (1), (2) and (3) together give the bound.\n",
      ],
      ["an answer naming options", "**Answer:** (a), (b) and (c) all apply.\n"],
      ["a mention of the notation", "Avoid inline (a) (b) (c) lists.\n"],
      [
        "terms with nothing between them",
        "Under § 107 (a)(b)(c), it is fair use.\n",
      ],
      [
        "terms in parentheses of their own",
        "Some apply ((a), (b), (c)) here.\n",
      ],
      [
        "enumerators inside an HTML <code> tag",
        "Use <code>(a) x (b) y (c) z</code> as the pattern.\n",
      ],
      [
        "enumerators inside HTML <kbd> and <samp> tags",
        "Press <kbd>(a) x (b) y</kbd> then <samp>(c) z</samp>.\n",
      ],
    ])("%s", async (_case, source) => {
      expect(await inlineLists(source)).toEqual([]);
    });
  });

  describe("[check.rules]", () => {
    const source = "Either (a) one, (b) two or (c) three.\n";

    /** The settings a `[check.rules]` line gives, with no warning about it. */
    function settingsFrom(line: string): Settings {
      const config = parseConfig(`[check.rules]\n${line}\n`);
      expect(config.warnings).toEqual([]);
      return config.settings;
    }

    it("turns it off, alone or with its family", async () => {
      for (const line of [`"${RULE}" = "off"`, '"prose/*" = "off"']) {
        expect(await inlineLists(source, settingsFrom(line))).toEqual([]);
      }
    });

    it("turns it up to an error", async () => {
      const root = makeTree({ "docs/a.md": source });
      const report = await checkTree(
        root,
        ["."],
        settingsFrom(`"${RULE}" = "error"`),
      );

      expect(
        report.findings.map((finding) => [finding.rule, finding.severity]),
      ).toEqual([[RULE, "error"]]);
    });
  });
});
