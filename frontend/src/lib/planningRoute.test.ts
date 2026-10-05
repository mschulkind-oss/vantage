/**
 * The planning page's URL (`docs/reference/planning-index.md` §6), and its
 * repository segment in daemon mode, which `docs/design/planning-filter.md`
 * §9.4 needs encoded so a filtered link can be put after it.
 */
import { describe, expect, it } from "vitest";
import { PLANNING_PAGE_PATH } from "vantage-md/planning";
import { PLANNING_ROUTE, planningPath } from "./planningRoute";

describe("planningPath", () => {
  it("is the planning module's path, which the checker's link starts with", () => {
    expect(PLANNING_ROUTE).toBe("/.vantage/planning");
    expect(PLANNING_ROUTE).toBe(PLANNING_PAGE_PATH);
  });

  it("has no repository segment in single-repository mode", () => {
    expect(planningPath(false, null)).toBe("/.vantage/planning");
    expect(planningPath(false, "alpha")).toBe("/.vantage/planning");
    expect(planningPath(true, null)).toBe("/.vantage/planning");
    expect(planningPath(true, "")).toBe("/.vantage/planning");
  });

  it("leaves a plain name as it is", () => {
    expect(planningPath(true, "alpha")).toBe("/.vantage/planning/alpha");
    expect(planningPath(true, "my-repo_2.x")).toBe(
      "/.vantage/planning/my-repo_2.x",
    );
  });

  it("encodes a name as one path segment, so it cannot end the path early", () => {
    expect(planningPath(true, "my repo")).toBe("/.vantage/planning/my%20repo");
    expect(planningPath(true, "a#b?c%d")).toBe(
      "/.vantage/planning/a%23b%3Fc%25d",
    );
    expect(planningPath(true, "a/b")).toBe("/.vantage/planning/a%2Fb");
    expect(planningPath(true, "caf\u00e9")).toBe(
      "/.vantage/planning/caf%C3%A9",
    );
    // The route decodes it back to the name.
    const segment = planningPath(true, "a#b?c%d").split("/").at(-1)!;
    expect(decodeURIComponent(segment)).toBe("a#b?c%d");
  });
});
