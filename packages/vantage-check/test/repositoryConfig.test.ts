import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import {
  candidateMatcher,
  type PlanningConfig,
} from "../../vantage-md/src/planning/index.js";

/**
 * This repository's own `.vantage.toml`, read the way `check` and `index`
 * read it. The gate runs with it, so what it excludes is what this
 * repository's planning index and planning rules see
 * (`docs/reference/planning-index.md` §14).
 */

// import.meta.dirname, not a URL's pathname, which percent-encodes a space in
// the checkout's path and so names a directory that is not there.
const repo = resolve(import.meta.dirname, "../../..");

/** The shared fixture's copy of the table, which the server's tests read too. */
function fixtureTable(): PlanningConfig {
  const fixture = JSON.parse(
    readFileSync(
      join(repo, "internal/repoconfig/testdata/planning-config.json"),
      "utf8",
    ),
  ) as { cases: { name: string; planning?: PlanningConfig }[] };
  const table = fixture.cases.find(
    (entry) => entry.name === "this repository's own table",
  )?.planning;
  if (table === undefined)
    throw new Error("the fixture lost this repository's table");
  return table;
}

describe("this repository's .vantage.toml", () => {
  const config = loadConfig({ from: repo });
  const isCandidate = candidateMatcher(config.planning);

  it("is the file at the repository root", () => {
    expect(config.path).toBe(join(repo, ".vantage.toml"));
  });

  it("resolves to the table the shared fixture pins for it", () => {
    expect(config.planning).toEqual(fixtureTable());
  });

  it("keeps the gallery's demo questions out of the index", () => {
    expect(isCandidate("docs/gallery/open-questions.md")).toBe(false);
    expect(isCandidate("docs/gallery/status.md")).toBe(false);
  });

  it("keeps the end-to-end fixtures' planning documents out of the index", () => {
    // The file listing does not apply .gitignore, and nothing about this path
    // is hidden or excluded by default, so only [planning] keeps it out.
    expect(isCandidate("frontend/e2e/fixtures/test_repo/README.md")).toBe(
      false,
    );
    expect(isCandidate("frontend/e2e/fixtures/test_repo/plans/x.md")).toBe(
      false,
    );
  });

  it("still reads the real planning documents and the roadmap", () => {
    expect(isCandidate("docs/reference/planning-index.md")).toBe(true);
    expect(isCandidate("docs/design/agent-bootstrap.md")).toBe(true);
    expect(isCandidate("roadmap.md")).toBe(true);
  });

  it("lists unrouted questions as warnings rather than failing on them", () => {
    expect(config.settings.setting("planning/unrouted")).toBe("warning");
  });
});
