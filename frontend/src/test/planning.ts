/**
 * Helpers for the planning index's suites (`src/lib/planning*.test.ts*`).
 *
 * The index lives in `packages/vantage-md`, which has no test runner of its
 * own, so its tests run here against the package source. Several of them read
 * shared fixtures and real documents from the repository, which this file
 * resolves from the repository root.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { questionDirectiveFor, vantageOqStatus } from "vantage-md";
import {
  DEFAULT_PLANNING_CONFIG,
  buildPlanningIndex,
  scanCandidate,
  type CardBlock,
  type PlanningConfig,
  type PlanningIndex,
  type PlanningSources,
  type ScannedEntry,
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

/**
 * The directive a question marked `marker` is declared with, as the convention
 * writes it: an open or unmarked question's `oq`, restating `leaning` when it
 * has one, and a 🔒 or ✅ one's `question`, which takes none
 * (`questionDirectiveFor`).
 */
export function questionDirective(
  marker: string,
  id: string,
  leaning: string | null = null,
): string {
  if (questionDirectiveFor(vantageOqStatus(marker)) === "question") {
    return `<!-- vantage: question id=${id} -->`;
  }
  return leaning === null
    ? `<!-- vantage: oq id=${id} -->`
    : `<!-- vantage: oq id=${id} leaning="${leaning}" -->`;
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

/**
 * A file's content hash as the server computes it: the first 128 bits of
 * SHA-256 over its UTF-8 bytes, in lowercase hex
 * (`docs/reference/planning-index.md` §2).
 */
export function contentHash(content: string): string {
  return createHash("sha256")
    .update(content, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/** One file of a tree, read and scanned. */
export type ScannedFile = Extract<ScannedEntry, { kind: "file" }>;

/**
 * A tree of path → content as the scan worker holds it once it has read each
 * file (`docs/reference/planning-index.md` §8.2): every file scanned,
 * with its content hash, in path order as the stream lists them, and each
 * planning document's card blocks by path. For the suites of the worker, the
 * planning store and the planning page.
 */
export function scannedOf(
  tree: Record<string, string>,
  config: Partial<PlanningConfig> = {},
): { entries: ScannedFile[]; blocks: Record<string, CardBlock[]> } {
  const full = planningConfig(config);
  const entries = Object.keys(tree)
    .sort()
    .map((path): ScannedFile => {
      const content = tree[path] ?? "";
      return {
        kind: "file",
        path,
        hash: contentHash(content),
        result: scanCandidate(full, path, content),
      };
    });
  const blocks: Record<string, CardBlock[]> = {};
  for (const { path, result } of entries) {
    if (result.kind === "planning") blocks[path] = result.cards;
  }
  return { entries, blocks };
}
