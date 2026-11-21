/**
 * The last coherent reading of each document
 * (`docs/reference/planning-ownership.md` §5): while a document's reviews
 * are paired with another version than the scan's, the page shows the reading
 * it last held whole, and says which documents those are.
 */
import { describe, expect, it } from "vitest";
import { indexOf, questionDirective } from "../test/planning";
import { LastCoherent } from "./coherentReadings";
import type { ReviewEvidence } from "../hooks/usePlanningReviews";
import type { ReviewComment } from "../types";

const OPEN = "\u{1F4AC}";
const doc = (title: string) =>
  [
    "---",
    "stage: DESIGN",
    "---",
    "",
    `1. ${OPEN} **OQ-A1: ${title}?**`,
    "",
    `   ${questionDirective(OPEN, "OQ-A1", "Yes.")}`,
    "",
    "   Words.",
    "",
  ].join("\n");
const STAGES = { stages: { DESIGN: "open" as const } };
const reading = (hash: string, extra: Partial<ReviewEvidence> = {}) => ({
  boot_id: "b",
  document_generation: 1,
  content_hash: hash,
  mutation_revision: 1,
  sample_changed: false,
  ...extra,
});
const answer: ReviewComment = {
  id: "c1",
  comment: "Yes",
  question_id: "OQ-A1",
  created_at: 0,
  reactions: [],
};

describe("LastCoherent", () => {
  const first = indexOf({ "a.md": doc("First") }, STAGES);
  const edited = indexOf({ "a.md": doc("Edited") }, STAGES);

  it("passes a coherent reading through as it is, the same objects", () => {
    const held = new LastCoherent();
    const byPath = { "a.md": [answer] };
    const evidence = { "a.md": reading("h1") };
    const hashes = { "a.md": "h1" };
    const out = held.take(first, byPath, evidence, hashes);
    expect(out.index).toBe(first);
    expect(out.byPath).toBe(byPath);
    expect(out.evidence).toBe(evidence);
    expect(out.hashes).toBe(hashes);
    expect(out.stale.size).toBe(0);
  });

  it("shows the last coherent reading of a document whose reviews are paired with another version, and marks it stale", () => {
    const held = new LastCoherent();
    held.take(
      first,
      { "a.md": [answer] },
      { "a.md": reading("h1") },
      {
        "a.md": "h1",
      },
    );
    // An agent edited the document: the scan moved, the reviews have not.
    const out = held.take(
      edited,
      { "a.md": [] },
      { "a.md": reading("h1") },
      { "a.md": "h2" },
    );
    expect(out.stale).toEqual(new Set(["a.md"]));
    expect(out.byPath["a.md"]).toEqual([answer]);
    expect(out.hashes["a.md"]).toBe("h1");
    expect(out.evidence["a.md"]?.content_hash).toBe("h1");
    expect(out.index?.documents[0].questions[0].title).toBe("OQ-A1: First?");

    // The reviews caught up: the new reading is shown, and nothing is stale.
    const caught = held.take(
      edited,
      { "a.md": [] },
      { "a.md": reading("h2") },
      { "a.md": "h2" },
    );
    expect(caught.stale.size).toBe(0);
    expect(caught.index).toBe(edited);
    expect(caught.byPath["a.md"]).toEqual([]);
  });

  it("treats a sample read while the document changed as stale too", () => {
    const held = new LastCoherent();
    held.take(
      first,
      { "a.md": [answer] },
      { "a.md": reading("h1") },
      {
        "a.md": "h1",
      },
    );
    const out = held.take(
      first,
      { "a.md": [] },
      { "a.md": reading("h1", { sample_changed: true }) },
      { "a.md": "h1" },
    );
    expect(out.stale).toEqual(new Set(["a.md"]));
    expect(out.byPath["a.md"]).toEqual([answer]);
  });

  it("marks a document stale with nothing to show when it was never read whole", () => {
    const held = new LastCoherent();
    const byPath = { "a.md": [answer] };
    const out = held.take(
      edited,
      byPath,
      { "a.md": reading("h1") },
      {
        "a.md": "h2",
      },
    );
    expect(out.stale).toEqual(new Set(["a.md"]));
    expect(out.byPath).toBe(byPath);
    expect(out.index).toBe(edited);
  });

  it("is never stale for a document with no review at all", () => {
    const held = new LastCoherent();
    const out = held.take(first, { "a.md": [] }, {}, { "a.md": "h1" });
    expect(out.stale.size).toBe(0);
  });
});
