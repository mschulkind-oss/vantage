import { describe, expect, it } from "vitest";
import { parseArgs, run } from "../src/cli.js";
import { bufferIo } from "../src/io.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit.js";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";

describe("parseArgs", () => {
  it("shows help when given nothing", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
  });

  it.each([["-h"], ["--help"], ["help"]])("treats %s as help", (arg) => {
    expect(parseArgs([arg])).toEqual({ kind: "help" });
  });

  it.each([["-V"], ["--version"], ["version"]])(
    "treats %s as version",
    (arg) => {
      expect(parseArgs([arg])).toEqual({ kind: "version" });
    },
  );

  it("parses style-guide", () => {
    expect(parseArgs(["style-guide"])).toEqual({ kind: "style-guide" });
  });

  it("rejects arguments to style-guide", () => {
    expect(parseArgs(["style-guide", "docs/"])).toMatchObject({
      kind: "usage-error",
    });
  });

  // `vantage-check docs/` has to work: it is the form the review payload puts
  // in front of agents, and a bare word is far likelier to be a path than a
  // misremembered subcommand.
  it("treats a bare argument as a path to check", () => {
    expect(parseArgs(["docs/"])).toEqual({
      kind: "check",
      options: {
        paths: ["docs/"],
        format: "text",
        strict: false,
        quiet: false,
      },
    });
  });

  it("rejects an unknown option", () => {
    expect(parseArgs(["--frobnicate"])).toMatchObject({ kind: "usage-error" });
  });
});

describe("run", () => {
  it("prints the shared style guide verbatim", async () => {
    const io = bufferIo();
    const code = await run(["style-guide"], io);

    expect(code).toBe(EXIT_OK);
    expect(io.stdout).toBe(`${STYLE_GUIDE.trim()}\n`);
    expect(io.stderr).toBe("");
  });

  it("emits a style guide an agent can act on", async () => {
    const io = bufferIo();
    await run(["style-guide"], io);

    // Spot-check the sections the checker has rules for, so the two cannot
    // drift apart silently.
    expect(io.stdout).toContain("Never use leading slashes");
    expect(io.stdout).toContain("Line anchors and ranges");
    expect(io.stdout).toContain("Frontmatter (Metadata)");
    expect(io.stdout).toContain("Mermaid diagrams");
    expect(io.stdout).toContain("Vantage directives");
  });

  it("carries the two directive rules that are guidance, not code", async () => {
    const io = bufferIo();
    await run(["style-guide"], io);

    // Neither can be a lint: "too many directives" is a judgement, and whether a
    // `leaning` restates the leaning is a judgement about a sentence. They live
    // here because the guide is the only place they can live — and nothing in
    // the tool counts or caps directives per document.
    expect(io.stdout).toContain("Use them sparingly");
    expect(io.stdout).toContain('restates the leaning; it is never "yes"');
  });

  it("prints usage to stderr and exits 2 on a bad option", async () => {
    const io = bufferIo();
    const code = await run(["--frobnicate"], io);

    expect(code).toBe(EXIT_USAGE);
    expect(io.stdout).toBe("");
    expect(io.stderr).toContain("unknown option: --frobnicate");
  });

  it("prints a version", async () => {
    const io = bufferIo();
    const code = await run(["version"], io);

    expect(code).toBe(EXIT_OK);
    expect(io.stdout).toMatch(/^vantage-check \S+\n$/);
  });
});
