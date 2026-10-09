/**
 * Copy answers + maintenance's rules (`docs/design/planning-to-do-list.md`
 * §5.1): the kinds left out, the total, when it is greyed out, and its text.
 */
import { describe, expect, it } from "vitest";
import {
  COPY_KINDS,
  checkedKinds,
  copyGreyed,
  copyTotal,
  maintenancePayload,
  parseLeftOut,
  serializeLeftOut,
} from "./planningCopy";

describe("the kinds left out", () => {
  it("offers the five kinds with a request, in the panel's order", () => {
    expect(COPY_KINDS).toEqual([
      "unrouted",
      "disagrees",
      "compact",
      "graduate",
      "ready",
    ]);
  });

  it("leaves Ready to build out until the reader chooses", () => {
    expect([...parseLeftOut(null)]).toEqual(["ready"]);
    expect(checkedKinds(parseLeftOut(null))).toEqual([
      "unrouted",
      "disagrees",
      "compact",
      "graduate",
    ]);
  });

  it("reads back what it writes, and an empty choice as none left out", () => {
    const leftOut = new Set(["compact", "unrouted"] as const);
    expect(serializeLeftOut(leftOut)).toBe("unrouted,compact");
    expect([...parseLeftOut("unrouted,compact")]).toEqual([
      "unrouted",
      "compact",
    ]);
    expect([...parseLeftOut("")]).toEqual([]);
  });

  it("ignores an id this release does not offer", () => {
    expect([...parseLeftOut("later,graduate, ready")]).toEqual([
      "graduate",
      "ready",
    ]);
  });
});

describe("the total, and greying out", () => {
  const counts = new Map([
    ["unrouted", 3],
    ["disagrees", 1],
    ["compact", 3],
    ["graduate", 2],
    ["ready", 4],
  ]);

  it("counts the answers and every checked kind's items", () => {
    expect(copyTotal(3, counts, parseLeftOut(null))).toBe(12);
    expect(copyTotal(3, counts, new Set())).toBe(16);
    expect(copyTotal(3, counts, new Set(COPY_KINDS))).toBe(3);
  });

  it("is greyed out with no kind checked, or a total of 0", () => {
    expect(copyGreyed(3, new Set(COPY_KINDS))).toBe(true);
    expect(copyGreyed(0, new Set())).toBe(true);
    expect(copyGreyed(1, new Set(["ready"] as const))).toBe(false);
  });
});

describe("the text it copies", () => {
  it("is the answers byte for byte, a blank line, then the request", () => {
    expect(maintenancePayload("A\nend", "Repository: x")).toBe(
      "A\nend\n\nRepository: x",
    );
  });

  it("is either alone when the other is empty, and nothing when both are", () => {
    expect(maintenancePayload(null, "R")).toBe("R");
    expect(maintenancePayload("A", null)).toBe("A");
    expect(maintenancePayload(null, null)).toBeNull();
  });
});
