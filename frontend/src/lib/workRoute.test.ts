import { describe, expect, it } from "vitest";
import { isWorkRouteHref, workPath, workRepoFromPath } from "./workRoute";

describe("Work routes", () => {
  it("encodes one repository segment and recognizes the shared route", () => {
    const path = workPath(true, "team/alpha #1");
    expect(path).toBe("/.vantage/work/team%2Falpha%20%231");
    expect(workRepoFromPath(path)).toBe("team/alpha #1");
    expect(isWorkRouteHref(`${path}?source=link#card`)).toBe(true);
    expect(isWorkRouteHref("/.vantage/workshop")).toBe(false);
  });

  it("leaves the projectless chooser at the reserved base route", () => {
    expect(workPath(true, null)).toBe("/.vantage/work");
    expect(workRepoFromPath("/.vantage/work")).toBeNull();
  });
});
