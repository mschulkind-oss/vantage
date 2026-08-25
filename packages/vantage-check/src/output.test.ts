import { describe, expect, it } from "vitest";
import { formatHuman, formatJson } from "./output.js";
import type { Report } from "./types.js";

const base: Report = {
  files: 2,
  findings: [],
  unchecked: [],
  environmentError: null,
  configError: null,
  strict: false,
};

describe("formatHuman", () => {
  it("reports a clean run", () => {
    expect(formatHuman(base)).toBe("✓ 2 files checked, no findings");
  });

  it("lists findings by position, then a summary", () => {
    const report: Report = {
      ...base,
      findings: [
        {
          file: "b.md",
          line: 1,
          rule: "link/missing-target",
          severity: "error",
          message: "no such file",
        },
        {
          file: "a.md",
          line: 2,
          rule: "frontmatter/unclosed",
          severity: "warning",
          message: "never closed",
        },
      ],
    };
    const out = formatHuman(report);
    expect(out.split("\n")[0]).toContain("a.md:2:");
    expect(out.split("\n")[1]).toContain("b.md:1:");
    expect(out).toContain("2 findings in 2 files (1 error, 1 warning)");
  });

  it("renders a config error and nothing else", () => {
    const report: Report = {
      ...base,
      configError:
        '.vantage.toml: [check.severity] "x" = "y" is not a valid severity',
    };
    expect(formatHuman(report)).toBe(
      'config error: .vantage.toml: [check.severity] "x" = "y" is not a valid severity',
    );
  });

  it("marks an inconclusive run instead of a green check", () => {
    const report: Report = {
      ...base,
      unchecked: ["mermaid/parse"],
      environmentError: "mermaid/parse: could not load mermaid",
    };
    const out = formatHuman(report);
    expect(out).not.toContain("✓");
    expect(out).toContain("2 files checked, no findings");
    expect(out).toContain("⚠ unchecked");
    expect(out).toContain("- mermaid/parse");
    expect(out).toContain("could not load mermaid");
    expect(out).toContain("exit 2");
  });
});

describe("formatJson", () => {
  it("round-trips the full report", () => {
    const report: Report = {
      ...base,
      strict: true,
      unchecked: ["lint"],
      environmentError: "lint: remark-lint failed to run",
    };
    expect(JSON.parse(formatJson(report))).toEqual(report);
  });
});
