/**
 * The roadmaps' routing and the planning page's sections
 * (`docs/design/planning-index.md` §6.1, §6.2, §6.4), and Referenced by and
 * its summary line (§7).
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
  roadmapsOf,
  routeQuestions,
  type PlanningConfig,
  type PlanningIndex,
  type PlanningRoadmap,
  type QuestionRef,
} from "vantage-md/planning";
import { indexOf, planningConfig, sourcesOf } from "../test/planning";

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
    expect(routeQuestions(index, "roadmap.md")).toEqual([
      { ...ref(index, "OQ-A2"), heading: "Rule these first" },
      { ...ref(index, "OQ-A1"), heading: "Rule these first" },
      { ...ref(index, "OQ-A3"), heading: "Rule these first" },
      { ...ref(index, "OQ-B1"), heading: "Building" },
    ]);
  });

  it("routes nothing through a heading link, such as a ledger citation (Plan Q12)", () => {
    const index = indexOf(tree);
    expect(
      routeQuestions(index, "roadmap.md").map((q) => q.path),
    ).not.toContain("docs/c.md");
    expect(derivePlanningSections(index).unrouted).toEqual([
      ref(index, "OQ-C1"),
    ]);
  });

  it("routes nothing into a done document", () => {
    const index = indexOf(
      { ...tree, "docs/b.md": doc("stage: GRADUATED", questions("B", OPEN)) },
      STAGES,
    );
    expect(
      routeQuestions(index, "roadmap.md").map((q) => q.path),
    ).not.toContain("docs/b.md");
  });

  // §3.2: a document's links are links to another candidate. The index's
  // JSON leaves a self-link out, so routing on one showed a routed question
  // with no link routing it.
  it("routes nothing through the roadmap's links to itself", () => {
    const index = indexOf({
      "roadmap.md": doc(
        "status: draft",
        [
          "See [below](#OQ-R1) and [the top](roadmap.md).",
          "",
          questions("R", OPEN),
        ].join("\n"),
      ),
    });
    expect(routeQuestions(index, "roadmap.md")).toEqual([]);
    expect(derivePlanningSections(index).unrouted).toEqual([
      ref(index, "OQ-R1"),
    ]);
  });

  it("routes nothing without a roadmap", () => {
    const { "roadmap.md": _roadmap, ...rest } = tree;
    expect(_roadmap).toBeDefined();
    expect(routeQuestions(indexOf(rest), "roadmap.md")).toEqual([]);
  });

  it("routes nothing from a document that is not a roadmap", () => {
    const index = indexOf({ ...tree, "docs/plan.md": tree["roadmap.md"] });
    expect(routeQuestions(index, "docs/plan.md")).toEqual([]);
    expect(
      routeQuestions(indexOf(tree, { roadmaps: [] }), "roadmap.md"),
    ).toEqual([]);
  });
});

describe("which files are roadmaps (§6.1)", () => {
  const ROADMAP = "# Roadmap\n";

  it("finds every roadmap.md by name, in any directory and any ASCII case, in roadmap order", () => {
    const index = indexOf({
      "docs/plans/roadmap.md": ROADMAP,
      "roadmap.md": ROADMAP,
      "docs/Roadmap.md": ROADMAP,
      "a/ROADMAP.md": ROADMAP,
      "my-roadmap.md": ROADMAP,
      "roadmap.md/notes.md": ROADMAP,
    });
    expect(roadmapsOf(index).map((r) => r.path)).toEqual([
      "roadmap.md",
      "a/ROADMAP.md",
      "docs/Roadmap.md",
      "docs/plans/roadmap.md",
    ]);
    // Every roadmap is a planning document, and nothing else here is one.
    expect(index.documents.map((d) => d.path)).toEqual([
      "a/ROADMAP.md",
      "docs/Roadmap.md",
      "docs/plans/roadmap.md",
      "roadmap.md",
    ]);
  });

  it("gives each roadmap found by name its state, and never missing", () => {
    const index = buildPlanningIndex(
      sourcesOf(
        {
          "roadmap.md": `${ROADMAP}\n- [A](docs/a.md)\n`,
          "old/roadmap.md": doc("stage: GRADUATED", "- [A](../docs/a.md)"),
          "bad/roadmap.md": "---\nstatus: [x\n---\n",
          "docs/a.md": doc("status: draft", questions("A", OPEN)),
        },
        { skipped: [{ path: "big/roadmap.md", size: 2_000_000 }] },
        STAGES,
      ),
    );
    expect(roadmapsOf(index)).toEqual([
      { path: "roadmap.md", state: "routes", needsYouCount: 1 },
      { path: "bad/roadmap.md", state: "unreadable", needsYouCount: 0 },
      { path: "big/roadmap.md", state: "skipped", needsYouCount: 0 },
      { path: "old/roadmap.md", state: "done", needsYouCount: 0 },
    ]);
  });

  it("lists exactly the configured paths, in roadmap order whatever order they were written in", () => {
    const index = buildPlanningIndex(
      sourcesOf(
        {
          "roadmap.md": ROADMAP,
          "docs/PLAN.md": ROADMAP,
          "docs/plans/roadmap.md": ROADMAP,
        },
        { unreadable: [{ path: "x/y/z.md", reason: "not UTF-8" }] },
        { roadmaps: ["x/y/z.md", "docs/PLAN.md", "gone.md", "roadmap.md"] },
      ),
    );
    expect(roadmapsOf(index)).toEqual([
      { path: "gone.md", state: "missing", needsYouCount: 0 },
      { path: "roadmap.md", state: "routes", needsYouCount: 0 },
      { path: "docs/PLAN.md", state: "routes", needsYouCount: 0 },
      { path: "x/y/z.md", state: "unreadable", needsYouCount: 0 },
    ]);
    // A roadmap.md the list leaves out is an ordinary document.
    expect(index.documents.map((d) => d.path)).toEqual([
      "docs/PLAN.md",
      "roadmap.md",
    ]);
  });
});

describe("several roadmaps (§6.1, §6.4)", () => {
  // Two roadmaps that route: the root's (the default) and docs/plans/'s. A
  // third is retired by its done stage. Between them:
  //   - OQ-A1 is routed by both, OQ-A2 only by the root's;
  //   - OQ-B1 (open) and OQ-B2 (answered) only by docs/plans/'s, OQ-B3 is
  //     blocked;
  //   - docs/c.md is linked only by the retired roadmap, so OQ-C1 is
  //     unrouted;
  //   - the root's roadmap links docs/plans/'s bare, which routes the one
  //     question written there, OQ-P1, and not what that roadmap routes.
  const tree = {
    "roadmap.md": [
      "# Roadmap",
      "",
      "## Now",
      "",
      "- [A's second](docs/a.md#OQ-A2)",
      "- [A's first](docs/a.md#OQ-A1)",
      "- [The other roadmap](docs/plans/roadmap.md)",
      "",
    ].join("\n"),
    "docs/plans/roadmap.md": [
      "---",
      "status: draft",
      "---",
      "",
      "# Plans",
      "",
      "## Later",
      "",
      "- [B](../b.md)",
      "- [A's first](../a.md#OQ-A1)",
      "",
      questions("P", OPEN),
    ].join("\n"),
    "docs/old/roadmap.md": doc("stage: GRADUATED", "- [C](../c.md)"),
    "docs/a.md": doc("stage: DESIGN", questions("A", OPEN, OPEN)),
    "docs/b.md": doc("stage: DESIGN", questions("B", OPEN, ANSWERED, BLOCKED)),
    "docs/c.md": doc("stage: DESIGN", questions("C", OPEN)),
  };
  const index = indexOf(tree, STAGES);
  const ids = (refs: readonly QuestionRef[] | null) =>
    (refs ?? []).map((r) => r.id);

  it("lists every roadmap with its state and Needs you count", () => {
    expect(derivePlanningSections(index).roadmaps).toEqual([
      { path: "roadmap.md", state: "routes", needsYouCount: 3 },
      { path: "docs/old/roadmap.md", state: "done", needsYouCount: 0 },
      { path: "docs/plans/roadmap.md", state: "routes", needsYouCount: 3 },
    ]);
  });

  it("routes each roadmap in its own order, and never through another roadmap", () => {
    expect(ids(routeQuestions(index, "roadmap.md"))).toEqual([
      "OQ-A2",
      "OQ-A1",
      "OQ-P1",
    ]);
    expect(ids(routeQuestions(index, "docs/plans/roadmap.md"))).toEqual([
      "OQ-B1",
      "OQ-B2",
      "OQ-B3",
      "OQ-A1",
    ]);
    // A done roadmap routes nothing.
    expect(routeQuestions(index, "docs/old/roadmap.md")).toEqual([]);
  });

  it("chooses the roadmap nearest the root by default", () => {
    const sections = derivePlanningSections(index);
    expect(sections.chosenRoadmap).toBe("roadmap.md");
    expect(ids(sections.needsYou)).toEqual(["OQ-A2", "OQ-A1", "OQ-P1"]);
    expect(sections.needsYou[0]?.heading).toBe("Now");
  });

  it("follows the chosen roadmap's order in Needs you", () => {
    const sections = derivePlanningSections(index, {
      roadmap: "docs/plans/roadmap.md",
    });
    expect(sections.chosenRoadmap).toBe("docs/plans/roadmap.md");
    // OQ-B3 is blocked, so it waits instead.
    expect(ids(sections.needsYou)).toEqual(["OQ-B1", "OQ-B2", "OQ-A1"]);
    expect(sections.needsYou.map((q) => q.heading)).toEqual([
      "Later",
      "Later",
      "Later",
    ]);
  });

  it.each([
    ["a done roadmap", "docs/old/roadmap.md"],
    ["a document that is not a roadmap", "docs/a.md"],
    ["a path the index does not hold", "nowhere/roadmap.md"],
    ["null", null],
  ])("falls back to the default when asked for %s", (_, roadmap) => {
    expect(derivePlanningSections(index, { roadmap }).chosenRoadmap).toBe(
      "roadmap.md",
    );
  });

  it("leaves Unrouted only what no roadmap routes", () => {
    for (const roadmap of ["roadmap.md", "docs/plans/roadmap.md"]) {
      expect(ids(derivePlanningSections(index, { roadmap }).unrouted)).toEqual([
        "OQ-C1",
      ]);
    }
  });

  it("lists what only the other roadmaps route, each once, with the first that does", () => {
    expect(derivePlanningSections(index).onOtherRoadmaps).toEqual([
      {
        ...ref(index, "OQ-B1"),
        heading: "Later",
        roadmap: "docs/plans/roadmap.md",
      },
      {
        ...ref(index, "OQ-B2"),
        heading: "Later",
        roadmap: "docs/plans/roadmap.md",
      },
    ]);
    expect(
      derivePlanningSections(index, { roadmap: "docs/plans/roadmap.md" })
        .onOtherRoadmaps,
    ).toEqual([
      { ...ref(index, "OQ-A2"), heading: "Now", roadmap: "roadmap.md" },
      { ...ref(index, "OQ-P1"), heading: "Now", roadmap: "roadmap.md" },
    ]);
  });

  it("names the first roadmap in roadmap order when two others route a question", () => {
    const three = indexOf({
      "roadmap.md": "# Root\n\n- [A](docs/a.md#OQ-A1)\n",
      "x/roadmap.md": "# X\n\n## X\n\n- [B](../docs/b.md)\n",
      "y/roadmap.md": "# Y\n\n## Y\n\n- [B](../docs/b.md)\n",
      "docs/a.md": doc("status: draft", questions("A", OPEN)),
      "docs/b.md": doc("status: draft", questions("B", OPEN)),
    });
    expect(derivePlanningSections(three).onOtherRoadmaps).toEqual([
      { ...ref(three, "OQ-B1"), heading: "X", roadmap: "x/roadmap.md" },
    ]);
  });

  it("counts a roadmap's own questions only when another roadmap links it", () => {
    const alone = indexOf({
      "roadmap.md": "# Root\n",
      "docs/roadmap.md": `# Docs\n\n${questions("D", OPEN)}`,
    });
    // Neither links docs/roadmap.md, and it does not route itself.
    expect(ids(derivePlanningSections(alone).unrouted)).toEqual(["OQ-D1"]);
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
      roadmaps: [{ path: "roadmap.md", state: "routes", needsYouCount: 0 }],
      chosenRoadmap: "roadmap.md",
      stagesDeclared: true,
      nothingNeedsYou: true,
      needsYou: [],
      onOtherRoadmaps: [],
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
    ["missing", {}, {}, []],
    [
      "too large to read",
      { skipped: [{ path: "roadmap.md", size: 2_000_000 }] },
      {},
      [{ path: "roadmap.md", state: "skipped", needsYouCount: 0 }],
    ],
    [
      "unreadable",
      {},
      { "roadmap.md": "---\nstatus: [x\n---\n" },
      [{ path: "roadmap.md", state: "unreadable", needsYouCount: 0 }],
    ],
  ])(
    "lists every open question by document when the roadmap is %s",
    (_, overrides, extra, roadmaps) => {
      const index = buildPlanningIndex(
        sourcesOf({ ...tree, ...extra }, overrides),
      );
      const sections = derivePlanningSections(index);
      expect(sections.roadmaps).toEqual(roadmaps);
      expect(sections.chosenRoadmap).toBeNull();
      expect(sections.unrouted).toBeNull();
      expect(sections.onOtherRoadmaps).toEqual([]);
      expect(sections.needsYou).toEqual([
        { ...ref(index, "OQ-A2"), heading: null },
        { ...ref(index, "OQ-B1"), heading: null },
        { ...ref(index, "OQ-B3"), heading: null },
      ]);
    },
  );

  it("lists every open question when the only roadmap has a done stage", () => {
    const index = indexOf(
      {
        ...tree,
        "roadmap.md": doc("stage: GRADUATED", "- [A](docs/a.md)"),
      },
      STAGES,
    );
    const sections = derivePlanningSections(index);
    expect(sections.roadmaps).toEqual([
      { path: "roadmap.md", state: "done", needsYouCount: 0 },
    ]);
    expect(sections.chosenRoadmap).toBeNull();
    expect(sections.unrouted).toBeNull();
    expect(sections.needsYou.map((q) => q.id)).toEqual([
      "OQ-A2",
      "OQ-B1",
      "OQ-B3",
    ]);
  });

  it("finds none when the list is empty, even with a roadmap.md in the tree", () => {
    const index = indexOf(
      { ...tree, "roadmap.md": "- [A](docs/a.md)\n" },
      { roadmaps: [] },
    );
    const sections = derivePlanningSections(index);
    expect(sections.roadmaps).toEqual([]);
    expect(sections.chosenRoadmap).toBeNull();
    // Not a roadmap, so an ordinary file: it plans nothing.
    expect(index.documents.map((d) => d.path)).not.toContain("roadmap.md");
  });
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
  it("say how to declare stages, and that nothing needs you", () => {
    expect(PLANNING_NOTICES.noStages).toContain("[planning.stages]");
    expect(PLANNING_NOTICES.nothingNeedsYou).toBe("Nothing needs you.");
  });

  it("say how many files there are and to narrow include (§3.5)", () => {
    const text = PLANNING_NOTICES.refused(5001, 5000);
    expect(text).toContain("5,001");
    expect(text).toContain("5,000");
    expect(text).toContain("include");
  });

  it("count the questions that need you on other roadmaps (§6.4)", () => {
    expect(PLANNING_NOTICES.otherRoadmaps(1)).toBe(
      "1 more question needs you on another roadmap.",
    );
    expect(PLANNING_NOTICES.otherRoadmaps(3)).toBe(
      "3 more questions need you on other roadmaps.",
    );
    expect(PLANNING_NOTICES.otherRoadmaps(1200)).toBe(
      "1,200 more questions need you on other roadmaps.",
    );
  });
});

// §6.4's table: the one line says what was looked for, and how to point the
// page at a roadmap.
describe("the roadmap notice (§6.4)", () => {
  const byName = planningConfig();
  const listed = (...roadmaps: string[]) => planningConfig({ roadmaps });
  const roadmap = (
    path: string,
    state: PlanningRoadmap["state"],
    needsYouCount = 0,
  ): PlanningRoadmap => ({ path, state, needsYouCount });
  const MISSING =
    "is missing or not in Vantage's file list (it is not a .md file, or is in a hidden or excluded directory, or matches .vantageignore)";

  it("says no roadmap.md was found, and where one is not read", () => {
    expect(PLANNING_NOTICES.roadmapNotice(byName, [])).toBe(
      "No roadmap: no planning candidate is named roadmap.md, so Needs you lists every open question by document. Add a roadmap.md in any directory, or name one with roadmap under [planning] in .vantage.toml. A roadmap.md in a hidden directory, matched by .vantageignore, or ruled out by include or exclude is not read.",
    );
  });

  it("names each roadmap found and why it does not route", () => {
    expect(
      PLANNING_NOTICES.roadmapNotice(byName, [
        roadmap("docs/roadmap.md", "skipped"),
        roadmap("plans/roadmap.md", "done"),
      ]),
    ).toBe(
      "No roadmap: docs/roadmap.md is larger than max-file-bytes, and plans/roadmap.md has a stage with the done role, so Needs you lists every open question by document. Add a roadmap.md in any directory, or name one with roadmap under [planning] in .vantage.toml. A roadmap.md in a hidden directory, matched by .vantageignore, or ruled out by include or exclude is not read.",
    );
    expect(
      PLANNING_NOTICES.roadmapNotice(byName, [
        roadmap("roadmap.md", "unreadable"),
      ]),
    ).toMatch(/^No roadmap: roadmap\.md could not be read, so Needs you/);
  });

  it("says an empty list names no roadmap, and how to name one", () => {
    expect(PLANNING_NOTICES.roadmapNotice(listed(), [])).toBe(
      "No roadmap: roadmap under [planning] in .vantage.toml is an empty list, so Needs you lists every open question by document. List a roadmap there, or remove roadmap to find every roadmap.md.",
    );
  });

  // The path is right, and finding by name would find the same retired file,
  // so neither correcting it nor removing roadmap would help.
  it("says to change the stage when every roadmap it found is retired by one", () => {
    expect(
      PLANNING_NOTICES.roadmapNotice(listed("roadmap.md"), [
        roadmap("roadmap.md", "done"),
      ]),
    ).toBe(
      "No roadmap: roadmap under [planning] in .vantage.toml lists roadmap.md, which has a stage with the done role, so Needs you lists every open question by document. Give it a stage without the done role, or list another roadmap.",
    );
    expect(
      PLANNING_NOTICES.roadmapNotice(listed("a.md", "b.md"), [
        roadmap("a.md", "done"),
        roadmap("b.md", "done"),
      ]),
    ).toMatch(
      / Give them stages without the done role, or list another roadmap\.$/,
    );
    expect(
      PLANNING_NOTICES.roadmapNotice(byName, [
        roadmap("old/roadmap.md", "done"),
      ]),
    ).toBe(
      "No roadmap: old/roadmap.md has a stage with the done role, so Needs you lists every open question by document. Give it a stage without the done role, add another roadmap.md in any directory, or name one with roadmap under [planning] in .vantage.toml. A roadmap.md in a hidden directory, matched by .vantageignore, or ruled out by include or exclude is not read.",
    );
  });

  it("names each listed roadmap that does not route", () => {
    expect(
      PLANNING_NOTICES.roadmapNotice(listed("plans/roadmap.md"), [
        roadmap("plans/roadmap.md", "missing"),
      ]),
    ).toBe(
      `No roadmap: roadmap under [planning] in .vantage.toml lists plans/roadmap.md, which ${MISSING}, so Needs you lists every open question by document. Correct the path, or remove roadmap to find every roadmap.md.`,
    );
    expect(
      PLANNING_NOTICES.roadmapNotice(listed("a.md", "plans/b.md"), [
        roadmap("a.md", "done"),
        roadmap("plans/b.md", "skipped"),
      ]),
    ).toBe(
      "No roadmap: roadmap under [planning] in .vantage.toml lists a.md, which has a stage with the done role, and plans/b.md, which is larger than max-file-bytes, so Needs you lists every open question by document. Correct the paths, or remove roadmap to find every roadmap.md.",
    );
  });

  it("names a listed roadmap that is not read while another routes", () => {
    expect(
      PLANNING_NOTICES.roadmapNotice(listed("roadmap.md", "plans/b.md"), [
        roadmap("roadmap.md", "routes", 2),
        roadmap("plans/b.md", "missing"),
      ]),
    ).toBe(
      `Not read as a roadmap: plans/b.md, which roadmap under [planning] lists, ${MISSING}.`,
    );
    expect(
      PLANNING_NOTICES.roadmapNotice(listed("roadmap.md", "b.md", "c.md"), [
        roadmap("b.md", "skipped"),
        roadmap("c.md", "unreadable"),
        roadmap("roadmap.md", "routes"),
      ]),
    ).toBe(
      "Not read as a roadmap: b.md, which roadmap under [planning] lists, is larger than max-file-bytes; c.md, which roadmap under [planning] lists, could not be read.",
    );
  });

  // A done stage is a deliberate retirement, and Skipped and Could not read
  // already list a roadmap found by name.
  it("says nothing of a listed done roadmap, or of one found by name, while another routes", () => {
    expect(
      PLANNING_NOTICES.roadmapNotice(listed("roadmap.md", "old.md"), [
        roadmap("old.md", "done"),
        roadmap("roadmap.md", "routes"),
      ]),
    ).toBeNull();
    expect(
      PLANNING_NOTICES.roadmapNotice(byName, [
        roadmap("roadmap.md", "routes"),
        roadmap("docs/roadmap.md", "skipped"),
        roadmap("old/roadmap.md", "unreadable"),
      ]),
    ).toBeNull();
    expect(
      PLANNING_NOTICES.roadmapNotice(byName, [roadmap("roadmap.md", "routes")]),
    ).toBeNull();
  });

  it("is what the page shows for the index's own roadmaps", () => {
    const index = buildPlanningIndex(
      sourcesOf(
        { "roadmap.md": "# Roadmap\n" },
        { skipped: [{ path: "plans/b.md", size: 9 }] },
        { roadmaps: ["roadmap.md", "plans/b.md", "gone.md"] },
      ),
    );
    expect(
      PLANNING_NOTICES.roadmapNotice(index.config, roadmapsOf(index)),
    ).toBe(
      `Not read as a roadmap: gone.md, which roadmap under [planning] lists, ${MISSING}; plans/b.md, which roadmap under [planning] lists, is larger than max-file-bytes.`,
    );
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
    expect(summaryOf(tree, "docs/a.md")).toMatchObject({
      onRoadmaps: [{ roadmap: "roadmap.md", heading: "Building" }],
      roadmaps: ["roadmap.md"],
    });
  });

  it("is routed by a link to one of its questions", () => {
    const roadmap =
      "# Roadmap\n\n## Rule these first\n\n- [one](docs/a.md#OQ-A2)\n";
    const summary = summaryOf({ ...tree, "roadmap.md": roadmap }, "docs/a.md");
    expect(summary.onRoadmaps).toEqual([
      { roadmap: "roadmap.md", heading: "Rule these first" },
    ]);
    // OQ-A1 is still open and unrouted, and the count says so.
    expect(summary.unrouted).toBe(1);
  });

  it("is routed by a bare link above every heading, with no heading to name", () => {
    const summary = summaryOf(
      { ...tree, "roadmap.md": "Start with [a](docs/a.md).\n" },
      "docs/a.md",
    );
    expect(summary.onRoadmaps).toEqual([
      { roadmap: "roadmap.md", heading: null },
    ]);
    expect(summary.unrouted).toBe(0);
  });

  it("routes a document with no questions through a bare link", () => {
    const summary = summaryOf(
      { "docs/a.md": doc("status: draft"), "roadmap.md": "- [a](docs/a.md)\n" },
      "docs/a.md",
    );
    expect(summary.onRoadmaps).toEqual([
      { roadmap: "roadmap.md", heading: null },
    ]);
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
    expect(summary.onRoadmaps).toEqual([]);
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
    expect(summary).toEqual({
      sources: [],
      onRoadmaps: [],
      unrouted: 1,
      roadmaps: ["roadmap.md"],
    });
  });

  it("reports nothing unrouted, and no routing, without a roadmap", () => {
    const noRoadmap = Object.fromEntries(
      Object.entries(tree).filter(([path]) => path !== "roadmap.md"),
    );
    expect(summaryOf(noRoadmap, "docs/a.md")).toMatchObject({
      onRoadmaps: [],
      unrouted: 0,
      roadmaps: [],
    });
  });

  it("takes nothing from a done document (Plan Q11)", () => {
    const done = {
      ...tree,
      "docs/a.md": doc("stage: GRADUATED", questions("A", OPEN)),
    };
    const summary = summaryOf(done, "docs/a.md", STAGES);
    expect(summary.onRoadmaps).toEqual([]);
    expect(summary.unrouted).toBe(0);
    expect(summary.sources).toHaveLength(3);
  });

  it("does not put the roadmap on itself", () => {
    const roadmap = `# Roadmap\n\n## Mine\n\n- [mine](#OQ-R1)\n\n${questions("R", OPEN, OPEN)}`;
    const summary = summaryOf({ "roadmap.md": roadmap }, "roadmap.md");
    // Its own link to OQ-R1 routes nothing (§3.2: a document's links are its
    // links to another candidate), so both are unrouted, as the page says.
    expect(summary).toEqual({
      sources: [],
      onRoadmaps: [],
      unrouted: 2,
      roadmaps: ["roadmap.md"],
    });
  });
});

describe("the Referenced by summary with several roadmaps (§7)", () => {
  const tree = {
    "roadmap.md": "# Root\n\n## Now\n\n- [A's first](docs/a.md#OQ-A1)\n",
    "plans/roadmap.md":
      "# Plans\n\n## Later\n\n- [A](../docs/a.md)\n- [The root](../roadmap.md)\n",
    "docs/z.md": doc("status: draft", "[a](a.md)"),
    "docs/a.md": doc("status: draft", questions("A", OPEN, OPEN, OPEN)),
    "docs/b.md": doc("status: draft", questions("B", OPEN)),
  };
  const index = indexOf(tree);

  it("names every roadmap that routes the document, in roadmap order", () => {
    expect(referenceSummary(index, "docs/a.md")).toEqual({
      sources: [
        expect.objectContaining({ from: "roadmap.md" }),
        expect.objectContaining({ from: "plans/roadmap.md" }),
        expect.objectContaining({ from: "docs/z.md" }),
      ],
      onRoadmaps: [
        { roadmap: "roadmap.md", heading: "Now" },
        { roadmap: "plans/roadmap.md", heading: "Later" },
      ],
      unrouted: 0,
      roadmaps: ["roadmap.md", "plans/roadmap.md"],
    });
  });

  it("counts as unrouted only what no roadmap routes", () => {
    const narrower = indexOf({
      ...tree,
      "plans/roadmap.md": "# Plans\n\n- [A's second](../docs/a.md#OQ-A2)\n",
    });
    expect(referenceSummary(narrower, "docs/a.md")).toMatchObject({
      onRoadmaps: [
        { roadmap: "roadmap.md", heading: "Now" },
        { roadmap: "plans/roadmap.md", heading: "Plans" },
      ],
      unrouted: 1,
    });
    expect(referenceSummary(narrower, "docs/b.md")).toMatchObject({
      onRoadmaps: [],
      unrouted: 1,
      roadmaps: ["roadmap.md", "plans/roadmap.md"],
    });
  });

  it("puts a roadmap on another roadmap that links it, never on itself", () => {
    expect(referenceSummary(index, "roadmap.md")).toMatchObject({
      onRoadmaps: [{ roadmap: "plans/roadmap.md", heading: "Later" }],
    });
    expect(referenceSummary(index, "plans/roadmap.md").onRoadmaps).toEqual([]);
  });

  it("reads the same whichever roadmap the page has chosen", () => {
    // It takes no choice: the page's is never an input.
    expect(referenceSummary.length).toBe(2);
  });
});
