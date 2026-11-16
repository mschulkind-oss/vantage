import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { EXIT_FINDINGS, EXIT_OK } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { makeTree } from "./helpers.js";
import { STAGES_TOML, doc } from "./planningTree.js";

/**
 * `planning/actions-value`: the diagnostic for a `planning-actions` the scan
 * cannot honor (docs/design/planning-eligibility-and-review-context.md §2.4).
 * Run through `check`, as the gate runs it.
 */

async function check(cwd: string, ...args: string[]) {
  const io = bufferIo(cwd);
  const code = await run(["check", "--format", "json", ...args], io);
  const findings = (
    JSON.parse(io.stdout).findings as {
      rule: string;
      file: string;
      line: number;
      severity: string;
      message: string;
    }[]
  ).filter((f) => f.rule === "planning/actions-value");
  return { code, findings };
}

const NONE = "planning-actions: none";

function repo(files: Record<string, string>): string {
  return makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".vantage.toml": STAGES_TOML,
    ...files,
  });
}

describe("planning/actions-value", () => {
  it("reports a value that is not all or none, at its line, as a warning", async () => {
    const root = repo({
      "bad.md": doc("stage: DECIDED\nplanning-actions: maybe"),
      "loud.md": doc("stage: DECIDED\nplanning-actions: true"),
      "fine.md": doc("stage: DECIDED\nplanning-actions: all"),
      "none.md": doc(`stage: DECIDED\n${NONE}`),
    });
    const { code, findings } = await check(
      root,
      "bad.md",
      "loud.md",
      "fine.md",
      "none.md",
    );
    expect(code).toBe(EXIT_OK);
    expect(findings.map((f) => [f.file, f.line, f.severity])).toEqual([
      ["bad.md", 3, "warning"],
      ["loud.md", 3, "warning"],
    ]);
    expect(findings[0]?.message).toContain(
      "`planning-actions` must be `all` or `none`",
    );
  });

  it("fails a --strict run, since it is a warning", async () => {
    const root = repo({
      "bad.md": doc("stage: DECIDED\nplanning-actions: maybe"),
    });
    expect((await check(root, "--strict", "bad.md")).code).toBe(EXIT_FINDINGS);
  });

  it("says nothing of the key on a document it cannot make a planning document, or on a done-role stage", async () => {
    const root = repo({
      "keyonly.md": `---\n${NONE}\n---\n\n# Only the key\n`,
      "retired.md": doc(`stage: RETIRED\n${NONE}`),
    });
    expect((await check(root, "keyonly.md", "retired.md")).findings).toEqual(
      [],
    );
  });

  it("reports the key on the roadmap, where it does nothing", async () => {
    const root = repo({
      "roadmap.md": `---\nstage: DECIDED\n${NONE}\n---\n\n# Roadmap\n`,
    });
    const { findings } = await check(root, "roadmap.md");
    expect(findings.map((f) => [f.file, f.line])).toEqual([["roadmap.md", 3]]);
    expect(findings[0]?.message).toContain("roadmap");
  });
});
