import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { STYLE_GUIDE } from "../../vantage-md/src/styleGuide.js";
import { parseFrontmatter } from "../../vantage-md/src/frontmatter.js";
import { parseMarkdown } from "../src/core/document.js";
import {
  QUESTION_WORDS_DEFAULT,
  questionWords,
} from "../src/rules/questionLength.js";
import { ruleMeta } from "../src/rules/registry.js";
import {
  isStageRole,
  scanPlanningDocument,
  type PlanningDocument,
  type PlanningQuestion,
} from "../../vantage-md/src/planning/index.js";

/**
 * The style guide tells agents how to write what the planning index reads
 * (`docs/reference/planning-index.md` §3.5). `directives.test.ts` holds its
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

describe("the style guide's roadmaps", () => {
  it("says a roadmap.md the index does not read is no roadmap", () => {
    // Finding by name looks only among candidates (planning-index.md §4.1),
    // so an agent must not put one under an excluded path and expect it to
    // route.
    const guide = STYLE_GUIDE.replace(/\s+/g, " ");
    expect(guide).toContain("Every `roadmap.md` Vantage reads is a roadmap");
    expect(guide).toContain(
      "one in a hidden directory, matched by `.vantageignore`, or ruled out by `include` or `exclude` is not read, and so is not a roadmap",
    );
  });
});

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

  it("says a blocked or answered question gets no one-click answer", () => {
    // Review mode offers Take this leaning on open questions only (Plan Q5,
    // planning-index.md §6.6). An agent told to keep a directive that renders
    // no button needs telling that is expected, not a mistake to fix.
    expect(STYLE_GUIDE).toContain(
      "Neither state gets the one-click button in review mode",
    );
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

describe("the style guide's advice on a question's length", () => {
  it("states the limit planning/question-length applies by default", () => {
    // The guide cannot import the checker, so the number is written out, and
    // this is what keeps the two from drifting apart.
    expect(STYLE_GUIDE).toContain(
      `runs past ${QUESTION_WORDS_DEFAULT} words (\`planning/question-length\`)`,
    );
    expect(
      ruleMeta("planning/question-length")?.options?.["max-words"],
    ).toEqual(expect.objectContaining({ default: QUESTION_WORDS_DEFAULT }));
  });

  it("says what the count leaves out, in the convention's own markers", () => {
    expect(STYLE_GUIDE).toContain(
      "not counting its `_Leaning:_` paragraph and its `**Answer:**`",
    );
  });

  it("gives examples the rule has nothing to say about", () => {
    const questions = exampleQuestions();
    expect(questions.length).toBeGreaterThan(0);
    for (const body of fences("markdown")) {
      const result = scanPlanningDocument("docs/example.md", body, false);
      if (result.kind !== "planning") continue;
      const { body: text, bodyLineOffset } = parseFrontmatter(body);
      const root = parseMarkdown(text);
      for (const question of result.document.questions) {
        expect(
          questionWords(root, question, bodyLineOffset),
        ).toBeLessThanOrEqual(QUESTION_WORDS_DEFAULT);
      }
    }
  });
});
