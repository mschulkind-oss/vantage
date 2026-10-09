/**
 * The planning outline, *On this page* (`docs/design/planning-to-do-list.md`
 * §3.5), drawn from the layout on screen. Every limit is proven by
 * configuring it down in the limits module, never by growing a tree to a
 * default.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { PlanningQuestion } from "vantage-md/planning";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import { indexOf, questionDirective } from "../test/planning";
import { planningCardId } from "./planningCardId";
import { planningOutline, planningRowId } from "./planningOutline";

afterEach(() => setPlanningLimitsForTests(null));

const OPEN = "\u{1F4AC}";

/** `count` questions `${prefix}1` on. */
function questions(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    [
      `## Part ${prefix}${i + 1}`,
      "",
      `1. ${OPEN} **${prefix}${i + 1}: Question ${prefix}${i + 1}?**`,
      "",
      `   ${questionDirective(OPEN, `${prefix}${i + 1}`)}`,
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n"),
  ).join("\n");
}

const doc = (...body: string[]) =>
  ["---\nstage: DESIGN\n---", "", "# Doc", "", ...body].join("\n");

const index = indexOf(
  {
    "roadmap.md": "# Roadmap\n",
    "a.md": doc(questions("OQ-A", 3)),
    "b.md": doc(questions("OQ-B", 2)),
    "c.md": doc(questions("OQ-C", 1)),
  },
  { stages: { DESIGN: "open" } },
);
const byId = new Map<string, PlanningQuestion>(
  index.documents.flatMap((d) => d.questions).map((q) => [q.id!, q]),
);
const qs = (...ids: string[]) => ids.map((id) => byId.get(id)!);

const input = {
  // The full cards in list order: a document's cards need not be adjacent.
  cards: qs("OQ-B1", "OQ-A1", "OQ-B2"),
  needing: qs("OQ-B1", "OQ-A1", "OQ-B2", "OQ-A2", "OQ-A3", "OQ-C1"),
  answered: { total: 4, first: byId.get("OQ-C1")! },
  blocked: 2,
  blockedExplanation: "Waits on something.",
  maintenance: 13,
};

describe("the planning outline, On this page", () => {
  it("lists the full cards' documents in list order, each with its questions that need you", () => {
    const outline = planningOutline(input);
    expect(outline.documents.map((d) => [d.path, d.questions])).toEqual([
      ["b.md", 2],
      ["a.md", 3],
    ]);
    // A document past the cards is not listed.
    expect(outline.documents.some((d) => d.path === "c.md")).toBe(false);
  });

  it("goes to a document's first card, by the card's id", () => {
    const [b] = planningOutline(input).documents;
    const first = byId.get("OQ-B1")!;
    expect(b!.target).toBe(planningCardId("b.md", "OQ-B1", first.unitLine));
  });

  it("then one line each for the answered rows, Blocked and Maintenance, with their counts", () => {
    expect(
      planningOutline(input).lines.map((l) => [l.title, l.total, l.target]),
    ).toEqual([
      [
        "Answered",
        4,
        planningCardId("c.md", "OQ-C1", byId.get("OQ-C1")!.unitLine),
      ],
      ["Blocked", 2, "waiting"],
      ["Maintenance", 13, "maintenance"],
    ]);
    expect(planningOutline(input).lines[1]!.explanation).toBe(
      "Waits on something.",
    );
  });

  it("leaves out the answered line with no answered row, and a group the layout has not", () => {
    const outline = planningOutline({
      ...input,
      answered: { total: 0, first: null },
      blocked: undefined,
    });
    expect(outline.lines.map((l) => l.id)).toEqual(["maintenance"]);
  });

  it("keeps a group's line whose count fell to 0 since the layout", () => {
    const outline = planningOutline({ ...input, blocked: 0 });
    expect(outline.lines.map((l) => [l.id, l.total])).toContainEqual([
      "waiting",
      0,
    ]);
  });

  it("lists outlineDocuments documents, and counts the rest", () => {
    setPlanningLimitsForTests({ outlineDocuments: 1 });
    const outline = planningOutline(input);
    expect(outline.documents.map((d) => d.path)).toEqual(["b.md"]);
    expect(outline.more).toBe(1);
  });

  it("names a document's row in a section by the section and its path", () => {
    expect(planningRowId("ready", "plans/ready.md")).toBe(
      "pr-ready--plans%2Fready.md",
    );
  });
});
