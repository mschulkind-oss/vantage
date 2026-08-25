import { describe, expect, it } from "vitest";
import { countLines, docFromContent } from "./parse.js";

describe("countLines", () => {
  it("counts lines, a trailing newline terminates rather than adds", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("\n")).toBe(1);
  });
});

describe("docFromContent", () => {
  it("strips frontmatter and records the line offset", () => {
    const doc = docFromContent(
      "---\ntitle: Notes\n---\n# Notes\n",
      "/repo/a.md",
      "a.md",
    );
    expect(doc.body).toBe("# Notes\n");
    expect(doc.bodyLineOffset).toBe(3);
    expect(doc.lineCount).toBe(4);
  });

  it("has no offset when there is no frontmatter", () => {
    const doc = docFromContent("# Notes\n", "/repo/a.md", "a.md");
    expect(doc.bodyLineOffset).toBe(0);
    expect(doc.body).toBe("# Notes\n");
  });

  it("assigns the viewer's heading ids: em dash, duplicates, punctuation", () => {
    const doc = docFromContent(
      "## Hello — world\n\n## Tips\n\n## Tips\n\n## Setup\n",
      "/repo/a.md",
      "a.md",
    );
    expect(doc.headingIds).toEqual(["hello--world", "tips", "tips-1", "setup"]);
  });
});
