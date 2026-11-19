import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import type { PlanningIndex } from "../../vantage-md/src/planning/index.js";
import { makeTree } from "./helpers.js";
import { FULL_TREE, fullTree } from "./planningTree.js";

/**
 * `vantage-check index --document <path>` (`docs/reference/planning-index.md`
 * §13.7): one document's entry in the index, for the server's review commands,
 * which prove a question's unit for one document per take and used to scan the
 * whole project to do it.
 */

async function index(cwd: string, ...args: string[]) {
  const io = bufferIo(cwd);
  const code = await run(["index", ...args], io);
  return { code, stdout: io.stdout, stderr: io.stderr };
}

async function documentJson(cwd: string, path: string) {
  const result = await index(cwd, "--format", "json", "--document", path);
  return { ...result, payload: JSON.parse(result.stdout) };
}

describe("index --document", () => {
  it("prints the document's entry exactly as the whole index holds it", async () => {
    const root = fullTree();
    const whole = JSON.parse((await index(root, "--format", "json")).stdout);
    const { code, payload } = await documentJson(root, "docs/a.md");

    expect(code).toBe(EXIT_OK);
    const entry = (i: PlanningIndex) =>
      i.documents.filter((d) => d.path === "docs/a.md");
    expect(payload.index.documents).toEqual(entry(whole.index));
    expect(payload.index.documents).toHaveLength(1);
    // Links are narrowed to candidates as the whole run narrows them, though
    // no other document was read.
    expect(
      payload.index.documents[0].links.map((l: { target: string }) => l.target),
    ).toEqual(["README.md"]);
  });

  it("has no sections, guide or roadmaps: one document cannot derive the page", async () => {
    const { payload } = await documentJson(fullTree(), "docs/a.md");

    expect(payload.sections).toBeNull();
    expect(payload.sectionGuide).toBeNull();
    expect(payload.roadmaps).toBeNull();
    expect(payload.document).toBe("docs/a.md");
  });

  it("accepts a leading ./", async () => {
    const { payload } = await documentJson(fullTree(), "./docs/a.md");

    expect(payload.document).toBe("docs/a.md");
    expect(payload.index.documents).toHaveLength(1);
  });

  it("lists nothing for a path that is no candidate, and still exits 0", async () => {
    const root = fullTree();
    for (const path of [
      "drafts/x.md",
      "node_modules/pkg/x.md",
      "docs/nope.md",
      "../x.md",
    ]) {
      const { code, payload } = await documentJson(root, path);
      expect(code, path).toBe(EXIT_OK);
      expect(payload.index.documents, path).toEqual([]);
      expect(payload.index.refused, path).toBe(false);
    }
  });

  it("says a candidate past max-file-bytes is too large, as the whole run does", async () => {
    const { payload } = await documentJson(fullTree(), "docs/huge.md");

    expect(payload.index.documents).toEqual([]);
    expect(payload.index.skipped.map((s: { path: string }) => s.path)).toEqual([
      "docs/huge.md",
    ]);
  });

  // The refusal bounds what a whole scan reads; one document is bounded
  // already, so a project past max-candidates still answers for it.
  it("is not refused past max-candidates", async () => {
    const root = makeTree({
      ...FULL_TREE,
      ".vantage.toml": `${FULL_TREE[".vantage.toml"]}\n`.replace(
        "[planning]",
        "[planning]\nmax-candidates = 2",
      ),
    });
    const { code, payload } = await documentJson(root, "docs/a.md");

    expect(code).toBe(EXIT_OK);
    expect(payload.index.refused).toBe(false);
    expect(payload.index.documents).toHaveLength(1);
  });

  it("is JSON only, and takes none of the options that shape the page", async () => {
    const root = fullTree();
    const cases: string[][] = [
      ["--document", "docs/a.md"],
      ["--format", "text", "--document", "docs/a.md"],
      [
        "--format",
        "json",
        "--document",
        "docs/a.md",
        "--roadmap",
        "roadmap.md",
      ],
      ["--format", "json", "--document", "docs/a.md", "--filter", "is:open"],
      ["--document", "docs/a.md", "--request"],
      ["--format", "json", "--document"],
    ];
    for (const args of cases) {
      const { code, stdout, stderr } = await index(root, ...args);
      expect(code, args.join(" ")).toBe(EXIT_USAGE);
      expect(stdout, args.join(" ")).toBe("");
      expect(stderr, args.join(" ")).toMatch(/--document/);
    }
  });
});
