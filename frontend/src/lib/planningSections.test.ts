/**
 * The roadmap's routing and the planning page's sections
 * (`docs/design/planning-index.md` §6.1, §6.2), and Referenced by and its
 * summary line (§7).
 *
 * These are the derivations the page, `vantage-check index` and the checker's
 * planning rules all share, so what is proved here is what all three show.
 */
import { describe, expect, it } from "vitest";
import {
  PLANNING_NOTICES,
  buildPlanningIndex,
  derivePlanningSections,
  questionFor,
  referenceSummary,
  referencedBy,
  routeQuestions,
  type PlanningConfig,
  type PlanningIndex,
  type QuestionRef,
} from "vantage-md/planning";
import { indexOf, sourcesOf } from "../test/planning";

/** A loose list of questions, `OQ-<prefix>1`, `OQ-<prefix>2`, …, one per marker. */
function questions(prefix: string, ...markers: string[]): string {
  return markers
    .map((marker, i) =>
      [
        `1. ${marker} **OQ-${prefix}${i + 1}: Question ${i + 1}?**`,
        "",
        `   <!-- vantage: oq id=OQ-${prefix}${i + 1} leaning="Yes." -->`,
        "",
        "   _Leaning:_ yes.",
        "",
      ].join("\n"),
    )
    .join("\n");
}

const doc = (header: string, body = "") =>
  `---\n${header}\n---\n\n# Title\n\n${body}\n`;

const OPEN = "\u{1F4AC}";
const BLOCKED = "\u{1F512}";
const ANSWERED = "✅";

const STAGES: Partial<PlanningConfig> = {
  stages: {
    SKETCH: "open",
    DESIGN: "open",
    DECIDED: "ready",
    BUILT: "built",
    GRADUATED: "done",
  },
};

/** The reference to the question carrying `id`, read back from the index. */
function ref(index: PlanningIndex, id: string): QuestionRef {
  for (const doc of index.documents) {
    const q = doc.questions.find((question) => question.id === id);
    if (q !== undefined) return { path: q.path, id, line: q.line };
  }
  throw new Error(`no question ${id}`);
}

describe("routing (§6.1)", () => {
  const tree = {
    "roadmap.md": [
      "# Roadmap",
      "",
      "## Rule these first",
      "",
      "1. [Its second question](docs/a.md#OQ-A2) — the one that blocks.",
      "1. [The rest of it](docs/a.md), in its own order.",
      "",
      "## Building",
      "",
      "- [The whole of b](docs/b.md).",
      "- [c's ledger](docs/c.md#decision-ledger), cited, not routed.",
      "- [A plain page](docs/plain.md) routes nothing.",
      "",
    ].join("\n"),
    "docs/a.md": doc("status: draft", questions("A", OPEN, OPEN, OPEN)),
    "docs/b.md": doc("status: draft", questions("B", OPEN)),
    "docs/c.md": doc("status: draft", questions("C", OPEN)),
    "docs/plain.md": "# Plain\n",
  };

  it("routes a question link, then a bare document link, keeping a question's first position", () => {
    const index = indexOf(tree);
    expect(routeQuestions(index)).toEqual([
      { ...ref(index, "OQ-A2"), heading: "Rule these first" },
      { ...ref(index, "OQ-A1"), heading: "Rule these first" },
      { ...ref(index, "OQ-A3"), heading: "Rule these first" },
      { ...ref(index, "OQ-B1"), heading: "Building" },
    ]);
  });

  it("routes nothing through a heading link, such as a ledger citation (Plan Q12)", () => {
    const index = indexOf(tree);
    expect(routeQuestions(index).map((q) => q.path)).not.toContain("docs/c.md");
    expect(derivePlanningSections(index).unrouted).toEqual([
      ref(index, "OQ-C1"),
    ]);
  });

  it("routes nothing into a done document", () => {
    const index = indexOf(
      { ...tree, "docs/b.md": doc("stage: GRADUATED", questions("B", OPEN)) },
      STAGES,
    );
    expect(routeQuestions(index).map((q) => q.path)).not.toContain("docs/b.md");
  });

  it("routes nothing without a roadmap", () => {
    const { "roadmap.md": _roadmap, ...rest } = tree;
    expect(_roadmap).toBeDefined();
    expect(routeQuestions(indexOf(rest))).toEqual([]);
  });
});

describe("the sections (§6.2)", () => {
  const tree = {
    "roadmap.md": [
      "# Roadmap",
      "",
      "- [Answered, awaiting compaction](docs/answered.md#OQ-N1)",
      "- [Open, routed](docs/design.md#OQ-D1)",
      "- [Blocked, routed](docs/design.md#OQ-D2)",
      "",
    ].join("\n"),
    "docs/answered.md": doc("stage: DESIGN", questions("N", ANSWERED)),
    "docs/design.md": doc(
      "stage: DESIGN\ndepends-on:\n  - waits-on.md#OQ-W1\n  - ruled.md#OQ-R1\n  - done.md\n  - ../../outside.md",
      questions("D", OPEN, BLOCKED, OPEN),
    ),
    "docs/waits-on.md": doc("stage: SKETCH", questions("W", OPEN)),
    "docs/ruled.md": doc("stage: SKETCH", questions("R", BLOCKED)),
    "docs/done.md": doc("stage: GRADUATED", questions("G", OPEN, BLOCKED)),
    "docs/ready.md": doc("stage: DECIDED", questions("Y", BLOCKED)),
    "docs/built.md": doc("stage: BUILT"),
    "docs/built-open.md": doc("stage: BUILT", questions("BO", OPEN)),
    "docs/ready-open.md": doc("stage: DECIDED", questions("RO", OPEN)),
    "docs/unstaged.md": doc("status: draft", questions("U", OPEN)),
  };
  const index = indexOf(tree, STAGES);
  const sections = derivePlanningSections(index);

  it("lists routed open and answered questions under Needs you, in roadmap order", () => {
    expect(sections.needsYou).toEqual([
      { ...ref(index, "OQ-N1"), heading: "Roadmap" },
      { ...ref(index, "OQ-D1"), heading: "Roadmap" },
    ]);
  });

  it("lists open questions the roadmap does not route, by path, then line", () => {
    expect(sections.unrouted?.map((q) => q.id)).toEqual([
      "OQ-BO1",
      "OQ-D3",
      "OQ-RO1",
      "OQ-U1",
      "OQ-W1",
    ]);
  });

  it("lists blocked questions and waiting documents under Waiting, by path", () => {
    expect(sections.waiting).toEqual([
      {
        kind: "document",
        path: "docs/design.md",
        waitingOn: [
          expect.objectContaining({
            target: "docs/waits-on.md",
            fragment: "OQ-W1",
          }),
        ],
      },
      { kind: "question", question: ref(index, "OQ-D2") },
      { kind: "question", question: ref(index, "OQ-Y1") },
      { kind: "question", question: ref(index, "OQ-R1") },
    ]);
  });

  it("does not wait on a blocked question, a done document, or a target outside the repository", () => {
    // `ruled.md#OQ-R1` is blocked, not open (Plan Q6); `done.md` has an open
    // question, but a done document never holds anything up (Plan Q11).
    const [entry] = sections.waiting;
    expect(entry?.kind === "document" && entry.waitingOn).toHaveLength(1);
  });

  it("sorts documents into Ready, Graduate and Disagrees by role", () => {
    expect(sections.ready).toEqual(["docs/ready.md"]);
    expect(sections.graduate).toEqual(["docs/built.md"]);
    expect(sections.disagrees).toEqual([
      "docs/built-open.md",
      "docs/ready-open.md",
    ]);
  });

  it("leaves a done document out of every section, and out of Nothing needs you", () => {
    const text = JSON.stringify(sections);
    expect(text).not.toContain("docs/done.md");
    const onlyDone = derivePlanningSections(
      indexOf(
        {
          "roadmap.md": "# Roadmap\n\n- [Done](docs/done.md)\n",
          "docs/done.md": tree["docs/done.md"],
        },
        STAGES,
      ),
    );
    expect(onlyDone).toMatchObject({
      nothingNeedsYou: true,
      needsYou: [],
      unrouted: [],
      waiting: [],
    });
  });

  it("says Nothing needs you beside a Needs you holding only answered questions", () => {
    const answered = derivePlanningSections(
      indexOf(
        {
          "roadmap.md": tree["roadmap.md"],
          "docs/answered.md": tree["docs/answered.md"],
        },
        STAGES,
      ),
    );
    expect(answered.nothingNeedsYou).toBe(true);
    expect(answered.needsYou.map((q) => q.id)).toEqual(["OQ-N1"]);
    expect(sections.nothingNeedsYou).toBe(false);
  });

  it("gives empty sections as empty lists, which the page hides", () => {
    const empty = derivePlanningSections(
      indexOf({ "roadmap.md": "# Roadmap\n" }, STAGES),
    );
    expect(empty).toEqual({
      roadmap: { path: "roadmap.md", present: true },
      stagesDeclared: true,
      nothingNeedsYou: true,
      needsYou: [],
      unrouted: [],
      waiting: [],
      ready: [],
      graduate: [],
      disagrees: [],
      skipped: [],
      unreadable: [],
    });
  });

  it("drops the three stage sections when no stages are declared", () => {
    const unstaged = derivePlanningSections(indexOf(tree));
    expect(unstaged).toMatchObject({
      stagesDeclared: false,
      ready: null,
      graduate: null,
      disagrees: null,
    });
    // With no roles, nothing is done, so every document counts.
    expect(unstaged.unrouted?.map((q) => q.path)).toContain("docs/done.md");
  });

  it("carries Skipped and Could not read through", () => {
    const skipped = [{ path: "docs/huge.md", size: 2_000_000 }];
    const unreadable = [{ path: "docs/latin1.md", reason: "not UTF-8" }];
    const index = buildPlanningIndex(sourcesOf(tree, { skipped, unreadable }));
    expect(derivePlanningSections(index)).toMatchObject({
      skipped,
      unreadable,
    });
  });
});

describe("without a roadmap (§6.2)", () => {
  const tree = {
    "docs/b.md": doc("status: draft", questions("B", OPEN, ANSWERED, OPEN)),
    "docs/a.md": doc("status: draft", questions("A", BLOCKED, OPEN)),
  };

  it.each([
    ["missing", {}, {}],
    [
      "too large to read",
      { skipped: [{ path: "roadmap.md", size: 2_000_000 }] },
      {},
    ],
    ["unreadable", {}, { "roadmap.md": "---\nstatus: [x\n---\n" }],
  ])(
    "lists every open question by document when the roadmap is %s",
    (_, overrides, extra) => {
      const index = buildPlanningIndex(
        sourcesOf({ ...tree, ...extra }, overrides),
      );
      const sections = derivePlanningSections(index);
      expect(sections.roadmap).toEqual({ path: "roadmap.md", present: false });
      expect(sections.unrouted).toBeNull();
      expect(sections.needsYou).toEqual([
        { ...ref(index, "OQ-A2"), heading: null },
        { ...ref(index, "OQ-B1"), heading: null },
        { ...ref(index, "OQ-B3"), heading: null },
      ]);
    },
  );
});

describe("questionFor", () => {
  const index = indexOf({
    "docs/a.md": doc("status: draft", questions("A", OPEN, OPEN)),
  });

  it("finds the question a reference names", () => {
    expect(questionFor(index, ref(index, "OQ-A2"))).toMatchObject({
      id: "OQ-A2",
      state: "open",
    });
  });

  it("misses a reference the index has moved past", () => {
    const second = ref(index, "OQ-A2");
    expect(questionFor(index, { ...second, id: "OQ-A1" })).toBeUndefined();
    expect(
      questionFor(index, { ...second, path: "docs/z.md" }),
    ).toBeUndefined();
  });
});

describe("the notices", () => {
  it("say which file would be the roadmap, and how to declare stages", () => {
    expect(PLANNING_NOTICES.noRoadmap("plans/ROADMAP.md")).toContain(
      "plans/ROADMAP.md",
    );
    expect(PLANNING_NOTICES.noStages).toContain("[planning.stages]");
    expect(PLANNING_NOTICES.nothingNeedsYou).toBe("Nothing needs you.");
  });

  it("say how many files there are and to narrow include (§3.5)", () => {
    const text = PLANNING_NOTICES.refused(5001, 5000);
    expect(text).toContain("5,001");
    expect(text).toContain("5,000");
    expect(text).toContain("include");
  });
});

describe("Referenced by (§7)", () => {
  const tree = {
    "roadmap.md": [
      "# Roadmap",
      "",
      "## Rule these first",
      "",
      "- [a](docs/a.md#OQ-A1) and [again](docs/a.md) under one heading.",
      "",
      "## Later",
      "",
      "- [a](docs/a.md), under another.",
      "",
    ].join("\n"),
    "docs/a.md": doc(
      "status: draft",
      `[myself](#OQ-A1) and [me](a.md) are not references.\n\n${questions("A", OPEN)}`,
    ),
    "docs/b.md": doc("status: draft", "Before any heading, [a](a.md)."),
    "docs/plain.md": "# Plain\n\n[a](a.md) from a page that plans nothing.\n",
  };

  it("names each linking document and the heading its link sits under", () => {
    expect(referencedBy(indexOf(tree), "docs/a.md")).toEqual([
      { from: "docs/b.md", heading: "Title", line: 7 },
      { from: "roadmap.md", heading: "Rule these first", line: 5 },
      { from: "roadmap.md", heading: "Later", line: 9 },
    ]);
  });

  it("is empty for a document nothing links to", () => {
    expect(referencedBy(indexOf(tree), "docs/b.md")).toEqual([]);
  });
});

describe("the Referenced by summary (§7)", () => {
  const summaryOf = (
    tree: Record<string, string>,
    path: string,
    config: Partial<PlanningConfig> = {},
  ) => referenceSummary(indexOf(tree, config), path);

  // docs/a.md's links, as its sources write them: the roadmap under two
  // headings, docs/b.md above every heading and then twice under one, and
  // docs/c.md once.
  const A = doc("status: draft", questions("A", OPEN, OPEN));
  const tree = {
    "docs/a.md": A,
    "docs/b.md": [
      "---",
      "status: draft",
      "---",
      "",
      "Before any heading, [a](a.md).",
      "",
      "## Uses",
      "",
      "[a](a.md) and [its question](a.md#OQ-A1).",
      "",
      "## Again",
      "",
      "[a](a.md)",
      "",
      "## Uses",
      "",
      "[a, under a repeated heading](a.md)",
      "",
    ].join("\n"),
    "docs/c.md": doc("status: draft", "[a](a.md)"),
    "roadmap.md": [
      "# Roadmap",
      "",
      "## Compacted",
      "",
      "- [the ledger](docs/a.md#decision-ledger)",
      "",
      "## Building",
      "",
      "- [a](docs/a.md)",
      "",
    ].join("\n"),
  };

  it("groups the references by source, the roadmap first, then by path", () => {
    const { sources } = summaryOf(tree, "docs/a.md");
    expect(sources.map((s) => s.from)).toEqual([
      "roadmap.md",
      "docs/b.md",
      "docs/c.md",
    ]);
    // Deduplicated by heading, in document order; before any heading is `null`.
    expect(sources[1]).toEqual({
      from: "docs/b.md",
      references: [
        { from: "docs/b.md", heading: null, line: 5 },
        { from: "docs/b.md", heading: "Uses", line: 9 },
        { from: "docs/b.md", heading: "Again", line: 13 },
      ],
    });
    expect(sources[0]?.references.map((r) => r.heading)).toEqual([
      "Compacted",
      "Building",
    ]);
  });

  it("names the heading of the first roadmap link that routes the document", () => {
    // The ledger link comes first but routes nothing (§6.1, Plan Q12).
    expect(summaryOf(tree, "docs/a.md").onRoadmap).toEqual({
      heading: "Building",
    });
  });

  it("is routed by a link to one of its questions", () => {
    const roadmap =
      "# Roadmap\n\n## Rule these first\n\n- [one](docs/a.md#OQ-A2)\n";
    const summary = summaryOf({ ...tree, "roadmap.md": roadmap }, "docs/a.md");
    expect(summary.onRoadmap).toEqual({ heading: "Rule these first" });
    // OQ-A1 is still open and unrouted, and the count says so.
    expect(summary.unrouted).toBe(1);
  });

  it("is routed by a bare link above every heading, with no heading to name", () => {
    const summary = summaryOf(
      { ...tree, "roadmap.md": "Start with [a](docs/a.md).\n" },
      "docs/a.md",
    );
    expect(summary.onRoadmap).toEqual({ heading: null });
    expect(summary.unrouted).toBe(0);
  });

  it("routes a document with no questions through a bare link", () => {
    const summary = summaryOf(
      { "docs/a.md": doc("status: draft"), "roadmap.md": "- [a](docs/a.md)\n" },
      "docs/a.md",
    );
    expect(summary.onRoadmap).toEqual({ heading: null });
  });

  it("is not routed by a heading link, nor by a link to an id no question carries", () => {
    const roadmap = [
      "## Here",
      "",
      "- [ledger](docs/a.md#decision-ledger)",
      "- [ruled](docs/a.md#OQ-A9)",
      "",
    ].join("\n");
    const summary = summaryOf({ ...tree, "roadmap.md": roadmap }, "docs/a.md");
    expect(summary.onRoadmap).toBeNull();
    expect(summary.unrouted).toBe(2);
    // The roadmap still links here, so it is still a source, and still first.
    expect(summary.sources[0]?.from).toBe("roadmap.md");
  });

  it("counts open questions only as unrouted", () => {
    const summary = summaryOf(
      {
        "docs/a.md": doc(
          "status: draft",
          questions("A", OPEN, BLOCKED, ANSWERED),
        ),
        "roadmap.md": "# Roadmap\n",
      },
      "docs/a.md",
    );
    expect(summary).toEqual({ sources: [], onRoadmap: null, unrouted: 1 });
  });

  it("reports nothing unrouted, and no routing, without a roadmap", () => {
    const noRoadmap = Object.fromEntries(
      Object.entries(tree).filter(([path]) => path !== "roadmap.md"),
    );
    expect(summaryOf(noRoadmap, "docs/a.md")).toMatchObject({
      onRoadmap: null,
      unrouted: 0,
    });
  });

  it("takes nothing from a done document (Plan Q11)", () => {
    const done = {
      ...tree,
      "docs/a.md": doc("stage: GRADUATED", questions("A", OPEN)),
    };
    const summary = summaryOf(done, "docs/a.md", STAGES);
    expect(summary.onRoadmap).toBeNull();
    expect(summary.unrouted).toBe(0);
    expect(summary.sources).toHaveLength(3);
  });

  it("does not put the roadmap on itself", () => {
    const roadmap = `# Roadmap\n\n## Mine\n\n- [mine](#OQ-R1)\n\n${questions("R", OPEN, OPEN)}`;
    const summary = summaryOf({ "roadmap.md": roadmap }, "roadmap.md");
    // Its own link routes OQ-R1, so only OQ-R2 is unrouted, as the page says.
    expect(summary).toEqual({ sources: [], onRoadmap: null, unrouted: 1 });
  });
});
