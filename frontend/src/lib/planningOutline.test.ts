/**
 * The planning outline (`docs/reference/planning-index.md` §6.9), drawn from the
 * index alone. Every limit is proven by configuring it down in the limits
 * module, never by growing a tree to a default.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildPlanningIndex, type PlanningConfig } from "vantage-md/planning";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import { indexOf, sourcesOf } from "../test/planning";
import { planningCardId } from "./planningCardId";
import {
  outlineTargetId,
  planningOutline,
  planningRowId,
  type OutlineSection,
} from "./planningOutline";
import {
  layoutPlanningPage,
  sectionsOf,
  type SectionId,
} from "./planningPages";

afterEach(() => setPlanningLimitsForTests(null));

const OPEN = "\u{1F4AC}";
const BLOCKED = "\u{1F512}";

/** `count` questions `${prefix}1` on, each a card of its own. */
function questions(prefix: string, count: number, marker = OPEN) {
  return Array.from({ length: count }, (_, i) =>
    [
      `## Part ${prefix}${i + 1}`,
      "",
      `1. ${marker} **${prefix}${i + 1}: Question ${prefix}${i + 1}?**`,
      "",
      `   <!-- vantage: oq id=${prefix}${i + 1} -->`,
      "",
      "   _Leaning:_ yes.",
      "",
    ].join("\n"),
  ).join("\n");
}

const doc = (front: string, ...body: string[]) =>
  [`---\n${front}\n---`, "", "# Doc", "", ...body].join("\n");

const STAGES: PlanningConfig["stages"] = {
  DESIGN: "open",
  DECIDED: "ready",
  BUILT: "built",
};

/** A roadmap that routes nothing, so every open question is Unrouted. */
const ROADMAP = { "roadmap.md": "# Roadmap\n" };

function outlineOf(tree: Record<string, string>) {
  const index = indexOf({ ...ROADMAP, ...tree }, { stages: STAGES });
  const sections = sectionsOf(index);
  return { index, sections, outline: planningOutline(index, sections) };
}

const sectionOf = (outline: OutlineSection[], id: SectionId) =>
  outline.find((s) => s.id === id)!;

/** Each document of a section, as `path questions page`. */
const listed = (outline: OutlineSection[], id: SectionId) =>
  sectionOf(outline, id).documents.map(
    (d) => `${d.path} ${d.questions} p${d.page}`,
  );

describe("the planning outline", () => {
  it("names each non-empty section with its count, in the page's order", () => {
    const { outline } = outlineOf({
      "b.md": doc("stage: DESIGN", questions("OQ-B", 2)),
      "ready.md": doc("stage: DECIDED", "Decided."),
    });
    expect(outline.map((s) => `${s.title} ${s.total}`)).toEqual([
      "Unrouted 2",
      "Ready 1",
    ]);
  });

  it("lists a section's documents in the section's order, each with its questions there", () => {
    const { outline } = outlineOf({
      "b.md": doc("stage: DESIGN", questions("OQ-B", 3)),
      "a.md": doc("stage: DESIGN", questions("OQ-A", 1)),
    });
    // Unrouted orders by path, then line.
    expect(listed(outline, "unrouted")).toEqual(["a.md 1 p1", "b.md 3 p1"]);
  });

  it("names the page of the section that holds a document's first entry", () => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    const { index, sections, outline } = outlineOf({
      "a.md": doc("stage: DESIGN", questions("OQ-A", 3)),
      "b.md": doc("stage: DESIGN", questions("OQ-B", 2)),
      "c.md": doc("stage: DESIGN", questions("OQ-C", 1)),
    });
    // a.md fills page 1 and starts page 2; b.md starts on page 2; c.md on 3.
    expect(listed(outline, "unrouted")).toEqual([
      "a.md 3 p1",
      "b.md 2 p2",
      "c.md 1 p3",
    ]);
    // The page the outline names is the one the layout shows the
    // document's first card on.
    for (const document of sectionOf(outline, "unrouted").documents) {
      const layout = layoutPlanningPage(index, sections, {
        unrouted: String(document.page),
      });
      const shown = layout.sections.find((s) => s.id === "unrouted")!;
      const cards =
        shown.kind === "cards"
          ? shown.items.flatMap((item) =>
              item.kind === "question" ? [item.question] : [],
            )
          : [];
      expect(cards).toContain(document.question);
    }
  });

  it("goes to a document's first card by the card's id, and to a row by the row's", () => {
    const { outline } = outlineOf({
      "plans/b.md": doc("stage: DESIGN", questions("OQ-B", 2)),
      "plans/deps.md": doc(
        "stage: DESIGN\ndepends-on:\n  - b.md#OQ-B1",
        "Waits.",
      ),
      "plans/ready.md": doc("stage: DECIDED", "Decided."),
    });
    const b = sectionOf(outline, "unrouted").documents[0]!;
    expect(b.question?.id).toBe("OQ-B1");
    // The contract with the cards: the id a card's root carries.
    expect(outlineTargetId("unrouted", b)).toBe(
      planningCardId("plans/b.md", "OQ-B1", b.question!.unitLine),
    );
    expect(outlineTargetId("unrouted", b)).toBe("pq-plans%2Fb.md--OQ-B1");
    const deps = sectionOf(outline, "waiting").documents[0]!;
    expect(deps).toMatchObject({
      path: "plans/deps.md",
      questions: 0,
      question: null,
    });
    expect(outlineTargetId("waiting", deps)).toBe(
      planningRowId("waiting", "plans/deps.md"),
    );
    const ready = sectionOf(outline, "ready").documents[0]!;
    expect(outlineTargetId("ready", ready)).toBe("pr-ready--plans%2Fready.md");
  });

  it("counts a Waiting document's blocked questions with its own row, which comes first", () => {
    const { outline } = outlineOf({
      "b.md": doc("stage: DESIGN", questions("OQ-B", 1)),
      "w.md": doc(
        "stage: DESIGN\ndepends-on:\n  - b.md#OQ-B1",
        questions("OQ-W", 2, BLOCKED),
      ),
    });
    const waiting = sectionOf(outline, "waiting").documents;
    expect(waiting.map((d) => [d.path, d.questions])).toEqual([["w.md", 2]]);
  });

  it("counts the open questions that put a document under Disagrees", () => {
    const { outline } = outlineOf({
      "d.md": doc("stage: DECIDED", questions("OQ-D", 2)),
    });
    expect(listed(outline, "disagrees")).toEqual(["d.md 2 p1"]);
  });

  it("lists no documents under Skipped", () => {
    const index = buildPlanningIndex(
      sourcesOf(
        ROADMAP,
        { skipped: [{ path: "big.md", size: 2_000_000 }] },
        { stages: STAGES },
      ),
    );
    const outline = planningOutline(index, sectionsOf(index));
    expect(sectionOf(outline, "skipped")).toMatchObject({
      total: 1,
      documents: [],
      more: 0,
    });
  });

  it("lists outlineDocuments documents under a section, and counts the rest", () => {
    setPlanningLimitsForTests({ outlineDocuments: 2 });
    const { outline } = outlineOf({
      "a.md": doc("stage: DESIGN", questions("OQ-A", 1)),
      "b.md": doc("stage: DESIGN", questions("OQ-B", 1)),
      "c.md": doc("stage: DESIGN", questions("OQ-C", 1)),
      "d.md": doc("stage: DESIGN", questions("OQ-D", 1)),
    });
    const unrouted = sectionOf(outline, "unrouted");
    expect(unrouted.documents.map((d) => d.path)).toEqual(["a.md", "b.md"]);
    expect(unrouted.more).toBe(2);
    expect(unrouted.total).toBe(4);
  });
});
