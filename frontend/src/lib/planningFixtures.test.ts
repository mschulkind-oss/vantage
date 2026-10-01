/**
 * The shared planning fixtures in `internal/repoconfig/testdata/` hold the
 * cases they exist for.
 *
 * The server's suite and `vantage-check`'s read them, and each proves its own
 * reader against them. What neither can see is a fixture that lost the case it
 * exists for, so those cases are asserted here, together with the
 * shapes both readers parse.
 */
import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { STAGE_ROLES, type PlanningConfig } from "vantage-md/planning";
import { planningFixture, readRepoFile } from "../test/planning";

interface ConfigCase {
  name: string;
  toml: string;
  ok: boolean;
  planning?: PlanningConfig;
}

const PLANNING_KEYS = [
  "roadmaps",
  "include",
  "exclude",
  "maxFileBytes",
  "maxCandidates",
  "stages",
].sort();

describe("planning-config.json", () => {
  const { cases } = planningFixture<{ cases: ConfigCase[] }>(
    "planning-config.json",
  );

  it("names each case once", () => {
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  it("gives every accepted case a whole PlanningConfig, and no rejected one any", () => {
    for (const c of cases) {
      if (!c.ok) {
        expect(c.planning, c.name).toBeUndefined();
        continue;
      }
      expect(Object.keys(c.planning ?? {}).sort(), c.name).toEqual(
        PLANNING_KEYS,
      );
      for (const role of Object.values(c.planning?.stages ?? {})) {
        expect(STAGE_ROLES, c.name).toContain(role);
      }
    }
  });

  // docs/reference/planning-index.md §14: the string form, the list form, and
  // each way a list is refused.
  it("holds a case for each form of roadmap, and each refusal of a list", () => {
    const roadmaps = (name: string) =>
      cases.find((c) => c.name === name)?.planning?.roadmaps;
    expect(roadmaps("no [planning] table")).toBeNull();
    expect(roadmaps("every key")).toEqual(["docs/ROADMAP.md"]);
    expect(roadmaps("a list of roadmaps, in the order written")).toEqual([
      "docs/plans/roadmap.md",
      "roadmap.md",
    ]);
    expect(roadmaps("an empty list names no roadmap")).toEqual([]);
    for (const name of [
      "a list holding a number",
      "a list holding a list",
      "a list holding an empty path",
      "a list holding only ./",
      "a list holding an absolute path",
      "a list holding a path that climbs out and back",
      "a list naming one path twice",
      "a roadmap written as a table",
      "roadmaps written as an array of tables",
      "a roadmap that is a boolean",
    ]) {
      expect(cases.find((c) => c.name === name)?.ok, name).toBe(false);
    }
  });

  it("holds an empty [planning.stages] table that reads as no stages", () => {
    const empty = cases.find(
      (c) => c.ok && /\[planning\.stages\]\s*$/.test(c.toml),
    );
    expect(empty?.planning?.stages).toBeNull();
  });

  it("is TOML throughout, but for the one case that is not", () => {
    for (const c of cases) {
      if (c.name === "a file that is not TOML") {
        expect(() => parseToml(c.toml)).toThrow();
      } else {
        expect(() => parseToml(c.toml), c.name).not.toThrow();
      }
    }
  });
});

describe("planning-roadmaps.json", () => {
  const { cases } = planningFixture<{
    cases: {
      roadmaps: string[] | null;
      include: string[];
      exclude: string[];
      path: string;
      candidate: boolean;
      roadmap: boolean;
    }[];
  }>("planning-roadmaps.json");

  it("gives every case the six fields both readers read", () => {
    for (const c of cases) {
      expect(Object.keys(c).sort(), c.path).toEqual(
        [
          "candidate",
          "exclude",
          "include",
          "path",
          "roadmap",
          "roadmaps",
        ].sort(),
      );
      expect(c.roadmaps === null || Array.isArray(c.roadmaps), c.path).toBe(
        true,
      );
    }
  });

  it("finds by name and lists, both", () => {
    expect(cases.some((c) => c.roadmaps === null)).toBe(true);
    expect(cases.some((c) => (c.roadmaps?.length ?? 0) > 0)).toBe(true);
    expect(cases.some((c) => c.roadmaps?.length === 0)).toBe(true);
  });
});

describe("planning-candidates.json", () => {
  const { tree, listed } = planningFixture<{
    tree: Record<string, string>;
    listed: string[];
  }>("planning-candidates.json");

  it("lists only files in the tree, sorted as the server sorts", () => {
    for (const path of listed) expect(tree).toHaveProperty([path]);
    expect([...listed].sort()).toEqual(listed);
  });

  it("holds a planning document under .github and one under a default-excluded directory, neither listed", () => {
    expect(tree[".github/x.md"]).toMatch(/^---\nstatus:/);
    expect(tree["node_modules/pkg/README.md"]).toBeDefined();
    expect(listed).not.toContain(".github/x.md");
    expect(listed).not.toContain("node_modules/pkg/README.md");
  });
});

describe("shared-config.toml", () => {
  it("carries a [planning] table both readers parse", () => {
    const parsed = parseToml(
      readRepoFile("internal/repoconfig/testdata/shared-config.toml"),
    ) as { planning?: Record<string, unknown> };
    expect(Object.keys(parsed.planning ?? {}).sort()).toEqual([
      "exclude",
      "include",
      "max-candidates",
      "max-file-bytes",
      "roadmap",
      "stages",
    ]);
  });
});
