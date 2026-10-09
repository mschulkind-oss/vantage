/**
 * The movement rule's pure half (`docs/design/planning-to-do-list.md` §4):
 * *Needs you* laid out, what the reader changes in place, the marks late
 * data puts on items, and the held updates Refresh would apply.
 */
import { describe, expect, it } from "vitest";
import type { PlanningIndex, PlanningQuestion } from "vantage-md/planning";
import type { ReviewComment } from "../types";
import {
  NOTHING_IN_PLACE,
  agentReplies,
  commentsByQuestion,
  heldUpdates,
  itemKey,
  layoutNeedsYou,
  marksOf,
  openRow,
  rowAnswer,
  shrinkCard,
  updatesTitle,
  updatesTotal,
  viewNeedsYou,
  type QuestionFacts,
} from "./planningLayout";
import { questionKey } from "./planningAnswers";
import {
  layoutPlanningPage,
  sectionsOf,
  type PlanningLayout,
} from "./planningPages";
import { indexOf, questionDirective } from "../test/planning";

const OPEN = "\u{1F4AC}";
const ANSWERED = "✅";

const q = (id: string, marker = OPEN, title = `Question ${id}?`) =>
  [
    `## Part ${id}`,
    "",
    `1. ${marker} **${id}: ${title}**`,
    "",
    `   ${questionDirective(marker, id, "Yes.")}`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const doc = (...body: string[]) =>
  ["---\nstage: DESIGN\n---", "", "# Doc", "", ...body].join("\n");

const roadmap = (...paths: string[]) =>
  ["# Roadmap", "", ...paths.map((p, i) => `${i + 1}. [It](${p})`), ""].join(
    "\n",
  );

const IDS = ["OQ-T1", "OQ-T2", "OQ-T3", "OQ-T4", "OQ-T5", "OQ-T6"];

function treeOf(ids = IDS, extra: Record<string, string> = {}) {
  return {
    "roadmap.md": roadmap(...ids.map((id) => `plans/a.md#${id}`)),
    "plans/a.md": doc(...ids.map((id) => q(id))),
    ...extra,
  };
}

const STAGES = { DESIGN: "open" as const };

function layoutOf(index: PlanningIndex, pageSize = 2): PlanningLayout {
  return layoutPlanningPage(index, sectionsOf(index), pageSize);
}

const keyOf = (index: PlanningIndex, id: string): string => {
  const question = index.documents
    .flatMap((d) => d.questions)
    .find((x) => x.id === id)!;
  return itemKey(question);
};
const qKey = (index: PlanningIndex, id: string): string =>
  questionKey(
    index.documents.flatMap((d) => d.questions).find((x) => x.id === id)!,
  );
const ids = (entries: readonly { question: PlanningQuestion }[]) =>
  entries.map((e) => e.question.id);

describe("Needs you, laid out (§3.3)", () => {
  const index = indexOf(treeOf(), { stages: STAGES });
  const layout = layoutOf(index);

  it("puts the answered questions first as rows, then the page size as cards, then the rest", () => {
    const answered = new Set([qKey(index, "OQ-T2"), qKey(index, "OQ-T5")]);
    const needsYou = layoutNeedsYou(layout.needsYou, answered, 2);
    expect(ids(needsYou.answered)).toEqual(["OQ-T2", "OQ-T5"]);
    expect(ids(needsYou.cards)).toEqual(["OQ-T1", "OQ-T3"]);
    expect(ids(needsYou.more)).toEqual(["OQ-T4", "OQ-T6"]);
  });

  it("leaves a ✅ question out of Needs you, for Maintenance to fold into the ledger", () => {
    const withDone = indexOf(
      {
        ...treeOf(["OQ-T1", "OQ-T2"]),
        "plans/a.md": doc(q("OQ-T1"), q("OQ-T2", ANSWERED)),
      },
      { stages: STAGES },
    );
    const laid = layoutOf(withDone);
    expect(ids(laid.needsYou)).toEqual(["OQ-T1"]);
    expect(laid.maintenance.map((k) => k.id)).toEqual(["compact"]);
  });

  it("shows the first answered rows and counts the rest behind … N more answered", () => {
    const answered = new Set(IDS.map((id) => qKey(index, id)));
    const needsYou = layoutNeedsYou(layout.needsYou, answered, 2);
    const view = viewNeedsYou(needsYou, NOTHING_IN_PLACE, 5);
    expect(view.top).toHaveLength(5);
    expect(view.hiddenAnswered).toBe(1);
    expect(view.rows).toBe(6);
    const all = viewNeedsYou(
      needsYou,
      { ...NOTHING_IN_PLACE, allAnswered: true },
      5,
    );
    expect(all.top).toHaveLength(6);
    expect(all.hiddenAnswered).toBe(0);
  });
});

describe("in place (§4.1)", () => {
  const index = indexOf(treeOf(), { stages: STAGES });
  const needsYou = layoutNeedsYou(layoutOf(index).needsYou, new Set(), 2);

  it("shrinks an answered card to a row where it was, and the next question joins the cards", () => {
    const after = shrinkCard(NOTHING_IN_PLACE, needsYou, keyOf(index, "OQ-T1"));
    const view = viewNeedsYou(needsYou, after, 5);
    expect(view.list.map((i) => [i.entry.question.id, i.as])).toEqual([
      ["OQ-T1", "row"],
      ["OQ-T2", "card"],
      ["OQ-T3", "card"],
    ]);
    expect(view.more).toBe(3);
    expect(view.rows).toBe(1);
  });

  it("opens a row back into its card where it is, and keeps the card that joined", () => {
    const key = keyOf(index, "OQ-T1");
    const after = openRow(shrinkCard(NOTHING_IN_PLACE, needsYou, key), key);
    const view = viewNeedsYou(needsYou, after, 5);
    expect(view.list.map((i) => [i.entry.question.id, i.as])).toEqual([
      ["OQ-T1", "card"],
      ["OQ-T2", "card"],
      ["OQ-T3", "card"],
    ]);
  });

  it("shrinks a row opened by Undo back to a row when it is answered again, and joins no second card", () => {
    const key = keyOf(index, "OQ-T1");
    const opened = openRow(shrinkCard(NOTHING_IN_PLACE, needsYou, key), key);
    const again = shrinkCard(opened, needsYou, key);
    expect(again.joined).toBe(1);
    expect(
      viewNeedsYou(needsYou, again, 5).list.map((i) => [
        i.entry.question.id,
        i.as,
      ]),
    ).toEqual([
      ["OQ-T1", "row"],
      ["OQ-T2", "card"],
      ["OQ-T3", "card"],
    ]);
  });

  it("shrinks an answered row opened by Show back to a row when it is answered again", () => {
    const answered = layoutNeedsYou(
      layoutOf(index).needsYou,
      new Set([qKey(index, "OQ-T2")]),
      2,
    );
    const key = keyOf(index, "OQ-T2");
    const again = shrinkCard(openRow(NOTHING_IN_PLACE, key), answered, key);
    expect(again.opened.has(key)).toBe(false);
    expect(again.joined).toBe(0);
    expect(viewNeedsYou(answered, again, 5).top[0]?.as).toBe("row");
  });

  it("joins nothing when nothing is left beyond the cards", () => {
    const small = layoutNeedsYou(layoutOf(index, 10).needsYou, new Set(), 10);
    const after = shrinkCard(NOTHING_IN_PLACE, small, keyOf(index, "OQ-T1"));
    expect(after.joined).toBe(0);
    expect(viewNeedsYou(small, after, 5).list).toHaveLength(6);
  });
});

describe("marks (§4.2)", () => {
  const index = indexOf(treeOf(), { stages: STAGES });
  const painted = index.documents.flatMap((d) => d.questions)[0]!;
  const facts = (over: Partial<QuestionFacts>): QuestionFacts => ({
    painted,
    now: painted,
    answeredThen: false,
    answeredNow: false,
    repliesSeen: 0,
    repliesNow: 0,
    ...over,
  });

  it("marks nothing that has not changed", () => {
    expect(marksOf(facts({}), "card")).toEqual({ marks: [], newReply: false });
  });

  it("marks New reply when the agent replied since it painted", () => {
    expect(marksOf(facts({ repliesNow: 1 }), "row").newReply).toBe(true);
    expect(
      marksOf(facts({ repliesSeen: 1, repliesNow: 1 }), "row").newReply,
    ).toBe(false);
  });

  it("marks a card Answered elsewhere, and never a row", () => {
    expect(marksOf(facts({ answeredNow: true }), "card").marks).toEqual([
      "answered-elsewhere",
    ]);
    expect(marksOf(facts({ answeredNow: true }), "row").marks).toEqual([]);
  });

  it("marks Done a question that became ✅ or left the index", () => {
    expect(marksOf(facts({ now: undefined }), "card").marks).toEqual(["done"]);
    expect(
      marksOf(facts({ now: { ...painted, state: "answered" } }), "card").marks,
    ).toEqual(["done"]);
  });

  it("marks Changed in the document when its text changed, not when it moved", () => {
    const moved = {
      ...painted,
      line: painted.line + 3,
      unitLine: painted.unitLine + 3,
      unitEndLine: painted.unitEndLine + 3,
    };
    expect(marksOf(facts({ now: moved }), "card").marks).toEqual([]);
    expect(
      marksOf(facts({ now: { ...painted, title: "Other?" } }), "card").marks,
    ).toEqual(["changed"]);
  });

  it("reads a longer block as a change only while the block holds the same questions", () => {
    const longer = { ...painted, cardChars: painted.cardChars + 40 };
    expect(
      marksOf(facts({ now: longer, siblingsThen: 2, siblingsNow: 2 }), "card")
        .marks,
    ).toEqual(["changed"]);
    // A sibling question added to the block: its text is not this one's.
    expect(
      marksOf(facts({ now: longer, siblingsThen: 2, siblingsNow: 3 }), "card")
        .marks,
    ).toEqual([]);
  });
});

describe("held updates (§4.3)", () => {
  const before = indexOf(treeOf(), { stages: STAGES });
  const layout = layoutOf(before);

  /** The held updates of `after` against `layout`, with `answered` now. */
  function updates(
    after: PlanningIndex,
    options: {
      answeredThen?: string[];
      answeredNow?: string[];
      replied?: string[];
      inPlace?: Parameters<typeof shrinkCard>[0];
      own?: string[];
    } = {},
  ) {
    const then = new Set(
      (options.answeredThen ?? []).map((id) => qKey(before, id)),
    );
    const now = new Set(
      (options.answeredNow ?? []).map((id) => qKey(after, id)),
    );
    const needsYou = layoutNeedsYou(layout.needsYou, then, 2);
    const freshLayout = layoutOf(after);
    const all = (index: PlanningIndex) =>
      new Map(
        index.documents
          .flatMap((d) => d.questions)
          .map((x) => [itemKey(x), x] as const),
      );
    const thenQs = all(before);
    const nowQs = all(after);
    return heldUpdates({
      layout,
      needsYou,
      inPlace: options.inPlace ?? NOTHING_IN_PLACE,
      fresh: layoutNeedsYou(freshLayout.needsYou, now, 2),
      freshOrder: freshLayout.needsYou,
      freshBlocked: freshLayout.blocked,
      freshMaintenance: freshLayout.maintenance,
      own: new Set((options.own ?? []).map((id) => keyOf(before, id))),
      facts: (key) => {
        const painted = thenQs.get(key) ?? nowQs.get(key);
        if (painted === undefined) return undefined;
        const current = nowQs.get(key);
        return {
          painted,
          now: current,
          answeredThen: then.has(questionKey(painted)),
          answeredNow: current !== undefined && now.has(questionKey(current)),
          repliesSeen: 0,
          repliesNow: (options.replied ?? []).includes(painted.id ?? "")
            ? 1
            : 0,
        };
      },
    });
  }

  it("holds nothing when nothing changed", () => {
    expect(updatesTotal(updates(before))).toBe(0);
  });

  it("counts a new question that needs you, beyond the cards or not", () => {
    const after = indexOf(treeOf(["OQ-T0", ...IDS]), { stages: STAGES });
    const held = updates(after);
    // Q0 would be a card; Q2 would leave the cards for the rest.
    expect(held.get("new question")).toBe(1);
    expect(held.get("moved")).toBe(1);
    expect(updatesTotal(held)).toBe(2);
  });

  it("counts a question answered elsewhere, which would become a row", () => {
    const held = updates(before, { answeredNow: ["OQ-T1"] });
    expect(held.get("answered elsewhere")).toBe(1);
    // Q3 would join the cards in its place.
    expect(held.get("moved")).toBe(1);
  });

  it("counts nothing for a card the reader answered here, nor for the card that joined", () => {
    const needsYou = layoutNeedsYou(layout.needsYou, new Set(), 2);
    const inPlace = shrinkCard(
      NOTHING_IN_PLACE,
      needsYou,
      keyOf(before, "OQ-T1"),
    );
    expect(
      updatesTotal(updates(before, { answeredNow: ["OQ-T1"], inPlace })),
    ).toBe(0);
  });

  it("counts a question that became ✅ as done", () => {
    const after = indexOf(
      {
        ...treeOf(),
        "plans/a.md": doc(
          ...IDS.map((id) => (id === "OQ-T2" ? q(id, ANSWERED) : q(id))),
        ),
      },
      { stages: STAGES },
    );
    const held = updates(after);
    expect(held.get("done")).toBe(1);
    // ✅ joins Maintenance's ledger kind.
    expect(held.get("new under Maintenance")).toBe(1);
  });

  it("counts a reply on a row that would need you again as a new reply", () => {
    const held = updates(before, {
      answeredThen: ["OQ-T1"],
      answeredNow: [],
      replied: ["OQ-T1"],
    });
    expect(held.get("new reply")).toBe(1);
  });

  it("counts a changed question's text once, as changed", () => {
    const after = indexOf(
      {
        ...treeOf(),
        "plans/a.md": doc(
          ...IDS.map((id) =>
            id === "OQ-T1" ? q(id, OPEN, "Reworded?") : q(id),
          ),
        ),
      },
      { stages: STAGES },
    );
    expect(updates(after).get("changed")).toBe(1);
  });

  it("counts a reordered roadmap once", () => {
    const after = indexOf(
      {
        ...treeOf(),
        "roadmap.md": roadmap(
          ...[...IDS].reverse().map((id) => `plans/a.md#${id}`),
        ),
      },
      { stages: STAGES },
    );
    const held = updates(after);
    expect(held.get("roadmap reordered")).toBe(1);
    // Once: not again for each question it moves in or out of the cards.
    expect(updatesTotal(held)).toBe(1);
  });

  it("counts nothing for a card whose own Answer… box is answering it, while it is typed in", () => {
    // Its box saves as the reader types, so a comment answers it now; the
    // card stays a card until the box closes, and nothing is held.
    expect(
      updatesTotal(updates(before, { answeredNow: ["OQ-T1"], own: ["OQ-T1"] })),
    ).toBe(0);
  });

  it("counts nothing for the reader's own Undo, nor for the card that joined before it", () => {
    const needsYou = layoutNeedsYou(layout.needsYou, new Set(), 2);
    const key = keyOf(before, "OQ-T1");
    const inPlace = openRow(shrinkCard(NOTHING_IN_PLACE, needsYou, key), key);
    expect(updatesTotal(updates(before, { inPlace }))).toBe(0);
  });

  it("says the held updates by kind in its title", () => {
    expect(
      updatesTitle(
        new Map([
          ["new reply", 2],
          ["new question", 1],
          ["done", 1],
        ]),
      ),
    ).toBe("2 new replies, 1 new question, 1 done");
  });
});

describe("an answered row's chip (§3.3)", () => {
  const comment = (over: Partial<ReviewComment>): ReviewComment =>
    ({
      id: "c1",
      comment: "Yes.",
      created_at: 1,
      resolved: false,
      reactions: [],
      anchor: { source_line: 5, selection_length: 0 },
      ...over,
    }) as ReviewComment;

  it("says Leaning taken for a pending take, and answered for any other pending comment", () => {
    expect(rowAnswer([comment({})], "Yes.")?.kind).toBe("taken");
    expect(rowAnswer([comment({ comment: "No." })], "Yes.")?.kind).toBe(
      "answered",
    );
    expect(rowAnswer([], "Yes.")).toBeNull();
  });

  it("says what became of a take the agent replied to", () => {
    const replied = comment({
      reactions: [
        { actor: "agent", kind: "addressed", timestamp: 2, summary: "Done." },
      ] as ReviewComment["reactions"],
    });
    expect(rowAnswer([replied], "Yes.")).toMatchObject({
      kind: "retake",
      replied: true,
    });
    expect(agentReplies([replied])).toBe(1);
  });

  it("places each comment on the innermost question whose unit holds its line", () => {
    const index = indexOf(treeOf(), { stages: STAGES });
    const questions = index.documents.flatMap((d) => d.questions);
    const q3 = questions.find((x) => x.id === "OQ-T3")!;
    const on = commentsByQuestion(questions, {
      "plans/a.md": [
        comment({ anchor: { source_line: q3.line, selection_length: 0 } }),
      ] as ReviewComment[],
    });
    expect([...on.keys()]).toEqual([questionKey(q3)]);
  });
});
