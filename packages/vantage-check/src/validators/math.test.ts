import { describe, expect, it } from "vitest";
import { docFromContent } from "../parse.js";
import { validateMath } from "./math.js";
import type { Finding } from "../types.js";

const doc = (content: string) =>
  docFromContent(content, "/repo/doc.md", "doc.md");

async function runMath(content: string): Promise<Finding[]> {
  return Promise.resolve(validateMath.run(doc(content)));
}

describe("validateMath", () => {
  it("reports no findings for valid block math", async () => {
    const content = "text\n$$\nE = mc^2\n$$\n";
    expect(await runMath(content)).toEqual([]);
  });

  it("flags an expression that does not compile, at the opening $$ line", async () => {
    const content = "text\n$$\n\\frac{1}{2\n$$\n";
    const findings = await runMath(content);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("math/compile");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].line).toBe(2);
    expect(findings[0].message).toMatch(/^KaTeX does not compile:/);
  });

  it("shifts math lines by the frontmatter offset", async () => {
    const content = "---\ntitle: t\n---\n$$\n\\frac{1}{2\n$$\n";
    const findings = await runMath(content);
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
  });

  it("does not validate single-dollar spans (viewer parity)", async () => {
    // The viewer's pipeline runs remark-math with singleDollarTextMath off,
    // so $...$ is plain text, not math — a broken $-span (or bare dollar
    // amounts) renders as text and is not a pipeline failure.
    expect(await runMath("Bad $\\frac{1}{2$ here.\n")).toEqual([]);
    expect(await runMath("Prices like $5 and $10 in text.\n")).toEqual([]);
  });
});
