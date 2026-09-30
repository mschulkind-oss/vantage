/**
 * Helpers for the planning index's suites (`src/lib/planning*.test.ts*`).
 *
 * The index lives in `packages/vantage-md`, which has no test runner of its
 * own, so its tests run here against the package source. Several of them read
 * shared fixtures and real documents from the repository, which this file
 * resolves from the repository root.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PLANNING_CONFIG,
  buildPlanningIndex,
  type PlanningConfig,
  type PlanningIndex,
  type PlanningSources,
} from "vantage-md/planning";

/** This file's own URL, held in a variable so Vite does not rewrite it. */
const here = import.meta.url;

/**
 * The absolute path of a file named relative to the repository root, found
 * from `from`: the URL of a file in this directory, this one's own unless a
 * test says otherwise. A URL's pathname is percent-encoded, so for a checkout
 * under `/with space/` it names `/with%20space/`, which is not on disk;
 * fileURLToPath decodes it.
 */
export function repoPath(rel: string, from: string = here): string {
  return fileURLToPath(new URL(`../../../${rel}`, from));
}

/** A file's text, named relative to the repository root. */
export function readRepoFile(rel: string): string {
  return readFileSync(repoPath(rel), "utf8");
}

/** A shared planning fixture from `internal/repoconfig/testdata/`. */
export function planningFixture<T>(name: string): T {
  return JSON.parse(readRepoFile(`internal/repoconfig/testdata/${name}`)) as T;
}

/** The default config, with `overrides` on top. */
export function planningConfig(
  overrides: Partial<PlanningConfig> = {},
): PlanningConfig {
  return { ...DEFAULT_PLANNING_CONFIG, ...overrides };
}

/**
 * A batch of sources from a tree of path → content, counted as the server
 * would count it: every file is a candidate.
 */
export function sourcesOf(
  tree: Record<string, string>,
  overrides: Partial<PlanningSources> = {},
  config: Partial<PlanningConfig> = {},
): PlanningSources {
  const files = Object.entries(tree).map(([path, content]) => ({
    path,
    content,
  }));
  return {
    config: planningConfig(config),
    candidateCount: files.length,
    refused: false,
    files,
    skipped: [],
    unreadable: [],
    ...overrides,
  };
}

/** The index of a tree, as `sourcesOf` would batch it. */
export function indexOf(
  tree: Record<string, string>,
  config: Partial<PlanningConfig> = {},
): PlanningIndex {
  return buildPlanningIndex(sourcesOf(tree, {}, config));
}
