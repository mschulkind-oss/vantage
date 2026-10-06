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
import { questionOffersTake, vantageOqStatus } from "vantage-md";
import {
  DEFAULT_PLANNING_CONFIG,
  PLANNING_SECTION_GUIDE,
  PLANNING_SECTION_IDS,
  buildPlanningIndex,
  scanCandidate,
  type CardBlock,
  type PlanningConfig,
  type PlanningFilterReason,
  type PlanningIndex,
  type PlanningSections,
  type PlanningSources,
  type QuestionRef,
  type ScannedEntry,
  type StageRole,
  type WaitingEntry,
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
 * A directive for a question marked `marker`: `question`, the one name for a
 * question in every state, restating `leaning` on an open or unmarked one. A
 * 🔒 or ✅ one gets none, which nothing would offer to take.
 */
export function questionDirective(
  marker: string,
  id: string,
  leaning: string | null = null,
): string {
  return leaning === null || !questionOffersTake(vantageOqStatus(marker))
    ? `<!-- vantage: question id=${id} -->`
    : `<!-- vantage: question id=${id} leaning="${leaning}" -->`;
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

/** Where the fixture of forms lives, from the repository root. */
export const FILTER_FORMS_PATH =
  "packages/vantage-md/src/planning/filterForms.json";

/**
 * The planning filter's fixture of forms (`docs/reference/planning-index.md`
 * §6.19): a small index, every filter text this release reads with what it
 * keeps there, and texts it does not understand with the term each names, or
 * the reason where there is none.
 *
 * In `read`, `documents` are the kept documents: every path the index lists
 * that one of the text's `path:` terms keeps (all of them when it has none)
 * and none of its `-path:` terms does, as a matcher written apart from the
 * filter module answered for each term; `questions` are the index's questions it keeps,
 * `<path>#<id>`, sorted, in whatever section or none; `keeps` are the entries
 * the filtered sections list under the default roadmap, in page order, as
 * `sectionEntryKeys` writes them; and `unknownKeys` the words its notice says
 * are not filter keys. It is an ordinary fixture of one release: any entry
 * may be edited, moved or removed when the language changes, and nothing
 * compares it with an earlier release's (§6.19, OQ-PF7).
 */
export interface PlanningFilterForms {
  index: {
    stages: Record<string, StageRole>;
    /** Lower than the default, so `skipped` can be a real file on disk. */
    maxFileBytes: number;
    files: Record<string, string>;
    /** Too large: on disk, a file of `size` bytes. */
    skipped: { path: string; size: number }[];
  };
  read: {
    text: string;
    canonical: string;
    documents: string[];
    /** The index's questions it keeps, `<path>#<id>`, in any section or none. */
    questions: string[];
    keeps: string[];
    /**
     * The canonical texts of its `path:` terms, with or without their `-`,
     * that match no listed path.
     */
    unmatched: string[];
    /** Each unknown key's word, once, in the order written (§6.12). */
    unknownKeys: string[];
  }[];
  notUnderstood: (
    | { text: string; term: string }
    | { text: string; reason: PlanningFilterReason }
  )[];
}

/** The fixture of forms, read fresh from disk. */
export function filterForms(): PlanningFilterForms {
  return JSON.parse(readRepoFile(FILTER_FORMS_PATH)) as PlanningFilterForms;
}

/** The fixture of forms' index, as the checker's walk would batch it. */
export function filterFormsIndex(
  forms: PlanningFilterForms = filterForms(),
): PlanningIndex {
  const { files, skipped, stages, maxFileBytes } = forms.index;
  return buildPlanningIndex(
    sourcesOf(
      files,
      { skipped, candidateCount: Object.keys(files).length + skipped.length },
      { stages, maxFileBytes },
    ),
  );
}

/**
 * Every entry `sections` lists, in page order, as the fixture of forms names
 * one: `"<section id> <path>"` for a row, and `"<section id> <path>#<id>"`
 * for a question.
 */
export function sectionEntryKeys(sections: PlanningSections): string[] {
  const question = (id: string, ref: QuestionRef) =>
    `${id} ${ref.path}#${ref.id ?? `line ${ref.line}`}`;
  return PLANNING_SECTION_IDS.flatMap((id) => {
    const key = PLANNING_SECTION_GUIDE[id].key;
    const entries = (sections[key] ?? []) as readonly (
      string | WaitingEntry | QuestionRef | { path: string }
    )[];
    return entries.map((entry) => {
      if (typeof entry === "string") return `${id} ${entry}`;
      if ("kind" in entry) {
        return entry.kind === "document"
          ? `${id} ${entry.path}`
          : question(id, entry.question);
      }
      if ("line" in entry) return question(id, entry);
      return `${id} ${entry.path}`;
    });
  });
}
