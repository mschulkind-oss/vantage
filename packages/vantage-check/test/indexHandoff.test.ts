import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { fullTree } from "./planningTree.js";

/**
 * The words `index --filter` adds for an agent handing a filter over
 * (docs/design/agent-planning-handoff.md §5.1): what its count is, and what an
 * unmatched `path:` term did and did not check. Exit code, JSON and the
 * notice text the viewer shares are pinned in index.test.ts.
 */

async function index(cwd: string, ...args: string[]) {
  const io = bufferIo(cwd);
  const code = await run(["index", ...args], io);
  return { code, stdout: io.stdout, stderr: io.stderr };
}

const PENDING =
  "The count is open in Markdown: answers pending in review are not subtracted here, and the Planning page shows them.";

describe("index --filter's count", () => {
  it("says answers pending in review are not subtracted, once, before the link", async () => {
    const { code, stdout } = await index(
      fullTree(),
      "--filter",
      "path:/docs/a.md is:open",
    );
    expect(code).toBe(EXIT_OK);
    const lines = stdout.split("\n");
    expect(lines.filter((line) => line === PENDING)).toHaveLength(1);
    expect(lines.indexOf(PENDING)).toBeLessThan(
      lines.findIndex((line) => line.startsWith("Planning page: ")),
    );
  });

  it("does not say it without a filter", async () => {
    const { stdout } = await index(fullTree());
    expect(stdout).not.toContain(PENDING);
  });
});

describe("index --filter, with a path: term that matches nothing", () => {
  const unmatched = async (term: string, root = fullTree()) => {
    const { code, stdout, stderr } = await index(root, "--filter", term);
    expect(code).toBe(EXIT_USAGE);
    expect(stdout).toBe("");
    return stderr;
  };

  const SAW =
    "The term matched none of the documents the scan indexed, skipped or could not read, and several `path:` terms combine in one filter.";

  it("says what it matched against and that path: terms combine", async () => {
    expect(await unmatched("path:/docs/nope.md")).toContain(SAW);
  });

  it("says a file exists at a root-anchored literal path the scan did not list, without saying why", async () => {
    const root = fullTree();
    writeFileSync(join(root, "notes.txt"), "x\n");
    const stderr = await unmatched("path:/notes.txt", root);
    expect(stderr).toContain("A file exists at `notes.txt`");
    expect(stderr).toContain(
      "whether the scan excluded, ignored or did not recognize it is not determined",
    );
  });

  it("says no file exists at a root-anchored literal path that is not there", async () => {
    const missing = await unmatched("path:/docs/nope.md");
    expect(missing).toContain("No file exists at `docs/nope.md`.");
  });

  it("says a root-anchored literal path is a folder, never that no file exists", async () => {
    const root = fullTree();
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "x.txt"), "x\n");
    const stderr = await unmatched("path:/assets", root);
    expect(stderr).toContain("`assets` is a folder");
    expect(stderr).not.toContain("No file exists");
    expect(stderr).toContain("`path:/assets` matches no path");
  });

  it("reports a pattern as an unmatched pattern, never as a missing file", async () => {
    for (const term of ["path:/docs/no*.md", "path:desing"]) {
      const stderr = await unmatched(term);
      expect(stderr).toContain(SAW);
      expect(stderr).toContain("is a pattern that matched nothing");
      expect(stderr).not.toContain("No file exists");
      expect(stderr).not.toContain("A file exists");
    }
  });

  it("keeps the existing first line, one per term", async () => {
    const stderr = await unmatched("path:/docs/x.md path:/docs/y.md");
    expect(stderr.split("\n")[0]).toContain(
      "`path:/docs/x.md` matches no path",
    );
  });
});
