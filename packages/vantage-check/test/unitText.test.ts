import { describe, expect, it } from "vitest";
import { scanPlanningDocument } from "../../vantage-md/src/planning/index.js";

/**
 * `PlanningQuestion.unitText` is what the server checks a reviewer's selected
 * quote against: the unit as the page renders it, not its Markdown source.
 */
function unitTexts(source: string): (string | null)[][] {
  const result = scanPlanningDocument("docs/q.md", source, false);
  if (result.kind !== "planning") throw new Error("not a planning document");
  return result.document.questions.map((q) => [q.id, q.unitText]);
}

describe("PlanningQuestion.unitText", () => {
  it("reads bold, links and inline code as they render, in a list-item unit", () => {
    const source = [
      "1. \u{1F4AC} **OQ-1: Which `cache` wins?** See [the spec](https://x.test/s).",
      "",
      '   <!-- vantage: oq id=OQ-1 leaning="**Bold** pick." -->',
      "",
      "   _Leaning:_ the **last** one, per [notes](n.md) and `ttl`.",
      "",
    ].join("\n");

    const [[id, text]] = unitTexts(source) as [[string, string]];
    expect(id).toBe("OQ-1");
    expect(text).toContain("Which cache wins? See the spec.");
    expect(text).toContain("Leaning: the last one, per notes and ttl.");
    expect(text).not.toContain("**");
    expect(text).not.toContain("](");
    expect(text).not.toContain("`");
  });

  it("covers every block of a question that is not a list item", () => {
    const source = [
      "## \u{1F4AC} **OQ-2: Heading shape?**",
      "",
      '<!-- vantage: oq id=OQ-2 leaning="Heading." -->',
      "",
      "Context with **bold** and [a link](x.md).",
      "",
      "_Leaning:_ the `heading` form.",
      "",
    ].join("\n");

    const [[, text]] = unitTexts(source) as [[string, string]];
    expect(text).toContain("Context with bold and a link.");
    expect(text).toContain("Leaning: the heading form.");
  });
});
