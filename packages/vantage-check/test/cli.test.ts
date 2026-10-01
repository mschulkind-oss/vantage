import { describe, expect, it } from "vitest";
import { parseArgs, run } from "../src/cli.js";
import { bufferIo } from "../src/io.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit.js";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import { styleGuideHeader } from "../src/commands/styleGuide.js";

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

  it("parses index, which defaults to text", () => {
    expect(parseArgs(["index"])).toEqual({
      kind: "index",
      options: { format: "text" },
    });
  });

  it("parses index's options, inline values included", () => {
    expect(
      parseArgs([
        "index",
        "--format=json",
        "--config",
        "x.toml",
        "--no-config",
      ]),
    ).toEqual({
      kind: "index",
      options: { format: "json", configPath: "x.toml", noConfig: true },
    });
  });

  it("parses index's --roadmap, the last one winning", () => {
    expect(
      parseArgs(["index", "--roadmap", "a/roadmap.md", "--roadmap=b.md"]),
    ).toEqual({ kind: "index", options: { format: "text", roadmap: "b.md" } });
    expect(parseArgs(["index", "--roadmap"])).toMatchObject({
      kind: "usage-error",
      message: "--roadmap needs a path",
    });
  });

  it("parses index's --request: the sections after it, none meaning all", () => {
    expect(parseArgs(["index", "--request"])).toEqual({
      kind: "index",
      options: { format: "text", request: [] },
    });
    expect(
      parseArgs([
        "index",
        "--request",
        "graduate",
        "ready",
        "--roadmap",
        "r.md",
        "--request=disagrees",
        "graduate",
      ]),
    ).toEqual({
      kind: "index",
      options: {
        format: "text",
        roadmap: "r.md",
        // In the order given, each once; the output is in page order.
        request: ["graduate", "ready", "disagrees"],
      },
    });
    expect(parseArgs(["index", "--format", "text", "--request"])).toEqual({
      kind: "index",
      options: { format: "text", request: [] },
    });
  });

  it.each([
    [
      ["index", "--request", "needs-you"],
      "--request takes the sections an agent works on: unrouted (Not on a roadmap), ready (Ready to build), graduate (Ready to graduate), disagrees (Stage conflict) (got needs-you)",
    ],
    [
      ["index", "--request=Ready to build"],
      "--request takes the sections an agent works on: unrouted (Not on a roadmap), ready (Ready to build), graduate (Ready to graduate), disagrees (Stage conflict) (got Ready to build)",
    ],
    [
      ["index", "--request", "--format", "json"],
      "--request prints text, so it takes no --format json",
    ],
    [
      ["index", "--format=json", "--request", "ready"],
      "--request prints text, so it takes no --format json",
    ],
  ])("refuses %j", (argv, message) => {
    expect(parseArgs(argv)).toEqual({ kind: "usage-error", message });
  });

  // The ids are what --request takes and the titles are what the page shows,
  // and they differ (Stage conflict is `disagrees`), so the help pairs them.
  it("lists each section --request takes by its id and its title", async () => {
    const { USAGE } = await import("../src/help.js");

    expect(USAGE).toContain(
      [
        "                                     (default: all four):",
        "                                       unrouted   Not on a roadmap",
        "                                       ready      Ready to build",
        "                                       graduate   Ready to graduate",
        "                                       disagrees  Stage conflict",
        "  --roadmap <path>",
      ].join("\n"),
    );
  });

  // A section id is a word only straight after --request; anywhere else it
  // is a path, and index takes none.
  it("refuses a section id that does not follow --request", () => {
    expect(
      parseArgs(["index", "--request", "--roadmap", "r.md", "graduate"]),
    ).toMatchObject({
      kind: "usage-error",
      message: expect.stringContaining("index takes no paths"),
    });
  });

  // `index` scans the project the working directory is in, so a path would
  // be a second answer to a question the project root already settles.
  it.each([[["index", "docs"]], [["index", "--", "docs"]]])(
    "refuses a path after index: %j",
    (argv) => {
      expect(parseArgs(argv)).toMatchObject({
        kind: "usage-error",
        message: expect.stringContaining("index takes no paths"),
      });
    },
  );

  it("refuses check's own options on index", () => {
    expect(parseArgs(["index", "--jobs", "2"])).toMatchObject({
      kind: "usage-error",
      message: "unknown option for index: --jobs",
    });
  });

  // `index` is a command word now, so `vantage-check index` no longer checks a
  // path called index. `./index` still does.
  it("takes index as a command, and ./index as a path", () => {
    expect(parseArgs(["index"]).kind).toBe("index");
    expect(parseArgs(["./index"])).toMatchObject({
      kind: "check",
      options: { paths: ["./index"] },
    });
    expect(parseArgs(["check", "index"])).toMatchObject({
      kind: "usage-error",
      message: expect.stringContaining("is a command, not a path"),
    });
  });
});

describe("run", () => {
  // The first line names the release whose conventions follow
  // (checker-version-skew.md §6.1), and is the checker's own: everything after
  // it is the guide the app's modal and the npm export carry, byte for byte.
  it("prints one line naming its release, then the shared style guide verbatim", async () => {
    const io = bufferIo();
    const code = await run(["style-guide"], io);
    const newline = io.stdout.indexOf("\n");

    expect(code).toBe(EXIT_OK);
    expect(io.stdout.slice(0, newline)).toBe(styleGuideHeader());
    expect(io.stdout.slice(newline + 1)).toBe(`${STYLE_GUIDE.trim()}\n`);
    expect(io.stderr).toBe("");
  });

  it("says a development build's guide is no release's", async () => {
    const io = bufferIo();
    await run(["style-guide"], io);

    expect(io.stdout.split("\n")[0]).toMatch(
      /^A Vantage development build's conventions: /,
    );
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

    // Neither can be a lint: "too many directives" is a judgment, and whether a
    // `leaning` restates the leaning is a judgment about a sentence. They live
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

  it("lists index and its options in the help", async () => {
    const io = bufferIo();
    await run(["help"], io);

    expect(io.stdout).toContain("vantage-check index ");
    expect(io.stdout).toContain("Options for index:");
    expect(io.stdout).toContain("write ./index");
    expect(io.stdout).toContain("max-candidates");
    expect(io.stdout).toContain("[planning.stages]");
  });

  // Several roadmaps (planning-index.md §4, §13): the help says what the
  // rule and the index do with them, not what a single roadmap did.
  it("describes roadmaps as the index finds them", async () => {
    const io = bufferIo();
    await run(["help"], io);
    const help = io.stdout.replace(/\s+/g, " ");

    // In plain words: "routes" is a term the help has no room to define.
    expect(help).toMatch(
      /planning\/unrouted +An open question no roadmap links to, directly or through its document/,
    );
    expect(help).toContain(
      "(default: the one nearest the root that can be read and has no stage with the done role)",
    );
    expect(help).not.toMatch(/\brout(e|es|ed)\b/);
    expect(help).toContain(
      "every roadmap.md the planning index reads is a roadmap (one in a hidden directory, matched by .vantageignore, or ruled out by include or exclude is not)",
    );
  });

  it("keeps every rule id apart from its summary in the help", async () => {
    const io = bufferIo();
    await run(["help"], io);

    const rules = io.stdout.split("Rules:\n")[1]?.split("\n\n")[0] ?? "";
    for (const line of rules.split("\n")) {
      expect(line, line).toMatch(/^ {2}\S+ {2,}\S/);
    }
  });

  // Running from source is a development build, and says so rather than
  // printing a version no release ever had (checker-version-skew.md §4.2).
  it("prints a version, which from source is a development build", async () => {
    const io = bufferIo();
    const code = await run(["version"], io);

    expect(code).toBe(EXIT_OK);
    expect(io.stdout).toBe("vantage-check development build\n");
  });
});
