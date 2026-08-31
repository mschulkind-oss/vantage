import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { bufferIo } from "../src/io.js";
import {
  EXIT_ENVIRONMENT,
  EXIT_FINDINGS,
  EXIT_OK,
  EXIT_USAGE,
} from "../src/exit.js";
import { exitCodeFor } from "../src/commands/check.js";
import { makeTree } from "./helpers.js";

describe("check command", () => {
  it("exits 0 and says so when there is nothing to fix", async () => {
    const root = makeTree({
      "index.md": "# Title\n\n[Here](#title)\n",
    });
    const io = bufferIo(root);

    const code = await run(["check", "."], io);

    expect(code).toBe(EXIT_OK);
    expect(io.stdout).toContain("1 file checked, nothing to fix");
    expect(io.stderr).toBe("");
  });

  it("exits 1 and prints file, position, rule and message", async () => {
    const root = makeTree({ "docs/index.md": "# T\n\n[Gone](./nowhere.md)\n" });
    const io = bufferIo(root);

    const code = await run(["check", "docs"], io);

    expect(code).toBe(EXIT_FINDINGS);
    expect(io.stdout).toContain("docs/index.md");
    expect(io.stdout).toContain("3:1");
    expect(io.stdout).toContain("link/missing-target");
    expect(io.stdout).toContain("1 error in 1 file checked");
  });

  it("takes a bare path as a check, with no subcommand", async () => {
    const root = makeTree({ "index.md": "[Gone](./nowhere.md)\n" });
    const io = bufferIo(root);

    expect(await run(["index.md"], io)).toBe(EXIT_FINDINGS);
    expect(io.stdout).toContain("link/missing-target");
  });

  it("exits 2 on a path that does not exist, and checks nothing", async () => {
    const root = makeTree({ "index.md": "# Title\n" });
    const io = bufferIo(root);

    const code = await run(["check", "nope"], io);

    expect(code).toBe(EXIT_USAGE);
    expect(io.stderr).toContain("no such file or directory: nope");
    expect(io.stdout).toBe("");
  });

  it("emits JSON with findings and failures kept apart", async () => {
    const root = makeTree({ "index.md": "[Gone](./nowhere.md)\n" });
    const io = bufferIo(root);

    const code = await run(["check", ".", "--format", "json"], io);
    const payload = JSON.parse(io.stdout);

    expect(code).toBe(EXIT_FINDINGS);
    expect(payload.tool).toBe("vantage-check");
    expect(payload.filesChecked).toBe(1);
    expect(payload.summary).toMatchObject({
      errors: 1,
      warnings: 0,
      failures: 0,
    });
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]).toMatchObject({
      rule: "link/missing-target",
      severity: "error",
      file: "index.md",
      line: 1,
    });
    expect(payload.failures).toEqual([]);
  });

  it("drops the summary line under --quiet", async () => {
    const root = makeTree({ "index.md": "# Title\n" });
    const io = bufferIo(root);

    await run(["check", ".", "--quiet"], io);

    expect(io.stdout).toBe("");
  });

  it("rejects an unknown option rather than guessing", async () => {
    const io = bufferIo();

    expect(await run(["check", "--frobnicate"], io)).toBe(EXIT_USAGE);
    expect(io.stderr).toContain("unknown option: --frobnicate");
  });

  it("walks directories for Markdown and skips node_modules and dotfiles", async () => {
    const root = makeTree({
      "index.md": "# A\n",
      "notes.markdown": "# B\n",
      "image.png": "not markdown",
      "sub/deep.md": "# C\n",
      "node_modules/pkg/readme.md": "[Gone](./nowhere.md)\n",
      ".vantage/inbox/stale.md": "[Gone](./nowhere.md)\n",
    });
    const io = bufferIo(root);

    const code = await run(["check", "."], io);

    expect(code).toBe(EXIT_OK);
    expect(io.stdout).toContain("3 files checked");
  });
});

describe("exit codes", () => {
  it("prefers 3 over 1: a run that could not check is not a verdict", () => {
    const code = exitCodeFor(
      {
        filesChecked: 1,
        findings: [
          {
            rule: "link/missing-target",
            severity: "error",
            message: "x",
            file: "a.md",
            line: 1,
            column: 1,
          },
        ],
        failures: [{ rule: "mermaid/parse", file: "a.md", message: "boom" }],
      },
      { strict: false, exitCode: EXIT_FINDINGS },
    );

    expect(code).toBe(EXIT_ENVIRONMENT);
  });

  it("only fails on warnings when asked to", () => {
    const report = {
      filesChecked: 1,
      findings: [
        {
          rule: "frontmatter/unterminated",
          severity: "warning" as const,
          message: "x",
          file: "a.md",
          line: 1,
          column: 1,
        },
      ],
      failures: [],
    };

    expect(
      exitCodeFor(report, { strict: false, exitCode: EXIT_FINDINGS }),
    ).toBe(EXIT_OK);
    expect(exitCodeFor(report, { strict: true, exitCode: EXIT_FINDINGS })).toBe(
      EXIT_FINDINGS,
    );
  });
});
