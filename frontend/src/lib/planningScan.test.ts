/**
 * One candidate file, read into what it gives the planning index
 * (`docs/design/planning-index.md` §3.1–§3.3 and §4).
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

/** A loose list item holding one question, in the convention's layout. */
function item(marker: string, id: string, leaning = "Take it."): string {
  return [
    `1. ${marker} **${id}: A question?**`,
    "",
    `   <!-- vantage: oq id=${id} leaning="${leaning}" -->`,
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
    // The wrapped leaning takes two lines in the directive and two in the
    // paragraph, so the first item runs 7–14 and the second 15–19.
    expect(first).toEqual({
      path: "docs/design/x.md",
      id: "OQ-B1",
      state: "open",
      preference: false,
      marker: "\u{1F4AC}",
      title: "OQ-B1: A question?",
      leaning: "Back of the queue.",
      line: 12,
      unitLine: 7,
      block: { startLine: 7, endLine: 19 },
    });
    expect(second).toMatchObject({ id: "OQ-B2", line: 19, unitLine: 15 });
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
      "After.", // 8
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

  it("hosts a question on a blockquote and on a heading", () => {
    const source = [
      '<!-- vantage: oq id=OQ-5 leaning="Quote." -->',
      "",
      "> \u{1F512} A question in a quote.",
      "",
      '<!-- vantage: oq id=OQ-6 leaning="Heading." -->',
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

describe("the header of record (§4, Plan Q20)", () => {
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
