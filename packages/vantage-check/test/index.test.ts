import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { INDEX_FORMAT_VERSION } from "../src/commands/index.js";
import { parseConfig } from "../src/core/config.js";
import { EXIT_ENVIRONMENT, EXIT_OK, EXIT_USAGE } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { VERSION } from "../src/version.js";
import {
  PLANNING_NOTICES,
  PLANNING_SECTION_GUIDE,
  buildPlanningIndex,
  derivePlanningSections,
  planningAgentRequest,
  planningSectionGuide,
  type PlanningIndex,
  type PlanningSources,
} from "../../vantage-md/src/planning/index.js";
import { makeTree } from "./helpers.js";
import {
  FULL_TOML,
  FULL_TREE,
  OPEN,
  STAGES_TOML,
  doc,
  fullTree,
  questions,
} from "./planningTree.js";

/**
 * `vantage-check index` (`docs/reference/planning-index.md` §13): the planning
 * page's sections as text or JSON, for the project the working directory is
 * in. The sections are vantage-md's derivations, so what these tests prove is
 * that the command feeds them the tree the server would, and prints what they
 * return.
 */

async function index(cwd: string, ...args: string[]) {
  const io = bufferIo(cwd);
  const code = await run(["index", ...args], io);
  return { code, stdout: io.stdout, stderr: io.stderr };
}

async function indexJson(cwd: string, ...args: string[]) {
  const result = await index(cwd, "--format", "json", ...args);
  return { ...result, payload: JSON.parse(result.stdout) };
}

/**
 * The batch the server would send for `FULL_TREE`, written out by hand rather
 * than by the walk under test: every candidate but the three the page lists
 * apart, with the size and reason each of those gets.
 */
function fullSources(): PlanningSources {
  const readable = [
    "README.md",
    "docs/a.md",
    "docs/b.md",
    "docs/broken.md",
    "docs/c.md",
    "docs/d.md",
    "docs/e.md",
    "docs/old.md",
    "roadmap.md",
  ];
  return {
    config: parseConfig(FULL_TOML).planning,
    candidateCount: readable.length + 2,
    refused: false,
    files: readable.map((path) => ({
      path,
      content: FULL_TREE[path] as string,
    })),
    skipped: [
      {
        path: "docs/huge.md",
        size: Buffer.byteLength(FULL_TREE["docs/huge.md"] as string),
      },
    ],
    unreadable: [{ path: "docs/latin1.md", reason: "not UTF-8" }],
  };
}

describe("index, as text", () => {
  // The golden: every section, in page order, then the roadmap with its
  // badges. The layout is the command's own; the sections are the page's.
  it("prints the page's sections, then the roadmap with its badges", async () => {
    const { code, stdout, stderr } = await index(fullTree());

    expect(code).toBe(EXIT_OK);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        "Needs you (3) · for the human",
        "Open or answered questions on this roadmap, in its order. Rule each open one, then Copy answers.",
        "  docs/a.md:8  💬 OQ-A1: Question A1?  (Rule these first)",
        "  docs/b.md:8  ✅ OQ-B1: Question B1?  (Rule these first)",
        "  docs/b.md:14  💬 🤷 OQ-B2: Question B2?  (Rule these first)",
        "",
        "Not on a roadmap (2)",
        "Open questions no roadmap links to. An agent proposes where each goes; you confirm.",
        "  docs/a.md:14  💬 OQ-A2: Question A2?",
        "  docs/e.md:8  💬 OQ-E1: Question E1?",
        "",
        "Blocked (2)",
        "Waiting on a question, a document or an outside event. Nothing to do here.",
        "  docs/a.md:20  🔒 OQ-A3: Question A3?",
        "  docs/c.md  blocked on docs/a.md#OQ-A2",
        "",
        "Ready to build (1)",
        "Decided, with no open questions. An agent builds it.",
        "  docs/c.md  [accepted · DECIDED]",
        "",
        "Ready to graduate (1)",
        "Built, with no questions left. An agent turns it into a reference doc.",
        "  docs/d.md  [accepted · BUILT]",
        "",
        "Stage conflict (1)",
        "The stage says ready or built, but questions are open. An agent finds which is wrong.",
        "  docs/e.md  [accepted · BUILT · 💬 1]",
        "",
        "Too large (1) · for the human",
        "Over max-file-bytes ([planning] in .vantage.toml), so not scanned. Raise the limit or exclude the file.",
        "  docs/huge.md  5,033 bytes, over max-file-bytes (4,096 bytes)",
        "",
        "Unreadable (2) · for the human",
        "Could not be read. Fix or exclude the file.",
        "  docs/broken.md  the frontmatter does not parse: Flow sequence in block collection must be sufficiently indented and end with a ] at line 1, column 10:",
        "  docs/latin1.md  not UTF-8",
        "",
        "Agent requests: vantage-check index --request",
        "",
        "Roadmap: roadmap.md",
        "",
        "# Roadmap",
        "",
        "## Rule these first",
        "",
        "- [A's first question](docs/a.md#OQ-A1) [💬 open]: it gates the rest.",
        "- [B, all of it](docs/b.md) [draft · DESIGN · 💬 1]: small.",
        "",
        "## Later",
        "",
        "- [C's ledger](docs/c.md#decision-ledger) [accepted · DECIDED] routes nothing.",
        "- [A compacted one](docs/a.md#OQ-A9) [⚠ not found] is not found.",
        "- [The readme](README.md) is not a planning document.",
        "",
      ].join("\n"),
    );
  });

  it("says so where the page would: nothing needs you, no roadmap, no stages", async () => {
    const root = makeTree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "docs/a.md": doc("status: draft", questions("A", "✅")),
    });
    const { code, stdout } = await index(root);

    expect(code).toBe(EXIT_OK);
    expect(stdout).toBe(
      [
        PLANNING_NOTICES.nothingNeedsYou,
        "No roadmap: no planning candidate is named roadmap.md, so Needs you lists every open question by document. Add a roadmap.md in any directory, or name one with roadmap under [planning] in .vantage.toml. A roadmap.md in a hidden directory, matched by .vantageignore, or ruled out by include or exclude is not read.",
        "",
        PLANNING_NOTICES.noStages,
        "",
      ].join("\n"),
    );
  });

  // An upgrade: `roadmap = "roadmap.md"` routed before a done stage did
  // anything to a roadmap. The path is right, and finding by name would find
  // the same file, so the notice says to change the stage instead.
  it("says to change the stage when the one listed roadmap is retired by it", async () => {
    const root = makeTree({
      ".git/HEAD": "",
      ".vantage.toml": `[planning]\nroadmap = "roadmap.md"\n\n${STAGES_TOML}`,
      "roadmap.md": doc("stage: RETIRED", "- [A](a.md)"),
      "a.md": doc("status: draft\nstage: DESIGN", questions("A", OPEN)),
    });
    const { code, stdout } = await index(root);

    expect(code).toBe(EXIT_OK);
    expect(stdout.split("\n")[0]).toBe(
      "No roadmap: roadmap under [planning] in .vantage.toml lists roadmap.md, which has a stage with the done role, so Needs you lists every open question by document. Give it a stage without the done role, or list another roadmap.",
    );
  });

  it("lists every open question under Needs you when there is no roadmap, and says so", async () => {
    const root = makeTree({
      ".git/HEAD": "",
      "b.md": doc("status: draft", questions("B", "💬")),
      "a.md": doc("status: draft", questions("A", "💬", "✅")),
    });
    const { stdout } = await index(root);

    expect(stdout).toContain(
      [
        "Needs you (2) · for the human",
        "Open questions, by document. Rule each, then Copy answers.",
        "  a.md:7  💬 OQ-A1: Question A1?",
        "  b.md:7  💬 OQ-B1: Question B1?",
      ].join("\n"),
    );
    expect(stdout).not.toContain("Not on a roadmap");
    // Nothing for an agent, so no pointer to --request.
    expect(stdout).not.toContain("--request");
  });

  // ✅ questions await compaction rather than a ruling, so the page can say
  // both at once (§6.2).
  it("says nothing needs you above a Needs you holding only answered questions", async () => {
    const root = makeTree({
      ".git/HEAD": "",
      "roadmap.md": "# Roadmap\n\n- [A](a.md)\n",
      "a.md": doc("status: draft", questions("A", "✅")),
    });
    const { stdout } = await index(root);

    const head = [
      PLANNING_NOTICES.nothingNeedsYou,
      "",
      "Needs you (1) · for the human",
      PLANNING_SECTION_GUIDE["needs-you"].explanation,
      "  a.md:7  ✅ OQ-A1: Question A1?  (Roadmap)",
      "",
    ].join("\n");
    expect(stdout.slice(0, head.length)).toBe(head);
    expect(stdout).toContain("- [A](a.md) [draft]\n");
  });
});

describe("index, as JSON", () => {
  it("carries the tool, the format version and the project root", async () => {
    const root = fullTree();
    const { code, payload } = await indexJson(root);

    expect(code).toBe(EXIT_OK);
    expect(Object.keys(payload)).toEqual([
      "tool",
      "toolVersion",
      "version",
      "root",
      "index",
      "sections",
      "sectionGuide",
      "roadmaps",
    ]);
    expect(payload.tool).toBe("vantage-check");
    // Two meanings of "version": `check`'s JSON holds the tool's there, and
    // this one the format's, with the tool's under its own name.
    expect(payload.toolVersion).toBe(VERSION);
    expect(payload.version).toBe(INDEX_FORMAT_VERSION);
    // Version 2: `sections.roadmap` and the top-level `roadmap` are gone, for
    // `sections.roadmaps` and a top-level `roadmaps` (§13).
    expect(payload.version).toBe(2);
    expect(payload.root).toBe(root);
  });

  // P7: the gate and the page cannot disagree, because both are these
  // derivations over the same batch.
  it("prints sections deep-equal to derivePlanningSections over the same tree", async () => {
    const { payload } = await indexJson(fullTree());
    const expected = derivePlanningSections(buildPlanningIndex(fullSources()));

    expect(payload.sections).toEqual(expected);
  });

  it("prints the index itself, each document's links narrowed to other candidates", async () => {
    const { payload } = await indexJson(fullTree());
    const built = buildPlanningIndex(fullSources());
    const withoutLinks = (index: PlanningIndex) => ({
      ...index,
      documents: index.documents.map((d) => ({ ...d, links: [] })),
    });

    expect(withoutLinks(payload.index)).toEqual(withoutLinks(built));
    // docs/a.md links README.md (a candidate), an excluded draft, a file
    // under node_modules (never listed) and itself; only the first is a link
    // in §3.2's sense.
    const links = Object.fromEntries(
      (payload.index as PlanningIndex).documents.map((d) => [
        d.path,
        d.links.map((l) => `${l.target}${l.fragment ? `#${l.fragment}` : ""}`),
      ]),
    );
    expect(links["docs/a.md"]).toEqual(["README.md"]);
    expect(links["roadmap.md"]).toEqual([
      "docs/a.md#OQ-A1",
      "docs/b.md",
      "docs/c.md#decision-ledger",
      "docs/a.md#OQ-A9",
      "README.md",
    ]);
  });

  it("lists the roadmap's links with the badge each carries", async () => {
    const { payload } = await indexJson(fullTree());

    expect(payload.roadmaps).toHaveLength(1);
    expect(payload.roadmaps[0]).toMatchObject({
      path: "roadmap.md",
      state: "routes",
      chosen: true,
    });
    expect(
      payload.roadmaps[0].links.map(
        (l: { line: number; target: string; badgeText: string | null }) => [
          l.line,
          l.target,
          l.badgeText,
        ],
      ),
    ).toEqual([
      [5, "docs/a.md", "💬 open"],
      [6, "docs/b.md", "draft · DESIGN · 💬 1"],
      [10, "docs/c.md", "accepted · DECIDED"],
      [11, "docs/a.md", "⚠ not found"],
      [12, "README.md", null],
    ]);
    expect(payload.roadmaps[0].links[0]).toEqual({
      line: 5,
      target: "docs/a.md",
      fragment: "OQ-A1",
      badge: {
        kind: "question",
        path: "docs/a.md",
        id: "OQ-A1",
        state: "open",
      },
      badgeText: "💬 open",
    });
  });

  // The page's headings and explanation lines, for a consumer that renders
  // the sections itself. A key of its own, so `sections` is untouched.
  it("carries each section's title, explanation and actor, in page order", async () => {
    const { payload } = await indexJson(fullTree());

    expect(payload.sectionGuide).toEqual(
      planningSectionGuide(payload.sections),
    );
    expect(
      payload.sectionGuide.map(
        (g: { id: string; key: string; title: string; actor: string }) => [
          g.id,
          g.key,
          g.title,
          g.actor,
        ],
      ),
    ).toEqual([
      ["needs-you", "needsYou", "Needs you", "you"],
      ["unrouted", "unrouted", "Not on a roadmap", "agent"],
      ["waiting", "waiting", "Blocked", "nobody"],
      ["ready", "ready", "Ready to build", "agent"],
      ["graduate", "graduate", "Ready to graduate", "agent"],
      ["disagrees", "disagrees", "Stage conflict", "agent"],
      ["skipped", "skipped", "Too large", "you"],
      ["could-not-read", "unreadable", "Unreadable", "you"],
    ]);
    // Every `key` names a field `sections` holds.
    for (const { key } of payload.sectionGuide) {
      expect(payload.sections).toHaveProperty(key);
    }
    expect(payload.sectionGuide[1].explanation).toBe(
      "Open questions no roadmap links to. An agent proposes where each goes; you confirm.",
    );
  });

  it("lists Too large and Unreadable", async () => {
    const { payload } = await indexJson(fullTree());

    expect(payload.sections.skipped).toEqual([
      { path: "docs/huge.md", size: 5033 },
    ]);
    expect(
      payload.sections.unreadable.map((u: { path: string }) => u.path),
    ).toEqual(["docs/broken.md", "docs/latin1.md"]);
    expect(payload.index.skipped).toEqual(payload.sections.skipped);
  });

  it("has empty roadmap lists when there is no roadmap", async () => {
    const root = makeTree({ ".git/HEAD": "", "a.md": doc("status: draft") });
    const { payload } = await indexJson(root);

    expect(payload.sections.roadmaps).toEqual([]);
    expect(payload.sections.chosenRoadmap).toBeNull();
    expect(payload.roadmaps).toEqual([]);
  });

  it("lists a listed roadmap that is missing, with no links", async () => {
    const root = makeTree({
      ".git/HEAD": "",
      ".vantage.toml": '[planning]\nroadmap = "plans/roadmap.md"\n',
      "a.md": doc("status: draft"),
    });
    const { payload } = await indexJson(root);

    expect(payload.index.config.roadmaps).toEqual(["plans/roadmap.md"]);
    expect(payload.sections.roadmaps).toEqual([
      { path: "plans/roadmap.md", state: "missing", needsYouCount: 0 },
    ]);
    expect(payload.roadmaps).toEqual([
      { path: "plans/roadmap.md", state: "missing", chosen: false, links: [] },
    ]);
  });
});

/**
 * Three roadmaps, found by name (§4.1, §13.2):
 *
 * - `roadmap.md`, the default, routes OQ-A1 and links the plans roadmap bare,
 *   which routes the questions written there (none), not the ones it routes;
 * - `docs/plans/roadmap.md` routes all of docs/b.md, then OQ-A1;
 * - `docs/old/roadmap.md` has the done role, so it routes nothing, and
 *   docs/c.md, which only it links, is unrouted, as is OQ-A2.
 */
const SEVERAL: Record<string, string> = {
  ".git/HEAD": "ref: refs/heads/main\n",
  ".vantage.toml": STAGES_TOML,
  "roadmap.md": [
    "# Roadmap",
    "",
    "## Now",
    "",
    "- [A's first](docs/a.md#OQ-A1)",
    "- [The plans](docs/plans/roadmap.md)",
    "",
  ].join("\n"),
  "docs/plans/roadmap.md": [
    "# Plans",
    "",
    "## Later",
    "",
    "- [B](../b.md)",
    "- [A's first](../a.md#OQ-A1)",
    "",
  ].join("\n"),
  "docs/old/roadmap.md": doc("stage: RETIRED", "- [C](../c.md)"),
  "docs/a.md": doc("status: draft\nstage: DESIGN", questions("A", OPEN, OPEN)),
  "docs/b.md": doc("status: draft\nstage: DESIGN", questions("B", OPEN)),
  "docs/c.md": doc("status: draft\nstage: DESIGN", questions("C", OPEN)),
};

describe("index, with several roadmaps", () => {
  const unrouted = [
    "Not on a roadmap (2)",
    PLANNING_SECTION_GUIDE.unrouted.explanation,
    "  docs/a.md:14  💬 OQ-A2: Question A2?",
    "  docs/c.md:8  💬 OQ-C1: Question C1?",
    "",
  ];

  it("lists every roadmap, and follows the one nearest the root", async () => {
    const { code, stdout, stderr } = await index(makeTree(SEVERAL));

    expect(code).toBe(EXIT_OK);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        "1 more question needs you on another roadmap. Choose one with --roadmap <path>.",
        "",
        "Roadmaps (3)",
        "  roadmap.md  1 needs you  (chosen)",
        "  docs/old/roadmap.md  ignored: has a stage with the done role",
        "  docs/plans/roadmap.md  2 need you",
        "",
        "Needs you (1) · for the human",
        PLANNING_SECTION_GUIDE["needs-you"].explanation,
        "  docs/a.md:8  💬 OQ-A1: Question A1?  (Now)",
        "",
        ...unrouted,
        "Agent requests: vantage-check index --request",
        "",
        "Roadmap: roadmap.md",
        "",
        "# Roadmap",
        "",
        "## Now",
        "",
        "- [A's first](docs/a.md#OQ-A1) [💬 open]",
        "- [The plans](docs/plans/roadmap.md)",
        "",
      ].join("\n"),
    );
  });

  it.each([
    [["--roadmap", "docs/plans/roadmap.md"]],
    [["--roadmap=docs/plans/roadmap.md"]],
    [["--roadmap", "./docs/plans/roadmap.md"]],
    // Given twice, the last wins, as --config does.
    [["--roadmap", "roadmap.md", "--roadmap", "docs/plans/roadmap.md"]],
  ])("follows the roadmap --roadmap names: %j", async (args) => {
    const { code, stdout } = await index(makeTree(SEVERAL), ...args);

    expect(code).toBe(EXIT_OK);
    // Everything the root's roadmap routes, the plans roadmap routes too, so
    // nothing needs you on another roadmap.
    expect(stdout).toBe(
      [
        "Roadmaps (3)",
        "  roadmap.md  1 needs you",
        "  docs/old/roadmap.md  ignored: has a stage with the done role",
        "  docs/plans/roadmap.md  2 need you  (chosen)",
        "",
        "Needs you (2) · for the human",
        PLANNING_SECTION_GUIDE["needs-you"].explanation,
        "  docs/b.md:8  💬 OQ-B1: Question B1?  (Later)",
        "  docs/a.md:8  💬 OQ-A1: Question A1?  (Later)",
        "",
        ...unrouted,
        "Agent requests: vantage-check index --request",
        "",
        "Roadmap: docs/plans/roadmap.md",
        "",
        "# Plans",
        "",
        "## Later",
        "",
        "- [B](../b.md) [draft · DESIGN · 💬 1]",
        "- [A's first](../a.md#OQ-A1) [💬 open]",
        "",
      ].join("\n"),
    );
  });

  it("prints JSON version 2: every roadmap, the chosen one, and what the others route", async () => {
    const { code, payload } = await indexJson(
      makeTree(SEVERAL),
      "--roadmap",
      "docs/plans/roadmap.md",
    );

    expect(code).toBe(EXIT_OK);
    expect(payload.version).toBe(2);
    expect(payload.sections.roadmaps).toEqual([
      { path: "roadmap.md", state: "routes", needsYouCount: 1 },
      { path: "docs/old/roadmap.md", state: "done", needsYouCount: 0 },
      { path: "docs/plans/roadmap.md", state: "routes", needsYouCount: 2 },
    ]);
    expect(payload.sections.chosenRoadmap).toBe("docs/plans/roadmap.md");
    expect(payload.sections.onOtherRoadmaps).toEqual([]);
    expect(payload.sections.needsYou.map((q: { id: string }) => q.id)).toEqual([
      "OQ-B1",
      "OQ-A1",
    ]);
    expect(
      payload.roadmaps.map(
        (r: { path: string; state: string; chosen: boolean }) => [
          r.path,
          r.state,
          r.chosen,
        ],
      ),
    ).toEqual([
      ["roadmap.md", "routes", false],
      ["docs/old/roadmap.md", "done", false],
      ["docs/plans/roadmap.md", "routes", true],
    ]);
    // Each read roadmap's links, a done one's included.
    expect(
      payload.roadmaps.map((r: { links: { target: string }[] }) =>
        r.links.map((l) => l.target),
      ),
    ).toEqual([
      ["docs/a.md", "docs/plans/roadmap.md"],
      ["docs/c.md"],
      ["docs/b.md", "docs/a.md"],
    ]);
  });

  it("lists the questions only another roadmap routes, with that roadmap", async () => {
    const { payload } = await indexJson(makeTree(SEVERAL));

    expect(payload.sections.onOtherRoadmaps).toEqual([
      {
        path: "docs/b.md",
        id: "OQ-B1",
        line: expect.any(Number),
        heading: "Later",
        roadmap: "docs/plans/roadmap.md",
      },
    ]);
    // Routed by the plans roadmap, so not on Not on a roadmap under the root's.
    expect(payload.sections.unrouted.map((q: { id: string }) => q.id)).toEqual([
      "OQ-A2",
      "OQ-C1",
    ]);
  });

  it("prints sections deep-equal to derivePlanningSections for the chosen roadmap", async () => {
    const root = makeTree(SEVERAL);
    const { payload } = await indexJson(
      root,
      "--roadmap",
      "docs/plans/roadmap.md",
    );
    const sources: PlanningSources = {
      config: parseConfig(STAGES_TOML).planning,
      candidateCount: 6,
      refused: false,
      files: Object.entries(SEVERAL)
        .filter(([path]) => path.endsWith(".md"))
        .map(([path, content]) => ({ path, content })),
      skipped: [],
      unreadable: [],
    };

    expect(payload.sections).toEqual(
      derivePlanningSections(buildPlanningIndex(sources), {
        roadmap: "docs/plans/roadmap.md",
      }),
    );
  });

  it.each([
    [
      ["--roadmap", "docs/a.md"],
      "vantage-check: --roadmap docs/a.md is not a roadmap here; the roadmaps are: roadmap.md, docs/plans/roadmap.md\n",
    ],
    [
      ["--roadmap", "docs/old/roadmap.md"],
      "vantage-check: --roadmap docs/old/roadmap.md is not a roadmap here; the roadmaps are: roadmap.md, docs/plans/roadmap.md\n",
    ],
    [
      ["--roadmap", "/roadmap.md"],
      "vantage-check: --roadmap /roadmap.md is not a roadmap here; the roadmaps are: roadmap.md, docs/plans/roadmap.md\n",
    ],
  ])(
    "exits 2 on a --roadmap that does not route: %j",
    async (args, message) => {
      for (const format of ["text", "json"]) {
        const { code, stdout, stderr } = await index(
          makeTree(SEVERAL),
          "--format",
          format,
          ...args,
        );

        expect(code).toBe(EXIT_USAGE);
        expect(stdout).toBe("");
        expect(stderr).toBe(message);
      }
    },
  );

  it("says there is no roadmap when --roadmap names one and none routes", async () => {
    const root = makeTree({ ".git/HEAD": "", "a.md": doc("status: draft") });
    const { code, stdout, stderr } = await index(root, "--roadmap", "a.md");

    expect(code).toBe(EXIT_USAGE);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      "vantage-check: --roadmap a.md is not a roadmap here; there is no roadmap\n",
    );
  });

  it("exits 3 past max-candidates, whatever --roadmap says", async () => {
    const root = makeTree({
      ...SEVERAL,
      ".vantage.toml": "[planning]\nmax-candidates = 2\n",
    });
    const { code, stdout, stderr } = await index(root, "--roadmap", "nope.md");

    expect(code).toBe(EXIT_ENVIRONMENT);
    expect(stdout).toBe("");
    expect(stderr).toBe(`vantage-check: ${PLANNING_NOTICES.refused(6, 2)}\n`);
  });

  it("hides a roadmap.md that exclude rules out", async () => {
    const root = makeTree({
      ...SEVERAL,
      ".vantage.toml": `[planning]\nexclude = ["docs/plans/**", "docs/old/**"]\n\n${STAGES_TOML}`,
    });
    const { payload } = await indexJson(root);

    expect(payload.sections.roadmaps).toEqual([
      { path: "roadmap.md", state: "routes", needsYouCount: 1 },
    ]);
    // With one roadmap, the text is what it always was: no Roadmaps block.
    const { stdout } = await index(root);
    expect(stdout).not.toContain("Roadmaps (");
    expect(stdout).not.toContain("--roadmap");
    expect(stdout.startsWith("Needs you (1) · for the human\n")).toBe(true);
  });

  it("reads a listed roadmap that exclude rules out, and no roadmap.md the list leaves out", async () => {
    const root = makeTree({
      ...SEVERAL,
      ".vantage.toml": `[planning]\nroadmap = ["docs/plans/roadmap.md"]\nexclude = ["docs/plans/**"]\n\n${STAGES_TOML}`,
    });
    const { payload } = await indexJson(root);

    expect(payload.sections.roadmaps).toEqual([
      { path: "docs/plans/roadmap.md", state: "routes", needsYouCount: 2 },
    ]);
    expect(payload.sections.chosenRoadmap).toBe("docs/plans/roadmap.md");
    // roadmap.md is an ordinary file now, and plans nothing.
    expect(
      payload.index.documents.map((d: { path: string }) => d.path),
    ).not.toContain("roadmap.md");
  });

  it("names the listed roadmaps it could not read, among the notices", async () => {
    const root = makeTree({
      ...SEVERAL,
      ".vantage.toml": `[planning]\nroadmap = ["roadmap.md", "plans/gone.md"]\n\n${STAGES_TOML}`,
    });
    const { stdout } = await index(root);

    expect(stdout.split("\n\n")[0]).toBe(
      "Not read as a roadmap: plans/gone.md, which roadmap under [planning] lists, is missing or not in Vantage's file list (it is not a .md file, or is in a hidden or excluded directory, or matches .vantageignore).",
    );
    expect(stdout).toContain(
      [
        "Roadmaps (2)",
        "  roadmap.md  1 needs you  (chosen)",
        "  plans/gone.md  not read: is missing or not in Vantage's file list (it is not a .md file, or is in a hidden or excluded directory, or matches .vantageignore)",
      ].join("\n"),
    );
  });
});

/** The request `--request` prints for the full tree, every agent section. */
const FULL_REQUEST = (root: string) =>
  [
    `Repository: ${root}`,
    "",
    "Not on a roadmap (2): open questions no roadmap links to. For each, propose its place on roadmap.md, with a one-clause reason. Do not decide priority: show the proposals to the human, and edit a roadmap only once they confirm the order. An entry is a link to the question's #OQ- anchor, or to its document with no fragment, which places every question in it.",
    "- docs/a.md:14  OQ-A2: Question A2?",
    "- docs/e.md:8  OQ-E1: Question E1?",
    "",
    // docs/c.md waits on OQ-A2 (Blocked lists it too), so it is marked, and
    // the agent is told to skip it rather than build ahead of a ruling.
    "Ready to build (1): decided, with no open questions. Build each from its plan, then set its stage to BUILT. If one should not be built, ask the human, and only with their agreement retire it by setting its stage to RETIRED. Skip any entry marked blocked: it waits on something else first.",
    "- docs/c.md  (stage DECIDED; blocked on docs/a.md#OQ-A2)",
    "",
    "Ready to graduate (1): built, with no questions left. For each, write a reference document of the system as built, where the repository keeps those: verify every claim against the code, and say what it covers and the commit it was verified at (if you use a system-doc skill, use it). Give it the stage the repository's other reference documents carry (one with the done role: RETIRED), or none. Then delete the design document and any plan written for it, repoint every link to them and citation of them, in documents, code comments and tests, at the new one, and keep every question id other documents cite resolvable.",
    "- docs/d.md  (stage BUILT)",
    "",
    "Stage conflict (1): the stage says ready or built, but questions are open. For each, find which is wrong, from the document and the code. If the stage is wrong, set it to DESIGN. If a question is a follow-up, propose moving it to a new document. Rule and answer nothing: where a question looks settled, tell the human what you found and ask for a ruling.",
    "- docs/e.md  (stage BUILT; open: OQ-E1)",
    "",
    "Verify: in the repository, run `vantage-check` on every Markdown file you changed, then `vantage-check index`. If the command cannot run, or exits 2 (a configuration error or a refusal), leave `.vantage.toml` as it is: the check is a quality gate, not part of the work.",
    "",
  ].join("\n");

describe("index --request", () => {
  it("prints the request for every agent section, and nothing else", async () => {
    const root = fullTree();
    const { code, stdout, stderr } = await index(root, "--request");

    expect(code).toBe(EXIT_OK);
    expect(stderr).toBe("");
    expect(stdout).toBe(FULL_REQUEST(root));
  });

  // P7: the page's buttons copy `planningAgentRequest` over the index it
  // built from the server's batch, with the repository's root path; this is
  // the same function over the same batch, so the two texts are one.
  it("prints exactly planningAgentRequest over the same tree, for any sections", async () => {
    const root = fullTree();
    const built = buildPlanningIndex(fullSources());
    const sections = derivePlanningSections(built);
    for (const ids of [
      [],
      ["graduate"],
      ["disagrees", "unrouted"],
      ["ready", "graduate"],
    ] as const) {
      const { stdout } = await index(root, "--request", ...ids);
      const expected = planningAgentRequest(built, sections, {
        repository: root,
        ...(ids.length === 0 ? {} : { ids }),
      });

      expect(stdout).toBe(`${expected}\n`);
    }
  });

  it("covers the sections asked for, in page order, whatever order they are asked in", async () => {
    const root = fullTree();
    const { stdout } = await index(root, "--request", "disagrees", "unrouted");

    const heads = stdout
      .split("\n")
      .filter((line) => /^[A-Z][a-z].* \(\d+\): /.test(line))
      .map((line) => line.slice(0, line.indexOf(":")));
    expect(heads).toEqual(["Not on a roadmap (2)", "Stage conflict (1)"]);
    expect(stdout.startsWith(`Repository: ${root}\n\n`)).toBe(true);
    expect(stdout.endsWith("not part of the work.\n")).toBe(true);
  });

  it("leaves out an empty section, and prints nothing when every asked one is", async () => {
    const root = makeTree({
      ".git/HEAD": "",
      ".vantage.toml": STAGES_TOML,
      "roadmap.md": "# Roadmap\n\n- [A](a.md)\n",
      "a.md": doc("status: draft\nstage: DESIGN", questions("A", OPEN)),
      "b.md": doc("status: accepted\nstage: BUILT"),
    });

    const all = await index(root, "--request");
    expect(all.code).toBe(EXIT_OK);
    expect(all.stdout).toContain("Ready to graduate (1)");
    expect(all.stdout).not.toContain("Not on a roadmap");
    expect(all.stdout).not.toContain("Ready to build");

    const none = await index(root, "--request", "ready", "disagrees");
    expect(none.code).toBe(EXIT_OK);
    expect(none.stdout).toBe("");
    expect(none.stderr).toBe(
      "vantage-check: nothing to ask an agent: Ready to build and Stage conflict have no entries\n",
    );
  });

  it("asks where a question goes among every roadmap that is read", async () => {
    const { stdout } = await index(makeTree(SEVERAL), "--request", "unrouted");

    expect(stdout).toContain(
      "For each, propose its place on one of the roadmaps (roadmap.md or docs/plans/roadmap.md), with a one-clause reason.",
    );
    expect(stdout).toContain(
      [
        "- docs/a.md:14  OQ-A2: Question A2?",
        "- docs/c.md:8  OQ-C1: Question C1?",
      ].join("\n"),
    );
    // The chosen roadmap changes Needs you, and nothing a request covers.
    const chosen = await index(
      makeTree(SEVERAL),
      "--request",
      "unrouted",
      "--roadmap",
      "docs/plans/roadmap.md",
    );
    expect(chosen.stdout.replace(/^Repository: .*\n/, "")).toBe(
      stdout.replace(/^Repository: .*\n/, ""),
    );
  });

  it("still refuses a --roadmap that names no roadmap", async () => {
    const { code, stdout } = await index(
      makeTree(SEVERAL),
      "--request",
      "--roadmap",
      "docs/a.md",
    );

    expect(code).toBe(EXIT_USAGE);
    expect(stdout).toBe("");
  });

  it("exits 3 past max-candidates, with nothing on stdout", async () => {
    const root = makeTree({
      ".vantage.toml": "[planning]\nmax-candidates = 1\n",
      "a.md": doc("status: draft"),
      "b.md": doc("status: draft"),
    });
    const { code, stdout, stderr } = await index(root, "--request");

    expect(code).toBe(EXIT_ENVIRONMENT);
    expect(stdout).toBe("");
    expect(stderr).toBe(`vantage-check: ${PLANNING_NOTICES.refused(2, 1)}\n`);
  });
});

describe("index past max-candidates", () => {
  const tree = (limit: number) => ({
    ".vantage.toml": `[planning]\nmax-candidates = ${limit}\n`,
    "a.md": doc("status: draft"),
    "b.md": doc("status: draft"),
    "roadmap.md": "# Roadmap\n",
  });

  // A partial index would quietly under-report, so the refusal is loud:
  // exit 3, "could not run", and the page's own words (§16).
  it("scans nothing, says why, and exits 3", async () => {
    const { code, stdout, stderr } = await index(makeTree(tree(2)));

    expect(code).toBe(EXIT_ENVIRONMENT);
    expect(stdout).toBe("");
    expect(stderr).toBe(`vantage-check: ${PLANNING_NOTICES.refused(3, 2)}\n`);
  });

  it("says the same in JSON, with no sections to show", async () => {
    const { code, payload, stderr } = await indexJson(makeTree(tree(2)));

    expect(code).toBe(EXIT_ENVIRONMENT);
    expect(stderr).toContain(PLANNING_NOTICES.refused(3, 2));
    expect(payload.index).toMatchObject({
      candidateCount: 3,
      refused: true,
      documents: [],
      skipped: [],
      unreadable: [],
    });
    expect(payload.sections).toBeNull();
    expect(payload.sectionGuide).toBeNull();
    expect(payload.roadmaps).toBeNull();
  });

  it("scans a project exactly at the limit", async () => {
    const { code, payload } = await indexJson(makeTree(tree(3)));

    expect(code).toBe(EXIT_OK);
    expect(payload.index.refused).toBe(false);
    expect(payload.index.candidateCount).toBe(3);
  });
});

describe("index's exit 2", () => {
  it("refuses a bad [planning] table", async () => {
    const root = makeTree({
      ".vantage.toml": "[planning]\nmax-candidates = 0\n",
      "a.md": "# A\n",
    });
    const { code, stdout, stderr } = await index(root);

    expect(code).toBe(EXIT_USAGE);
    expect(stdout).toBe("");
    expect(stderr).toContain("planning.max-candidates");
  });

  // A key from a newer release is ignored with a warning, and the scan goes
  // on under the rest of the table (core/config.ts).
  it("warns about a [planning] key it does not know, and scans under the rest", async () => {
    const root = makeTree({
      ".vantage.toml": '[planning]\nexclude = ["b.md"]\nroadmaps = 1\n',
      "a.md": "# A\n",
      "b.md": "# B\n",
    });
    const { code, stderr, payload } = await indexJson(root);

    expect(code).toBe(EXIT_OK);
    expect(stderr).toMatch(
      /^vantage-check: warning: \.vantage\.toml: unknown key planning\.roadmaps/,
    );
    expect(payload.index.candidateCount).toBe(1);
  });

  it("refuses a --config that is not there", async () => {
    const { code, stderr } = await index(
      makeTree({ "a.md": "# A\n" }),
      "--config",
      "nope.toml",
    );

    expect(code).toBe(EXIT_USAGE);
    expect(stderr).toMatch(/no config file at \S*nope\.toml/);
  });

  it.each([
    [["docs"], "index takes no paths"],
    [["--format", "xml"], "--format takes text or json"],
    [["--strict"], "unknown option for index: --strict"],
    [["--config"], "--config needs a path"],
    [["--roadmap"], "--roadmap needs a path"],
  ])("refuses index %j", async (args, message) => {
    const { code, stdout, stderr } = await index(process.cwd(), ...args);

    expect(code).toBe(EXIT_USAGE);
    expect(stdout).toBe("");
    expect(stderr).toContain(message);
  });
});

describe("the project index scans", () => {
  const planning = (name: string) => doc(`status: draft\ntitle: ${name}`);
  const paths = (payload: { index: PlanningIndex }) =>
    payload.index.documents.map((d) => d.path);

  it("is found through a .vantage.toml above the working directory", async () => {
    const root = makeTree({
      ".vantage.toml": "",
      "top.md": planning("top"),
      "docs/deep/a.md": planning("a"),
    });
    const { payload } = await indexJson(join(root, "docs/deep"));

    expect(payload.root).toBe(root);
    expect(paths(payload)).toEqual(["docs/deep/a.md", "top.md"]);
  });

  it("is found through a .git above the working directory", async () => {
    const root = makeTree({
      ".git/HEAD": "",
      "top.md": planning("top"),
      "docs/a.md": planning("a"),
    });
    const { payload } = await indexJson(join(root, "docs"));

    expect(payload.root).toBe(root);
    expect(paths(payload)).toEqual(["docs/a.md", "top.md"]);
  });

  it("is the working directory when nothing above it marks a project", async () => {
    const root = makeTree({
      "top.md": planning("top"),
      "sub/a.md": planning("a"),
    });
    const { payload } = await indexJson(join(root, "sub"));

    expect(payload.root).toBe(join(root, "sub"));
    expect(paths(payload)).toEqual(["a.md"]);
  });

  // `just _self-check` passes `--config "$(mktemp)"`, whose directory is /tmp.
  // A root found through the config file would scan the wrong tree.
  it("does not move when --config names a file outside the tree", async () => {
    const root = makeTree({
      ".git/HEAD": "",
      "docs/a.md": planning("a"),
      "notes/b.md": planning("b"),
    });
    const elsewhere = makeTree({
      "cfg.toml": '[planning]\nexclude = ["notes/**"]\n',
    });
    const { payload } = await indexJson(
      join(root, "docs"),
      "--config",
      join(elsewhere, "cfg.toml"),
    );

    expect(payload.root).toBe(root);
    expect(paths(payload)).toEqual(["docs/a.md"]);
    expect(payload.index.config.exclude).toEqual(["notes/**"]);
  });

  it("scans the same project under --no-config, with the defaults", async () => {
    const root = makeTree({
      ".vantage.toml": '[planning]\nexclude = ["notes/**"]\n',
      "docs/a.md": planning("a"),
      "notes/b.md": planning("b"),
    });

    expect(paths((await indexJson(root)).payload)).toEqual(["docs/a.md"]);
    const { payload } = await indexJson(root, "--no-config");
    expect(payload.root).toBe(root);
    expect(paths(payload)).toEqual(["docs/a.md", "notes/b.md"]);
  });

  it("stops at the git root, below a .vantage.toml further up", async () => {
    const outer = makeTree({
      ".vantage.toml": "",
      "outside.md": planning("outside"),
      "repo/.git/HEAD": "",
      "repo/a.md": planning("a"),
    });
    const { payload } = await indexJson(join(outer, "repo"));

    expect(payload.root).toBe(join(outer, "repo"));
    expect(paths(payload)).toEqual(["a.md"]);
  });

  // The server reads only the repository's own .vantage.toml, so a table
  // above the root rules nothing on the planning page, and must not here.
  it("reads the root's own config, never one further up", async () => {
    const outer = makeTree({
      ".vantage.toml":
        '[planning]\nexclude = ["docs/**"]\n\n[planning.stages]\nDESIGN = "open"\n',
      "repo/.git/HEAD": "",
      "repo/docs/a.md": planning("a"),
    });
    const { code, payload } = await indexJson(join(outer, "repo"));

    expect(code).toBe(EXIT_OK);
    expect(payload.index.config.exclude).toEqual([]);
    expect(payload.index.config.stages).toBeNull();
    expect(paths(payload)).toEqual(["docs/a.md"]);
  });

  it("reads this repository's own planning documents", async () => {
    const repo = join(import.meta.dirname, "..", "..", "..");
    const { code, payload } = await indexJson(join(repo, "docs"));

    expect(code).toBe(EXIT_OK);
    expect(payload.root).toBe(repo);
    expect(paths(payload)).toContain("docs/reference/planning-index.md");
    expect(paths(payload)).toContain("roadmap.md");
    // Found by name: this repository sets no roadmap, and its exclude rules
    // out the end-to-end fixture's plans/roadmap.md (§14).
    expect(payload.index.config.roadmaps).toBeNull();
    expect(payload.sections.roadmaps).toEqual([
      expect.objectContaining({ path: "roadmap.md", state: "routes" }),
    ]);
    expect(payload.sections.chosenRoadmap).toBe("roadmap.md");
  });
});
