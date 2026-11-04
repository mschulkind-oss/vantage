/**
 * What the shared scanner reads for the review store's ownership decisions: a
 * unit's source fingerprint (the server's `review.BuildUnit` hash), the
 * Decision Ledger's first-column ids, and the anchor hashes of a document's
 * blocks (`packages/vantage-md/src/planning/evidence.ts`).
 */
import { describe, expect, it } from "vitest";
import { scanPlanningDocument } from "vantage-md/planning";
import { hashBlockText } from "./reviewAnchor";
import {
  contentHash,
  blockTextHash,
  unitFingerprint,
} from "../../../packages/vantage-md/src/planning/evidence";

function planning(source: string) {
  const r = scanPlanningDocument("docs/design/x.md", source, false);
  if (r.kind !== "planning") throw new Error("not planning");
  return r.document;
}

const NL = String.fromCharCode(10);
const DOC = [
  "---",
  "status: in-review",
  "---",
  "# Title",
  "",
  "1. 💬 **OQ-A1: Alpha?**",
  "",
  '   <!-- vantage: question id=OQ-A1 leaning="x" -->',
  "",
  "   _Leaning:_ x",
  "",
  "2. 💬 **OQ-B1: Beta?**",
  "",
  '   <!-- vantage: question id=OQ-B1 leaning="x" -->',
  "",
  "   _Leaning:_ x",
  "",
  "## Decision Ledger",
  "",
  "| ID | Decision |",
  "| --- | --- |",
  "| OQ-C1 | Ruled long ago |",
  "| `OQ-C2` | Ruled |",
  "",
  "## After",
  "",
  "| ID | Decision |",
  "| --- | --- |",
  "| OQ-D1 | not a ledger |",
  "",
].join("\n");

describe("sha256 prefix", () => {
  it("matches the server's ContentHash vectors (sha256 first 128 bits)", () => {
    expect(contentHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223");
    expect(contentHash("line one\nline two")).toBe(
      "b6858b03a6cae635deeaeab09a74e598",
    );
  });
});

describe("planning scan evidence", () => {
  it("fingerprints a unit as the hash of its source lines", () => {
    const doc = planning(DOC);
    const a = doc.questions.find((q) => q.id === "OQ-A1");
    const unit = DOC.split(NL).slice(a!.unitLine - 1, a!.unitEndLine);
    expect(unit.join(NL)).toContain("OQ-A1: Alpha?");
    expect(a?.unitFingerprint).toBe(contentHash(unit.join(NL)));
  });

  it("ignores CR in the fingerprint, as the server does", () => {
    const crlf = planning(DOC.replace(/\n/g, "\r\n"));
    const lf = planning(DOC);
    expect(crlf.questions[0]?.unitFingerprint).toBe(
      lf.questions[0]?.unitFingerprint,
    );
  });

  it("reads ledger first-column ids under the Decision Ledger only", () => {
    expect(planning(DOC).ledgerIds).toEqual(["OQ-C1", "OQ-C2"]);
  });

  it("maps a block's anchor hash to its line, and a repeated one to 0", () => {
    const doc = planning(
      DOC.replace(
        "# Title",
        "# Title\n\nsame words\n\nsame words\n\nonly here",
      ),
    );
    expect(doc.blockLines[blockTextHash("only here")]).toBeGreaterThan(0);
    expect(doc.blockLines[blockTextHash("same words")]).toBe(0);
  });
});

describe("unit fingerprint across the two implementations", () => {
  // The same literal is pinned by internal/review's TestBuildUnitFingerprintMatchesScanner.
  it("equals the server's BuildUnit fingerprint for the same lines", () => {
    expect(unitFingerprint("a\r\nb c\r\nd", 2, 3)).toBe(
      "6f6a59d1a2c07723dfc69d6a6a7973d4",
    );
  });
});

describe("anchor block hash", () => {
  it("is the one the viewer stores in a comment anchor", () => {
    for (const text of [
      "Plain words.",
      "  Mixed   CASE\nand\tspace ",
      "ünïcode ✅",
    ]) {
      expect(blockTextHash(text)).toBe(hashBlockText(text));
    }
  });
});
