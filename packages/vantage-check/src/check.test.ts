import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectMarkdownFiles,
  exitCode,
  isMarkdownFile,
  runCheck,
} from "./check.js";
import type { Finding } from "./types.js";

const FIX = path.resolve(process.cwd(), "test/fixtures/repo");
const rel = (p: string) => path.relative(process.cwd(), path.join(FIX, p));
const sig = (f: Finding) => `${f.file}:${f.line}:${f.rule}`;

describe("isMarkdownFile", () => {
  it("matches .md case-insensitively and nothing else", () => {
    expect(isMarkdownFile("a.md")).toBe(true);
    expect(isMarkdownFile("A.MD")).toBe(true);
    expect(isMarkdownFile("a.markdown")).toBe(false);
    expect(isMarkdownFile("a.txt")).toBe(false);
  });
});

describe("collectMarkdownFiles", () => {
  it("collects .md files under a directory, sorted", () => {
    const files = collectMarkdownFiles(FIX).map((f) => path.relative(FIX, f));
    expect(files).toEqual(["README.md", "docs/guide.md", "docs/notes.md"]);
  });

  it("returns the single markdown file for a file argument", () => {
    expect(collectMarkdownFiles(path.join(FIX, "README.md"))).toEqual([
      path.join(FIX, "README.md"),
    ]);
  });

  it("returns empty for a non-markdown file argument", () => {
    expect(collectMarkdownFiles(path.join(FIX, "docs", "data.txt"))).toEqual(
      [],
    );
  });
});

describe("runCheck (end to end)", () => {
  it("finds exactly the seeded findings", async () => {
    const report = await runCheck(FIX, { strict: false, configPath: null });
    expect(report.files).toBe(3);
    const got = report.findings.map(sig).sort();
    const expected = [
      `${rel("docs/guide.md")}:7:link/missing-target`,
      `${rel("docs/guide.md")}:8:link/leading-slash`,
      `${rel("docs/notes.md")}:10:link/missing-target`,
      `${rel("docs/notes.md")}:12:link/line-anchor-range`,
      `${rel("docs/notes.md")}:12:link/dead-section-anchor`,
    ].sort();
    expect(got).toEqual(expected);
  });

  it("reports no findings for a clean document", async () => {
    const report = await runCheck(path.join(FIX, "README.md"), {
      strict: false,
      configPath: null,
    });
    expect(report.files).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("skips hidden directories and node_modules", async () => {
    const report = await runCheck(FIX, { strict: false, configPath: null });
    expect(report.findings.every((f) => !f.file.includes("node_modules"))).toBe(
      true,
    );
  });
});

describe("exitCode", () => {
  it("is 1 when the tree has error findings", async () => {
    const report = await runCheck(FIX, { strict: false, configPath: null });
    expect(exitCode(report)).toBe(1);
  });

  it("is 0 for a clean document", async () => {
    const report = await runCheck(path.join(FIX, "README.md"), {
      strict: false,
      configPath: null,
    });
    expect(exitCode(report)).toBe(0);
  });
});
