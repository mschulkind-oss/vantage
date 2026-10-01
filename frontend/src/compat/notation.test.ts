/**
 * The check `just compat-previous` runs, proved offline: this tree stands in
 * for the previous release, alone or doctored to misread one thing. The run
 * against the real previous release is `src/test/compat/`.
 */
import { describe, expect, it } from "vitest";
import { STYLE_GUIDE } from "vantage-md";
import {
  THIS_TREE,
  frontmatterExamples,
  guideExamples,
  misreadings,
  vocabularyExamples,
  withoutDirectives,
  type Release,
} from "./notation";

/** This tree, with `edit` applied to every page it renders. */
function rendering(edit: (html: string) => string): Release {
  return {
    ...THIS_TREE,
    name: "the doctored release",
    renderMarkdown: async (content) => ({
      html: edit((await THIS_TREE.renderMarkdown(content)).html),
    }),
  };
}

/**
 * This tree, withholding the block on `line` whenever `marker` is in the
 * source: a stand-in for `fallback`, which these tests cannot assume the tree
 * has, under a name no release knows.
 */
function withholding(marker: string, line: number): Release {
  return {
    ...THIS_TREE,
    renderMarkdown: async (content) => {
      const { html } = await THIS_TREE.renderMarkdown(content);
      if (!content.includes(marker)) return { html };
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelector(`[data-source-line="${line}"]`)?.remove();
      return { html: doc.body.innerHTML };
    },
  };
}

const STAND_IN = "<!-- vantage: stand-in -->";

/**
 * This tree, with every drawing dropped as a release before 0.8 drops it: a
 * stand-in for a previous release that lacks the inline-SVG capability.
 */
const NO_SVG = rendering((html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ""));

const DRAWING = [
  "<div>",
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="currentColor"/></svg>',
  "</div>",
  "",
].join("\n");

function question(marker: string, directive: string): string {
  return [
    `1. ${marker}**OQ-10: The retry budget.**`,
    "",
    `   ${directive}`,
    "",
    "   Waits on the load test.",
    "",
  ].join("\n");
}

async function kinds(source: string, previous: Release = THIS_TREE) {
  return (await misreadings({ origin: "a test", source }, previous)).map(
    (m) => m.kind,
  );
}

describe("guideExamples", () => {
  const guide = [
    "## Markdown style guide",
    "",
    "Quote `<!-- vantage: block tone=note -->` here, and again: `<!-- vantage: block tone=note -->`.",
    "",
    "### Directives",
    "",
    "```markdown",
    "<!-- vantage: section tone=warning -->",
    "",
    "## Migration path",
    "```",
    "",
    "- A list item:",
    "  ```yaml",
    "  ---",
    "  title: x",
    "  ---",
    "  ```",
    "",
    "```yaml",
    "key: not frontmatter",
    "```",
    "",
    "```toml",
    "[planning]",
    "```",
  ].join("\n");

  it("takes the guide itself, each quoted directive once, each Markdown example and each frontmatter block", () => {
    const examples = guideExamples(guide);
    expect(examples.map((e) => e.origin)).toEqual([
      "the style guide, read as a document",
      "<!-- vantage: block tone=note -->, as the style guide quotes it at line 3",
      'the ```markdown example at line 7 of the style guide, under "Directives"',
      'the frontmatter in the ```yaml example at line 14 of the style guide, under "Directives"',
    ]);
    expect(examples[0]?.source).toBe(guide);
    expect(examples[1]?.source).toBe(
      "<!-- vantage: block tone=note -->\n\n## A heading\n\nA paragraph.\n",
    );
    expect(examples[2]?.source).toBe(
      "<!-- vantage: section tone=warning -->\n\n## Migration path\n",
    );
    // Read at the fence's own indentation, so the delimiter is at column 0.
    expect(examples[3]?.source).toBe(
      "---\ntitle: x\n---\n\n# A document\n\nA paragraph.\n",
    );
  });

  it("finds directive examples and frontmatter examples in the real guide, so the run cannot pass by finding nothing", () => {
    const examples = guideExamples(STYLE_GUIDE);
    const markdown = examples.filter((e) => e.origin.includes("```markdown"));
    expect(markdown.some((e) => e.source.includes("<!-- vantage: oq"))).toBe(
      true,
    );
    expect(
      examples.filter((e) => e.origin.startsWith("the frontmatter")).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("vocabularyExamples", () => {
  it("writes each name bare and with every value of every key, above a heading and above a paragraph", () => {
    const examples = vocabularyExamples({
      block: { tone: ["note", "tip"] },
      oq: { id: null, leaning: null },
    });
    expect(examples.map((e) => e.origin)).toEqual([
      "<!-- vantage: block --> above a heading",
      "<!-- vantage: block --> above a paragraph",
      "<!-- vantage: block tone=note --> above a heading",
      "<!-- vantage: block tone=note --> above a paragraph",
      "<!-- vantage: block tone=tip --> above a heading",
      "<!-- vantage: block tone=tip --> above a paragraph",
      "<!-- vantage: oq --> above a heading",
      "<!-- vantage: oq --> above a paragraph",
      "<!-- vantage: oq id=OQ-1 --> above a heading",
      "<!-- vantage: oq id=OQ-1 --> above a paragraph",
      '<!-- vantage: oq leaning="A sentence of text." --> above a heading',
      '<!-- vantage: oq leaning="A sentence of text." --> above a paragraph',
    ]);
  });
});

describe("withoutDirectives", () => {
  it("blanks each directive's lines and keeps every other line where it was", () => {
    const source = [
      "Before.",
      "",
      "<!-- vantage: block",
      "     tone=note -->",
      "",
      "After.",
    ].join("\n");
    expect(withoutDirectives(source)).toBe(
      ["Before.", "", "", "", "", "After."].join("\n"),
    );
  });

  it("keeps a directive the release applies, and one inside fenced code", () => {
    const source = [
      "<!-- vantage: block tone=note -->",
      "",
      "```markdown",
      "<!-- vantage: fallback -->",
      "```",
    ].join("\n");
    expect(withoutDirectives(source, () => true)).toBe(source);
    expect(withoutDirectives(source)).toBe(
      ["", "", "```markdown", "<!-- vantage: fallback -->", "```"].join("\n"),
    );
  });

  it("asks about the comment HTML reads, which a `-->` inside a value cuts short", () => {
    const asked: string[] = [];
    const source = '<!-- vantage: block tone="a-->b" -->\n\nText.\n';
    const out = withoutDirectives(source, (inner) => {
      asked.push(inner);
      return false;
    });
    expect(asked).toEqual([' vantage: block tone="a']);
    expect(out).toBe("\n\nText.\n");
  });

  it("blanks only the first line of a directive that never closes", () => {
    expect(withoutDirectives("<!-- vantage: block\n\nText.\n")).toBe(
      "\n\nText.\n",
    );
  });
});

describe("misreadings", () => {
  it("flags an oq directive on a 🔒 question, which every 0.7 viewer offers to answer", async () => {
    const found = await misreadings(
      {
        origin: "a test",
        source: question("\u{1F512} ", "<!-- vantage: oq id=OQ-10 -->"),
      },
      THIS_TREE,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("affordance");
    expect(found[0]?.message).toContain('offers "Take this leaning" on OQ-10');
    expect(found[0]?.message).toContain("blocked");
  });

  it("flags one on a ✅ question too", async () => {
    const found = await misreadings(
      {
        origin: "a test",
        source: question("✅ ", "<!-- vantage: oq id=OQ-10 -->"),
      },
      THIS_TREE,
    );
    expect(found.map((m) => m.kind)).toEqual(["affordance"]);
    expect(found[0]?.message).toContain("answered");
  });

  it("passes one on an open question, marked or not", async () => {
    for (const marker of ["\u{1F4AC} ", "\u{1F4AC} \u{1F937} ", ""]) {
      expect(
        await kinds(question(marker, "<!-- vantage: oq id=OQ-10 -->")),
      ).toEqual([]);
    }
  });

  it("flags a button where this tree reads no question at all", async () => {
    const previous = rendering((html) =>
      html.replace(
        '<p data-source-line="3">',
        '<p data-source-line="3" data-vantage-oq="true">',
      ),
    );
    const found = await misreadings(
      { origin: "a test", source: "# Title\n\nA paragraph.\n" },
      previous,
    );
    // The stamp itself is a changed meaning too, and reported as one.
    expect(found.map((m) => m.kind)).toEqual(["affordance", "meaning"]);
    expect(found[0]?.message).toBe(
      'the doctored release offers "Take this leaning" on line 3, where this tree reads no question at all.',
    );
  });

  it("flags a directive whose value carries `-->`, which spills onto the page", async () => {
    const found = await misreadings(
      {
        origin: "a test",
        source: '<!-- vantage: block tone="a-->b" -->\n\nText.\n',
      },
      THIS_TREE,
    );
    expect(found.map((m) => m.kind)).toEqual(["spill"]);
    expect(found[0]?.message).toContain('"b\\" --> Text."');
  });

  it("flags a stamp this tree gives another value, or does not give at all", async () => {
    const source = "<!-- vantage: block badge=done -->\n\nText.\n";
    const changed = await misreadings(
      { origin: "a test", source },
      rendering((html) =>
        html.replace('data-vantage-badge="done"', 'data-vantage-badge="stale"'),
      ),
    );
    expect(changed).toEqual([
      {
        kind: "meaning",
        message:
          'the doctored release stamps data-vantage-badge="stale" on the <p> at line 3, and this tree stamps data-vantage-badge="done".',
      },
    ]);

    const added = await misreadings(
      { origin: "a test", source: "Text.\n" },
      rendering((html) =>
        html.replace("<p ", '<p data-vantage-tone="warning" '),
      ),
    );
    expect(added.map((m) => m.message)).toEqual([
      'the doctored release stamps data-vantage-tone="warning" on the <p> at line 1, and this tree does not stamp it.',
    ]);
  });

  it("lets the older page keep a stamp this tree replaces by a directive it drops", async () => {
    // A release that predates `question` drops it, so the heading keeps its
    // own slug where this tree gives it the question's id. That is the
    // directive dropped, not read another way.
    const predatesQuestion: Release = {
      ...THIS_TREE,
      name: "the doctored release",
      appliesDirective: (inner) =>
        !inner.includes("question") && THIS_TREE.appliesDirective!(inner),
      renderMarkdown: (content) =>
        THIS_TREE.renderMarkdown(
          withoutDirectives(content, (inner) => !inner.includes("question")),
        ),
    };
    const source =
      "<!-- vantage: question id=OQ-1 -->\n\n## A heading\n\nA paragraph.\n";
    expect(await kinds(source, predatesQuestion)).toEqual([]);

    // A directive the older release applies is still held to this tree's
    // reading of it.
    const misreadsBlock = rendering((html) =>
      html.replace('id="a-heading"', 'id="elsewhere"'),
    );
    expect(
      await kinds(
        "<!-- vantage: block tone=note -->\n\n## A heading\n",
        misreadsBlock,
      ),
    ).toEqual(["meaning"]);
  });

  it("flags frontmatter the release cannot read, reads differently, or chips differently", async () => {
    const source =
      "---\nstatus: draft\nvantage:\n  status-chip: true\n---\n\n# A\n";
    const unreadable: Release = {
      ...THIS_TREE,
      name: "the doctored release",
      parseFrontmatter: (content) => ({
        ...THIS_TREE.parseFrontmatter(content),
        frontmatter: {},
        problem: { kind: "invalid" },
      }),
    };
    expect(await kinds(source, unreadable)).toEqual(["frontmatter"]);

    const different: Release = {
      ...THIS_TREE,
      parseFrontmatter: (content) => {
        const parsed = THIS_TREE.parseFrontmatter(content);
        return {
          ...parsed,
          frontmatter: { ...parsed.frontmatter, status: "accepted" },
        };
      },
    };
    expect(await kinds(source, different)).toEqual([
      "frontmatter",
      "frontmatter",
    ]);

    const chip: Release = {
      ...THIS_TREE,
      name: "the doctored release",
      readVantageFrontmatter: () => ({ statusChip: "accepted" }),
    };
    const found = await misreadings({ origin: "a test", source }, chip);
    expect(found.map((m) => m.message)).toEqual([
      'the doctored release shows the status chip "accepted", and this tree shows "draft".',
    ]);
  });

  it("flags text the older page shows and this tree's does not", async () => {
    const found = await misreadings(
      { origin: "a test", source: "Text.\n" },
      rendering((html) => html.replace("Text.", "{.note} Text.")),
    );
    expect(found).toEqual([
      {
        kind: "text",
        message:
          'the doctored release shows text this tree does not: "{.note}".',
      },
    ]);
  });

  it("lets the older page show a block this tree withholds by a directive", async () => {
    const source = `Lead.\n\n${STAND_IN}\n\nOnly for older readers.\n`;
    const current = withholding(STAND_IN, 5);
    expect(
      await misreadings({ origin: "a test", source }, THIS_TREE, current),
    ).toEqual([]);
    // And only that block: text elsewhere still counts.
    const noisy = rendering((html) => html.replace("Lead.", "Lead. Extra."));
    expect(
      (await misreadings({ origin: "a test", source }, noisy, current)).map(
        (m) => m.kind,
      ),
    ).toEqual(["text"]);
  });

  it("flags a capability with no fallback block and no release named", async () => {
    const found = await misreadings(
      { origin: "a test", source: DRAWING },
      NO_SVG,
    );
    expect(found.map((m) => m.message)).toEqual([
      "this tree draws inline <svg> here, which needs Vantage 0.8, and the example pairs it with no fallback block and never says it needs Vantage 0.8.",
    ]);
  });

  it("passes a capability paired with a fallback the older viewer shows, under a heading naming its release", async () => {
    const source = `${DRAWING}\n${STAND_IN}\n\nA drawing.\n`;
    const current = withholding(STAND_IN, 7);
    expect(
      await misreadings(
        {
          origin: "a test",
          source,
          heading: '"Inline SVG (needs Vantage 0.8 or later)"',
        },
        NO_SVG,
        current,
      ),
    ).toEqual([]);
    // Without the heading, the example has to say it itself.
    expect(
      (await misreadings({ origin: "a test", source }, NO_SVG, current)).map(
        (m) => m.kind,
      ),
    ).toEqual(["capability"]);
  });

  // Right after a release is published it is the previous release, and it
  // draws what it added: a drawing is no gap between it and this tree, and a
  // fallback it withholds as this tree does is not one it fails to show.
  it("passes a capability the previous release already draws, with or without a fallback", async () => {
    expect(await kinds(DRAWING)).toEqual([]);
    expect(
      await kinds(`${DRAWING}\n<!-- vantage: fallback -->\n\nA drawing.\n`),
    ).toEqual([]);
  });

  // What compat-previous meets once this tree is published and becomes the
  // previous release: it must not fail on the very notation it shipped. One
  // case per example, so the whole guide's render has a budget of its own.
  const published: Release = {
    ...THIS_TREE,
    name: "vantage-md@0.8.0 (this tree)",
  };
  it.each(
    [...guideExamples(), ...vocabularyExamples(), ...frontmatterExamples()].map(
      (example) => [example.origin, example] as const,
    ),
  )("reads %s the same as itself", async (_origin, example) => {
    expect(await misreadings(example, published)).toEqual([]);
  });
});
