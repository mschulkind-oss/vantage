/**
 * The answers waiting on the agent on the planning page, and what they take
 * off the human's plate (`docs/reference/planning-index.md` §6.7): a comment
 * pending for the agent anywhere in a question's unit answers it.
 */
import { describe, expect, it } from "vitest";
import {
  filterKeepsQuestion,
  type PlanningQuestion,
} from "vantage-md/planning";
import {
  answeredPerSection,
  needYou,
  pendingAnswers,
  questionKey,
} from "./planningAnswers";
import { needYouDocuments } from "../hooks/usePlanningPageInputs";
import { listedQuestions, sectionsOf, understoodFilter } from "./planningPages";
import { filterFormsIndex, indexOf, questionDirective } from "../test/planning";
import type { ReviewComment } from "../types";

const OPEN = "\u{1F4AC}";
const ANSWERED = "✅";

/** A numbered question with a body paragraph, so its unit spans lines. */
const q = (id: string, marker = OPEN) =>
  [
    `1. ${marker} **${id}: Question ${id}?**`,
    "",
    "   Context for it.",
    "",
    `   ${questionDirective(marker, id, "Yes.")}`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const doc = (...body: string[]) =>
  ["---\nstage: DESIGN\n---", "", "# Doc", "", ...body].join("\n");

const TREE: Record<string, string> = {
  "roadmap.md": "# Roadmap\n\n1. [A](a.md)\n",
  "plans/roadmap.md": "# Plans\n\n1. [B](../b.md)\n2. [A2](../a.md#OQ-A2)\n",
  "a.md": doc(q("OQ-A1"), q("OQ-A2"), q("OQ-A3", ANSWERED)),
  "b.md": doc(q("OQ-B1")),
  "c.md": doc(q("OQ-C1")),
};
const STAGES = { stages: { DESIGN: "open" as const } };
const index = indexOf(TREE, STAGES);
const sections = sectionsOf(index, "roadmap.md");
const listed = listedQuestions(index, sections);
const byId = (id: string): PlanningQuestion =>
  listed.find((question) => question.id === id)!;

let ids = 0;
/** A comment on the line `line` of `question`'s document. */
function on(line: number, patch: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: `c${++ids}`,
    comment: "An answer.",
    created_at: 0,
    reactions: [],
    anchor: {
      source_line: line,
      block_text_hash: "00000000",
      selection_offset: 0,
      selection_length: 0,
    },
    ...patch,
  };
}

const agentReply = {
  actor: "agent" as const,
  kind: "addressed" as const,
  summary: "Done.",
  before_text: "",
  after_text: "",
  timestamp: 10,
};

describe("pendingAnswers", () => {
  it("answers the question whose unit holds a pending comment's line, from its title down", () => {
    const a1 = byId("OQ-A1");
    const title = on(a1.unitLine);
    const leaning = on(a1.line);
    const { groups, answered } = pendingAnswers(
      listed,
      { "a.md": [title, leaning] },
      {},
    );
    expect(groups).toEqual([{ path: "a.md", comments: [title, leaning] }]);
    expect([...answered]).toEqual([questionKey(a1)]);
  });

  it("answers nothing with a comment the agent has answered, or one dismissed", () => {
    const a1 = byId("OQ-A1");
    const { groups, answered } = pendingAnswers(
      listed,
      {
        "a.md": [
          on(a1.unitLine, { reactions: [agentReply] }),
          on(a1.unitLine, { resolved: true }),
        ],
      },
      {},
    );
    expect(groups).toEqual([]);
    expect(answered.size).toBe(0);
  });

  it("answers nothing with a comment outside every listed question", () => {
    const { answered } = pendingAnswers(listed, { "a.md": [on(1)] }, {});
    expect(answered.size).toBe(0);
  });

  it("takes a rendered card's report over placement, for that question alone", () => {
    const a1 = byId("OQ-A1");
    const a2 = byId("OQ-A2");
    const comments = [on(a1.unitLine)];
    const byPath = { "a.md": comments };
    // The card read the comment as OQ-A2's, from its rendered block.
    const reported = pendingAnswers(listed, byPath, {
      [questionKey(a2)]: { ids: [comments[0].id], question: a2, comments },
    });
    expect([...reported.answered]).toEqual([questionKey(a2)]);
    // A report read from other comments says nothing of these.
    const stale = pendingAnswers(listed, byPath, {
      [questionKey(a2)]: { ids: [comments[0].id], question: a2, comments: [] },
    });
    expect([...stale.answered]).toEqual([questionKey(a1)]);
  });
});

describe("needYou", () => {
  const none = new Set<string>();

  it("is the index's own counts with nothing answered", () => {
    const counts = needYou(index, sections, none);
    expect(Object.fromEntries(counts.roadmaps)).toEqual({
      "plans/roadmap.md": 2,
      "roadmap.md": 3,
    });
    expect(counts.others).toBe(sections.onOtherRoadmaps.length);
    expect(counts.nothing).toBe(false);
  });

  it("takes each answered question off every roadmap that routes it, and off the others line", () => {
    const counts = needYou(
      index,
      sections,
      new Set([questionKey(byId("OQ-A2")), questionKey(byId("OQ-B1"))]),
    );
    // OQ-A2 is routed by both; OQ-B1 by the other roadmap alone.
    expect(Object.fromEntries(counts.roadmaps)).toEqual({
      "plans/roadmap.md": 0,
      "roadmap.md": 2,
    });
    expect(counts.others).toBe(0);
    expect(counts.nothing).toBe(false);
  });

  it("says nothing needs you once every open question is answered, ✅ ones aside", () => {
    const open = ["OQ-A1", "OQ-A2", "OQ-B1", "OQ-C1"].map((id) =>
      questionKey(byId(id)),
    );
    const counts = needYou(index, sections, new Set(open));
    expect(counts.nothing).toBe(true);
    // The ✅ question still needs compacting, so its roadmap counts it.
    expect(counts.roadmaps.get("roadmap.md")).toBe(1);
    // One open question unanswered, and something needs you.
    expect(needYou(index, sections, new Set(open.slice(1))).nothing).toBe(
      false,
    );
  });
});

describe("answeredPerSection", () => {
  it("counts each question section's answered entries, and leaves out a section with none", () => {
    const answered = new Set(
      ["OQ-A1", "OQ-A3", "OQ-C1"].map((id) => questionKey(byId(id))),
    );
    // Needs you lists A1, A2 and A3 (✅); Not on a roadmap, C1.
    expect(Object.fromEntries(answeredPerSection(sections, answered))).toEqual({
      "needs-you": 2,
      unrouted: 1,
    });
    expect(answeredPerSection(sections, new Set()).size).toBe(0);
  });
});

describe("needYouDocuments", () => {
  it("names every listed document holding an open or ✅ question, under any roadmap", () => {
    // b.md is routed only by the other roadmap, c.md by none: their answers
    // count all the same.
    expect(needYouDocuments(index, "roadmap.md")).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
  });
});

describe("under a planning filter (planning-index.md §6.7)", () => {
  /** The filter's keep predicate, as the page builds it. */
  const keepsOf = (text: string) => {
    const filter = understoodFilter(text)!;
    return (question: PlanningQuestion) =>
      filterKeepsQuestion(filter, question);
  };

  it("places over every listed question, then narrows to the kept ones, saying how many it leaves out", () => {
    const a1 = byId("OQ-A1");
    const c1 = byId("OQ-C1");
    const byPath = {
      "a.md": [on(a1.unitLine)],
      "c.md": [on(c1.unitLine), on(c1.line)],
    };
    const { groups, answered, leftOut } = pendingAnswers(
      listed,
      byPath,
      {},
      keepsOf("path:a.md"),
    );
    expect(groups).toEqual([{ path: "a.md", comments: byPath["a.md"] }]);
    expect([...answered]).toEqual([questionKey(a1)]);
    expect(leftOut).toBe(2);
    // With no filter, nothing is left out.
    expect(pendingAnswers(listed, byPath, {}).leftOut).toBe(0);
  });

  // The fixture of forms' docs/design/a.md: OQ-A4, ✅, nested in OQ-A3, open.
  it("leaves out a comment on a hidden ✅ question nested in a kept open one, never crediting it to the kept one", () => {
    const forms = filterFormsIndex();
    const all = listedQuestions(forms, sectionsOf(forms));
    const of = (id: string) => all.find((q) => q.id === id)!;
    const [a3, a4] = [of("OQ-A3"), of("OQ-A4")];
    // A4's unit is inside A3's, so placement by line alone over A3 would
    // take the comment for A3's.
    expect(a4.unitLine).toBeGreaterThan(a3.unitLine);
    expect(a4.unitEndLine).toBeLessThanOrEqual(a3.unitEndLine);
    const comment = on(a4.unitLine);
    const byPath = { "docs/design/a.md": [comment] };
    const filtered = pendingAnswers(all, byPath, {}, keepsOf("is:open"));
    expect(filtered).toEqual({ groups: [], answered: new Set(), leftOut: 1 });
    // Over the kept questions alone, it would have been credited to A3.
    const kept = all.filter(keepsOf("is:open"));
    expect([...pendingAnswers(kept, byPath, {}).answered]).toEqual([
      questionKey(a3),
    ]);
    // Unfiltered, it is A4's.
    expect([...pendingAnswers(all, byPath, {}).answered]).toEqual([
      questionKey(a4),
    ]);
  });

  it("recounts each roadmap's need-you numbers over the kept questions", () => {
    const filtered = sectionsOf(index, "roadmap.md", "path:a.md");
    const keeps = keepsOf("path:a.md");
    // The filtered sections' own counts, with nothing answered.
    expect(
      Object.fromEntries(needYou(index, filtered, new Set(), keeps).roadmaps),
    ).toEqual({ "plans/roadmap.md": 1, "roadmap.md": 3 });
    // Answering B1, which the filter hides, takes nothing more off; A1 does.
    const counts = needYou(
      index,
      filtered,
      new Set([questionKey(byId("OQ-B1")), questionKey(byId("OQ-A1"))]),
      keeps,
    );
    expect(Object.fromEntries(counts.roadmaps)).toEqual({
      "plans/roadmap.md": 1,
      "roadmap.md": 2,
    });
    // Every open question it keeps answered: nothing it keeps needs you.
    expect(
      needYou(
        index,
        filtered,
        new Set(["OQ-A1", "OQ-A2"].map((id) => questionKey(byId(id)))),
        keeps,
      ).nothing,
    ).toBe(true);
  });
});
