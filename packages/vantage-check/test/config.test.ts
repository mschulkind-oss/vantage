import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ConfigError,
  findConfig,
  loadConfig,
  parseConfig,
} from "../src/core/config.js";
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
  // table out of the same file (docs/design/repo-config.md). This is not the
  // "other tools" guarantee above wearing a different hat — that one is about
  // being a good neighbour, and this one is load-bearing for a Vantage feature.
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
    const { policy, settings } = parseConfig(
      readFileSync(fixture, "utf8"),
      fixture,
    );

    // Our own keys, read out of a file that also holds the server's.
    expect(policy.strict).toBe(true);
    expect(policy.exitCode).toBe(3);
    expect(settings.severity("link/dead-section-anchor")).toBe("warning");
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

  // A typo that silently disables nothing is the quiet kind of wrong a checker
  // cannot afford, so every one of these is an error rather than a warning.
  it.each([
    ['[check.rules]\n"link/no-such-rule" = "error"\n', "unknown rule"],
    ['[check]\nstrict = "yes"\n', "must be true or false"],
    ["[check]\nexit-code = 999\n", "between 0 and 125"],
    ["[check]\nunexpected = 1\n", "unknown key"],
    ['[check.rules]\n"link/*" = "loud"\n', "must be"],
    ["[check\n", ""],
  ])("rejects %j", (source, fragment) => {
    expect(() => parseConfig(source)).toThrow(ConfigError);
    if (fragment) expect(() => parseConfig(source)).toThrow(fragment);
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

  it("honours the discovered config", async () => {
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
        ".vantage.toml": '[check.rules]\n"link/nope" = "error"\n',
        "index.md": "# Title\n",
      }),
    );

    expect(await run(["check", "."], io)).toBe(EXIT_USAGE);
    expect(io.stderr).toContain("unknown rule");
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
