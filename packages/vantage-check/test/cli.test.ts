import { describe, expect, it } from "vitest";
import { parseArgs, run } from "../src/cli.js";
import { bufferIo } from "../src/io.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit.js";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import { parsePlanningFilter } from "../../vantage-md/src/planning/index.js";
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

  // docs/design/planning-filter.md §8.1: given twice, the values join with one
  // space, in order, which is what typing both into the Filter box gives.
  it("parses index's --filter, every value joined with one space", () => {
    expect(
      parseArgs(["index", "--filter", "path:docs/a.md", "--filter=is:open"]),
    ).toEqual({
      kind: "index",
      options: { format: "text", filter: "path:docs/a.md is:open" },
    });
    // Empty is still given: the command reads it as no filter.
    expect(parseArgs(["index", "--filter", ""])).toEqual({
      kind: "index",
      options: { format: "text", filter: "" },
    });
    expect(parseArgs(["index", "--filter="])).toEqual({
      kind: "index",
      options: { format: "text", filter: "" },
    });
    expect(parseArgs(["index", "--filter", "", "--filter", "is:open"])).toEqual(
      { kind: "index", options: { format: "text", filter: " is:open" } },
    );
  });

  // The next argument is the value whatever it is, so an exclusion, or a
  // filter the command cannot read, is never an unknown option.
  it("takes the argument after --filter as its value, whatever it is", () => {
    expect(parseArgs(["index", "--filter", "-path:x"])).toEqual({
      kind: "index",
      options: { format: "text", filter: "-path:x" },
    });
    expect(parseArgs(["index", "--filter", "--roadmap"])).toEqual({
      kind: "index",
      options: { format: "text", filter: "--roadmap" },
    });
    expect(
      parseArgs([
        "index",
        "--request",
        "ready",
        "--filter",
        "path:docs",
        "--format=text",
      ]),
    ).toEqual({
      kind: "index",
      options: { format: "text", request: ["ready"], filter: "path:docs" },
    });
  });

  it.each([
    [
      ["index", "--filter"],
      "--filter needs a filter text, such as 'path:/docs/design/x.md is:open'",
    ],
    [
      ["index", "--filter", "path:a", "--filter"],
      "--filter needs a filter text, such as 'path:/docs/design/x.md is:open'",
    ],
    [
      ["index", "--request", "--filter", "path:a", "--format", "json"],
      "--request prints text, so it takes no --format json",
    ],
  ])("refuses %j", (argv, message) => {
    expect(parseArgs(argv)).toEqual({ kind: "usage-error", message });
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

  // The help is where an agent learns the filter (planning-filter.md §9.5):
  // its words and keys, the -, how terms combine, and what to do with the
  // link.
  it("lists --filter, its words, keys and -, among index's options, and its exit 2", async () => {
    const { USAGE } = await import("../src/help.js");
    const help = USAGE.replace(/\s+/g, " ");

    expect(USAGE).toContain(
      "\n  --filter <text>                    show only the entries the text keeps, as\n",
    );
    expect(USAGE).toMatch(/\n {39}word {12}text a question's id,\n/);
    expect(USAGE).toMatch(/\n {39}"a phrase" {6}the same, for words\n/);
    expect(USAGE).toMatch(/\n {39}path:<pattern> {2}a document whose path\n/);
    expect(USAGE).toMatch(/\n {39}is:open {9}a question still open\n/);
    expect(USAGE).toMatch(/\n {39}-<term> {9}leave out what the\n/);
    expect(help).toContain(
      "text a question's id, title, leaning or path holds, or a row's path, stage or next; in any case",
    );
    expect(help).toContain(
      "path: terms keep any of their matches; every other term must match.",
    );
    expect(help).toContain(
      "Paste the link into the planning page's Filter box: press / there.",
    );
    expect(help).toContain(
      'a document whose path holds the text, in any case. A * matches within a folder or file name, ** across folders, and a leading / pins it to the path\'s start. In "quotes", every character matches itself, a space too',
    );
    expect(help).toContain(
      "For index, also a --filter it cannot read, checked before anything is scanned, or one with a path: or -path: term that matches no path",
    );
    // Options for index, in order: --filter sits beside --roadmap.
    const options = USAGE.split("Options for index:\n")[1]?.split("\n\n")[0];
    expect(
      (options ?? "")
        .split("\n")
        .filter((line) => /^ {2}-/.test(line))
        .map((line) => line.trim().split(/\s{2,}/)[0]),
    ).toEqual([
      "--format text|json",
      "--request [<section>...]",
      "--roadmap <path>",
      "--filter <text>",
      "--config <path>",
      "--no-config",
    ]);
  });

  // §5.4, §5.5: a bare value holds any character but white space and a
  // quote, so the help says only what quotes are for: a space, and a `*`
  // that is a `*`.
  it("says which paths go in quotes as the parser reads them", () => {
    for (const ch of [
      "A",
      "z",
      "0",
      ".",
      "_",
      "-",
      "'",
      "+",
      "(",
      "#",
      "~",
      ",",
      "@",
      "?",
      "[",
      "\u00fc",
    ]) {
      expect(parsePlanningFilter(`path:docs/a${ch}b.md`), ch).toMatchObject({
        kind: "understood",
        canonical: `path:docs/a${ch}b.md`,
      });
      // Quoted, it is written bare, since bare it reads the same.
      expect(parsePlanningFilter(`path:"docs/a${ch}b.md"`), ch).toMatchObject({
        kind: "understood",
        canonical: `path:docs/a${ch}b.md`,
      });
    }
    // Bare, a space ends the path: what follows it is a word of its own.
    expect(parsePlanningFilter("path:docs/a b.md")).toMatchObject({
      kind: "understood",
      canonical: "path:docs/a b.md",
      terms: [
        { key: "path", value: "docs/a" },
        { key: "text", value: "b.md" },
      ],
    });
    expect(parsePlanningFilter('path:"docs/a b.md"')).toMatchObject({
      kind: "understood",
      canonical: 'path:"docs/a b.md"',
      terms: [{ key: "path", value: "docs/a b.md" }],
    });
    // Quoted, a `*` is a `*`, so it stays quoted.
    expect(parsePlanningFilter('path:"docs/*.md"')).toMatchObject({
      kind: "understood",
      canonical: 'path:"docs/*.md"',
      terms: [{ key: "path", value: "docs/*.md", quoted: true }],
    });
  });

  it("prints usage to stderr and exits 2 on --filter with no value", async () => {
    const io = bufferIo();
    const code = await run(["index", "--filter"], io);

    expect(code).toBe(EXIT_USAGE);
    expect(io.stdout).toBe("");
    expect(io.stderr).toContain("vantage-check: --filter needs a filter text");
    expect(io.stderr).toContain("Options for index:");
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
