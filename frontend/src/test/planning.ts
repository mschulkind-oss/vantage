/**
 * Helpers for the planning index's suites (`src/lib/planning*.test.ts*`).
 *
 * The index lives in `packages/vantage-md`, which has no test runner of its
 * own, so its tests run here against the package source. Several of them read
 * shared fixtures and real documents from the repository, which this file
 * resolves from the repository root.
 */
import { readFileSync } from "node:fs";

/** This file's own URL, held in a variable so Vite does not rewrite it. */
const here = import.meta.url;

/** The absolute path of a file named relative to the repository root. */
export function repoPath(rel: string): string {
  return new URL(`../../../${rel}`, here).pathname;
}

/** A file's text, named relative to the repository root. */
export function readRepoFile(rel: string): string {
  return readFileSync(repoPath(rel), "utf8");
}

/** A shared planning fixture from `internal/repoconfig/testdata/`. */
export function planningFixture<T>(name: string): T {
  return JSON.parse(readRepoFile(`internal/repoconfig/testdata/${name}`)) as T;
}
