/**
 * The planning outline (`docs/reference/planning-index.md` §6.9), drawn from the
 * index alone. Every limit is proven by configuring it down in the limits
 * module, never by growing a tree to a default.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPlanningIndex,
  sectionExplanation,
  type PlanningConfig,
} from "vantage-md/planning";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import { indexOf, questionDirective, sourcesOf } from "../test/planning";
import { planningCardId } from "./planningCardId";
import {
  outlineTargetId,
  planningOutline,
  planningRowId,
  type OutlineSection,
} from "./planningOutline";
import { sectionsOf, type SectionId } from "./planningPages";

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
      `   ${questionDirective(marker, `${prefix}${i + 1}`)}`,
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

/** A roadmap that routes nothing, so no open question is on a roadmap. */
const ROADMAP = { "roadmap.md": "# Roadmap\n" };

function outlineOf(tree: Record<string, string>) {
  const index = indexOf({ ...ROADMAP, ...tree }, { stages: STAGES });
  const sections = sectionsOf(index);
  return { index, sections, outline: planningOutline(index, sections) };
}

const sectionOf = (outline: OutlineSection[], id: SectionId) =>
  outline.find((s) => s.id === id)!;

/** Each document of a section, as `path questions`. */
const listed = (outline: OutlineSection[], id: SectionId) =>
  sectionOf(outline, id).documents.map((d) => `${d.path} ${d.questions}`);

describe("the planning outline", () => {
  it("names each non-empty section with its count, in the page's order", () => {
    const { outline } = outlineOf({
      "b.md": doc("stage: DESIGN", questions("OQ-B", 2)),
      "ready.md": doc("stage: DECIDED", "Decided."),
    });
    expect(outline.map((s) => `${s.title} ${s.total}`)).toEqual([
      "Not on a roadmap 2",
      "Ready to build 1",
    ]);
  });

  it("gives each section the line under its heading, as the page's tooltip", () => {
    const { outline, sections } = outlineOf({
      "b.md": doc("stage: DESIGN", questions("OQ-B", 1)),
      "ready.md": doc("stage: DECIDED", "Decided."),
    });
    expect(outline.map((s) => s.explanation)).toEqual([
      sectionExplanation("unrouted", sections),
      sectionExplanation("ready", sections),
    ]);
    expect(sectionOf(outline, "ready").explanation).toBe(
      "Decided, with no open questions. An agent builds it.",
    );
  });

  it("lists a section's documents in the section's order, each with its questions there", () => {
    const { outline } = outlineOf({
      "b.md": doc("stage: DESIGN", questions("OQ-B", 3)),
      "a.md": doc("stage: DESIGN", questions("OQ-A", 1)),
    });
    // Not on a roadmap orders by path, then line.
    expect(listed(outline, "unrouted")).toEqual(["a.md 1", "b.md 3"]);
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

  it("counts a Blocked document's blocked questions with its own row, which comes first", () => {
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

  it("counts the open questions that put a document under Stage conflict", () => {
    const { outline } = outlineOf({
      "d.md": doc("stage: DECIDED", questions("OQ-D", 2)),
    });
    expect(listed(outline, "disagrees")).toEqual(["d.md 2"]);
  });

  it("lists no documents under Too large", () => {
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
