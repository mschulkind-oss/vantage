import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exitCode, runCheck } from "./check.js";
import {
  ConfigError,
  ConfigResolver,
  defaultConfig,
  findConfigFile,
  parseConfigFile,
  severityOf,
} from "./config.js";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "vantage-check-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Build a small repo-shaped tree under tmp. */
function repo(name: string, files: Record<string, string>, git = true): string {
  const root = path.join(tmp, name);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  if (git) mkdirSync(path.join(root, ".git"), { recursive: true });
  return root;
}

const BAD_LINK = "See [x](nope.md) for details.\n";

describe("findConfigFile", () => {
  it("finds the config at the git root, from a nested directory", () => {
    const root = repo("disc-1", {
      ".vantage.toml": "",
      "sub/doc.md": "text\n",
    });
    expect(findConfigFile(path.join(root, "sub"))).toBe(
      path.join(root, ".vantage.toml"),
    );
  });

  it("stops at the git root and never looks above it", () => {
    // A config in the *parent* of the git root must not be found.
    const parent = repo("disc-2", {
      ".vantage.toml": "[check]\nstrict = true\n",
    });
    const root = path.join(parent, "repo");
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, "doc.md"), "text\n");
    expect(findConfigFile(root)).toBeNull();
  });

  it("returns null when no config exists", () => {
    const root = repo("disc-3", { "doc.md": "text\n" });
    expect(findConfigFile(path.join(root, "nowhere"))).toBeNull();
  });
});

describe("ConfigResolver", () => {
  it("throws ConfigError for an explicit path that does not exist", () => {
    expect(
      () => new ConfigResolver(path.join(tmp, "missing", ".vantage.toml")),
    ).toThrowError(ConfigError);
  });

  it("uses the explicit path for every file", () => {
    const root = repo("res-1", {
      "other.toml": "[check]\nstrict = true\n",
      "doc.md": "text\n",
    });
    const resolver = new ConfigResolver(path.join(root, "other.toml"));
    expect(resolver.forFile(path.join(root, "doc.md")).strict).toBe(true);
  });

  it("falls back to defaults when nothing is found", () => {
    const root = repo("res-2", { "doc.md": "text\n" });
    const resolver = new ConfigResolver(null);
    const config = resolver.forFile(path.join(root, "doc.md"));
    expect(config.strict).toBe(false);
    expect(config.lint.enabled).toBe(false);
    expect(config.source).toBeNull();
  });
});

describe("parseConfigFile", () => {
  it("parses strict, severity overrides, and lint", () => {
    const root = repo("parse-1", {
      ".vantage.toml":
        '[check]\nstrict = true\n\n[check.severity]\n"link/missing-target" = "off"\n\n[check.lint]\nenabled = true\n',
    });
    const config = parseConfigFile(path.join(root, ".vantage.toml"));
    expect(config.strict).toBe(true);
    expect(config.severity.get("link/missing-target")).toBe("off");
    expect(config.lint.enabled).toBe(true);
  });

  it("rejects an invalid severity value", () => {
    const root = repo("parse-2", {
      ".vantage.toml": '[check.severity]\n"link/missing-target" = "blocker"\n',
    });
    expect(() =>
      parseConfigFile(path.join(root, ".vantage.toml")),
    ).toThrowError(/blocker/);
  });

  it("rejects a non-boolean strict", () => {
    const root = repo("parse-3", {
      ".vantage.toml": '[check]\nstrict = "yes"\n',
    });
    expect(() =>
      parseConfigFile(path.join(root, ".vantage.toml")),
    ).toThrowError(/strict/);
  });

  it("rejects malformed TOML", () => {
    const root = repo("parse-4", { ".vantage.toml": "this is [not toml" });
    expect(() =>
      parseConfigFile(path.join(root, ".vantage.toml")),
    ).toThrowError(ConfigError);
  });
});

describe("severityOf", () => {
  it("uses the built-in defaults", () => {
    expect(severityOf("link/missing-target", defaultConfig())).toBe("error");
    expect(severityOf("frontmatter/unclosed", defaultConfig())).toBe("warning");
  });

  it("treats lint/* and unknown rules as warnings", () => {
    expect(severityOf("lint/no-undefined-references", defaultConfig())).toBe(
      "warning",
    );
    expect(severityOf("no/such-rule", defaultConfig())).toBe("warning");
  });

  it("lets config overrides win, including off", () => {
    const config = defaultConfig();
    config.severity.set("link/missing-target", "off");
    config.severity.set("frontmatter/unclosed", "error");
    expect(severityOf("link/missing-target", config)).toBe("off");
    expect(severityOf("frontmatter/unclosed", config)).toBe("error");
  });
});

describe("runCheck with .vantage.toml (end to end)", () => {
  it("discovers a config per file and applies severity overrides", async () => {
    const root = repo("e2e-1", {
      ".vantage.toml": '[check.severity]\n"link/missing-target" = "off"\n',
      "doc.md": BAD_LINK,
    });
    const report = await runCheck(root, { strict: false, configPath: null });
    expect(report.findings).toEqual([]);
    expect(report.configError).toBeNull();
    expect(exitCode(report)).toBe(0);
  });

  it("downgrades a rule to warning without failing the run", async () => {
    const root = repo("e2e-2", {
      ".vantage.toml": '[check.severity]\n"link/missing-target" = "warning"\n',
      "doc.md": BAD_LINK,
    });
    const report = await runCheck(root, { strict: false, configPath: null });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe("warning");
    expect(exitCode(report)).toBe(0);
  });

  it("honors [check] strict from the config file", async () => {
    const root = repo("e2e-3", {
      ".vantage.toml":
        '[check]\nstrict = true\n\n[check.severity]\n"link/missing-target" = "warning"\n',
      "doc.md": BAD_LINK,
    });
    const report = await runCheck(root, { strict: false, configPath: null });
    expect(report.strict).toBe(true);
    expect(exitCode(report)).toBe(1);
  });

  it("the --strict flag beats a non-strict config", async () => {
    const root = repo("e2e-4", {
      ".vantage.toml": '[check.severity]\n"link/missing-target" = "warning"\n',
      "doc.md": BAD_LINK,
    });
    const report = await runCheck(root, { strict: true, configPath: null });
    expect(report.strict).toBe(true);
    expect(exitCode(report)).toBe(1);
  });

  it("reports configError and exits 2 when a discovered config is invalid", async () => {
    const root = repo("e2e-5", {
      ".vantage.toml": '[check.severity]\n"link/missing-target" = "blocker"\n',
      "doc.md": BAD_LINK,
    });
    const report = await runCheck(root, { strict: false, configPath: null });
    expect(report.configError).not.toBeNull();
    expect(report.configError).toMatch(/blocker/);
    expect(exitCode(report)).toBe(2);
  });

  it("applies an explicit --config path instead of discovering", async () => {
    const root = repo("e2e-6", {
      "custom.toml": '[check.severity]\n"link/missing-target" = "off"\n',
      "doc.md": BAD_LINK,
    });
    const report = await runCheck(root, {
      strict: false,
      configPath: path.join(root, "custom.toml"),
    });
    expect(report.findings).toEqual([]);
  });
});
