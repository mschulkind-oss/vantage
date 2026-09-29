import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import {
  isStageRole,
  scanPlanningDocument,
  type PlanningDocument,
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

/** The guide's frontmatter example for the planning keys. */
function planningFrontmatter(): string {
  const example = fences("yaml").find((body) => body.includes("\nstage:"));
  if (example === undefined) throw new Error("no yaml example sets stage:");
  return example;
}

describe("the style guide's planning frontmatter", () => {
  it("reads as the guide says it does", () => {
    const result = scanPlanningDocument(
      "docs/design/bootstrap.md",
      planningFrontmatter(),
      false,
    );

    expect(result.kind).toBe("planning");
    const doc = (result as { document: PlanningDocument }).document;
    expect(doc).toMatchObject({
      status: "in-review",
      stage: "DESIGN",
      next: "Rule OQ-B2 \u2014 the install step waits on it",
      headerProblems: [],
    });
    // Resolved like links, relative to the document, one fragment kept.
    expect(
      doc.dependsOn.map(({ target, fragment }) => ({ target, fragment })),
    ).toEqual([
      { target: "docs/design/pypi-distribution.md", fragment: null },
      { target: "docs/plans/rollout.md", fragment: "OQ-R1" },
    ]);
  });

  it("stays out of the checker's frontmatter examples", () => {
    // directives.test.ts checks every yaml fence carrying `vantage:` in a
    // temporary tree, and this one's depends-on names files that tree lacks.
    expect(planningFrontmatter()).not.toContain("vantage:");
  });

  it("uses a stage its own [planning] example declares", () => {
    const table = fences("toml").find((body) => body.includes("[planning]"));
    expect(table).toBeDefined();
    const planning = (
      parseToml(table ?? "") as { planning: Record<string, unknown> }
    ).planning;

    expect(
      Object.keys(planning).filter(
        (key) =>
          ![
            "roadmap",
            "include",
            "exclude",
            "max-file-bytes",
            "max-candidates",
            "stages",
          ].includes(key),
      ),
    ).toEqual([]);
    const stages = planning["stages"] as Record<string, unknown>;
    expect(Object.values(stages).every(isStageRole)).toBe(true);
    expect(Object.keys(stages)).toContain("DESIGN");
  });
});
