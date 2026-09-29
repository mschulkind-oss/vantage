import { describe, expect, it } from "vitest";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import {
  scanPlanningDocument,
  type PlanningQuestion,
} from "../../vantage-md/src/planning/index.js";

/**
 * The style guide tells agents how to write what the planning index reads
 * (`docs/design/planning-index.md` §10). `directives.test.ts` holds its
 * directive examples to the checker's rules; these hold its planning examples
 * to the scan itself, so an example an agent copies means to Vantage what the
 * guide says it means.
 */

/** The bodies of every fence in the guide tagged with `language`. */
function fences(language: string): string[] {
  const pattern = new RegExp("```" + language + "\\n([\\s\\S]*?)```", "g");
  return [...STYLE_GUIDE.matchAll(pattern)].map((match) => match[1] ?? "");
}

/** Every question the index finds in the guide's Markdown examples. */
function exampleQuestions(): PlanningQuestion[] {
  return fences("markdown").flatMap((body) => {
    const result = scanPlanningDocument("docs/example.md", body, false);
    return result.kind === "planning" ? result.document.questions : [];
  });
}

describe("the style guide's blocked question", () => {
  it("carries an oq directive, so the index counts it", () => {
    // A question with no directive does not exist to the index (§3.3), so the
    // guide's old advice, that a 🔒 question needs none, hid every one of them.
    const blocked = exampleQuestions().filter(
      (question) => question.state === "blocked",
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ id: "OQ-10", leaning: null });
  });

  it("no longer says a blocked or answered question needs no directive", () => {
    expect(STYLE_GUIDE).not.toMatch(/needs no directive/);
  });
});
