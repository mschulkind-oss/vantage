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
  buildPlanningIndex,
  derivePlanningSections,
  type PlanningIndex,
  type PlanningSources,
} from "../../vantage-md/src/planning/index.js";
import { makeTree } from "./helpers.js";
import {
  FULL_TOML,
  FULL_TREE,
  doc,
  fullTree,
  questions,
} from "./planningTree.js";

/**
 * `vantage-check index` (`docs/design/planning-index.md` §8): the planning
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
        "Needs you (3)",
        "  docs/a.md:8  💬 OQ-A1: Question A1?  (Rule these first)",
        "  docs/b.md:8  ✅ OQ-B1: Question B1?  (Rule these first)",
        "  docs/b.md:14  💬 🤷 OQ-B2: Question B2?  (Rule these first)",
        "",
        "Unrouted (2)",
        "  docs/a.md:14  💬 OQ-A2: Question A2?",
        "  docs/e.md:8  💬 OQ-E1: Question E1?",
        "",
        "Waiting (2)",
        "  docs/a.md:20  🔒 OQ-A3: Question A3?",
        "  docs/c.md  waits on docs/a.md#OQ-A2",
        "",
        "Ready (1)",
        "  docs/c.md  [accepted · DECIDED]",
        "",
        "Graduate (1)",
        "  docs/d.md  [accepted · BUILT]",
        "",
        "Disagrees (1)",
        "  docs/e.md  [accepted · BUILT · 💬 1]",
        "",
        "Skipped (1)",
        "  docs/huge.md  5,033 bytes, over max-file-bytes (4,096 bytes)",
        "",
        "Could not read (2)",
        "  docs/broken.md  the frontmatter does not parse: Flow sequence in block collection must be sufficiently indented and end with a ] at line 1, column 10:",
        "  docs/latin1.md  not UTF-8",
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
        PLANNING_NOTICES.noRoadmap("roadmap.md"),
        "",
        PLANNING_NOTICES.noStages,
        "",
      ].join("\n"),
    );
  });

  it("lists every open question under Needs you when there is no roadmap", async () => {
    const root = makeTree({
      ".git/HEAD": "",
      "b.md": doc("status: draft", questions("B", "💬")),
      "a.md": doc("status: draft", questions("A", "💬", "✅")),
    });
    const { stdout } = await index(root);

    expect(stdout).toContain(
      [
        "Needs you (2)",
        "  a.md:7  💬 OQ-A1: Question A1?",
        "  b.md:7  💬 OQ-B1: Question B1?",
      ].join("\n"),
    );
    expect(stdout).not.toContain("Unrouted");
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
      "roadmap",
    ]);
    expect(payload.tool).toBe("vantage-check");
    // Two meanings of "version": `check`'s JSON holds the tool's there, and
    // this one the format's, with the tool's under its own name.
    expect(payload.toolVersion).toBe(VERSION);
    expect(payload.version).toBe(INDEX_FORMAT_VERSION);
    expect(payload.version).toBe(1);
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
    // in design §3.2's sense.
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

    expect(
      payload.roadmap.map(
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
    expect(payload.roadmap[0]).toEqual({
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

  it("lists Skipped and Could not read", async () => {
    const { payload } = await indexJson(fullTree());

    expect(payload.sections.skipped).toEqual([
      { path: "docs/huge.md", size: 5033 },
    ]);
    expect(
      payload.sections.unreadable.map((u: { path: string }) => u.path),
    ).toEqual(["docs/broken.md", "docs/latin1.md"]);
    expect(payload.index.skipped).toEqual(payload.sections.skipped);
  });

  it("has an empty roadmap list when the roadmap is missing", async () => {
    const root = makeTree({ ".git/HEAD": "", "a.md": doc("status: draft") });
    const { payload } = await indexJson(root);

    expect(payload.sections.roadmap).toEqual({
      path: "roadmap.md",
      present: false,
    });
    expect(payload.roadmap).toEqual([]);
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
  // exit 3, "could not run", and the page's own words (design §3.5).
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
    expect(payload.roadmap).toBeNull();
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
      ".vantage.toml": "[planning]\nroadmaps = 1\n",
      "a.md": "# A\n",
    });
    const { code, stdout, stderr } = await index(root);

    expect(code).toBe(EXIT_USAGE);
    expect(stdout).toBe("");
    expect(stderr).toContain("unknown key planning.roadmaps");
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

  it("reads this repository's own planning documents", async () => {
    const repo = join(import.meta.dirname, "..", "..", "..");
    const { code, payload } = await indexJson(join(repo, "docs"));

    expect(code).toBe(EXIT_OK);
    expect(payload.root).toBe(repo);
    expect(paths(payload)).toContain("docs/design/planning-index.md");
    expect(paths(payload)).toContain("roadmap.md");
    expect(payload.sections.roadmap).toEqual({
      path: "roadmap.md",
      present: true,
    });
  });
});
