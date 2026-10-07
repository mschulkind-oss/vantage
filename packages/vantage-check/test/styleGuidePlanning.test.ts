import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { run } from "../src/cli.js";
import { EXIT_OK, EXIT_USAGE } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import {
  STYLE_GUIDE,
  ANSWER_PROCESSING_GUIDE,
} from "../../vantage-md/src/styleGuide.js";
import { parseFrontmatter } from "../../vantage-md/src/frontmatter.js";
import { parseMarkdown } from "../src/core/document.js";
import {
  QUESTION_WORDS_DEFAULT,
  questionWords,
} from "../src/rules/questionLength.js";
import { ruleMeta } from "../src/rules/registry.js";
import { QUESTION_SHAPE } from "../../vantage-md/src/planning/leaning.js";
import {
  PLANNING_SPACE_FILE,
  isStageRole,
  parsePlanningFilter,
  scanPlanningDocument,
  type PlanningDocument,
  type PlanningQuestion,
} from "../../vantage-md/src/planning/index.js";
import { fullTree } from "./planningTree.js";

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

describe("the style guide's answer-processing instructions", () => {
  it("reaches agents through the CLI command", async () => {
    const io = bufferIo(fullTree());
    expect(await run(["style-guide"], io)).toBe(EXIT_OK);
    expect(io.stdout).toContain(ANSWER_PROCESSING_GUIDE);
  });

  it("includes the same protocol as review payloads, without claiming mechanical enforcement", () => {
    expect(STYLE_GUIDE).toContain(ANSWER_PROCESSING_GUIDE);
    expect(ANSWER_PROCESSING_GUIDE).toContain(
      "before launching or continuing downstream work",
    );
    expect(ANSWER_PROCESSING_GUIDE).toContain("the checkout Vantage serves");
    expect(ANSWER_PROCESSING_GUIDE).toContain("repair inbound Markdown links");
    expect(ANSWER_PROCESSING_GUIDE).toContain(
      "Keep question-specific `depends-on` fragments",
    );
    expect(ANSWER_PROCESSING_GUIDE).toContain(
      "Vantage cannot verify from prose alone",
    );
  });
});

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

describe("the style guide's questions", () => {
  it("declares every question, open and blocked, with `question`", () => {
    // A question with no directive does not exist to the index (§3.3), so the
    // guide's old advice, that a 🔒 question needs none, hid every one of them.
    // And never with an `oq`, the name `question` replaces, which every viewer
    // before 0.8 offers to answer whatever the question's state.
    const questions = exampleQuestions();
    expect(
      questions.map((q) => [q.id, q.state, q.directive, q.leaning !== null]),
    ).toEqual([
      ["OQ-9", "open", "question", true],
      ["OQ-10", "blocked", "question", false],
    ]);
    expect(STYLE_GUIDE).not.toMatch(/```markdown[^`]*<!-- vantage: oq/);
  });

  it("no longer says a blocked or answered question needs no directive", () => {
    expect(STYLE_GUIDE).not.toMatch(/needs no directive/);
  });

  it("says a question's state is its marker, and its directive stays", () => {
    const guide = STYLE_GUIDE.replace(/\s+/g, " ");
    expect(guide).toContain(
      "Changing a question's state changes its marker and nothing else.",
    );
    expect(guide).toContain("Every question gets a `question` directive");
  });

  it("calls `oq` the name `question` replaces, and never to be put on a 🔒 or ✅ question", () => {
    const guide = STYLE_GUIDE.replace(/\s+/g, " ");
    expect(guide).toContain("`oq` is the name `question` replaces.");
    expect(guide).toContain("`vantage/oq-deprecated`");
    expect(guide).toContain("Never put `oq` on a \u{1F512} or \u2705 question");
    expect(guide).toContain(
      "every Vantage before 0.8 offers the one-click button on every `oq`",
    );
    expect(guide).toContain("`vantage/question-name`");
    // What `question` costs a reader still on 0.7, stated once, and how a
    // repository whose readers are on 0.7 keeps its `oq`s without the warning:
    // its target, which a checker before 0.8 ignores rather than rejects.
    expect(guide).toContain(
      "a reader still on 0.7 gets no one-click answer and no anchor on a question written with it, and misreads nothing",
    );
    expect(guide).toContain(
      "keep an `oq` on an open question unless you know every reader of the repository is on 0.8 or later",
    );
    expect(guide).toContain(
      'says so with a `target` before 0.8, such as `target = "0.7"`: there an open question takes `oq`, new ones included, and `vantage-check` asks for `oq` rather than `question` on one.',
    );
  });

  it("says to write a question as a list item, and what a question outside one runs over", () => {
    const guide = STYLE_GUIDE.replace(/\s+/g, " ");
    expect(guide).toContain("**Write a question as a list item.**");
    expect(guide).toContain(
      "up to the next heading (for a question written as a heading, the next one of its level or higher), the next rule or the next question",
    );
  });
});

/**
 * How a question is written (`QUESTION_SHAPE`): the parts the page and the
 * planning card lay it out by. The guide teaches them at length and the
 * checker's findings quote them in a sentence, so they must name the same
 * parts.
 */
describe("the style guide's question shape", () => {
  it("says never to write a question as one run-together paragraph", () => {
    const guide = STYLE_GUIDE.replace(/\s+/g, " ");
    expect(guide).toContain(
      "Write each question in its parts, never as one run-together paragraph.",
    );
    expect(guide).toContain("`vantage/question-layout`");
    expect(QUESTION_SHAPE).toContain("never one run-together paragraph");
  });

  it("names the same parts as the sentence the checker quotes", () => {
    const guide = STYLE_GUIDE.replace(/\s+/g, " ");
    for (const [inGuide, inShape] of [
      [
        "**The title line**",
        "a title line with its marker, its id and the question in bold",
      ],
      ["**The context**, in short paragraphs", "context in short paragraphs"],
      ["**The options as a list**", "the options as a list"],
      [
        "**`_Leaning:_` as a paragraph of its own**",
        "`_Leaning:_ …` as a paragraph of its own",
      ],
      [
        "**`**Answer:**` as a paragraph of its own**",
        "`**Answer:**` as a paragraph of its own",
      ],
    ]) {
      expect(guide).toContain(inGuide);
      expect(QUESTION_SHAPE).toContain(inShape);
    }
  });

  it("gives an open question in every part", () => {
    const open = fences("markdown").find((body) => body.includes("OQ-9"));
    expect(open).toBeDefined();
    for (const part of [
      "1. \u{1F4AC} **OQ-9:",
      "\n   - **A — ",
      "\n   _Leaning:_ ",
      "\n   **Answer:**\n",
    ]) {
      expect(open).toContain(part);
    }
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

describe("the style guide's filtered planning page", () => {
  /**
   * The command the guide teaches for handing a human the rulings one piece
   * of work needs (`docs/reference/planning-index.md` §13.5), with its two
   * documents still placeholders.
   */
  function taught(): string {
    const guide = STYLE_GUIDE.replace(/\s+/g, " ");
    const command = /`vantage-check index --filter '([^']*)'`/.exec(guide);
    expect(command).not.toBeNull();
    return command?.[1] ?? "";
  }

  it("teaches a filter the checker understands once its documents are named", async () => {
    // A placeholder is no path: the text as printed matches none, so the
    // checker exits 2 naming it, and the agent must name the documents, from
    // the root, with a leading `/`.
    expect(taught()).toBe("path:/<design> path:/<plan> is:open");
    const io = bufferIo(fullTree());
    expect(await run(["index", "--filter", taught()], io)).toBe(EXIT_USAGE);
    expect(io.stdout).toBe("");
    expect(io.stderr).toContain("`path:/<design>` matches no path");
    const named = taught()
      .replace("<design>", "docs/design/search.md")
      .replace("<plan>", "docs/design/search-plan.md");
    expect(parsePlanningFilter(named)).toEqual(
      expect.objectContaining({
        kind: "understood",
        canonical:
          "path:/docs/design/search.md path:/docs/design/search-plan.md is:open",
      }),
    );
  });

  it("names the line the command prints for the human", async () => {
    expect(STYLE_GUIDE).toContain("give the human the `Planning page:` line");
    const root = fullTree();
    const io = bufferIo(root);
    const named = taught()
      .replace("<design>", "docs/a.md")
      .replace("<plan>", "docs/e.md");
    const code = await run(["index", "--filter", named], io);
    expect(code).toBe(EXIT_OK);
    // Ending with the checkout's space id, which the run made (§13.6).
    const space = readFileSync(join(root, PLANNING_SPACE_FILE), "utf8").trim();
    expect(io.stdout).toContain(
      `\nPlanning page: /.vantage/planning?filter=path:/docs/a.md+path:/docs/e.md+is:open&space=${space}\n`,
    );
  });
});
