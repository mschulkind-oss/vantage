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
  /** Repo-relative, with no leading `./`. The default is `roadmap.md`. */
  roadmap: string;
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
  roadmap: "roadmap.md",
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

/**
 * Whether a listed Markdown path is a candidate: matched by `include` and not
 * by `exclude`, with the roadmap a candidate whatever either says (design §3.1).
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
  return (path) => path === config.roadmap || (include(path) && !exclude(path));
}
