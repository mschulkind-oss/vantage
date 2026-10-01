/**
 * One candidate file, read into what it gives the planning index
 * (`docs/reference/planning-index.md` §3.1–§3.3 and §3.4).
 *
 * The scan lives in `packages/vantage-md/src/planning/scan.ts`, which has no
 * suite of its own; this runs it through the frontend's `vantage-md/planning`
 * alias. The agreement with the rendered contents column is proved separately,
 * over every document in `docs/`, by `planningAgreement.test.tsx`.
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "vantage-md";
import {
  VANTAGE_OQ_PREFERENCE,
  normalizeLeaning,
  resolveRepoLink,
  scanPlanningDocument,
  type PlanningDocument,
  type ScanResult,
} from "vantage-md/planning";

/** Scan `source` as `path` and insist it is a planning document. */
function planning(
  source: string,
  path = "docs/design/x.md",
  isRoadmap = false,
): PlanningDocument {
  const result = scanPlanningDocument(path, source, isRoadmap);
  if (result.kind !== "planning") {
    throw new Error(`expected a planning document, got ${result.kind}`);
  }
  return result.document;
}

function scan(source: string, isRoadmap = false): ScanResult {
  return scanPlanningDocument("docs/design/x.md", source, isRoadmap);
}

/**
 * A loose list item holding one question, in the convention's layout: a
 * `question` directive in every state, restating the question's leaning.
 */
function item(marker: string, id: string, leaning = "Take it."): string {
  return [
    `1. ${marker} **${id}: A question?**`,
    "",
    `   <!-- vantage: question id=${id} leaning="${leaning}" -->`,
    "",
    `   _Leaning:_ ${leaning}`,
    "",
  ].join("\n");
}

describe("which files are planning documents (§3.1)", () => {
  it("counts a document with a status", () => {
    expect(scan("---\nstatus: draft\n---\n\n# X\n").kind).toBe("planning");
  });

  it("counts a document with a stage", () => {
    expect(scan("---\nstage: DESIGN\n---\n\n# X\n").kind).toBe("planning");
  });

  it("counts a document holding one oq directive and no frontmatter", () => {
    const doc = planning(
      '# X\n\n<!-- vantage: oq id=OQ-1 leaning="Yes." -->\n\nShould it?\n',
    );
    expect(doc.questions).toHaveLength(1);
  });

  it("counts a document holding one question directive and no frontmatter", () => {
    const doc = planning(
      "# X\n\n<!-- vantage: question id=OQ-1 -->\n\n\u{1F512} Waits on the load test.\n",
    );
    expect(doc.questions).toMatchObject([
      { id: "OQ-1", directive: "question", state: "blocked" },
    ]);
    expect(doc.directiveIds).toEqual(["OQ-1"]);
  });

  it("counts the roadmap whatever it holds", () => {
    const doc = planning("# Roadmap\n\nNothing yet.\n", "roadmap.md", true);
    expect(doc).toMatchObject({ status: null, stage: null, questions: [] });
  });

  it("drops a document with none of those", () => {
    expect(scan("# X\n\nProse about `vantage:` directives.\n")).toEqual({
      kind: "not-planning",
    });
  });

  it("does not count an oq directive inside a fence", () => {
    // The gallery's own orphan example is written this way, which is why it
    // proves fence exclusion and nothing more.
    const source = [
      "# X",
      "",
      "```markdown",
      '<!-- vantage: oq id=OQ-8 leaning="This does nothing." -->',
      "",
      "- The target is the list, not this item.",
      "```",
      "",
    ].join("\n");
    expect(scan(source).kind).toBe("not-planning");
  });

  it("counts a document whose only oq is an orphan, with no questions", () => {
    const doc = planning(
      '# X\n\n<!-- vantage: oq id=OQ-8 leaning="Nothing." -->\n\n- An item.\n',
    );
    expect(doc.questions).toEqual([]);
  });

  it("counts an inline oq directive, which stamps nothing", () => {
    const doc = planning("# X\n\nText <!-- vantage: oq id=OQ-1 --> more.\n");
    expect(doc.questions).toEqual([]);
  });

  it.each([
    ["invalid YAML", "---\nstatus: [draft\n---\n\n# X\n", "does not parse"],
    ["an unterminated block", "---\nstatus: draft\n\n# X\n", "never closed"],
    ["a list, not a table", "---\n- draft\n---\n\n# X\n", "not a table"],
  ])("makes a file unreadable when its frontmatter is %s", (_, source, why) => {
    const result = scan(source);
    expect(result.kind).toBe("unreadable");
    expect(result.kind === "unreadable" && result.reason).toContain(why);
  });

  it("makes even the roadmap unreadable when its frontmatter is broken", () => {
    expect(scan("---\nstatus: [x\n---\n", true).kind).toBe("unreadable");
  });
});

describe("what a document contributes (§3.2)", () => {
  it("keeps a status outside the four as no status, and still counts it", () => {
    const doc = planning("---\nstatus: current\n---\n\n# X\n");
    expect(doc.status).toBeNull();
  });

  it("reads each of the four statuses", () => {
    for (const status of ["draft", "in-review", "accepted", "deprecated"]) {
      expect(planning(`---\nstatus: ${status}\n---\n`).status).toBe(status);
    }
  });

  it("collects Markdown links and reference links, and nothing else", () => {
    const source = [
      "---", // 1
      "status: draft", // 2
      "---", // 3
      "", // 4
      "[before](a.md) comes before any heading.", // 5
      "", // 6
      "## Rule these `first`", // 7
      "", // 8
      "See [the plan](../plans/b.md#OQ-B2) and [c][ref].", // 9
      "", // 10
      "![an image](d.md) is not a link, and neither is `[e](e.md)`.", // 11
      "", // 12
      "```", // 13
      "[f](f.md)", // 14
      "```", // 15
      "", // 16
      "<!-- [g](g.md) -->", // 17
      "", // 18
      "[out](https://example.com/h.md), [root](/i.md), [up](../../../j.md).", // 19
      "", // 20
      "[ref]: ./c.md?raw=1#Some%20Heading", // 21
      "",
    ].join("\n");
    const doc = planning(source);
    expect(
      doc.links.map(({ target, fragment, heading, line }) => ({
        target,
        fragment,
        heading,
        line,
      })),
    ).toEqual([
      { target: "docs/design/a.md", fragment: null, heading: null, line: 5 },
      {
        target: "docs/plans/b.md",
        fragment: "OQ-B2",
        heading: "Rule these first",
        line: 9,
      },
      {
        target: "docs/design/c.md",
        fragment: "Some Heading",
        heading: "Rule these first",
        line: 9,
      },
    ]);
  });

  it("collects no link from a block a fallback withholds", () => {
    // The page never renders it, so it routes nothing and badges nothing.
    // GitHub shows it, which is why the checker still checks it.
    const source = [
      "---",
      "status: draft",
      "---",
      "",
      "<!-- vantage: fallback -->",
      "",
      "> See [the drawing](chart.svg) and [the plan](plan.md).",
      "",
      "[Kept](kept.md).",
      "",
      // A tight item unwraps its paragraph into bare text, so this run meets
      // text, withholds nothing, and the link is on the page.
      "- one",
      "  <!-- vantage: fallback -->",
      "  [also kept](also.md)",
      "- two",
      "",
    ].join("\n");
    expect(planning(source).links.map((link) => link.target)).toEqual([
      "docs/design/kept.md",
      "docs/design/also.md",
    ]);
  });

  it("collects no link from a raw-HTML block a fallback withholds, blank lines and nesting included", async () => {
    // `rehype-raw` builds `<div>`, the Markdown inside it and `</div>` into
    // one element, so the fallback withholds all of it, up to the `</div>`
    // that closes the outer one; a `<p>` is closed at the first blank line,
    // so only its own node goes.
    const source = [
      "---",
      "status: draft",
      "---",
      "",
      "<!-- vantage: fallback -->",
      "",
      "<div>",
      "",
      "[the plan](plan.md)",
      "",
      "<div>",
      "",
      "[nested](nested.md)",
      "",
      "</div>",
      "",
      "[still inside](inside.md)",
      "",
      "</div>",
      "",
      "[After the div](after.md).",
      "",
      "<!-- vantage: fallback -->",
      "",
      "<p>",
      "",
      "[after the p](p.md)",
      "",
      "</p>",
      "",
    ].join("\n");
    expect(planning(source).links.map((link) => link.target)).toEqual([
      "docs/design/after.md",
      "docs/design/p.md",
    ]);
    const { html } = await renderMarkdown(source);
    for (const gone of ["plan.md", "nested.md", "inside.md"]) {
      expect(html).not.toContain(gone);
    }
    expect(html).toContain("after.md");
    expect(html).toContain("p.md");
  });

  it("records where each link ends in the source", () => {
    const source =
      "---\nstatus: draft\n---\n\n# X\n\nSee [the plan](b.md). Then more.\n";
    const [link] = planning(source).links;
    expect(source.slice(0, link?.endOffset)).toMatch(/\[the plan\]\(b\.md\)$/);
  });

  it("keeps a link to the document itself", () => {
    const doc = planning(
      "---\nstatus: draft\n---\n\n[up](#OQ-1) and [me](x.md)\n",
    );
    expect(doc.links.map((l) => [l.target, l.fragment])).toEqual([
      ["docs/design/x.md", "OQ-1"],
      ["docs/design/x.md", null],
    ]);
  });

  it("collects every OQ id in the text, the Decision Ledger included", () => {
    const source = [
      "---",
      "status: accepted",
      "---",
      "",
      "Ruled in _OQ-4_, and OQ-B2 twice: OQ-B2.",
      "",
      "| ID | Ruling |",
      "| :--- | :--- |",
      "| OQ-PL1 | Yes |",
      "",
      "Not ids: FOOQ-1, OQ-B2x, OQ-foo, OQ-.",
      "",
    ].join("\n");
    expect(planning(source).ids).toEqual(["OQ-4", "OQ-B2", "OQ-PL1"]);
  });
});

describe("a question (§3.3)", () => {
  it.each([
    ["\u{1F4AC}", "open", false],
    [`\u{1F4AC} ${VANTAGE_OQ_PREFERENCE}`, "open", true],
    ["\u{1F512}", "blocked", false],
    ["✅", "answered", false],
    ["", "open", false],
  ])("reads marker %j as %s", (marker, state, preference) => {
    const [question] = planning(`# Q\n\n${item(marker, "OQ-1")}`).questions;
    expect(question).toMatchObject({ state, preference, marker });
  });

  it("reads the state off the title, as the contents column does", () => {
    // 💬 on the title and ✅ in the body is open: the column reads the marker
    // before the bold title, where the checker's `oq-missing` reads the item.
    const source = [
      "1. \u{1F4AC} **OQ-1: Still open?**",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="Yes." -->',
      "",
      "   _Leaning:_ yes. The last one was ✅ already.",
      "",
    ].join("\n");
    expect(planning(source).questions[0]?.state).toBe("open");
  });

  it("carries the title, the leaning and the lines", () => {
    const source = [
      "---", // 1
      "status: in-review", // 2
      "---", // 3
      "", // 4
      "# Open questions", // 5
      "", // 6
      item("\u{1F4AC}", "OQ-B1", "Back of\n   the   queue."), // 7-14
      item("\u{1F512}", "OQ-B2"), // 15-20
    ].join("\n");
    const [first, second] = planning(source).questions;
    // Both sit in the one list, lines 7–19, and its card is those lines.
    const card = `${source.split("\n").slice(6, 19).join("\n")}\n`;
    // The wrapped leaning takes two lines in the directive and two in the
    // paragraph, so the first item runs 7–13, a blank line follows, and the
    // second runs 15–19.
    expect(first).toEqual({
      path: "docs/design/x.md",
      directive: "question",
      id: "OQ-B1",
      state: "open",
      preference: false,
      marker: "\u{1F4AC}",
      title: "OQ-B1: A question?",
      leaning: "Back of the queue.",
      line: 12,
      unitLine: 7,
      unitEndLine: 13,
      block: { startLine: 7, endLine: 19 },
      cardChars: card.length,
    });
    expect(second).toMatchObject({
      directive: "question",
      id: "OQ-B2",
      // A 🔒 question keeps its leaning, which nothing offers to take.
      leaning: "Take it.",
      line: 19,
      unitLine: 15,
      unitEndLine: 19,
      cardChars: card.length,
    });
  });

  // Every card's own agreement with the old cut is `planningCard.test.ts`'s;
  // this is the count the page pages by, beside the blocks it counts.
  it("counts each question's card in characters, one block per root-level block", () => {
    const source = [
      "# X", // 1
      "", // 2
      item("\u{1F4AC}", "OQ-C1"), // 3-7
      item("\u{1F4AC}", "OQ-C2"), // 9-13
      '<!-- vantage: oq id=OQ-C3 leaning="Yes." -->', // 15
      "", // 16
      "\u{1F4AC} A root-level question.", // 17
      "",
    ].join("\n");
    const result = scan(source);
    if (result.kind !== "planning") throw new Error("not planning");
    const lines = source.split("\n");
    const slice = (from: number, to: number) =>
      `${lines.slice(from - 1, to).join("\n")}\n`;
    expect(result.cards).toEqual([
      { startLine: 3, endLine: 13, markdown: slice(3, 13), lineOffset: 2 },
      { startLine: 15, endLine: 17, markdown: slice(15, 17), lineOffset: 14 },
    ]);
    expect(result.document.questions.map((q) => [q.id, q.cardChars])).toEqual([
      ["OQ-C1", slice(3, 13).length],
      ["OQ-C2", slice(3, 13).length],
      ["OQ-C3", slice(15, 17).length],
    ]);
  });

  // No rendered element carries the line a unit ends on, so this is held to
  // mdast's own positions, written beside each line, rather than to the DOM
  // `planningAgreement.test.tsx` reads.
  it("ends each question's unit on the last line of its node", () => {
    const source = [
      "# X", // 1
      "", // 2
      "1. \u{1F4AC} **OQ-L1: A list item?**", // 3
      "", // 4
      '   <!-- vantage: oq id=OQ-L1 leaning="Yes." -->', // 5
      "", // 6
      "   _Leaning:_ yes,", // 7
      "   over two lines.", // 8
      "", // 9
      "2. An outer item.", // 10
      "", // 11
      "   - \u{1F4AC} **OQ-N1: A nested item?**", // 12
      "", // 13
      '     <!-- vantage: oq id=OQ-N1 leaning="Yes." -->', // 14
      "", // 15
      "     _Leaning:_ yes.", // 16
      "", // 17
      "   - A sibling.", // 18
      "", // 19
      '<!-- vantage: oq id=OQ-P1 leaning="Yes." -->', // 20
      "", // 21
      "\u{1F4AC} A bare paragraph,", // 22
      "over two lines.", // 23
      "", // 24
      '<!-- vantage: oq id=OQ-Q1 leaning="Yes." -->', // 25
      "", // 26
      "> \u{1F4AC} A question in a quote,", // 27
      "> over two lines.", // 28
      "", // 29
      '<!-- vantage: oq id=OQ-H1 leaning="Yes." -->', // 30
      "", // 31
      "### \u{1F4AC} A question as a heading", // 32
      "", // 33
      "After,", // 34
      "in its section.", // 35
      "", // 36
      "## The next section", // 37
      "", // 38
      "Not the question's.", // 39
      "",
    ].join("\n");
    expect(
      planning(source).questions.map((q) => [q.id, q.unitLine, q.unitEndLine]),
    ).toEqual([
      // A list item ends where its last block does, before the blank line.
      ["OQ-L1", 3, 8],
      // The nearest item is the unit, not the outer one it sits in.
      ["OQ-N1", 12, 16],
      // Outside a list the unit runs from the host block up to the next
      // question's: here, the host block alone.
      ["OQ-P1", 22, 23],
      ["OQ-Q1", 27, 28],
      // A heading runs to the end of its section.
      ["OQ-H1", 32, 35],
    ]);
  });

  it("runs a question outside a list over the blocks after its host, up to a heading, a rule or the next question", () => {
    const source = [
      '<!-- vantage: question id=OQ-1 leaning="A." -->', // 1
      "", // 2
      "\u{1F4AC} **OQ-1: Where does a job go?**", // 3
      "", // 4
      "Its context.", // 5
      "", // 6
      "- **A — The back.**", // 7
      "- **B — Its old place.**", // 8
      "", // 9
      "_Leaning:_ A.", // 10
      "", // 11
      "**Answer:**", // 12
      "", // 13
      "> _(empty — fill in when decided)_", // 14
      "", // 15
      "[ref]: https://example.com", // 16
      "", // 17
      "<!-- an editorial comment -->", // 18
      "", // 19
      '<!-- vantage: question id=OQ-2 leaning="B." -->', // 20
      "", // 21
      "\u{1F4AC} **OQ-2: The next one?**", // 22
      "", // 23
      "Its context.", // 24
      "", // 25
      "---", // 26
      "", // 27
      "No question's.", // 28
      "", // 29
      "<!-- vantage: question id=OQ-3 -->", // 30
      "", // 31
      "\u{1F4AC} **OQ-3: Before a heading?**", // 32
      "", // 33
      "#### Even a deeper one ends it", // 34
      "",
    ].join("\n");
    const questions = planning(source).questions;
    expect(
      questions.map((q) => [q.id, q.unitLine, q.unitEndLine, q.block]),
    ).toEqual([
      // The link definition and the comment render nothing, so they neither
      // belong to it nor end it; the next question's host does.
      ["OQ-1", 3, 14, { startLine: 1, endLine: 14 }],
      ["OQ-2", 22, 24, { startLine: 20, endLine: 24 }],
      ["OQ-3", 32, 32, { startLine: 30, endLine: 32 }],
    ]);
  });

  it("offsets a unit's last line by the frontmatter, as its first", () => {
    const source = [
      "---", // 1
      "status: draft", // 2
      "---", // 3
      "", // 4
      item("\u{1F4AC}", "OQ-F1"), // 5-9
    ].join("\n");
    expect(planning(source).questions[0]).toMatchObject({
      unitLine: 5,
      unitEndLine: 9,
    });
  });

  it("starts a root-level question's block at its directive", () => {
    const source = [
      "# X", // 1
      "", // 2
      '<!-- vantage: oq id=OQ-4 leaning="A paragraph." -->', // 3
      "", // 4
      "A question written as a plain paragraph,", // 5
      "over two lines.", // 6
      "", // 7
      "---", // 8
      "", // 9
      "After.", // 10
      "",
    ].join("\n");
    expect(planning(source).questions[0]).toMatchObject({
      id: "OQ-4",
      title: "A question written as a plain paragraph, over two lines.",
      marker: "",
      line: 5,
      unitLine: 5,
      block: { startLine: 3, endLine: 6 },
    });
  });

  // Several comments in one raw HTML node: each comment's line is counted
  // from the previous one's, so the later ones must still land right.
  it("starts the block at the directive's own line in a node of several comments", () => {
    const source = [
      "# X", // 1
      "", // 2
      "<!-- a plain comment -->", // 3
      "<!-- another -->", // 4
      "<!-- vantage: oq id=OQ-4 -->", // 5
      "", // 6
      "The question.", // 7
      "",
    ].join("\n");
    expect(planning(source).questions[0]).toMatchObject({
      id: "OQ-4",
      line: 7,
      block: { startLine: 5, endLine: 7 },
    });
  });

  it("hosts a question on a blockquote and on a heading", () => {
    const source = [
      "<!-- vantage: question id=OQ-5 -->",
      "",
      "> \u{1F512} A question in a quote.",
      "",
      "<!-- vantage: question id=OQ-6 -->",
      "",
      "### ✅ A question as a heading",
      "",
    ].join("\n");
    expect(
      planning(source).questions.map((q) => [q.id, q.state, q.line]),
    ).toEqual([
      ["OQ-5", "blocked", 3],
      ["OQ-6", "answered", 7],
    ]);
  });

  it.each([
    ["a list", "- The target is the list.\n- Not this item."],
    ["a fence", "```\ncode\n```"],
    ["a table", "| a | b |\n| - | - |\n| 1 | 2 |"],
  ])("yields no question for an oq directive above %s", (_, block) => {
    const doc = planning(
      `# X\n\n<!-- vantage: oq id=OQ-1 leaning="No." -->\n\n${block}\n`,
    );
    expect(doc.questions).toEqual([]);
  });

  it("yields no question inside a tight list item, where there is no paragraph", () => {
    const source = [
      "- \u{1F4AC} **OQ-1: Tight?**",
      '  <!-- vantage: oq id=OQ-1 leaning="No." -->',
      "  _Leaning:_ no.",
      "- Another item.",
      "",
    ].join("\n");
    expect(planning(source).questions).toEqual([]);
  });

  it("does not count a directive inside a raw HTML block (Plan Q17)", () => {
    const source = [
      "# X",
      "",
      "<div>",
      '<!-- vantage: oq id=OQ-H1 leaning="Inside." -->',
      "<p>\u{1F4AC} <strong>OQ-H1: In raw HTML?</strong></p>",
      "</div>",
      "",
    ].join("\n");
    const doc = planning(source);
    expect(doc.questions).toEqual([]);
  });

  it("reads no question from a block a fallback withholds", () => {
    // The page never shows the block, so no button, no contents entry and no
    // card can exist for it. One in the same run goes with it; one inside a
    // withheld list is never reached; one under a heading the fallback
    // cannot withhold still counts.
    const source = [
      "# X",
      "",
      '<!-- vantage: oq id=OQ-1 leaning="Gone." -->',
      "<!-- vantage: fallback -->",
      "",
      "\u{1F4AC} **OQ-1: Merged onto a fallback?**",
      "",
      "<!-- vantage: fallback -->",
      "",
      item("\u{1F4AC}", "OQ-2"),
      '<!-- vantage: oq id=OQ-3 leaning="Kept." -->',
      "<!-- vantage: fallback -->",
      "",
      "### \u{1F4AC} **OQ-3: On a heading?**",
      "",
    ].join("\n");
    expect(planning(source).questions.map((q) => q.id)).toEqual(["OQ-3"]);
  });

  it("keeps the question of an item whose other paragraph is withheld", () => {
    // The fallback withholds its own block and nothing else in the item.
    const source = [
      "- \u{1F4AC} **OQ-1: Kept?**",
      "",
      '  <!-- vantage: oq id=OQ-1 leaning="Yes." -->',
      "",
      "  _Leaning:_ yes.",
      "",
      "  <!-- vantage: fallback -->",
      "",
      "  Withheld, in a loose item.",
      "- Another item.",
      "",
    ].join("\n");
    expect(planning(source).questions.map((q) => q.id)).toEqual(["OQ-1"]);
  });

  it("merges a run of directives onto one question, last key winning", () => {
    const source = [
      '<!-- vantage: oq id=OQ-1 leaning="First." -->',
      "<!-- TODO: a note between them does not break the run -->",
      '<!-- vantage: oq leaning="Second." -->',
      "",
      "The question.",
      "",
    ].join("\n");
    expect(planning(source).questions).toEqual([
      expect.objectContaining({ id: "OQ-1", leaning: "Second." }),
    ]);
  });

  it("counts a question with no id, a malformed id, or a repeated one, with no id (Plan Q5)", () => {
    const source = [
      "# X",
      "",
      "<!-- vantage: oq -->",
      "",
      "No id.",
      "",
      "<!-- vantage: oq id=OQ-nope -->",
      "",
      "Malformed.",
      "",
      "<!-- vantage: oq id=OQ-4 -->",
      "",
      "First.",
      "",
      "<!-- vantage: oq id=OQ-4 -->",
      "",
      "Repeated.",
      "",
    ].join("\n");
    expect(planning(source).questions.map((q) => [q.title, q.id])).toEqual([
      ["No id.", null],
      ["Malformed.", null],
      ["First.", "OQ-4"],
      ["Repeated.", null],
    ]);
  });

  // §3.3 names vantage/oq-id-duplicate for "used earlier", and that rule
  // counts every oq directive, an orphan's included. The page anchors the
  // orphan's table first, so `#OQ-1` lands there and the question cannot have
  // it; the scan used to count only earlier questions' ids.
  it("gives no id to a question whose id an earlier orphan directive used", () => {
    const source = [
      "# X",
      "",
      "<!-- vantage: oq id=OQ-1 -->",
      "",
      "| a |",
      "| - |",
      "| b |",
      "",
      "<!-- vantage: oq id=OQ-1 -->",
      "",
      "Real question?",
      "",
      "<!-- vantage: oq id=OQ-2 -->",
      "",
      "Its own.",
      "",
    ].join("\n");
    expect(planning(source).questions.map((q) => [q.title, q.id])).toEqual([
      ["Real question?", null],
      ["Its own.", "OQ-2"],
    ]);
  });

  it("reads no leaning when the directive gives none, or an empty one", () => {
    const source = [
      "<!-- vantage: oq id=OQ-7 -->",
      "",
      "No leaning.",
      "",
      '<!-- vantage: oq id=OQ-8 leaning="   " -->',
      "",
      "A blank one.",
      "",
    ].join("\n");
    expect(planning(source).questions.map((q) => q.leaning)).toEqual([
      null,
      null,
    ]);
  });

  it("reads which name declared each question, an `oq` in a run winning", () => {
    // The page stamps `data-vantage-oq` for any run holding an `oq`, as a
    // viewer that drops `question` reads it, and the index says the same.
    const source = [
      "<!-- vantage: oq id=OQ-1 -->",
      "",
      "Open.",
      "",
      "<!-- vantage: question id=OQ-2 -->",
      "",
      "Blocked.",
      "",
      "<!-- vantage: question id=OQ-3 -->",
      '<!-- vantage: oq id=OQ-3 leaning="Mixed." -->',
      "",
      "Both.",
      "",
    ].join("\n");
    expect(
      planning(source).questions.map((q) => [q.id, q.directive, q.leaning]),
    ).toEqual([
      ["OQ-1", "oq", null],
      ["OQ-2", "question", null],
      ["OQ-3", "oq", "Mixed."],
    ]);
  });

  it("reads a leaning off a `question`, in every state", () => {
    for (const marker of ["", "\u{1F4AC} ", "\u{1F512} ", "✅ "]) {
      const source = `<!-- vantage: question id=OQ-1 leaning="Yes." -->\n\n${marker}X.\n`;
      expect(planning(source).questions, marker).toMatchObject([
        { id: "OQ-1", directive: "question", leaning: "Yes." },
      ]);
    }
  });

  it("reads a run holding both names exactly as a viewer before `question` does: the `oq` alone", () => {
    // Whichever comes first. That viewer drops the `question` whole, so a key
    // only the `question` sets applies in no release, and the same bytes file
    // the same Take everywhere.
    for (const run of [
      '<!-- vantage: question id=OQ-3 leaning="Q." -->\n<!-- vantage: oq leaning="O." -->',
      '<!-- vantage: oq leaning="O." -->\n<!-- vantage: question id=OQ-3 leaning="Q." -->',
    ]) {
      expect(planning(`${run}\n\nBoth.\n`).questions, run).toMatchObject([
        { id: null, directive: "oq", leaning: "O." },
      ]);
    }
    expect(
      planning(
        '<!-- vantage: question leaning="Q." -->\n<!-- vantage: oq id=OQ-3 -->\n\nBoth.\n',
      ).questions,
    ).toMatchObject([{ id: "OQ-3", directive: "oq", leaning: null }]);
  });

  it("keeps the id a run declares on more than one of its comments", () => {
    // One run is one declaration, whichever of its comments came first in the
    // document: the anchor is the page's, and both releases render it.
    for (const run of [
      "<!-- vantage: question id=OQ-1 -->\n<!-- vantage: oq id=OQ-1 -->",
      "<!-- vantage: oq id=OQ-1 -->\n<!-- vantage: question id=OQ-1 -->",
      "<!-- vantage: oq id=OQ-1 -->\n<!-- vantage: oq id=OQ-1 -->",
    ]) {
      const doc = planning(`${run}\n\nBoth.\n`);
      expect(
        doc.questions.map((q) => q.id),
        run,
      ).toEqual(["OQ-1"]);
      expect(doc.directiveIds, run).toEqual(["OQ-1"]);
    }
  });

  it("keeps one namespace of ids across `oq` and `question`", () => {
    // The anchor is the same attribute, so a `question` that repeats an
    // `oq`'s id lands nowhere, as a repeated `oq` does.
    const source = [
      "<!-- vantage: oq id=OQ-4 -->",
      "",
      "First.",
      "",
      "<!-- vantage: question id=OQ-4 -->",
      "",
      "Repeated.",
      "",
    ].join("\n");
    expect(planning(source).questions.map((q) => [q.title, q.id])).toEqual([
      ["First.", "OQ-4"],
      ["Repeated.", null],
    ]);
  });

  it("normalizes a leaning exactly as the page stamps it", async () => {
    for (const raw of [
      "Back of\n     the queue —\n  for now",
      `${"a ".repeat(400)}end`,
      "\ttabs\tand  spaces ",
    ]) {
      const { html } = await renderMarkdown(
        `<!-- vantage: oq leaning="${raw}" -->\n\nBody.\n`,
      );
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(normalizeLeaning(raw)).toBe(
        host.querySelector("p")?.getAttribute("data-vantage-leaning"),
      );
    }
  });
});

describe("the header of record (§3.4, Plan Q20)", () => {
  // `status` on line 2 makes each a planning document, since `next` and
  // `depends-on` alone do not (§3.1); the key under test starts on line 3.
  const header = (yaml: string) =>
    planning(`---\nstatus: draft\n${yaml}\n---\n\n# X\n`);

  it("reads a stage as written, trimmed, and remembers its line", () => {
    const doc = header("stage: '  DESIGN  '");
    expect(doc).toMatchObject({ stage: "DESIGN", stageLine: 3 });
    expect(doc.headerProblems).toEqual([]);
  });

  it("keeps a multi-word stage as written, for the vocabulary to reject", () => {
    expect(header("stage: Not Decided").stage).toBe("Not Decided");
  });

  it.each([
    ["a number", "stage: 3"],
    ["a list", "stage: [DESIGN]"],
    ["a table", "stage: { a: b }"],
    ["empty", "stage: ''"],
    ["absent", "stage:"],
  ])("ignores a stage that is %s, and says so", (_, yaml) => {
    const doc = header(yaml);
    expect(doc.stage).toBeNull();
    expect(doc.stageLine).toBeNull();
    expect(doc.headerProblems).toEqual([
      expect.objectContaining({ key: "stage", line: 3 }),
    ]);
  });

  it("reads a YAML date as the text it is to this parser, and a TOML date as a date", () => {
    // The `yaml` parser follows YAML 1.2's core schema, which has no
    // timestamps, so `2026-09-28` is a string there and a stage like any other;
    // the vocabulary is what refuses it. TOML does have dates.
    expect(header("stage: 2026-09-28").stage).toBe("2026-09-28");
    const toml = scanPlanningDocument(
      "docs/x.md",
      '+++\nstatus = "draft"\nstage = 2026-09-28\n+++\n',
      false,
    );
    expect(toml.kind === "planning" && toml.document).toMatchObject({
      stage: null,
      headerProblems: [expect.objectContaining({ key: "stage", line: 3 })],
    });
  });

  it("reads next as one trimmed line, OQ ids and all", () => {
    expect(header('next: " Rule OQ-B2 — the payload waits on it "').next).toBe(
      "Rule OQ-B2 — the payload waits on it",
    );
  });

  it.each([
    ["runs over several lines", "next: |\n  one\n  two"],
    ["is not text", "next: 42"],
  ])("ignores a next that %s, and says so", (_, yaml) => {
    const doc = header(yaml);
    expect(doc.next).toBeNull();
    expect(doc.headerProblems).toEqual([
      expect.objectContaining({ key: "next", line: 3 }),
    ]);
  });

  it("reads a single depends-on path as a one-entry list", () => {
    const doc = header("depends-on: ../gallery/status.md#OQ-3");
    expect(doc.dependsOn).toEqual([
      {
        raw: "../gallery/status.md#OQ-3",
        target: "docs/gallery/status.md",
        fragment: "OQ-3",
        line: 3,
      },
    ]);
    expect(doc.headerProblems).toEqual([]);
  });

  it("drops a depends-on entry that is not a string, at that entry's line", () => {
    const doc = header(
      ["title: x", "depends-on:", "  - a.md", "  - 7", "  - b.md"].join("\n"),
    );
    expect(doc.dependsOn.map((d) => [d.raw, d.line])).toEqual([
      ["a.md", 5],
      ["b.md", 7],
    ]);
    expect(doc.headerProblems).toEqual([
      expect.objectContaining({ key: "depends-on", line: 6 }),
    ]);
  });

  it("keeps a depends-on target outside the repository as no target", () => {
    const doc = header("depends-on:\n  - ../../../elsewhere.md#OQ-1");
    expect(doc.dependsOn).toEqual([
      {
        raw: "../../../elsewhere.md#OQ-1",
        target: null,
        fragment: "OQ-1",
        line: 4,
      },
    ]);
    expect(doc.headerProblems).toEqual([]);
  });

  it("reports a depends-on that is neither a path nor a list", () => {
    const doc = header("depends-on:\n  a: b");
    expect(doc.dependsOn).toEqual([]);
    expect(doc.headerProblems).toEqual([
      expect.objectContaining({ key: "depends-on", line: 3 }),
    ]);
  });

  it("places TOML header keys by their lines", () => {
    const result = scanPlanningDocument(
      "docs/x.md",
      '+++\nstatus = "draft"\nstage = 3\ndepends-on = ["a.md"]\n+++\n\n# X\n',
      false,
    );
    expect(result.kind === "planning" && result.document).toMatchObject({
      stage: null,
      dependsOn: [{ raw: "a.md", target: "docs/a.md", line: 4 }],
      headerProblems: [expect.objectContaining({ key: "stage", line: 3 })],
    });
  });
});

describe("resolveRepoLink", () => {
  it.each([
    ["https://example.com/x.md"],
    ["mailto:someone@example.com"],
    ["file:///etc/passwd"],
    ["//example.com/x.md"],
    ["/docs/x.md"],
    ["../../../x.md"],
  ])("does not resolve %s inside the repository", (href) => {
    expect(resolveRepoLink("docs/design/a.md", href)).toBeNull();
  });

  it.each([
    ["b.md", { path: "docs/design/b.md", fragment: null }],
    ["./b.md#OQ-1", { path: "docs/design/b.md", fragment: "OQ-1" }],
    ["../x/../gallery/c.md", { path: "docs/gallery/c.md", fragment: null }],
    ["../../roadmap.md", { path: "roadmap.md", fragment: null }],
    [
      "my%20doc.md?raw=1#a%20b",
      { path: "docs/design/my doc.md", fragment: "a b" },
    ],
    ["#OQ-2", { path: "docs/design/a.md", fragment: "OQ-2" }],
    ["b.md#", { path: "docs/design/b.md", fragment: null }],
    ["../", { path: "docs", fragment: null }],
  ])("resolves %s", (href, expected) => {
    expect(resolveRepoLink("docs/design/a.md", href)).toEqual(expected);
  });
});
