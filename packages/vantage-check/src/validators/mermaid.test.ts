import { describe, expect, it } from "vitest";
import { docFromContent } from "../parse.js";
import { validateMermaid } from "./mermaid.js";

const doc = (content: string) =>
  docFromContent(content, "/repo/doc.md", "doc.md");

describe("validateMermaid", () => {
  it("reports no findings for valid diagrams", async () => {
    const content =
      "```mermaid\n" +
      "graph TD\n" +
      "  A-->B\n" +
      "```\n" +
      "\n" +
      "```mermaid\n" +
      "sequenceDiagram\n" +
      "  A->>B: hi\n" +
      "```\n";
    expect(await validateMermaid.run(doc(content))).toEqual([]);
  });

  it("flags a block with a grammar error, at the fence line", async () => {
    const content = "intro\n\n```mermaid\ngraph TD\n  A-->\n```\n";
    const findings = await validateMermaid.run(doc(content));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("mermaid/parse");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].line).toBe(3);
    expect(findings[0].message).toMatch(/syntax error/);
  });

  it("flags an unrecognized diagram type", async () => {
    const content = "```mermaid\nbogusDiagram\n  A-->B\n```\n";
    const findings = await validateMermaid.run(doc(content));
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(1);
    expect(findings[0].message).toMatch(/not a recognized diagram type/);
  });

  it("shifts fence lines by the frontmatter offset", async () => {
    const content = "---\ntitle: t\n---\n```mermaid\ngraph TD\n  A-->\n```\n";
    const findings = await validateMermaid.run(doc(content));
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
  });

  it("ignores code blocks in other languages", async () => {
    const content = "```js\nconst a = 1;\n```\n";
    expect(await validateMermaid.run(doc(content))).toEqual([]);
  });
});
