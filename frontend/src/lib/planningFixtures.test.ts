/**
 * The shared planning fixtures in `internal/repoconfig/testdata/` hold what the
 * plan says they hold.
 *
 * The server's suite and `vantage-check`'s read them, and each proves its own
 * reader against them. What neither can see is a fixture that lost the case it
 * exists for, so the cases the plan names are asserted here, together with the
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
  "roadmap",
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
