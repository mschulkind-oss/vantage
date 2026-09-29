import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The *project root* (a term coined in `docs/design/planning-index.md` §8):
 * the nearest ancestor of a directory that holds `.git` or `.vantage.toml`.
 *
 * One definition for every command that needs to know which repository a file
 * belongs to. `link/leading-slash` resolves a `/docs/x.md` suggestion against
 * it, `check`'s planning rules find the roadmap from it, and `index` scans it
 * (Plan Q16). Keeping one is what makes `index` and `check` agree on the
 * project.
 *
 * An explicit `--config` never moves it. The gate's own self-check passes
 * `--config "$(mktemp)"`, whose directory is `/tmp`; a root found through the
 * config file would scan the wrong tree.
 *
 * `.git` is checked as a plain directory entry rather than by asking git, so
 * this still works in a bare checkout with no git on PATH (P1). A linked
 * worktree's `.git` is a file, and it counts too: the worktree is its own root.
 */
export function repositoryRoot(from: string): string | undefined {
  let current = from;
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    if (existsSync(join(current, ".vantage.toml"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
