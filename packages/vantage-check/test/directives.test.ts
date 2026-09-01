import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../vantage-md/src/renderMarkdown.js";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import { parseConfig } from "../src/core/config.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

/**
 * The `vantage/*` family: Vantage's own directives, checked with the viewer's
 * own parser.
 *
 * Every expectation here was measured by running the real chain — the same
 * `renderMarkdown` the app uses — and several tests assert the render and the
 * finding together, so the checker's claim about a document and the document's
 * actual fate cannot drift apart.
 */

const one = async (markdown: string) =>
  checkTree(makeTree({ "index.md": markdown }));

const check = async (markdown: string) => ruleIds(await one(markdown));

/** The rendered HTML of a fixture, through the viewer's own pipeline. */
const render = async (markdown: string) =>
  (await renderMarkdown(markdown)).html;

describe("vantage/* on documents that are right", () => {
  // The test that has to hold. Everything else in this file is about a document
  // that is wrong; a checker whose default output on good markup is noise is a
  // checker nobody leaves switched on.
  it("says nothing about directives that work", async () => {
    const markdown = [
      "<!-- vantage: section tone=warning emphasis=strong badge=stale -->",
      "",
      "## Migration path",
      "",
      "The steps below predate the rewrite.",
      "",
      "<!-- vantage: block tone=important -->",
      "",
      "Every delivery carries a nonce.",
      "",
      "<!-- vantage: section collapsed=true -->",
      "",
      "## Appendix B",
      "",
      "1. **OQ-9: Queue position on re-entry.**",
      "",
      '   <!-- vantage: oq id=OQ-9 leaning="Back of the queue — it might interact." -->',
      "",
      "   _Leaning:_ Back of the queue.",
      "",
    ].join("\n");

    expect(await check(markdown)).toEqual([]);

    // And the same document really does stamp: a silent checker over markup
    // that silently does nothing would pass this test too.
    const html = await render(markdown);
    expect(html).toContain('data-vantage-tone="warning"');
    expect(html).toContain('data-vantage-badge="stale"');
    expect(html).toContain('data-vantage-tone="important"');
    expect(html).toContain('data-vantage-oq="true"');
    expect(html).toContain('data-vantage-collapse-toggle="1"');
  });

  it("is silent on a directive in a fence, in backticks, or indented", async () => {
    // Structural, not a filter: `checkDirectives` visits mdast `html` nodes, and
    // a fenced block, a 4-space-indented line and inline code are `code` and
    // `inlineCode` nodes. This is what keeps the rule off this repo's own
    // documentation, which is full of directive examples.
    const markdown = [
      "# Examples",
      "",
      "```markdown",
      "<!-- vantage: sektion tone=purple -->",
      "```",
      "",
      "    <!-- vantage: alsobogus badge=nope -->",
      "",
      "Prose with `<!-- vantage: bogus -->` in it.",
      "",
    ].join("\n");

    expect(await check(markdown)).toEqual([]);
  });

  it("is silent on the design doc it was written from", async () => {
    // Coupled on purpose: `just _self-check` runs the built binary over `docs/`,
    // so a rule that fires on a fenced example turns the gate red. This catches
    // that in `npm test` instead of in the slow binary build.
    const repo = resolve(
      dirname(new URL(import.meta.url).pathname),
      "../../..",
    );
    const report = await checkTree(repo, ["docs/design/inline-markup.md"]);

    expect(report.filesChecked).toBe(1);
    expect(
      report.findings.filter((finding) => finding.rule.startsWith("vantage/")),
    ).toEqual([]);
  });

  it("is silent on the directive examples the style guide tells agents to write", async () => {
    // The checker and the guide are one contract: an example an agent is told to
    // copy has to pass the rules the same agent's document is judged by.
    const examples = [...STYLE_GUIDE.matchAll(/```markdown\n([\s\S]*?)```/g)]
      .map((match) => match[1] ?? "")
      .filter((body) => body.includes("vantage:"));

    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const example of examples) {
      expect(await check(example)).toEqual([]);
    }
  });

  it("treats `oq`'s id and leaning as free text, quotes and dashes included", async () => {
    expect(
      await check(
        [
          "1. **OQ-B1: whether to re-run it**",
          "",
          '   <!-- vantage: oq id=OQ-B1 leaning="Back of the queue — the fix might interact." -->',
          "",
          "   _Leaning:_ later.",
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("accepts a directive that wraps onto a second line", async () => {
    const markdown = [
      "<!-- vantage: section",
      "     tone=warning -->",
      "",
      "## Head",
      "",
      "body",
      "",
    ].join("\n");

    expect(await check(markdown)).toEqual([]);
    expect(await render(markdown)).toContain('data-vantage-tone="warning"');
  });

  it("ignores comments that are not ours", async () => {
    for (const comment of [
      "<!-- TODO: rewrite this -->",
      "<!-- v: section tone=warning -->",
      "<!--- vantage: section tone=warning -->",
    ]) {
      expect(await check(`${comment}\n\npara\n`)).toEqual([]);
    }
  });
});

describe("vantage/unterminated", () => {
  it("reports the comment that eats the rest of the file", async () => {
    const markdown = "# Title\n\n<!-- vantage: section tone=warning\n\nprose\n";
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/unterminated"]);
    expect(report.findings[0]?.severity).toBe("error");
    expect(report.findings[0]?.line).toBe(3);
    expect(report.findings[0]?.column).toBe(1);
    expect(report.findings[0]?.message).toContain("disappears from the page");

    // The measured consequence, pinned beside the finding: the prose is gone.
    const html = await render(markdown);
    expect(html).toContain("Title");
    expect(html).not.toContain("prose");
  });

  it("reports `--!>`, which closes the comment but not the HTML block", async () => {
    const markdown = "<!-- vantage: block tone=note --!>\n\n## Head\n\n- a\n";
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/unterminated"]);
    expect(report.findings[0]?.message).toContain("`--!>`");

    // Measured: the heading and the list arrive as literal text.
    const html = await render(markdown);
    expect(html).toContain("## Head");
    expect(html).not.toContain("<h2");
  });

  it("says nothing when a later `-->` in the same node closes the block", async () => {
    // parse5 splits this into two comments and the directive stamps normally,
    // so calling the `--!>` a defect here would be a false finding.
    const markdown = "<!-- vantage: block tone=note --!><!-- x -->\n\npara\n";

    expect(await check(markdown)).toEqual([]);
    expect(await render(markdown)).toContain('data-vantage-tone="note"');
  });

  it("finds a directive after somebody else's `--!>` comment", async () => {
    expect(
      await check("<!-- a --!><!-- vantage: block tone=purple -->\n\np\n"),
    ).toEqual(["vantage/unknown-value"]);
  });

  it("stays quiet about an unterminated comment that is not ours", async () => {
    expect(await check("# T\n\n<!-- just a note\n\nprose\n")).toEqual([]);
  });
});

describe("vantage/malformed", () => {
  const malformed = [
    "<!-- vantage: -->",
    "<!-- vantage: Section -->",
    "<!-- vantage: section tone -->",
    "<!-- vantage: section tone='x' -->",
    "<!-- vantage: section tone=note vantage: block -->",
    "<!-- vantage: section tone=notebadge=x -->",
    "<!-- vantage: section bad(paren)=x -->",
    "<!-- vantage: section tone= -->",
  ];

  it.each(malformed)("reports %s once, with a reason", async (comment) => {
    const report = await one(`${comment}\n\npara\n`);

    expect(ruleIds(report)).toEqual(["vantage/malformed"]);
    expect(report.findings[0]?.severity).toBe("error");
    expect(report.findings[0]?.message.endsWith(".")).toBe(true);
    expect(report.findings[0]?.message.length).toBeGreaterThan(80);
  });

  it("reports a `-->` inside a quoted value, which truncates the comment", async () => {
    // Measured: the comment ends at the first `-->`, so ` b" -->` leaks into
    // the page as literal text and the directive never parses.
    const markdown = '<!-- vantage: oq leaning="a --> b" -->\n\npara\n';

    expect(await check(markdown)).toEqual(["vantage/malformed"]);
    expect(await render(markdown)).toContain('b" -->');
  });
});

describe("vantage/unknown-*", () => {
  it("drops the whole directive for an unknown name, and reports once", async () => {
    const report = await one(
      "<!-- vantage: callout tone=warning badge=stale -->\n\n## H\n",
    );

    expect(ruleIds(report)).toEqual(["vantage/unknown-name"]);
    expect(report.findings[0]?.column).toBe(15);
    expect(report.findings[0]?.message).toContain("`section`, `block` or `oq`");
  });

  it("drops one key and keeps its siblings", async () => {
    const report = await one(
      "<!-- vantage: section tone=warning bogus=zzz badge=stale -->\n\n## H\n",
    );

    expect(ruleIds(report)).toEqual(["vantage/unknown-key"]);
    expect(report.findings[0]?.column).toBe(36);
    expect(report.findings[0]?.message).toContain("`section` accepts");
  });

  it("reports `id` on `section`, which belongs to `oq` alone", async () => {
    expect(await check("<!-- vantage: section id=OQ-9 -->\n\n## H\n")).toEqual([
      "vantage/unknown-key",
    ]);
  });

  it("reports a value outside the closed set, naming every token", async () => {
    const report = await one("<!-- vantage: section tone=purple -->\n\n## H\n");

    expect(ruleIds(report)).toEqual(["vantage/unknown-value"]);
    expect(report.findings[0]?.column).toBe(28);
    for (const tone of [
      "note",
      "tip",
      "important",
      "warning",
      "caution",
      "muted",
    ]) {
      expect(report.findings[0]?.message).toContain(`\`${tone}\``);
    }
  });

  it("reports the P2 attack shape as one unknown value, never a crash", async () => {
    const markdown =
      '<!-- vantage: section tone="url(https://evil/x)" -->\n\n## H\n';

    expect(await check(markdown)).toEqual(["vantage/unknown-value"]);
    expect(await render(markdown)).not.toContain("evil");
  });

  it("reports both comments in one html node, at their own columns", async () => {
    const report = await one(
      "<!-- vantage: section tone=purple --> <!-- vantage: block badge=zzz -->\n\n# h\n",
    );

    expect(ruleIds(report)).toEqual([
      "vantage/unknown-value",
      "vantage/unknown-value",
    ]);
    expect(report.findings.map((finding) => finding.column)).toEqual([28, 65]);
  });

  it("numbers findings by their line in the file, frontmatter included", async () => {
    const report = await one(
      [
        "---",
        'title: "Doc"',
        "---",
        "",
        "<!-- vantage: section tone=purple -->",
        "",
        "## H",
        "",
      ].join("\n"),
    );

    expect(report.findings[0]?.line).toBe(5);
  });
});

describe("vantage/duplicate-key", () => {
  it("warns on the second one, which is the one that wins", async () => {
    const report = await one(
      "<!-- vantage: section tone=note tone=warning -->\n\n## H\n",
    );

    expect(ruleIds(report)).toEqual(["vantage/duplicate-key"]);
    expect(report.findings[0]?.severity).toBe("warning");
    expect(report.findings[0]?.column).toBe(33);
  });
});

describe("vantage/orphan", () => {
  it("warns when nothing follows the directive", async () => {
    const report = await one(
      "# T\n\npara\n\n<!-- vantage: block tone=note -->\n",
    );

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.severity).toBe("warning");
    expect(report.findings[0]?.message).toContain("Nothing follows");
  });

  it("says nothing when the target is only separated by things that vanish", async () => {
    // A definition produces no HTML, a footnote definition is hoisted to the end
    // of the document, and a plain comment stays a comment: in all three the
    // paragraph really is the directive's target. Measured.
    for (const between of [
      "[ref]: ./x.md",
      "[^a]: note text",
      "<!-- TODO -->",
    ]) {
      const root = makeTree({
        "index.md": `<!-- vantage: block tone=note -->\n\n${between}\n\npara\n`,
        "x.md": "# X\n",
      });

      expect(ruleIds(await checkTree(root))).toEqual([]);
    }
  });

  it("says nothing about two directives that merge onto one heading", async () => {
    const markdown = [
      "<!-- vantage: section tone=note -->",
      "<!-- vantage: section badge=wip -->",
      "",
      "## H",
      "",
      "body",
      "",
    ].join("\n");

    expect(await check(markdown)).toEqual([]);
    const html = await render(markdown);
    expect(html).toContain('data-vantage-tone="note"');
    expect(html).toContain('data-vantage-badge="wip"');
  });

  it("warns once when a run of directives reaches the end of the file", async () => {
    expect(
      await check(
        "para\n\n<!-- vantage: section tone=note --><!-- vantage: block badge=wip -->\n",
      ),
    ).toEqual(["vantage/orphan"]);
  });

  it("warns about an inline directive, naming what it is inside", async () => {
    const report = await one(
      "Text with <!-- vantage: block tone=tip --> *emph* mid.\n",
    );

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.message).toContain("inline, inside a paragraph");
    expect(report.findings[0]?.column).toBe(11);
  });

  it("warns about a directive in a table cell", async () => {
    expect(
      await check(
        "| a | b |\n| - | - |\n| <!-- vantage: block tone=note --> x | y |\n",
      ),
    ).toEqual(["vantage/orphan"]);
  });

  it("warns when text follows the directive inside the same HTML block", async () => {
    const markdown = "<!-- vantage: block tone=note --> trailing\n\npara\n";
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.message).toContain("same HTML block");
    // Measured: the trailing text blocks the run, so the paragraph is untouched.
    expect(await render(markdown)).not.toContain("data-vantage");
  });

  it("says nothing about a directive inside a block of raw HTML", async () => {
    // mdast sees one opaque `html` node; hast sees the comment with a real `<p>`
    // sibling and stamps it. Guessing from mdast would invent a finding.
    const markdown =
      "<div>\n<!-- vantage: block tone=note -->\n<p>x</p>\n</div>\n";

    expect(await check(markdown)).toEqual([]);
    expect(await render(markdown)).toContain('data-vantage-tone="note"');
  });

  it("says nothing about a directive inside a block quote", async () => {
    // The plugin walks the whole tree, resolving inside each parent, so this
    // stamps the quoted paragraph. A root-only checker would call it an orphan.
    const markdown = "> <!-- vantage: block tone=note -->\n>\n> quoted para\n";

    expect(await check(markdown)).toEqual([]);
    expect(await render(markdown)).toContain('data-vantage-tone="note"');
  });

  it("warns about an `oq` above a list, where no button can be rendered", async () => {
    const markdown = "<!-- vantage: oq id=OQ-1 -->\n\n- item one\n- item two\n";
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.message).toContain("bulleted list");
    expect(report.findings[0]?.message).toContain(
      "Indent it inside the list item",
    );
    // Measured: `ul` is not a tag the review system can anchor on, so the
    // plugin stamps nothing at all.
    expect(await render(markdown)).not.toContain("data-vantage-oq");
  });

  it("warns about an `oq` above a horizontal rule", async () => {
    expect(await check("<!-- vantage: oq -->\n\n---\n\npara\n")).toEqual([
      "vantage/orphan",
    ]);
  });

  it("says nothing about an `oq` above a quote or a heading", async () => {
    for (const target of ["> quoted", "## H"]) {
      const markdown = `<!-- vantage: oq -->\n\n${target}\n`;
      expect(await check(markdown)).toEqual([]);
      expect(await render(markdown)).toContain('data-vantage-oq="true"');
    }
  });

  // D5: the checker's answer has to be the app's answer. `pre` and `table` are
  // anchor-capable — a comment can be anchored on either — but neither can host
  // the button (`OQ_HOST_TAGS` in `useOpenQuestionButtons`), so the directive
  // stamps and no affordance ever appears. That is exactly the silence this
  // family exists to break.
  it("warns about an `oq` above a code block, which cannot host a button", async () => {
    const markdown = "<!-- vantage: oq -->\n\n```ts\nconst x = 1;\n```\n";
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.message).toContain("code block");
    expect(report.findings[0]?.message).toContain(
      "put the directive above the paragraph",
    );
    // Measured: the stamp lands, which is why nothing else says a word.
    expect(await render(markdown)).toContain('data-vantage-oq="true"');
  });

  it("warns about an `oq` above a table, which cannot host a button", async () => {
    const markdown =
      "<!-- vantage: oq -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.message).toContain("table");
    expect(await render(markdown)).toContain('data-vantage-oq="true"');
  });

  it("does not offer `code block` or `table` as legal `oq` hosts", async () => {
    // The message enumerated both while the button refused both, so a reader of
    // the finding was told the shape that does not work is the fix.
    const report = await one("<!-- vantage: oq -->\n\n- item\n");

    expect(report.findings[0]?.message).not.toContain("code block");
    expect(report.findings[0]?.message).not.toContain("table");
  });

  it("warns about a style directive above a `$$` math block", async () => {
    // With math on — which is what the viewers and this checker do — a display
    // formula renders as a `<span class="katex-display">`, which is no kind of
    // stampable block.
    const markdown = "<!-- vantage: block tone=note -->\n\n$$\nE = mc^2\n$$\n";

    expect(await check(markdown)).toEqual(["vantage/orphan"]);
    expect(await render(markdown)).not.toContain("data-vantage");
  });

  it("warns about a directive in a tight list item", async () => {
    const markdown = "- one\n  <!-- vantage: block tone=note -->\n  two\n";
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.message).toContain("no blank lines");
    // Measured: a tight item's paragraphs lose their `<p>`, so there is nothing
    // to stamp — the whole reason A6's authoring form has the blank lines.
    expect(await render(markdown)).not.toContain("data-vantage");
  });

  it("says nothing about the same item once it has blank lines", async () => {
    const markdown = "- one\n\n  <!-- vantage: block tone=note -->\n\n  two\n";

    expect(await check(markdown)).toEqual([]);
    expect(await render(markdown)).toContain('data-vantage-tone="note"');
  });

  it("says nothing about a heading target inside a tight list item", async () => {
    // Only paragraphs lose their wrapper, so this one really does stamp.
    const markdown = "- x\n  <!-- vantage: block tone=note -->\n  # h\n";

    expect(await check(markdown)).toEqual([]);
    expect(await render(markdown)).toContain('data-vantage-tone="note"');
  });
});

describe("vantage/list-split", () => {
  it("reports a directive between two numbered items", async () => {
    const markdown =
      "9. Question nine\n\n<!-- vantage: oq -->\n\n10. Question ten\n";
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/list-split"]);
    expect(report.findings[0]?.severity).toBe("error");
    expect(report.findings[0]?.line).toBe(3);
    expect(report.findings[0]?.message).toContain("numbered list");

    // Measured: two `<ol>`s where deleting the comment gives one.
    const html = await render(markdown);
    expect(html).toContain('<ol start="9"');
    expect(html).toContain('<ol start="10"');
    expect(
      await render(markdown.replace("<!-- vantage: oq -->\n\n", "")),
    ).not.toContain('start="10"');
  });

  it("reports a directive between two bulleted items", async () => {
    const report = await one(
      "- one\n\n<!-- vantage: block tone=note -->\n\n- two\n",
    );

    expect(ruleIds(report)).toEqual(["vantage/list-split"]);
    expect(report.findings[0]?.message).toContain("bulleted list");
  });

  it("says nothing when the two lists would have been separate anyway", async () => {
    // Different markers are two lists in CommonMark whatever sits between them,
    // so the comment changes nothing and a finding would be a false one.
    expect(
      await check("- one\n\n<!-- vantage: block tone=note -->\n\n* two\n"),
    ).toEqual([]);
    expect(
      await check("1. one\n\n<!-- vantage: block tone=note -->\n\n1) two\n"),
    ).toEqual([]);
  });

  it("says nothing about a directive after a list", async () => {
    expect(
      await check(
        "- one\n- two\n\n<!-- vantage: block tone=note -->\n\npara\n",
      ),
    ).toEqual([]);
  });

  it("prefers the placement finding over the orphan it also causes", async () => {
    // An `oq` between numbered items attaches to the second `<ol>`, which is not
    // anchor-capable, so both rules have something to say. One mistake, one fix,
    // one finding.
    expect(await check("1. one\n\n<!-- vantage: oq -->\n\n2. two\n")).toEqual([
      "vantage/list-split",
    ]);
  });
});

/**
 * The general form of the same defect: D1 says the document renders as if the
 * markup were not there, and the way to check that is to *take it away*. Each
 * case below asserts the finding and the measured HTML difference together, so
 * the rule cannot drift from the thing it claims about the page.
 */
describe("vantage/block-split", () => {
  /** The rendered HTML with the directive line, and with it deleted. */
  const bothWays = async (markdown: string, directive: string) => [
    await render(markdown),
    await render(markdown.replace(`${directive}\n`, "")),
  ];

  it("reports a directive between two rows of a table", async () => {
    const directive = "<!-- vantage: block tone=note -->";
    const markdown = `| a | b |\n| - | - |\n| 1 | 2 |\n${directive}\n| 3 | 4 |\n`;
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/block-split"]);
    expect(report.findings[0]?.severity).toBe("error");
    expect(report.findings[0]?.line).toBe(4);
    expect(report.findings[0]?.message).toContain("table");
    expect(report.findings[0]?.message).toContain("put the directive above");

    // Measured: the table ends after row 1 and the rest is literal prose — text
    // the plain document does not contain anywhere (D8).
    const [withIt, withoutIt] = await bothWays(markdown, directive);
    expect(withIt).toContain("| 3 | 4 |");
    expect(withoutIt).not.toContain("| 3 | 4 |");
    expect(withoutIt).toContain("<td>3</td>");
  });

  it("reports a directive that cuts one paragraph in two", async () => {
    const directive = "<!-- vantage: block tone=note -->";
    const markdown = `some prose\n${directive}\nmore prose\n`;
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/block-split"]);
    expect(report.findings[0]?.message).toContain("paragraph");

    const [withIt, withoutIt] = await bothWays(markdown, directive);
    expect(withIt.match(/<p\b/g)).toHaveLength(2);
    expect(withoutIt.match(/<p\b/g)).toHaveLength(1);
  });

  it("reports a directive that cuts one block quote in two", async () => {
    const directive = "<!-- vantage: block tone=note -->";
    const markdown = `> quoted one\n${directive}\n> quoted two\n`;
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/block-split"]);
    expect(report.findings[0]?.message).toContain("block quote");

    const [withIt, withoutIt] = await bothWays(markdown, directive);
    expect(withIt.match(/<blockquote\b/g)).toHaveLength(2);
    expect(withoutIt.match(/<blockquote\b/g)).toHaveLength(1);
  });

  it("reports a directive that stops a setext heading being a heading", async () => {
    const directive = "<!-- vantage: section tone=note -->";
    const markdown = `Title\n${directive}\n=====\n`;
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/block-split"]);
    expect(report.findings[0]?.message).toContain("underline");

    // Measured: the `=====` lands on the page as text, and the heading is gone.
    const [withIt, withoutIt] = await bothWays(markdown, directive);
    expect(withIt).toContain("=====");
    expect(withIt).not.toContain("<h1");
    expect(withoutIt).toContain("<h1");
    expect(withoutIt).not.toContain("=====");
  });

  it("reports a directive that cuts one indented code block in two", async () => {
    // Blank lines on both sides and *still* a split, because a blank line inside
    // an indented code block belongs to the block. This is why the rule deletes
    // the directive and re-parses rather than looking at the neighbouring lines.
    const directive = "<!-- vantage: block tone=note -->";
    const markdown = `    code a\n\n${directive}\n\n    code b\n`;
    const report = await one(markdown);

    expect(ruleIds(report)).toEqual(["vantage/block-split"]);
    expect(report.findings[0]?.message).toContain("code block");

    const [withIt, withoutIt] = await bothWays(markdown, directive);
    expect(withIt.match(/<pre\b/g)).toHaveLength(2);
    expect(withoutIt.match(/<pre\b/g)).toHaveLength(1);
  });

  it("leaves the list shape to `vantage/list-split`, which says more", async () => {
    // The general rule sees the list split too. The specific one names the fix
    // ("indent it inside the item") and the measured cost (item spacing, `start`),
    // so it reports and the general one stands down. One mistake, one finding.
    expect(
      await check("- one\n\n<!-- vantage: block tone=note -->\n\n- two\n"),
    ).toEqual(["vantage/list-split"]);
  });

  it("prefers the orphan finding when the directive also attaches to nothing", async () => {
    // A tight list item: `- one` / directive / `two` restructures the item *and*
    // leaves nothing stampable. `vantage/orphan` explains both, so it wins.
    expect(
      await check("- one\n  <!-- vantage: block tone=note -->\n  two\n"),
    ).toEqual(["vantage/orphan"]);
  });

  it("says nothing about the placements that change nothing", async () => {
    // The delete-and-compare test in the negative, over every legal shape this
    // suite and the style guide use. A rule that fired on any of these would be
    // worse than the silence it replaces.
    for (const markdown of [
      // Between a paragraph and the heading its section starts.
      "intro para\n\n<!-- vantage: section tone=note -->\n\n## Head\n\nbody\n",
      // Between two paragraphs, which stay two paragraphs.
      "one\n\n<!-- vantage: block tone=note -->\n\ntwo\n",
      // A6's authoring form: indented inside a loose list item.
      "1. **OQ-B1: x**\n\n   <!-- vantage: oq id=OQ-B1 -->\n\n   _Leaning:_ y\n",
      "- one\n\n  <!-- vantage: block tone=note -->\n\n  two\n",
      // Inside a block quote, above its own paragraph.
      "> <!-- vantage: block tone=note -->\n>\n> quoted para\n",
      // After a whole list, and above a fenced block.
      "- one\n- two\n\n<!-- vantage: block tone=note -->\n\npara\n",
      "para\n\n<!-- vantage: block tone=note -->\n\n```ts\nconst x = 1;\n```\n",
      // Two lists CommonMark would have separated anyway.
      "- one\n\n<!-- vantage: block tone=note -->\n\n* two\n",
      // A directive above a table, which is where the table case's fix puts it.
      "para\n\n<!-- vantage: block tone=note -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    ]) {
      expect(await check(markdown)).toEqual([]);
    }
  });
});

describe("vantage/* settings", () => {
  const settingsFor = (toml: string) => parseConfig(toml).settings;
  const bad = [
    "<!-- vantage: section tone=purple bogus=x -->",
    "",
    "## H",
    "",
  ].join("\n");

  it("silences the whole family through the family switch", async () => {
    const root = makeTree({ "index.md": bad });
    const off = settingsFor('[check.rules]\n"vantage/*" = "off"\n');

    expect(ruleIds(await checkTree(root, ["."], off))).toEqual([]);
  });

  it("downgrades one rule without touching its siblings", async () => {
    const root = makeTree({ "index.md": bad });
    const tuned = settingsFor(
      '[check.rules]\n"vantage/unknown-value" = "warning"\n',
    );

    const report = await checkTree(root, ["."], tuned);
    const severities = new Map(
      report.findings.map((finding) => [finding.rule, finding.severity]),
    );

    expect(severities.get("vantage/unknown-value")).toBe("warning");
    expect(severities.get("vantage/unknown-key")).toBe("error");
  });

  it("rejects a misspelled rule id, because the family is ours", async () => {
    expect(() =>
      parseConfig('[check.rules]\n"vantage/unkown-name" = "off"\n'),
    ).toThrow(/unknown rule/);
  });
});

describe("a run of directives across two comments", () => {
  it("reports the placement once, from the first of the run", async () => {
    // Two nodes, one run, one target that is not there — and one finding.
    const report = await one(
      [
        "para",
        "",
        "<!-- vantage: section tone=note -->",
        "<!-- vantage: block badge=wip -->",
        "",
      ].join("\n"),
    );

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.line).toBe(3);
  });

  it("keeps the whole run's names, so a later `oq` is still checked", async () => {
    // The run merges onto the `<ul>`: legal for `section`, no anchor for `oq`.
    // Reporting from the first node has to carry the second node's name.
    const report = await one(
      [
        "<!-- vantage: section tone=note -->",
        "<!-- vantage: oq id=OQ-1 -->",
        "",
        "- item one",
        "- item two",
        "",
      ].join("\n"),
    );

    expect(ruleIds(report)).toEqual(["vantage/orphan"]);
    expect(report.findings[0]?.message).toContain("Open Question button");
  });
});
