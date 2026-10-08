import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * `git check-ignore` — which of the files beside a document git excludes.
 *
 * `ref/unlinked-file` normally demands a link wherever prose names a file that
 * exists beside the document. A file git ignores is private to the machine
 * that holds it, so a committed document that mentions one cannot be held to a
 * link: the link would work here and break for every other reader. The field
 * report was a committed `CHANGELOG.md` that mentions `yolo-jail.local.jsonc`
 * in passing — the same document passed in a clean worktree and failed on a
 * machine where the ignored file happened to exist.
 *
 * Git answers the question exactly, with the repository's own rules: nested
 * `.gitignore` files, `.git/info/exclude`, and the user's global excludes.
 * Reimplementing exclude matching here would be a second, drifting copy of
 * semantics this repository does not own. `check-ignore` is read-only and
 * writes nothing, so the checker's "nothing is written" invariant holds.
 *
 * The probe is best-effort, and the rule keeps its old behavior wherever it
 * cannot answer: no git on `PATH`, no repository, a repository that is not a
 * work tree, an unreadable path. A failed probe never turns a filename finding
 * into silence — the finding comes back.
 *
 * Architecture: docs/reference/linked-references.md
 */

/**
 * Git's repository-location environment variables, which override the
 * working-directory discovery every call here relies on. The same list the Go
 * binary scrubs (`internal/gitenv`), for the same reason: the checker can run
 * from inside a git hook, where git exports `GIT_DIR` and `GIT_INDEX_FILE`
 * pointing at the *outer* repository, and an inherited one would silently
 * answer about the wrong tree.
 */
const GIT_LOCATION_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
];

/** Past this long, the probe is abandoned and nothing is ignored. */
const CHECK_IGNORE_TIMEOUT_MS = 5_000;

/** A cap on the probe's output, so a pathological repository cannot OOM a run. */
const MAX_CHECK_IGNORE_BYTES = 16 * 1024 * 1024;

/** The environment for a `git` child: the process's own, with location unset. */
function scrubbedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_ENV) delete env[name];
  return env;
}

/**
 * The work-tree root git would use from `from`, or `null` when there is none.
 *
 * A plain walk for `.git` rather than `git rev-parse`, so a machine without
 * git, or a bare checkout with git off `PATH`, still reaches a decision (the
 * same reason `repositoryRoot` in `projectRoot.ts` does it this way). A linked
 * worktree's `.git` is a file and counts; the walk does not care which it is,
 * and git sorts out the rest.
 */
export function gitWorkTreeRoot(from: string): string | null {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Whether `path` lies inside the work tree rooted at `root`. */
function inWorkTree(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Which of `paths` git ignores. `from` is any directory inside the repository;
 * the work tree is found from there. Paths outside that work tree, and every
 * path when there is no work tree, answer `false` — the probe does not reach
 * across repositories.
 */
export function gitIgnoredPaths(
  paths: readonly string[],
  from: string,
): Set<string> {
  if (paths.length === 0) return new Set();

  const root = gitWorkTreeRoot(from);
  if (root === null) return new Set();

  const inside = paths.filter((path) => inWorkTree(root, path));
  if (inside.length === 0) return new Set();

  // Passed relative to the work-tree root, not absolute: the answer is about
  // the path as git sees it from there, and a relative path is the one shape
  // git echoes back byte for byte. An absolute path through a symlinked
  // directory (macOS `/var` → `/private/var`) can come back canonicalized,
  // which would no longer match the target the rule is holding.
  const byRelative = new Map<string, string>();
  for (const target of inside) {
    byRelative.set(relative(root, target).split(sep).join("/"), target);
  }

  try {
    const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
      cwd: root,
      // `--stdin` with `-z` reads NUL-separated paths and answers in the same
      // shape, so a path with a newline in it cannot be mistaken for two.
      input: [...byRelative.keys()].join("\u0000") + "\u0000",
      env: scrubbedGitEnv(),
      encoding: "utf8",
      timeout: CHECK_IGNORE_TIMEOUT_MS,
      maxBuffer: MAX_CHECK_IGNORE_BYTES,
    });

    // Status 1 is "none of these are ignored", which is an answer. Anything
    // else — git absent, the directory not a work tree, a timeout, output too
    // large — leaves every path unignored, and the rule reports as it did
    // before this probe existed.
    if (
      result.error !== undefined ||
      result.status === null ||
      result.status > 1
    ) {
      return new Set();
    }

    const ignored = new Set<string>();
    for (const path of result.stdout.split("\u0000")) {
      const target = byRelative.get(path.split(sep).join("/"));
      if (target !== undefined) ignored.add(target);
    }
    return ignored;
  } catch {
    // The probe is an input to a rule, never a verdict on a document: an
    // unexpected failure must not become a `run/shard` failure and end the
    // run. It falls back exactly as a missing git does.
    return new Set();
  }
}
