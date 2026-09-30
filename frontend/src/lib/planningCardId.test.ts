/**
 * The id a question's card carries on the planning page, which the page's
 * outline looks up to scroll to it (`planningCardId.ts`).
 */
import { describe, expect, it } from "vitest";
import { planningCardId } from "./planningCardId";

describe("planningCardId", () => {
  it("names a question by its document and its id", () => {
    expect(planningCardId("docs/design/x.md", "OQ-B4", 12)).toBe(
      "pq-docs%2Fdesign%2Fx.md--OQ-B4",
    );
  });

  it("names a question without an id by the line its unit starts on", () => {
    expect(planningCardId("docs/x.md", null, 42)).toBe("pq-docs%2Fx.md--L42");
  });

  it("keeps a path's spaces, hashes and dashes out of the way of the separator", () => {
    const id = planningCardId("a b/c#d--e.md", "OQ-1", 1);
    expect(id).toBe("pq-a%20b%2Fc%23d--e.md--OQ-1");
    expect(id).not.toMatch(/\s|#/);
  });

  it("finds the card with getElementById", () => {
    const el = document.createElement("article");
    el.id = planningCardId("docs/a b.md", "OQ-2", 3);
    document.body.appendChild(el);
    try {
      expect(
        document.getElementById(planningCardId("docs/a b.md", "OQ-2", 3)),
      ).toBe(el);
    } finally {
      el.remove();
    }
  });
});
