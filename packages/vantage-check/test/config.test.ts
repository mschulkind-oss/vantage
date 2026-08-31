import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  ConfigError,
  findConfig,
  loadConfig,
  parseConfig,
} from "../src/core/config.js";
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
      parseConfig("[server]\nport = 8000\n\n[check]\nstrict = true\n"),
    ).not.toThrow();
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
