import { describe, expect, it } from "vitest";
import { docFromContent } from "../parse.js";
import { validateLint } from "./lint.js";

const doc = (content: string) =>
  docFromContent(content, "/repo/doc.md", "doc.md");

describe("validateLint", () => {
  it("reports remark-lint recommended-preset findings as lint/* warnings", async () => {
    // no-undefined-references (line 1), ordered-list-marker-style (line 4),
    // final-newline (the document has none).
    const content =
      "[link][missing-ref]\n\n1. a\n2) b\n\npara with no final newline";
    const findings = await validateLint.run(doc(content));
    const rules = findings.map((f) => f.rule).sort();
    expect(rules).toEqual([
      "lint/final-newline",
      "lint/no-undefined-references",
      "lint/ordered-list-marker-style",
    ]);
    for (const f of findings) expect(f.severity).toBe("warning");
    expect(
      findings.find((f) => f.rule === "lint/no-undefined-references")?.line,
    ).toBe(1);
    expect(
      findings.find((f) => f.rule === "lint/ordered-list-marker-style")?.line,
    ).toBe(4);
  });

  it("reports no findings for a clean document", async () => {
    const content =
      "# Title\n\nA clean paragraph with [a link](https://example.com).\n";
    expect(await validateLint.run(doc(content))).toEqual([]);
  });

  it("shifts lint lines by the frontmatter offset", async () => {
    // Body is a single unterminated line (final-newline reports on it),
    // under a 3-line frontmatter block: 1 + 3 = file line 4.
    const content = "---\ntitle: t\n---\npara with no final newline";
    const findings = await validateLint.run(doc(content));
    expect(findings.map((f) => f.rule)).toEqual(["lint/final-newline"]);
    expect(findings[0].line).toBe(4);
  });
});
