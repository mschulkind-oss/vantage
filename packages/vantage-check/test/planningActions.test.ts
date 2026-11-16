import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EXIT_OK } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { makeTree } from "./helpers.js";
import { ANSWERED, OPEN, STAGES_TOML, doc, questions } from "./planningTree.js";

/**
 * `planning-actions` (docs/design/planning-eligibility-and-review-context.md
 * §2.2, §2.4): `none` keeps a document out of Ready, graduation and the
 * compaction offer, and out of nothing else. Driven through the real CLI, as an
 * agent runs it.
 */

async function cli(cwd: string, ...args: string[]) {
  const io = bufferIo(cwd);
  const code = await run(args, io);
  return { code, stdout: io.stdout, stderr: io.stderr };
}

async function indexJson(cwd: string, ...args: string[]) {
  const result = await cli(cwd, "index", "--format", "json", ...args);
  return { ...result, payload: JSON.parse(result.stdout) };
}

const NONE = "planning-actions: none";

function repo(files: Record<string, string>): string {
  return makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".vantage.toml": STAGES_TOML,
    ...files,
  });
}

describe("planning-actions: none, through the index command", () => {
  const tree = {
    "listed-ready.md": doc("stage: DECIDED"),
    "opted-ready.md": doc(`stage: DECIDED\n${NONE}`),
    "listed-built.md": doc("stage: BUILT"),
    "opted-built.md": doc(`stage: BUILT\n${NONE}`),
    "listed-answered.md": doc("stage: DESIGN", questions("L", ANSWERED)),
    "opted-answered.md": doc(
      `stage: DESIGN\n${NONE}`,
      questions("O", ANSWERED),
    ),
  };

  it("leaves an opted-out document out of Ready, graduation and compaction, and no other", async () => {
    const { code, stdout } = await cli(
      repo(tree),
      "index",
      "--request",
      "ready",
      "graduate",
      "compact",
    );
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain("- listed-ready.md  (stage DECIDED)");
    expect(stdout).toContain("- listed-built.md  (stage BUILT)");
    expect(stdout).toContain("listed-answered.md:");
    expect(stdout).not.toContain("opted-ready.md");
    expect(stdout).not.toContain("opted-built.md");
    expect(stdout).not.toContain("opted-answered.md");
  });

  it("keeps the opted-out document's stage in the index, and says it is opted out, additively", async () => {
    const { payload } = await indexJson(repo(tree));
    const byPath = Object.fromEntries(
      payload.index.documents.map((d: { path: string }) => [d.path, d]),
    );
    expect(payload.version).toBe(3);
    expect(byPath["opted-ready.md"]).toMatchObject({
      stage: "DECIDED",
      planningActions: "none",
    });
    expect(byPath["listed-ready.md"]).not.toHaveProperty("planningActions");
    expect(payload.sections.ready).toEqual(["listed-ready.md"]);
    expect(payload.sections.graduate).toEqual(["listed-built.md"]);
  });

  it("keeps its questions, counts, routing and Stage conflict", async () => {
    const root = repo({
      "opted-open.md": doc(`stage: DECIDED\n${NONE}`, questions("Z", OPEN)),
    });
    const { payload } = await indexJson(root);
    expect(payload.sections.ready).toEqual([]);
    expect(payload.sections.disagrees).toEqual(["opted-open.md"]);
    expect(payload.sections.needsYou).toHaveLength(1);
    const conflict = await cli(root, "index", "--request", "disagrees");
    expect(conflict.stdout).toContain("opted-open.md");
  });

  it("does not let a filter bring an opted-out document back", async () => {
    const { stdout } = await cli(
      repo(tree),
      "index",
      "--filter",
      "path:opted-ready.md",
      "--request",
    );
    expect(stdout).not.toContain("Ready to build");
  });

  it("reads any value but none as all", async () => {
    const root = repo({
      "bad.md": doc("stage: DECIDED\nplanning-actions: maybe"),
      "loud.md": doc("stage: DECIDED\nplanning-actions: true"),
      "fine.md": doc("stage: DECIDED\nplanning-actions: all"),
    });
    const { payload } = await indexJson(root);
    expect(payload.sections.ready).toEqual(["bad.md", "fine.md", "loud.md"]);
  });

  it("does not let the key alone make a document a contributor, and ignores it on a done-role stage", async () => {
    const root = repo({
      "keyonly.md": `---\n${NONE}\n---\n\n# Only the key\n`,
      "retired.md": doc(`stage: RETIRED\n${NONE}`),
    });
    const { payload } = await indexJson(root);
    expect(
      payload.index.documents.map((d: { path: string }) => d.path),
    ).toEqual(["retired.md"]);
  });

  it("is inert on a roadmap, and a roadmap link cannot override the key", async () => {
    const root = repo({
      "roadmap.md": `---\nstage: DECIDED\n${NONE}\n---\n\n# Roadmap\n\n- [Opted](opted-ready.md) first.\n`,
      "opted-ready.md": doc(`stage: DECIDED\n${NONE}`),
    });
    const { payload } = await indexJson(root);
    const roadmap = payload.index.documents.find(
      (d: { path: string }) => d.path === "roadmap.md",
    );
    expect(roadmap).not.toHaveProperty("planningActions");
    expect(payload.sections.ready).toEqual(["roadmap.md"]);
  });
});
