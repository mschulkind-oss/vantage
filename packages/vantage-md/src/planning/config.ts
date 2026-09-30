/**
 * The `[planning]` table's shape, its defaults, and which files it makes
 * candidates (design §3.1, §9).
 *
 * Parsing the table is each reader's own job — the server's
 * `internal/repoconfig` and the checker's `core/config.ts` — because each reads
 * `.vantage.toml` with its own TOML library and its own error reporting. This
 * module holds only what both of them, and the viewer, must agree on: the value
 * a parsed table resolves to, and what it means for a path.
 */

import { compileIgnorePatterns } from "./patterns.js";

/**
 * What a stage word means to the planning page — a *stage role* (design §4).
 *
 * A closed set: a repository maps its own words onto these under
 * `[planning.stages]`, and a role outside them is a config error in both
 * readers.
 */
export type StageRole = "open" | "ready" | "built" | "done";

/** The four roles, in the order the design lists them. */
export const STAGE_ROLES: readonly StageRole[] = [
  "open",
  "ready",
  "built",
  "done",
];

/** A resolved `[planning]` table: every key present, defaults applied. */
export interface PlanningConfig {
  /**
   * `roadmap`, as a list (design §9). `null` when the key is absent, the
   * default: every candidate named `roadmap.md` is a roadmap. Otherwise
   * exactly the roadmaps, in the order written, each repo-relative with no
   * leading `./`; `[]` names none. A string in the file is a list of one.
   */
  roadmaps: string[] | null;
  /** gitignore-style lines, as `[starred] promote` writes them. */
  include: string[];
  /** gitignore-style lines; a match here wins over `include`. */
  exclude: string[];
  /** A candidate larger than this is skipped, never read. */
  maxFileBytes: number;
  /** Past this many candidates nothing is scanned at all (design §3.5). */
  maxCandidates: number;
  /**
   * `[planning.stages]`: stage word → role. `null` when the table is absent or
   * empty, which means no vocabulary and no roles (design §9).
   */
  stages: Record<string, StageRole> | null;
}

/** The effective config of a repository that never wrote a `[planning]` table. */
export const DEFAULT_PLANNING_CONFIG: Readonly<PlanningConfig> = Object.freeze({
  roadmaps: null,
  include: ["**/*.md"],
  exclude: [],
  maxFileBytes: 1048576,
  maxCandidates: 5000,
  stages: null,
});

/** Whether `value` is one of the four roles. */
export function isStageRole(value: unknown): value is StageRole {
  return (
    typeof value === "string" &&
    (STAGE_ROLES as readonly string[]).includes(value)
  );
}

/** The file name a roadmap is found by when none is listed (design §6.1). */
export const ROADMAP_FILE_NAME = "roadmap.md";

/**
 * Whether the path's last `/`-separated segment is `roadmap.md`, compared
 * ASCII case-insensitively: `ROADMAP.md` and `docs/Roadmap.md` are, and
 * `roadmap.markdown`, `my-roadmap.md` and `roadmap.md/notes.md` are not. Only
 * `A`–`Z` are folded, so no other letter, however it lowercases, can stand in
 * for one of the name's.
 */
export function hasRoadmapName(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    name.length === ROADMAP_FILE_NAME.length &&
    name.replace(/[A-Z]+/g, (upper) => upper.toLowerCase()) ===
      ROADMAP_FILE_NAME
  );
}

/**
 * The *roadmap test*, a term the implementation plan coined: whether `path` is
 * a roadmap under `config`. Listed in `roadmaps`, or, with `roadmaps` null,
 * named `roadmap.md` (design §6.1).
 *
 * A test on the path alone. It does not ask whether the path is a candidate:
 * a roadmap found by name is one only among candidates, which whoever lists
 * the paths decides, and the server applies the same test to the same config,
 * held to one answer by `internal/repoconfig/testdata/planning-roadmaps.json`.
 */
export function isRoadmapPath(config: PlanningConfig, path: string): boolean {
  return config.roadmaps === null
    ? hasRoadmapName(path)
    : config.roadmaps.includes(path);
}

/**
 * *Roadmap order* (design §6.1): fewer `/`-separated segments first, then the
 * index's path order, so `roadmap.md` comes before `docs/roadmap.md`, and that
 * before `docs/plans/roadmap.md`. Every list of roadmaps is in this order,
 * whatever order a configured list was written in.
 */
export function compareRoadmaps(a: string, b: string): number {
  const depth = a.split("/").length - b.split("/").length;
  if (depth !== 0) return depth;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether a listed Markdown path is a candidate: matched by `include` and not
 * by `exclude`, with a listed roadmap a candidate whatever either says
 * (design §3.1, Plan Q2, per entry). A roadmap found by name has no such
 * exemption: it is a roadmap because it is a candidate.
 *
 * The listing's own rules — `.md` only, hidden and excluded directories pruned,
 * `.vantageignore` — are not applied here. They belong to whoever produced the
 * path: the server's file listing, or the checker's walk that mirrors it.
 */
export function candidateMatcher(
  config: PlanningConfig,
): (path: string) => boolean {
  const include = compileIgnorePatterns(config.include);
  const exclude = compileIgnorePatterns(config.exclude);
  const listed = new Set(config.roadmaps ?? []);
  return (path) => listed.has(path) || (include(path) && !exclude(path));
}
