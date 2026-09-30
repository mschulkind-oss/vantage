/**
 * `[planning] include` and `exclude` mean what the server's matcher says they
 * mean (design §3.1, Plan Q1), and a path is a roadmap exactly when the
 * server's roadmap test says it is (§6.1).
 *
 * The expected answers are not written here. They live in fixtures shared
 * with the server's suite, and every pattern answer was produced by running
 * `sabhiram/go-gitignore` under Go's `regexp` — so this file proves the port
 * agrees with Go, and the server's test proves the fixture still is Go.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNING_CONFIG,
  ROADMAP_FILE_NAME,
  candidateMatcher,
  compareRoadmaps,
  compileIgnorePatterns,
  hasRoadmapName,
  isRoadmapPath,
  type PlanningConfig,
} from "vantage-md/planning";
import { planningFixture } from "../test/planning";

interface PatternCase {
  include: string[];
  exclude: string[];
  path: string;
  candidate: boolean;
}

const fixture = planningFixture<{ cases: PatternCase[] }>(
  "planning-patterns.json",
);

describe("the planning pattern matcher", () => {
  it.each(fixture.cases)(
    "include $include, exclude $exclude: $path → $candidate",
    ({ include, exclude, path, candidate }) => {
      const included = compileIgnorePatterns(include);
      const excluded = compileIgnorePatterns(exclude);
      expect(included(path) && !excluded(path)).toBe(candidate);
    },
  );

  it("covers the quirks the design names, so the fixture cannot lose them", () => {
    // Each of these is a row the plan requires; a fixture regenerated without
    // one would still pass the loop above.
    const includes = fixture.cases.map((c) => c.include.join("\n"));
    for (const pattern of [
      "[[:upper:]]*.md",
      "(?=x)",
      "a+b.md",
      "{a,b}.md",
      "dir/",
      "a?.md",
    ]) {
      expect(includes).toContain(pattern);
    }
    expect(fixture.cases).toContainEqual(
      expect.objectContaining({
        exclude: ["docs/gallery/**"],
        path: "x/docs/gallery/a.md",
        candidate: false,
      }),
    );
  });

  it("treats a line Go cannot compile as absent, not as a match-nothing error", () => {
    // `\q` is an invalid escape in RE2 and the letter `q` in JavaScript, which
    // is exactly the disagreement the dialect step exists to remove.
    expect(compileIgnorePatterns(["\\q.md"])("q.md")).toBe(false);
    expect(compileIgnorePatterns(["\\q.md", "*.md"])("q.md")).toBe(true);
  });
});

const config = (overrides: Partial<PlanningConfig>): PlanningConfig => ({
  ...DEFAULT_PLANNING_CONFIG,
  ...overrides,
});

describe("candidateMatcher", () => {
  it("includes everything and excludes nothing by default", () => {
    const matches = candidateMatcher(config({}));
    expect(matches("roadmap.md")).toBe(true);
    expect(matches("docs/gallery/status.md")).toBe(true);
  });

  it("lets exclude win over include", () => {
    const matches = candidateMatcher(
      config({ exclude: ["docs/gallery/**", "frontend/e2e/fixtures/**"] }),
    );
    expect(matches("docs/gallery/status.md")).toBe(false);
    expect(matches("frontend/e2e/fixtures/test_repo/plans/a.md")).toBe(false);
    expect(matches("docs/design/planning-index.md")).toBe(true);
  });

  it("makes a listed roadmap a candidate even when include or exclude rules it out (Plan Q2)", () => {
    const matches = candidateMatcher(
      config({
        roadmaps: ["plans/ROADMAP.md", "notes/next.md"],
        include: ["docs/**"],
        exclude: ["plans/**", "notes/**"],
      }),
    );
    expect(matches("plans/ROADMAP.md")).toBe(true);
    expect(matches("notes/next.md")).toBe(true);
    expect(matches("plans/other.md")).toBe(false);
    expect(matches("docs/a.md")).toBe(true);
  });

  it("matches a listed roadmap's path exactly, not by pattern", () => {
    const matches = candidateMatcher(
      config({ include: [], roadmaps: ["a.md"] }),
    );
    expect(matches("a.md")).toBe(true);
    expect(matches("x/a.md")).toBe(false);
  });

  // §6.1: a roadmap found by name is one because it is a candidate, so the
  // patterns are how a reader hides one.
  it("gives a roadmap found by name no exemption", () => {
    const matches = candidateMatcher(config({ exclude: ["vendor/**"] }));
    expect(matches("vendor/pkg/roadmap.md")).toBe(false);
    expect(matches("docs/roadmap.md")).toBe(true);
    expect(candidateMatcher(config({ include: [] }))("roadmap.md")).toBe(false);
  });
});

interface RoadmapCase {
  roadmaps: string[] | null;
  include: string[];
  exclude: string[];
  path: string;
  candidate: boolean;
  roadmap: boolean;
}

describe("the roadmap test, as planning-roadmaps.json pins it for both readers", () => {
  const { cases } = planningFixture<{ cases: RoadmapCase[] }>(
    "planning-roadmaps.json",
  );

  it.each(cases)(
    "roadmaps $roadmaps, include $include, exclude $exclude: $path → candidate $candidate, roadmap $roadmap",
    ({ roadmaps, include, exclude, path, candidate, roadmap }) => {
      const full = config({ roadmaps, include, exclude });
      expect(candidateMatcher(full)(path)).toBe(candidate);
      expect(isRoadmapPath(full, path)).toBe(roadmap);
    },
  );

  it("covers the cases the plan names, so the fixture cannot lose them", () => {
    const byName = cases.filter((c) => c.roadmaps === null);
    for (const [path, roadmap] of [
      ["ROADMAP.md", true],
      ["ROADMAP.MD", true],
      ["roadmap.markdown", false],
      ["roadmap.md/notes.md", false],
      ["\u0280oadmap.md", false],
    ] as const) {
      expect(byName).toContainEqual(expect.objectContaining({ path, roadmap }));
    }
    // Named like a roadmap, and not a candidate: the default include is
    // case-sensitive.
    expect(cases).toContainEqual(
      expect.objectContaining({
        path: "ROADMAP.MD",
        candidate: false,
        roadmap: true,
      }),
    );
    expect(cases).toContainEqual(
      expect.objectContaining({ roadmaps: [], roadmap: false }),
    );
  });
});

describe("the roadmap name, and roadmap order (§6.1)", () => {
  it("is roadmap.md, compared ASCII case-insensitively on the last segment", () => {
    expect(ROADMAP_FILE_NAME).toBe("roadmap.md");
    for (const path of ["roadmap.md", "a/b/RoadMap.MD", "docs/ROADMAP.md"]) {
      expect(hasRoadmapName(path), path).toBe(true);
    }
    for (const path of [
      "roadmap.markdown",
      "my-roadmap.md",
      "roadmap.md/notes.md",
      "roadmap.md.bak",
      " roadmap.md",
      // Letters that only look like an r.
      "\u0280oadmap.md",
      "\uFF52oadmap.md",
    ]) {
      expect(hasRoadmapName(path), path).toBe(false);
    }
  });

  it("is listed membership when roadmaps are listed, exactly and case-sensitively", () => {
    const listed = config({ roadmaps: ["docs/PLAN.md", "Roadmap.md"] });
    expect(isRoadmapPath(listed, "docs/PLAN.md")).toBe(true);
    expect(isRoadmapPath(listed, "Roadmap.md")).toBe(true);
    expect(isRoadmapPath(listed, "roadmap.md")).toBe(false);
    expect(isRoadmapPath(listed, "docs/plan.md")).toBe(false);
    expect(isRoadmapPath(config({ roadmaps: [] }), "roadmap.md")).toBe(false);
    expect(isRoadmapPath(config({}), "x/roadmap.md")).toBe(true);
  });

  it("puts fewer segments first, then path order", () => {
    expect(
      [
        "docs/plans/roadmap.md",
        "docs/roadmap.md",
        "b/roadmap.md",
        "roadmap.md",
        "ROADMAP.md",
        "a/b/c/d.md",
      ].sort(compareRoadmaps),
    ).toEqual([
      "ROADMAP.md",
      "roadmap.md",
      "b/roadmap.md",
      "docs/roadmap.md",
      "docs/plans/roadmap.md",
      "a/b/c/d.md",
    ]);
  });
});
