/**
 * The planning page's URL (`docs/reference/planning-index.md` §6), and its
 * repository segment in daemon mode, which `docs/reference/planning-index.md`
 * §13.5 needs encoded so a filtered link can be put after it.
 */
import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PLANNING_PAGE_PATH } from "vantage-md/planning";
import {
  PLANNING_ROUTE,
  isPlanningRouteHref,
  planningPath,
} from "./planningRoute";

/**
 * The repository a planning URL names, read as the page reads it: the first
 * segment of the splat of App.tsx's one `${PLANNING_ROUTE}/*` route, which
 * React Router decodes.
 */
function repositoryOf(pathname: string): string | undefined {
  const match = matchRoutes([{ path: `${PLANNING_ROUTE}/*` }], pathname);
  return match?.[0]?.params["*"]?.split("/").filter(Boolean)[0];
}

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
  });

  it("is read back to the name through the route", () => {
    for (const name of [
      "alpha",
      "my repo",
      "a#b?c%d",
      "caf\u00e9",
      "a+b=c@d:e$f&g (h)!*'",
    ]) {
      expect(repositoryOf(planningPath(true, name)), name).toBe(name);
    }
  });

  // cmd/vantage/tips.go writes the segment with Go's url.PathEscape, which
  // differs from encodeURIComponent on `+ = @ : $ &` and `( ) ! * '`: the
  // same page, by another string.
  it("names the same repository as the startup tip's encoding", () => {
    const name = "a+b=c@d:e$f&g (h)!*'";
    const tip = `${PLANNING_ROUTE}/a+b=c@d:e$f&g%20%28h%29%21%2A%27`;
    expect(planningPath(true, name)).not.toBe(tip);
    expect(repositoryOf(tip)).toBe(name);
  });
});

describe("isPlanningRouteHref", () => {
  it("is the planning route, with a project segment, a query or a fragment", () => {
    for (const href of [
      "/.vantage/planning",
      "/.vantage/planning/",
      "/.vantage/planning?filter=is:open&space=abcdefghijklmnop",
      "/.vantage/planning#needs-you",
      "/.vantage/planning/beta?filter=is:open",
      "/.vantage/planning/my%20repo",
    ]) {
      expect(isPlanningRouteHref(href), href).toBe(true);
    }
  });

  it("is no other path, nor one that only starts like it", () => {
    for (const href of [
      "/.vantage/planningx",
      "/.vantage/plan",
      ".vantage/planning",
      "/docs/.vantage/planning",
      "/gamma/.vantage/planning",
      "planning.md",
      "#planning",
    ]) {
      expect(isPlanningRouteHref(href), href).toBe(false);
    }
  });
});
