/**
 * The ownership map against the real planning scan
 * (`docs/design/planning-question-state.md` §4, §5, §9 scenarios 1-4, 13).
 */
import { describe, expect, it } from "vitest";
import { indexOf, questionDirective } from "../test/planning";
import {
  lifecycleOf,
  ownershipMap,
  questionQuote,
  unassignedRequestsText,
  unresolvedGroups,
  unresolvedCount,
} from "./questionOwnership";
import { blockTextHash } from "../../../packages/vantage-md/src/planning/evidence";
import type { ReviewEvidence } from "../hooks/usePlanningReviews";
import type { PlanningQuestion } from "vantage-md/planning";
import type { ReviewComment } from "../types";

const OPEN = "\u{1F4AC}";
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
const STAGES = { stages: { DESIGN: "open" as const } };

let n = 0;
const comment = (patch: Partial<ReviewComment> = {}): ReviewComment => ({
  id: `c${++n}`,
  comment: "Answer.",
  created_at: 0,
  reactions: [],
  fallback_text: "the original quote",
  ...patch,
});
const agent = {
  actor: "agent" as const,
  kind: "addressed" as const,
  summary: "s",
  before_text: "",
  after_text: "",
  timestamp: 1,
};

describe("unassigned reasons and the quote", () => {
  it("says apart that the checker is not installed and that it refused the scan", () => {
    const index = indexOf({ "a.md": doc(q("OQ-A1")) }, STAGES);
    const reasonOf = (ownership_reason: string) =>
      ownershipMap(index, {
        "a.md": [comment({ ownership: "unknown", ownership_reason })],
      }).unresolved.unassigned[0].reason;
    expect(reasonOf("scanner_unavailable")).toMatch(
      /not installed on the server/,
    );
    expect(reasonOf("scan_refused")).toMatch(/refused the scan/);
    expect(reasonOf("scan_refused")).not.toMatch(/not installed/);
    // A checker that crashed or raced is never called not installed.
    expect(reasonOf("scanner_failed")).toMatch(/checker failed/);
    expect(reasonOf("scan_raced")).toMatch(/changed while/);
    for (const r of ["scanner_failed", "scan_raced"]) {
      expect(reasonOf(r)).not.toMatch(/not installed/);
    }
  });

  it("cuts a quote on code points, never inside a surrogate pair", () => {
    const text = "x".repeat(199) + "\u{1F4AC}" + "tail";
    const quote = questionQuote({ unitText: text } as PlanningQuestion);
    expect(Array.from(quote)).toHaveLength(200);
    expect(quote.endsWith("\u{1F4AC}")).toBe(true);
    expect(quote).not.toMatch(/[\ud800-\udbff]$/);
  });
});

describe("ownershipMap", () => {
  it("credits a comment to its id's question wherever that question moved, never to the line", () => {
    const index = indexOf({ "a.md": doc(q("OQ-B1"), q("OQ-A1")) }, STAGES);
    const c = comment({ question_id: "OQ-A1" });
    const map = ownershipMap(index, { "a.md": [c] });
    expect(map.entries[0]).toMatchObject({ kind: "bound" });
    expect(map.entries[0].question?.id).toBe("OQ-A1");
    expect(map.boundPending.get("a.md")).toEqual([c]);
  });

  it("puts a comment with no id in Unassigned with its quote, counted apart", () => {
    const index = indexOf({ "a.md": doc(q("OQ-A1")) }, STAGES);
    const c = comment();
    const map = ownershipMap(index, { "a.md": [c] });
    expect(map.unresolved.unassigned.map((e) => e.comment)).toEqual([c]);
    expect(map.boundPending.size).toBe(0);
    expect(unresolvedCount(map)).toBe(1);
  });

  it("puts threads on a repeated id in Ambiguous, credited to no card", () => {
    const index = indexOf(
      { "a.md": doc(q("OQ-A1"), "", q("OQ-A1"), "", q("OQ-Z1")) },
      STAGES,
    );
    const c = comment({ question_id: "OQ-A1" });
    const map = ownershipMap(index, { "a.md": [c] });
    expect(map.unresolved.ambiguous.map((e) => e.comment)).toEqual([c]);
    expect(map.boundPending.size).toBe(0);
  });

  it("keeps a comment on a deleted question as Removed, readable", () => {
    const index = indexOf({ "a.md": doc(q("OQ-Z1")) }, STAGES);
    const c = comment({ question_id: "OQ-G1" });
    const map = ownershipMap(index, { "a.md": [c] });
    expect(map.unresolved.removed[0].comment).toBe(c);
    expect(map.unresolved.removed[0].comment.fallback_text).toBe(
      "the original quote",
    );
  });

  it("reads a comment in an unscanned document as Unknown, not Removed", () => {
    const index = indexOf({ "a.md": doc(q("OQ-Z1")) }, STAGES);
    const c = comment({ question_id: "OQ-A1" });
    const map = ownershipMap(index, { "elsewhere.md": [c] });
    expect(map.unresolved.unknown).toHaveLength(1);
    expect(map.unresolved.removed).toHaveLength(0);
  });

  it("is one map per scan and review identity", () => {
    const index = indexOf({ "a.md": doc(q("OQ-A1")) }, STAGES);
    const byPath = { "a.md": [comment({ question_id: "OQ-A1" })] };
    expect(ownershipMap(index, byPath)).toBe(ownershipMap(index, byPath));
  });

  it("leaves placed comments to Copy answers and keeps unassigned requests apart", () => {
    const index = indexOf({ "a.md": doc(q("OQ-A1")) }, STAGES);
    const placed = comment();
    const loose = comment({ comment: "loose request" });
    const map = ownershipMap(index, { "a.md": [placed, loose] });
    const groups = unresolvedGroups(map, new Set([placed.id]));
    expect(groups.unassigned.map((e) => e.comment)).toEqual([loose]);
    const text = unassignedRequestsText(groups)!;
    expect(text).toContain("> the original quote");
    expect(text).toContain("loose request");
    expect(text).not.toContain(placed.id);
  });
});

describe("lifecycleOf", () => {
  const index = indexOf(
    { "a.md": doc(q("OQ-A1"), "", q("OQ-R1", "✅")) },
    STAGES,
  );
  const [open, ruled] = index.documents[0].questions;
  it("never claims more than the evidence", () => {
    expect(lifecycleOf(open, [])).toBe("Open");
    expect(lifecycleOf(open, [], false)).toBe("Unknown");
    expect(lifecycleOf(ruled, [])).toBe("Ruling recorded");
    expect(lifecycleOf(open, [comment()])).toBe(
      "Response saved, waiting for agent",
    );
    expect(lifecycleOf(open, [comment({ reactions: [agent] })])).toBe(
      "Agent replied, question still open",
    );
  });
});

/** A question whose detail line is its own, so its block hash is unique. */
const own = (id: string, detail = `Detail for ${id} only.`) =>
  [
    `1. ${OPEN} **${id}: Question ${id}?**`,
    "",
    `   ${detail}`,
    "",
    `   ${questionDirective(OPEN, id, "Yes.")}`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const legacy = (detail: string, patch: Partial<ReviewComment> = {}) =>
  comment({
    anchor: {
      source_line: 10,
      block_text_hash: blockTextHash(detail),
      selection_offset: 0,
      selection_length: 0,
    },
    ...patch,
  });

describe("legacy auto-bind candidates (real scan output)", () => {
  it("follows a legacy comment's block to the question that holds it after A and B swap, never the line", () => {
    const detailA = "Detail for OQ-A1 only.";
    const before = indexOf({ "a.md": doc(own("OQ-A1"), own("OQ-B1")) }, STAGES);
    const after = indexOf({ "a.md": doc(own("OQ-B1"), own("OQ-A1")) }, STAGES);
    const c = legacy(detailA);
    const beforeMap = ownershipMap(before, { "a.md": [c] });
    const afterMap = ownershipMap(after, { "a.md": [c] });
    expect(beforeMap.entries[0].candidate?.id).toBe("OQ-A1");
    // Question B now sits on the line A had; the comment still goes to A.
    expect(afterMap.entries[0].candidate?.id).toBe("OQ-A1");
    expect(afterMap.entries[0].kind).toBe("unassigned");
  });

  it("proposes nothing when the same text appears twice in the document", () => {
    const index = indexOf(
      { "a.md": doc(own("OQ-A1"), own("OQ-B1", "Detail for OQ-A1 only.")) },
      STAGES,
    );
    const map = ownershipMap(index, {
      "a.md": [legacy("Detail for OQ-A1 only.")],
    });
    expect(map.entries[0].candidate).toBeUndefined();
  });

  it("proposes nothing when the block's question id is repeated", () => {
    const index = indexOf(
      { "a.md": doc(own("OQ-A1"), own("OQ-A1", "Other detail.")) },
      STAGES,
    );
    const map = ownershipMap(index, {
      "a.md": [legacy("Detail for OQ-A1 only.")],
    });
    expect(map.entries[0].candidate).toBeUndefined();
  });

  it("proposes nothing for a comment that already names a question, or whose hash is not in the document", () => {
    const index = indexOf({ "a.md": doc(own("OQ-A1")) }, STAGES);
    const named = legacy("Detail for OQ-A1 only.", { question_id: "OQ-A1" });
    const gone = legacy("text that was edited away");
    const map = ownershipMap(index, { "a.md": [named, gone] });
    expect(map.entries.map((e) => e.candidate)).toEqual([undefined, undefined]);
  });
});

describe("ownership keyed on the reviews' reading", () => {
  const index = () => indexOf({ "a.md": doc(own("OQ-A1")) }, STAGES);
  const reading = (patch: Partial<ReviewEvidence> = {}): ReviewEvidence => ({
    boot_id: "b",
    document_generation: 1,
    content_hash: "h1",
    mutation_revision: 1,
    sample_changed: false,
    ...patch,
  });

  it("reads a comment as bound only against a reading of the scanned version", () => {
    const idx = index();
    const c = comment({ question_id: "OQ-A1" });
    const byPath = { "a.md": [c] };
    const ok = ownershipMap(idx, byPath, {
      evidence: { "a.md": reading() },
      hashes: { "a.md": "h1" },
    });
    expect(ok.entries[0].kind).toBe("bound");
    expect(ok.entries[0].reading?.mutation_revision).toBe(1);
  });

  it("reads Unknown when the sample changed, the hash differs, or there is no evidence", () => {
    const idx = index();
    const c = comment({ question_id: "OQ-A1" });
    const kinds = [
      { "a.md": reading({ sample_changed: true }) },
      { "a.md": reading({ content_hash: "other" }) },
      {},
    ].map(
      (evidence) =>
        ownershipMap(
          idx,
          { "a.md": [c] },
          { evidence, hashes: { "a.md": "h1" } },
        ).entries[0],
    );
    expect(kinds.map((e) => e.kind)).toEqual(["unknown", "unknown", "unknown"]);
    expect(kinds[0].reason).toMatch(/changed while/);
    expect(kinds[1].reason).toMatch(/another version/);
    // An Unknown comment is counted as unresolved, never credited to a card.
    const map = ownershipMap(
      idx,
      { "a.md": [c] },
      { evidence: {}, hashes: { "a.md": "h1" } },
    );
    expect(map.unresolved.unknown).toHaveLength(1);
    expect(map.boundPending.size).toBe(0);
  });

  it("does not propose a bind from an unpaired reading", () => {
    const idx = index();
    const c = legacy("Detail for OQ-A1 only.");
    const map = ownershipMap(
      idx,
      { "a.md": [c] },
      {
        evidence: { "a.md": reading({ sample_changed: true }) },
        hashes: { "a.md": "h1" },
      },
    );
    expect(map.entries[0].candidate).toBeUndefined();
  });

  it("is a new map for a new reading of the same reviews", () => {
    const idx = index();
    const byPath = { "a.md": [comment({ question_id: "OQ-A1" })] };
    const first = ownershipMap(idx, byPath, {
      evidence: { "a.md": reading() },
      hashes: { "a.md": "h1" },
    });
    const evidence = { "a.md": reading({ sample_changed: true }) };
    const second = ownershipMap(idx, byPath, {
      evidence,
      hashes: { "a.md": "h1" },
    });
    expect(second).not.toBe(first);
    expect(second.entries[0].kind).toBe("unknown");
  });
});

describe("Compacted", () => {
  const ledger = [
    "",
    "## Decision Ledger",
    "",
    "| ID | Decision |",
    "| --- | --- |",
    "| OQ-C1 | Ruled |",
    "",
  ].join("\n");

  it("reads a comment on an id only the ledger holds as Compacted, and one on an id written elsewhere as Unknown", () => {
    const index = indexOf(
      { "a.md": doc(own("OQ-A1"), ledger, "", "See OQ-Z9 for context.") },
      STAGES,
    );
    const map = ownershipMap(index, {
      "a.md": [
        comment({ question_id: "OQ-C1" }),
        comment({ question_id: "OQ-Z9" }),
        comment({ question_id: "OQ-Y9" }),
      ],
    });
    expect(map.entries.map((e) => e.kind)).toEqual([
      "compacted",
      "unknown",
      "removed",
    ]);
  });
});
