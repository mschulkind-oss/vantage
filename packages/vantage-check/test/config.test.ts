import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ConfigError,
  MAX_CONFIG_BYTES,
  defaultConfig,
  findConfig,
  loadConfig,
  parseConfig,
} from "../src/core/config.js";
import {
  DEFAULT_PLANNING_CONFIG,
  type PlanningConfig,
} from "../../vantage-md/src/planning/index.js";
import { Settings } from "../src/core/settings.js";
import { run } from "../src/cli.js";
import { bufferIo } from "../src/io.js";
import { EXIT_FINDINGS, EXIT_OK, EXIT_USAGE } from "../src/exit.js";
import { makeTree } from "./helpers.js";

describe("parseConfig", () => {
  it("uses working defaults for an empty file", () => {
    const { settings, policy } = parseConfig("");

    expect(policy).toEqual({ strict: false, exitCode: 1 });
    expect(settings.setting("link/missing-target")).toBe("error");
  });

  it("sets a rule's severity", () => {
    const { settings } = parseConfig(
      '[check.rules]\n"link/dead-section-anchor" = "warning"\n',
    );

    expect(settings.setting("link/dead-section-anchor")).toBe("warning");
    expect(settings.setting("link/missing-target")).toBe("error");
  });

  it("turns a rule off", () => {
    const { settings } = parseConfig(
      '[check.rules]\n"link/line-anchor-range" = "off"\n',
    );

    expect(settings.enabled("link/line-anchor-range")).toBe(false);
  });

  it("applies a family glob, with the exact rule winning", () => {
    const { settings } = parseConfig(
      [
        "[check.rules]",
        '"link/*" = "warning"',
        '"link/missing-target" = "error"',
      ].join("\n"),
    );

    expect(settings.setting("link/leading-slash")).toBe("warning");
    expect(settings.setting("link/missing-target")).toBe("error");
  });

  it("reads the run policy", () => {
    const { policy } = parseConfig("[check]\nstrict = true\nexit-code = 0\n");

    expect(policy).toEqual({ strict: true, exitCode: 0 });
  });

  it("ignores sections that belong to other tools", () => {
    expect(() =>
      parseConfig("[tool.ruff]\nline-length = 100\n\n[check]\nstrict = true\n"),
    ).not.toThrow();
  });

  // `.vantage.toml` has a second reader: the server reads its own top-level
  // table out of the same file (docs/reference/repo-config.md). This is not the
  // "other tools" guarantee above wearing a different hat — that one is about
  // being a good neighbor, and this one is load-bearing for a Vantage feature.
  // If it ever stops holding, every repository that promotes a starred document
  // gets exit code 2 from the checker instead of a clean run.
  it("reads past the viewer's own section in the same file", () => {
    const { policy } = parseConfig(
      '[starred]\npromote = ["roadmap.md", "docs/*.md"]\n\n[check]\nstrict = true\n',
    );

    expect(policy.strict).toBe(true);
  });

  it("accepts the viewer's section on its own, with no [check] at all", () => {
    const { policy, settings } = parseConfig(
      '[starred]\npromote = ["roadmap.md"]\n',
    );

    expect(policy).toEqual({ strict: false, exitCode: 1 });
    expect(settings).toEqual(Settings.defaults());
  });

  // The TypeScript half of the shared-file conformance check. Its sibling is
  // TestSharedFixtureIsReadableByThisReader in internal/repoconfig, which parses
  // the same bytes and asserts the complementary half.
  //
  // One fixture rather than two copies, because the property under test is that
  // the two readers agree about one file. Two would let them drift apart while
  // both suites stayed green — the failure sharing a file invites.
  //
  // The fixture deliberately is not named `.vantage.toml`: findConfig walks up
  // from any document below it, so a file with that name committed in this tree
  // would silently become the configuration for the documentation gate.
  it("reads the shared conformance fixture the server also parses", () => {
    const fixture = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "internal",
      "repoconfig",
      "testdata",
      "shared-config.toml",
    );
    const { policy, settings, target, warnings } = parseConfig(
      readFileSync(fixture, "utf8"),
      fixture,
    );

    // Our own keys, read out of a file that also holds the server's.
    expect(policy.strict).toBe(true);
    expect(policy.exitCode).toBe(3);
    expect(settings.severity("link/dead-section-anchor")).toBe("warning");
    expect(target?.written).toBe("0.8");
    expect(warnings).toEqual([]);
  });

  // [planning] is the one table both readers parse, and the checker reads all
  // of it. The server's suite asserts the half it reads out of the same bytes.
  it("reads [planning] out of the shared conformance fixture", () => {
    const fixture = testdata("shared-config.toml");
    const { planning } = parseConfig(readFileSync(fixture, "utf8"), fixture);

    // A string is a list of one (docs/reference/planning-index.md §14).
    expect(planning).toEqual({
      roadmaps: ["plans/ROADMAP.md"],
      include: ["docs/**", "plans/**"],
      exclude: ["docs/gallery/**"],
      maxFileBytes: 65536,
      maxCandidates: 250,
      stages: {
        DRAFTED: "open",
        SETTLED: "ready",
        SHIPPED: "built",
        RETIRED: "done",
      },
    });
  });

  // A mistyped --config is a bad argument, and it has to READ like one.
  //
  // `existsSync` is true for a directory, so this reached readFileSync and
  // aborted with `EISDIR: illegal operation on a directory` and a stack trace
  // into the bundle — reported as exit 3, "a check could not run", which claims
  // the checker's own environment broke rather than that the invocation was
  // wrong. Exit 2 is the code for "fix the invocation".
  it("reports a directory passed to --config instead of crashing", async () => {
    const cwd = makeTree({ "index.md": "# Doc\n", "sub/keep.md": "# Sub\n" });
    const io = bufferIo(cwd);

    const code = await run(["check", "--config", "sub", "."], io);

    expect(code).toBe(EXIT_USAGE);
    expect(io.stderr).toContain("is a directory, not a config file");
    expect(io.stderr).not.toContain("internal error");
    expect(io.stderr).not.toContain("EISDIR");
  });

  // The server ignores a .vantage.toml past 200 KiB and serves the defaults
  // (internal/repoconfig), so a checker that applied one would scan under a
  // table the planning page never reads (P7). Refused as the server's other
  // rejections are: exit 2.
  it("refuses a config larger than the server reads, and takes one at the cap", async () => {
    const padded = (size: number) => {
      const table = '[planning]\nexclude = ["docs/**"]\n';
      return `${table}#${"x".repeat(size - table.length - 2)}\n`;
    };
    const over = makeTree({ ".vantage.toml": padded(204801), "a.md": "# A\n" });
    const io = bufferIo(over);
    expect(await run(["index"], io)).toBe(EXIT_USAGE);
    expect(io.stderr).toContain("larger than 204800 bytes");

    const at = makeTree({ ".vantage.toml": padded(204800), "a.md": "# A\n" });
    expect(await run(["index"], bufferIo(at))).toBe(0);
  });

  it("caps a config where the server does, read from its Go source", () => {
    const go = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "..",
        "internal",
        "repoconfig",
        "repoconfig.go",
      ),
      "utf8",
    );
    const [, kib] = /const maxSize = (\d+) \* 1024\b/.exec(go) ?? [];
    expect(Number(kib) * 1024).toBe(MAX_CONFIG_BYTES);
  });

  it("still reports a --config path that is not there", async () => {
    const cwd = makeTree({ "index.md": "# Doc\n" });
    const io = bufferIo(cwd);

    const code = await run(["check", "--config", "no-such.toml", "."], io);

    expect(code).toBe(EXIT_USAGE);
    expect(io.stderr).toContain("no config file at");
  });

  // The one arrangement that breaks the shared file, pinned so nobody "tidies"
  // the server's keys under the checker's table. The parser IS strict — one
  // level down — so this reads as the neat option and is a breaking change for
  // every existing .vantage.toml user.
  it.each([
    '[check.starred]\npromote = ["roadmap.md"]\n',
    '[check]\nstarred = ["roadmap.md"]\n',
  ])("refuses the viewer's keys nested under [check]: %s", (source) => {
    expect(() => parseConfig(source)).toThrow(ConfigError);
    expect(() => parseConfig(source)).toThrow(/unknown key/);
  });

  // checker-version-skew.md §6.2. An unknown key or rule id is a typo, or the
  // configuration of a newer vantage-check than this one, and an agent told
  // only "unknown" deletes the line. So each is ignored with a warning that
  // names this checker, says to run a newer one and keep the line, and says to
  // fix a typo; the rest of the file still applies.
  it.each([
    [
      "[check]\nstrict = true\nfuture-key = 1\n",
      "unknown key check.future-key, which this development build of vantage-check does not know, so this run ignores it.",
      "key",
    ],
    [
      '[check]\nstrict = true\n\n[planning]\nroadmaps = "r.md"\n',
      "unknown key planning.roadmaps, which this development build of vantage-check does not know, so this run ignores it. Here [planning] takes",
      "key",
    ],
    [
      '[check]\nstrict = true\n\n[check.rules]\n"future/rule" = "error"\n',
      'unknown rule "future/rule", which this development build of vantage-check does not have, so this run ignores it.',
      "rule",
    ],
    [
      '[check]\nstrict = true\n\n[check.rules]\n"planning/question-length" = { future-key = 1 }\n',
      'unknown key "future-key" for rule "planning/question-length", which in this development build of vantage-check takes severity and max-words, so this run ignores the key.',
      "key",
    ],
    [
      '[check]\nstrict = true\n\n[check.rules]\n"link/missing-target" = { future-key = 1 }\n',
      'unknown key "future-key" for rule "link/missing-target", which in this development build of vantage-check takes only a severity, so this run ignores the key.',
      "key",
    ],
  ])(
    "ignores %j with a warning that says to keep it if it is newer",
    (source, opening, what) => {
      const { policy, warnings } = parseConfig(source);

      expect(policy.strict).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(opening);
      expect(warnings[0]).toContain(
        `If this repository is configured for a newer vantage-check, run one (for example, \`uvx vantage-check@latest\`) and don't remove the ${what}; if it is a typo, fix it.`,
      );
    },
  );

  // The server refuses the whole file over a [planning] key it does not know,
  // so the checker, which only warns, says what the viewer does with it.
  it("says that a viewer of its release ignores the file over an unknown [planning] key", () => {
    const { warnings } = parseConfig('[planning]\nroadmaps = "r.md"\n');

    expect(warnings[0]).toContain(
      "a viewer from this development build ignores the whole file over a key it does not know, [starred] and theme included.",
    );
  });

  it("applies what it knows around what it ignores", () => {
    const { settings, planning, warnings } = parseConfig(
      [
        "[check.rules]",
        '"future/rule" = "error"',
        '"link/dead-section-anchor" = "warning"',
        '"planning/question-length" = { severity = "error", max-words = 90, max-sentences = 3 }',
        "",
        "[planning]",
        'exclude = ["docs/gallery/**"]',
        "future-key = true",
      ].join("\n"),
    );

    expect(warnings).toHaveLength(3);
    expect(settings.setting("link/dead-section-anchor")).toBe("warning");
    expect(settings.setting("planning/question-length")).toBe("error");
    expect(settings.option("planning/question-length", "max-words")).toBe(90);
    expect(planning.exclude).toEqual(["docs/gallery/**"]);
  });

  // A rule a later release gives options to takes a table there, so a table
  // here is read for its severity, and any other key in it is warned about.
  it("reads a severity-only table for a rule with no options, and warns about nothing", () => {
    const { settings, warnings } = parseConfig(
      '[check.rules]\n"link/missing-target" = { severity = "warning" }\n',
    );

    expect(warnings).toEqual([]);
    expect(settings.setting("link/missing-target")).toBe("warning");
  });

  // The viewer's own names, written below a table header, are neither a typo
  // nor a newer checker's key: "keep it and run a newer checker" would leave a
  // `theme` where it does nothing. The fix is where it is written, and the
  // opening is still the one the user guide's theme pages quote.
  it.each([
    [
      '[check]\nstrict = true\ntheme = "solarized-dark"\n',
      "unknown key check.theme.",
      "move it above the first [table]",
    ],
    [
      '[check.rules]\n"link/*" = "error"\ntheme = "solarized-dark"\n',
      'unknown rule "theme".',
      "move it above the first [table]",
    ],
    [
      '[planning]\nexclude = []\ntheme = "solarized-dark"\n',
      "unknown key planning.theme.",
      "move it above the first [table]",
    ],
    [
      '[check.starred]\npromote = ["roadmap.md"]\n',
      "unknown key check.starred.",
      "write it as a top-level [starred] table",
    ],
  ])("says where the viewer's key goes: %j", (source, opening, fix) => {
    let message = "";
    try {
      parseConfig(source);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }

    expect(message).toContain(opening);
    expect(message).toContain(fix);
    expect(message).not.toMatch(/newer vantage-check|don't remove/);
  });

  // A value this checker cannot take for a key it knows is never a newer
  // release's key, so every one of these is an error rather than a warning.
  it.each([
    ['[check]\nstrict = "yes"\n', "must be true or false"],
    ["[check]\nexit-code = 999\n", "between 0 and 125"],
    ['[check.rules]\n"link/*" = "loud"\n', "must be"],
    ["[check\n", ""],
  ])("rejects %j", (source, fragment) => {
    expect(() => parseConfig(source)).toThrow(ConfigError);
    if (fragment) expect(() => parseConfig(source)).toThrow(fragment);
  });
});

describe("a rule written as a table", () => {
  const RULE = "planning/question-length";
  const rules = (value: string) => `[check.rules]\n"${RULE}" = ${value}\n`;

  it("sets the rule's options and its severity", () => {
    const { settings } = parseConfig(
      rules('{ severity = "error", max-words = 150 }'),
    );

    expect(settings.setting(RULE)).toBe("error");
    expect(settings.option(RULE, "max-words")).toBe(150);
  });

  it("reads the table-header form the same way", () => {
    const { settings } = parseConfig(
      `[check.rules."${RULE}"]\nseverity = "off"\nmax-words = 90\n`,
    );

    expect(settings.enabled(RULE)).toBe(false);
    expect(settings.option(RULE, "max-words")).toBe(90);
  });

  it("leaves the severity to the family, `*` and the default without one", () => {
    expect(
      parseConfig(rules("{ max-words = 150 }")).settings.setting(RULE),
    ).toBe("warning");
    const family = parseConfig(
      `[check.rules]\n"planning/*" = "error"\n"${RULE}" = { max-words = 150 }\n`,
    ).settings;
    expect(family.setting(RULE)).toBe("error");
    expect(family.option(RULE, "max-words")).toBe(150);
  });

  it("gives an option its default when nothing sets it", () => {
    expect(Settings.defaults().option(RULE, "max-words")).toBe(120);
    expect(
      parseConfig(rules('"error"')).settings.option(RULE, "max-words"),
    ).toBe(120);
  });

  it("survives the crossing to a worker, as plain data", () => {
    const { settings } = parseConfig(
      rules('{ severity = "error", max-words = 7 }'),
    );
    const cloned = structuredClone({
      overrides: settings.entries(),
      options: settings.optionEntries(),
    });
    const rebuilt = new Settings(
      new Map(cloned.overrides),
      new Map(cloned.options),
    );

    expect(rebuilt.setting(RULE)).toBe("error");
    expect(rebuilt.option(RULE, "max-words")).toBe(7);
  });

  it.each([
    [rules("{ max-words = 0 }"), "whole number of 1 or more"],
    [rules("{ max-words = 1.5 }"), "whole number of 1 or more"],
    [rules('{ max-words = "150" }'), "whole number of 1 or more"],
    [rules('{ severity = "loud" }'), "must be"],
    [
      '[check.rules]\n"planning/*" = { max-words = 150 }\n',
      "takes only a severity",
    ],
    [
      '[check.rules]\n"*" = { severity = "warning" }\n',
      "takes only a severity",
    ],
    [rules("1979-05-27"), "must be"],
  ])("rejects %j", (source, fragment) => {
    expect(() => parseConfig(source)).toThrow(ConfigError);
    expect(() => parseConfig(source)).toThrow(fragment);
  });

  it.each([
    [rules("{ max-chars = 150 }"), 'unknown key "max-chars"'],
    ['[check.rules]\n"planning/nope" = { max-words = 150 }\n', "unknown rule"],
  ])("ignores %j with a warning", (source, fragment) => {
    const { warnings } = parseConfig(source);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(fragment);
  });
});

/** A file in the shared fixtures the server's suite also reads. */
function testdata(name: string): string {
  return join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "internal",
    "repoconfig",
    "testdata",
    name,
  );
}

interface PlanningConfigCase {
  name: string;
  toml: string;
  ok: boolean;
  planning?: PlanningConfig;
}

// The server's internal/repoconfig test reads the same cases, so the two
// readers of `[planning]` accept and refuse exactly the same files, and resolve
// an accepted one to the same table (docs/reference/planning-index.md §14).
describe("[planning], as planning-config.json pins it for both readers", () => {
  const { cases } = JSON.parse(
    readFileSync(testdata("planning-config.json"), "utf8"),
  ) as { cases: PlanningConfigCase[] };

  it("holds cases of both kinds", () => {
    expect(cases.some((c) => c.ok)).toBe(true);
    expect(cases.some((c) => !c.ok)).toBe(true);
  });

  it.each(cases.filter((c) => c.ok).map((c) => [c.name, c] as const))(
    "accepts %s",
    (_name, c) => {
      expect(parseConfig(c.toml).planning).toEqual(c.planning);
    },
  );

  it.each(cases.filter((c) => !c.ok).map((c) => [c.name, c] as const))(
    "refuses %s, whole",
    (_name, c) => {
      expect(() => parseConfig(c.toml)).toThrow(ConfigError);
    },
  );

  it("resolves a file with no [planning] table to the defaults", () => {
    expect(parseConfig("").planning).toEqual(DEFAULT_PLANNING_CONFIG);
    expect(defaultConfig().planning).toEqual(DEFAULT_PLANNING_CONFIG);
  });

  it("never hands out the shared default's arrays", () => {
    const first = defaultConfig().planning;
    first.include.push("x/**");

    expect(defaultConfig().planning.include).toEqual(["**/*.md"]);
    expect(DEFAULT_PLANNING_CONFIG.include).toEqual(["**/*.md"]);
  });

  it.each([
    ['[planning.stages]\nX = "shipped"\n', '"open", "ready", "built", "done"'],
    ["[planning]\nmax-candidates = 0\n", "whole number of 1 or more"],
    ['[planning]\nroadmap = "../r.md"\n', "inside the repository"],
    ['[planning]\ninclude = "**/*.md"\n', "list of gitignore-style patterns"],
    ['[planning]\nstages = ["DESIGN"]\n', "planning.stages must be a table"],
  ])("says what is wrong with %j", (source, fragment) => {
    expect(() => parseConfig(source)).toThrow(fragment);
  });

  // §14: an entry's error names planning.roadmap, the entry's position
  // counted from 1, and its value.
  it.each([
    [
      '[planning]\nroadmap = ["roadmap.md", 3]\n',
      "entry 2 of planning.roadmap must be a repo-relative path written as text (got 3)",
    ],
    [
      '[planning]\nroadmap = [["roadmap.md"]]\n',
      'entry 1 of planning.roadmap must be a repo-relative path written as text (got ["roadmap.md"])',
    ],
    [
      '[[planning.roadmap]]\npath = "roadmap.md"\n',
      'entry 1 of planning.roadmap must be a repo-relative path written as text (got {"path":"roadmap.md"})',
    ],
    [
      '[planning]\nroadmap = ["roadmap.md", "./"]\n',
      'entry 2 of planning.roadmap is empty (got "./")',
    ],
    [
      '[planning]\nroadmap = ["a.md", "docs/../roadmap.md"]\n',
      'entry 2 of planning.roadmap must be a path inside the repository, relative to its root, with no leading / and no .. (got "docs/../roadmap.md")',
    ],
    [
      '[planning]\nroadmap = ["plans/roadmap.md", "a.md", "./plans/roadmap.md"]\n',
      'entry 3 of planning.roadmap ("./plans/roadmap.md") names the same path as entry 1',
    ],
    [
      '[planning]\nroadmap = { path = "roadmap.md" }\n',
      'planning.roadmap must be a repo-relative path written as text, or a list of them (got {"path":"roadmap.md"})',
    ],
    [
      "[planning]\nroadmap = true\n",
      "planning.roadmap must be a repo-relative path written as text, or a list of them (got true)",
    ],
  ])("says which roadmap entry is wrong in %j", (source, fragment) => {
    expect(() => parseConfig(source)).toThrow(ConfigError);
    expect(() => parseConfig(source)).toThrow(fragment);
  });

  it("keeps the list in the order written, and a string as a list of one", () => {
    expect(
      parseConfig('[planning]\nroadmap = ["b/roadmap.md", "./a.md"]\n').planning
        .roadmaps,
    ).toEqual(["b/roadmap.md", "a.md"]);
    expect(
      parseConfig('[planning]\nroadmap = "./a.md"\n').planning.roadmaps,
    ).toEqual(["a.md"]);
    expect(parseConfig("[planning]\nroadmap = []\n").planning.roadmaps).toEqual(
      [],
    );
    expect(parseConfig("[planning]\n").planning.roadmaps).toBeNull();
  });
});

interface VersionSkewCase {
  name: string;
  toml: string;
  server: "accepts" | "refuses";
  checker: "accepts" | "warns" | "refuses";
  target?: string | null;
  says?: string;
  planning?: PlanningConfig;
}

// The server's internal/repoconfig test reads the same cases and asserts its
// own answer, which differs from this one where the fixture says so: this
// checker ignores a key it does not know with a warning, and the server still
// refuses the whole file over one in [starred] or [planning].
describe("a file written for another release, as version-skew-config.json pins it", () => {
  const { cases } = JSON.parse(
    readFileSync(testdata("version-skew-config.json"), "utf8"),
  ) as { cases: VersionSkewCase[] };

  it("holds every answer this reader gives, and cases where the readers part", () => {
    const answers = new Set(cases.map((c) => c.checker));
    expect([...answers].sort()).toEqual(["accepts", "refuses", "warns"]);
    expect(
      cases.some((c) => c.checker === "warns" && c.server === "refuses"),
    ).toBe(true);
    expect(
      cases.some((c) => c.checker === "refuses" && c.server === "accepts"),
    ).toBe(true);
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    if (c.checker === "refuses") {
      expect(() => parseConfig(c.toml)).toThrow(ConfigError);
      if (c.says !== undefined)
        expect(() => parseConfig(c.toml)).toThrow(c.says);
      return;
    }
    const parsed = parseConfig(c.toml);
    expect(parsed.target?.written ?? null).toBe(c.target);
    if (c.checker === "warns") {
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.warnings[0]).toContain(c.says);
    } else {
      expect(parsed.warnings).toEqual([]);
    }
    if (c.planning !== undefined) expect(parsed.planning).toEqual(c.planning);
  });
});

describe("target", () => {
  it.each([
    ["0.8", [0, 8, 0]],
    ["0.8.1", [0, 8, 1]],
    ["1.0", [1, 0, 0]],
    ["0.10", [0, 10, 0]],
    ["0.0", [0, 0, 0]],
  ])("reads %s as a release", (written, version) => {
    expect(parseConfig(`target = "${written}"\n`).target).toEqual({
      written,
      version,
    });
  });

  it("is null when the file declares none, and with no file at all", () => {
    expect(parseConfig("[check]\nstrict = true\n").target).toBeNull();
    expect(defaultConfig().target).toBeNull();
  });

  it("names the forms it takes, and what it got", () => {
    expect(() => parseConfig("target = 0.8\n")).toThrow(
      'target must name one Vantage release as text, "X.Y" or "X.Y.Z", such as target = "0.8" (got 0.8).',
    );
    expect(() => parseConfig('target = "v0.8"\n')).toThrow('(got "v0.8")');
  });

  // §4.1: appended to a file that ends in a table, the key lands in it.
  it.each([
    ['[check]\ntarget = "0.8"\n', "unknown key check.target."],
    ['[check.rules]\ntarget = "0.8"\n', 'unknown rule "target".'],
    ['[planning]\ntarget = "0.8"\n', "unknown key planning.target."],
    [
      '[planning.stages]\nDESIGN = "open"\ntarget = "0.8"\n',
      "planning.stages.target is a release, not a stage's role.",
    ],
    ["[planning.stages]\ntarget = 0.8\n", "planning.stages.target"],
    [
      '[check.rules."planning/question-length"]\ntarget = "0.8"\n',
      'unknown key "target" for rule "planning/question-length".',
    ],
    // The server's table, whose other keys this checker never reads.
    [
      '[starred]\npromote = ["roadmap.md"]\ntarget = "0.8"\n',
      "unknown key starred.target.",
    ],
  ])("says to move a target written below a table: %j", (source, opening) => {
    let message = "";
    try {
      parseConfig(source);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }

    expect(message).toContain(opening);
    expect(message).toContain(
      "`target` is a top-level key, and TOML reads a key written after a [table] header as part of that table: move it above the first [table].",
    );
  });
});

describe("discovery", () => {
  it("walks up from the target to the repository root", () => {
    const root = makeTree({
      ".vantage.toml": "[check]\nstrict = true\n",
      "docs/deep/index.md": "# Title\n",
    });

    expect(findConfig(join(root, "docs/deep/index.md"))).toBe(
      join(root, ".vantage.toml"),
    );
    expect(loadConfig({ from: join(root, "docs/deep") }).policy.strict).toBe(
      true,
    );
  });

  it("uses defaults when there is no config anywhere above", () => {
    const root = makeTree({ "index.md": "# Title\n" });

    // A tmp dir has no .vantage.toml above it, which is the bare-checkout case.
    expect(loadConfig({ from: root }).policy).toEqual({
      strict: false,
      exitCode: 1,
    });
  });

  it("fails loudly on an explicit --config that is not there", () => {
    expect(() =>
      loadConfig({ from: process.cwd(), explicitPath: "/nope/.vantage.toml" }),
    ).toThrow(ConfigError);
  });
});

describe("check with configuration", () => {
  const tree = {
    ".vantage.toml": '[check.rules]\n"link/missing-target" = "off"\n',
    "index.md": "[Gone](./nowhere.md)\n",
  };

  it("honors the discovered config", async () => {
    const io = bufferIo(makeTree(tree));

    expect(await run(["check", "."], io)).toBe(EXIT_OK);
  });

  it("--no-config puts the defaults back", async () => {
    const io = bufferIo(makeTree(tree));

    expect(await run(["check", ".", "--no-config"], io)).toBe(EXIT_FINDINGS);
  });

  it("reports a broken config instead of checking with half of it", async () => {
    const io = bufferIo(
      makeTree({
        ".vantage.toml": '[check.rules]\n"link/*" = "loud"\n',
        "index.md": "# Title\n",
      }),
    );

    expect(await run(["check", "."], io)).toBe(EXIT_USAGE);
    expect(io.stderr).toContain('rule "link/*" must be');
    expect(io.stdout).toBe("");
  });

  // Forward compatible (checker-version-skew.md): a rule from a newer release
  // is warned about on stderr and the run goes on under the rest of the file,
  // with the exit code its findings earn and nothing in the report about it.
  it("warns about a rule it does not know, and checks under the rest", async () => {
    const io = bufferIo(
      makeTree({
        ".vantage.toml":
          '[check.rules]\n"future/rule" = "error"\n"link/missing-target" = "off"\n',
        "index.md": "[Gone](./nowhere.md)\n",
      }),
    );

    expect(await run(["check", "."], io)).toBe(EXIT_OK);
    expect(io.stderr).toMatch(
      /^vantage-check: warning: \.vantage\.toml: unknown rule "future\/rule"/,
    );
    expect(io.stderr.split("\n").filter(Boolean)).toHaveLength(1);
    expect(io.stdout).not.toContain("future/rule");
  });

  // §3.3: a warning about the checker's own age is not a finding about the
  // documents, so neither way of asking for strictness counts it.
  it.each([
    ["--strict", "", ["check", "--strict", "--format", "json", "."]],
    ["check.strict", "strict = true\n", ["check", "--format", "json", "."]],
  ])(
    "never lets a config warning change the exit code, under %s",
    async (_name, strict, argv) => {
      const io = bufferIo(
        makeTree({
          ".vantage.toml": `[check]\n${strict}future-key = 1\n\n[check.rules]\n"future/rule" = "error"\n`,
          "index.md": "# Title\n\nClean.\n",
        }),
      );

      expect(await run(argv, io)).toBe(EXIT_OK);
      const warnings = io.stderr.split("\n").filter(Boolean);
      expect(warnings).toHaveLength(2);
      expect(warnings.join("\n")).toContain("unknown key check.future-key");
      expect(warnings.join("\n")).toContain('unknown rule "future/rule"');
      const report = JSON.parse(io.stdout) as {
        summary: { warnings: number; errors: number };
      };
      expect(report.summary.warnings).toBe(0);
      expect(report.summary.errors).toBe(0);
      expect(io.stdout).not.toContain("future");
    },
  );

  it("names the file one way in everything a run says about it", async () => {
    // A note about its target and a warning about its keys, in one run, both
    // relative to where the run was started; and an error the same way.
    const io = bufferIo(
      makeTree({
        ".vantage.toml": 'target = "0.8"\n\n[check]\nfuture-key = 1\n',
        "index.md": "# Title\n",
      }),
    );
    expect(await run(["check", "."], io)).toBe(EXIT_OK);
    const lines = io.stderr.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^vantage-check: \.vantage\.toml targets Vantage 0\.8/,
    );
    expect(lines[1]).toMatch(
      /^vantage-check: warning: \.vantage\.toml: unknown key check\.future-key/,
    );

    const bad = bufferIo(
      makeTree({ ".vantage.toml": "target = 0.8\n", "index.md": "# Title\n" }),
    );
    expect(await run(["check", "."], bad)).toBe(EXIT_USAGE);
    expect(bad.stderr).toMatch(
      /^vantage-check: \.vantage\.toml: target must name/,
    );
  });

  it("warns once about a key in a root's own file that the run also reads", async () => {
    const outer = makeTree({
      "one/.git/HEAD": "ref: refs/heads/main\n",
      "one/.vantage.toml": "[planning]\nfuture-key = 1\n",
      "one/a.md": "# A\n",
      "two/.git/HEAD": "ref: refs/heads/main\n",
      "two/.vantage.toml": "[planning]\nanother-key = 1\n",
      "two/b.md": "# B\n",
    });
    const io = bufferIo(outer);

    expect(await run(["check", "one/a.md", "two/b.md"], io)).toBe(EXIT_OK);
    const warnings = io.stderr.split("\n").filter(Boolean);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("unknown key planning.future-key");
    expect(warnings[1]).toContain("unknown key planning.another-key");
  });

  // The design wants a bad [planning] to fail loudly rather than be read as
  // half a table, and the checker has only one way to say so: exit 2, for
  // every command, `check` included (docs/reference/planning-index.md §14).
  it("refuses a check whose [planning] is bad, before checking anything", async () => {
    const io = bufferIo(
      makeTree({
        ".vantage.toml": '[planning.stages]\nDESIGN = "shipped"\n',
        "index.md": "# Title\n",
      }),
    );

    expect(await run(["check", "."], io)).toBe(EXIT_USAGE);
    expect(io.stderr).toContain("planning.stages");
    expect(io.stdout).toBe("");
  });

  it("lets the config choose the failing exit code", async () => {
    const io = bufferIo(
      makeTree({
        ".vantage.toml": "[check]\nexit-code = 0\n",
        "index.md": "[Gone](./nowhere.md)\n",
      }),
    );

    expect(await run(["check", "."], io)).toBe(EXIT_OK);
    expect(io.stdout).toContain("link/missing-target");
  });
});
