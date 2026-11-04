import { describe, expect, it } from "vitest";
import { ownershipCue } from "./replyCoverage";
import type { ReviewComment } from "../types";

const c = (patch: Partial<ReviewComment>): ReviewComment => ({
  id: "c",
  comment: "x",
  created_at: 0,
  reactions: [],
  ...patch,
});

describe("ownershipCue", () => {
  it("names the reason and never contradicts a proven question id", () => {
    expect(
      ownershipCue(
        c({
          question_id: "OQ-1",
          ownership: "unknown",
          ownership_reason: "question_not_at_anchor",
        }),
      ),
    ).toBe("anchor moved");
    expect(
      ownershipCue(
        c({ ownership: "unknown", ownership_reason: "scanner_unavailable" }),
      ),
    ).toBe("checker not installed");
    expect(
      ownershipCue(
        c({ ownership: "unknown", ownership_reason: "scan_refused" }),
      ),
    ).toBe("scan refused");
    expect(
      ownershipCue(
        c({ ownership: "unknown", ownership_reason: "scanner_failed" }),
      ),
    ).toBe("checker failed");
    expect(
      ownershipCue(c({ ownership: "unknown", ownership_reason: "scan_raced" })),
    ).toBe("document changed during scan");
    expect(ownershipCue(c({ ownership: "unknown" }))).toBe("ownership unknown");
    expect(ownershipCue(c({ ownership: "proven" }))).toBeNull();
  });
});
