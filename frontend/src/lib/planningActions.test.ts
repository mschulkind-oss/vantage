/**
 * `planning-actions` (`docs/design/planning-eligibility-and-review-context.md`
 * §2.2, §2.4): the scan reads it, and the shared derivations the page, the CLI
 * and the checker all read leave an opted-out document out of Ready, graduation
 * and the compaction offer, and out of nothing else.
 */
import { describe, expect, it } from "vitest";
import {
  answeredQuestions,
  derivePlanningSections,
  planningRequestCount,
  scanPlanningDocument,
  waitingDependsOn,
  type PlanningConfig,
} from "vantage-md/planning";
import { compactEntries, sectionsOf } from "./planningPages";
import { indexOf, questionDirective } from "../test/planning";

const STAGES: PlanningConfig["stages"] = {
  DESIGN: "open",
  DECIDED: "ready",
  BUILT: "built",
  GONE: "done",
};
const OPEN = "\u{1F4AC}";
const ANSWERED = "✅";

const question = (id: string, marker: string) =>
  [
    `1. ${marker} **${id}: Question ${id}?**`,
    "",
    `   ${questionDirective(marker, id, "Yes.")}`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const doc = (header: string, body = "") =>
  `---\n${header}\n---\n\n# Title\n\n${body}\n`;

const scan = (source: string, isRoadmap = false) =>
  scanPlanningDocument("docs/x.md", source, isRoadmap);

describe("reading planning-actions", () => {
  it("reads none as an opt-out and says nothing", () => {
    const result = scan(doc("stage: DECIDED\nplanning-actions: none"));
    expect(result).toMatchObject({
      kind: "planning",
      document: { planningActions: "none", headerProblems: [] },
    });
  });

  it.each([
    ["is missing", "stage: DECIDED"],
    ["is all", "stage: DECIDED\nplanning-actions: all"],
  ])("leaves the field off when the key %s", (_, header) => {
    const result = scan(doc(header));
    expect(result.kind === "planning" && result.document).not.toHaveProperty(
      "planningActions",
    );
    expect(result).toMatchObject({ document: { headerProblems: [] } });
  });

  it.each([
    ["a word that is neither", "planning-actions: maybe"],
    ["the wrong case", "planning-actions: None"],
    ["a boolean", "planning-actions: false"],
    ["a number", "planning-actions: 0"],
    ["a list", "planning-actions: [none]"],
    ["empty", "planning-actions:"],
  ])("treats %s as all and reports it at the key", (_, line) => {
    const result = scan(doc(`stage: DECIDED\n${line}`));
    expect(result.kind === "planning" && result.document).not.toHaveProperty(
      "planningActions",
    );
    expect(result).toMatchObject({
      document: {
        headerProblems: [
          expect.objectContaining({ key: "planning-actions", line: 3 }),
        ],
      },
    });
  });

  it("reads a TOML header the same way", () => {
    const result = scan(
      '+++\nstage = "DECIDED"\nplanning-actions = "none"\n+++\n',
    );
    expect(result).toMatchObject({
      document: { planningActions: "none", headerProblems: [] },
    });
  });

  it("does not let the key alone make a document a contributor", () => {
    expect(
      scan("---\nplanning-actions: none\n---\n\n# Only the key\n"),
    ).toEqual({
      kind: "not-planning",
    });
  });

  it("leaves a malformed header unreadable, key or no key", () => {
    expect(scan("---\nplanning-actions: none\nstage: [\n---\n").kind).toBe(
      "unreadable",
    );
  });

  it("is inert on the roadmap, and says so at the key", () => {
    const result = scan(doc("stage: DECIDED\nplanning-actions: none"), true);
    expect(result.kind === "planning" && result.document).not.toHaveProperty(
      "planningActions",
    );
    expect(result).toMatchObject({
      document: {
        headerProblems: [
          expect.objectContaining({ key: "planning-actions", line: 3 }),
        ],
      },
    });
  });
});

describe("what planning-actions: none leaves out", () => {
  const NONE = "planning-actions: none";
  const tree: Record<string, string> = {
    "listed-ready.md": doc("stage: DECIDED"),
    "opted-ready.md": doc(`stage: DECIDED\n${NONE}`),
    "listed-built.md": doc("stage: BUILT"),
    "opted-built.md": doc(`stage: BUILT\n${NONE}`),
    "listed-answered.md": doc("stage: DESIGN", question("OQ-L1", ANSWERED)),
    "opted-answered.md": doc(
      `stage: DESIGN\n${NONE}`,
      question("OQ-O1", ANSWERED),
    ),
    "opted-open.md": doc(`stage: DECIDED\n${NONE}`, question("OQ-Z1", OPEN)),
    "waits.md": doc("stage: DECIDED\ndepends-on:\n  - opted-open.md"),
  };
  const index = indexOf(tree, { stages: STAGES });

  it("keeps Ready and graduation to the documents that did not opt out", () => {
    const sections = derivePlanningSections(index);
    expect(sections.ready).toEqual(["listed-ready.md", "waits.md"]);
    expect(sections.graduate).toEqual(["listed-built.md"]);
  });

  it("keeps the opted-out document's open question, its conflict and its dependents' wait", () => {
    const sections = derivePlanningSections(index);
    expect(sections.disagrees).toEqual(["opted-open.md"]);
    expect(sections.needsYou.map((ref) => ref.id)).toContain("OQ-Z1");
    const waits = index.documents.find((d) => d.path === "waits.md")!;
    expect(waitingDependsOn(index, waits).map((e) => e.target)).toEqual([
      "opted-open.md",
    ]);
    expect(
      index.documents.find((d) => d.path === "opted-ready.md"),
    ).toMatchObject({ stage: "DECIDED" });
  });

  it("offers compaction for the questions of documents that did not opt out", () => {
    const sections = derivePlanningSections(index);
    expect(answeredQuestions(index).map((ref) => ref.id)).toEqual(["OQ-L1"]);
    expect(planningRequestCount(index, sections, "compact")).toBe(1);
    expect(compactEntries(index, "").map((entry) => entry.question.id)).toEqual(
      ["OQ-L1"],
    );
  });

  it("does not let a filter bring it back", () => {
    const sections = sectionsOf(index, null, "path:opted");
    expect(sections.ready).toEqual([]);
    expect(sections.graduate).toEqual([]);
    expect(compactEntries(index, "path:opted")).toEqual([]);
  });
});
