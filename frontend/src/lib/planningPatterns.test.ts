/**
 * `[planning] include` and `exclude` mean what the server's matcher says they
 * mean (design §3.1, Plan Q1).
 *
 * The expected answers are not written here. They live in a fixture shared
 * with the server's suite, and every one of them was produced by running
 * `sabhiram/go-gitignore` under Go's `regexp` — so this file proves the port
 * agrees with Go, and the server's test proves the fixture still is Go.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNING_CONFIG,
  candidateMatcher,
  compileIgnorePatterns,
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

describe("candidateMatcher", () => {
  const config = (overrides: Partial<PlanningConfig>): PlanningConfig => ({
    ...DEFAULT_PLANNING_CONFIG,
    ...overrides,
  });

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

  it("makes the roadmap a candidate even when include or exclude rules it out (Plan Q2)", () => {
    const matches = candidateMatcher(
      config({
        roadmap: "plans/ROADMAP.md",
        include: ["docs/**"],
        exclude: ["plans/**"],
      }),
    );
    expect(matches("plans/ROADMAP.md")).toBe(true);
    expect(matches("plans/other.md")).toBe(false);
    expect(matches("docs/a.md")).toBe(true);
  });

  it("matches the roadmap path exactly, not by pattern", () => {
    const matches = candidateMatcher(config({ include: [], roadmap: "a.md" }));
    expect(matches("a.md")).toBe(true);
    expect(matches("x/a.md")).toBe(false);
  });
});
