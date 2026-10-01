import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  CONFIG_FILENAME,
  MAX_CONFIG_BYTES,
  parseTarget,
  shownPath,
  type Target,
} from "./config.js";
import { repositoryRoot } from "./projectRoot.js";
import { EXIT_USAGE } from "../exit.js";
import type { Io } from "../io.js";
import { RELEASE, checkerName } from "../version.js";

/**
 * What this release does with a repository's `target`
 * (`docs/design/checker-version-skew.md` §4): the key is reserved now, so that
 * a later release which some repositories need a newer checker for can count
 * on every checker from this one on to refuse them, rather than to check them
 * under rules it predates. A checker cannot learn that later; the one that
 * shipped before the key never reads it.
 *
 * So in this release a target does two things and nothing else:
 *
 * - **newer than this checker,** it refuses the run: exit 2, one message
 *   naming the release needed, and nothing read or printed besides (§4.2);
 * - **otherwise,** it is noted on stderr, and the checker checks and teaches
 *   its own release whatever the target says. Holding documents to an older
 *   target is the next release's work.
 *
 * A development build never refuses, because it does not know which release it
 * is, and is at or ahead of every release it was built after (§4.2).
 *
 * The target is read before anything else in the file, with a reader that
 * looks at `target` alone, so that a refusal comes first: a file written for a
 * newer release can hold a value this one cannot parse, and the answer there
 * is "run a newer checker", not "fix this value".
 */

/** A `target`, and the `.vantage.toml` that declares it. */
export interface DeclaredTarget {
  /** The file, absolute. */
  path: string;
  target: Target;
}

/**
 * A release's major, minor and patch, or `undefined` for a development build.
 * A pre-release counts as the release it leads to, which knows its notation.
 */
export function releaseVersion(
  release: string | undefined = RELEASE,
): readonly [number, number, number] | undefined {
  if (release === undefined) return undefined;
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(release);
  return match === null
    ? undefined
    : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * The `target` a `.vantage.toml` declares, or `null` when it declares none or
 * cannot be read. A malformed target is a `ConfigError`, as it is to the
 * reader of the whole file. Every other problem with the file is left to that
 * reader, which runs after this one and says what is wrong.
 */
export function readDeclaredTarget(
  path: string,
  /** Where the run was started, which a malformed target's error names the file from. */
  cwd?: string,
): Target | null {
  let source: string;
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_CONFIG_BYTES) return null;
    source = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseToml(source);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  return parseTarget(
    (parsed as Record<string, unknown>)["target"],
    shownPath(path, cwd),
  );
}

/** Each of these files that declares a target, once, in path order. */
export function declaredTargets(
  paths: Iterable<string | undefined>,
  cwd?: string,
): DeclaredTarget[] {
  const declared: DeclaredTarget[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    const target = readDeclaredTarget(path, cwd);
    if (target !== null) declared.push({ path, target });
  }
  return declared.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The files whose target a `check` run answers to: the run's own config, and
 * unless `--config` or `--no-config` chose the run's file, the
 * `.vantage.toml` of each project root the run's files are in. The second is
 * where every later release reads the target from (§4.2), and a root's own
 * file is the one the server reads for it, so a run that spans repositories
 * refuses for any of them that needs a newer checker.
 */
export function checkTargetPaths(
  runConfig: string | undefined,
  explicit: boolean,
  files: readonly string[],
): (string | undefined)[] {
  if (explicit) return [runConfig];
  const paths = [runConfig];
  const seen = new Set<string>();
  for (const file of files) {
    const directory = dirname(file);
    if (seen.has(directory)) continue;
    seen.add(directory);
    const root = repositoryRoot(directory);
    if (root !== undefined) paths.push(join(resolve(root), CONFIG_FILENAME));
  }
  return paths;
}

/**
 * The file `style-guide` answers to: its project root's own, the one `index`
 * reads (the root is the working directory's, as `index` finds it).
 */
export function styleGuideTargetPath(cwd: string): string {
  return join(resolve(repositoryRoot(cwd) ?? cwd), CONFIG_FILENAME);
}

/**
 * Stop a command whose repository targets a release newer than this checker:
 * print the refusal and return the exit code to stop with, or return
 * `undefined` when the command goes on. Called before the full config is
 * read, so the refusal is the only thing said.
 */
export function refuseTargets(
  declared: readonly DeclaredTarget[],
  io: Io,
  release: string | undefined = RELEASE,
): number | undefined {
  const refusal = targetRefusal(declared, io.cwd, release);
  if (refusal === undefined) return undefined;
  io.err(`vantage-check: ${refusal}\n`);
  return EXIT_USAGE;
}

/** Say on stderr which targets a command went on under, and what it does. */
export function noteTargets(
  declared: readonly DeclaredTarget[],
  io: Io,
  release: string | undefined = RELEASE,
): void {
  for (const note of targetNotes(declared, io.cwd, release)) {
    io.err(`vantage-check: ${note}\n`);
  }
}

/**
 * The message that stops a checker older than a target, or `undefined` when
 * none is newer than it. It names each file, this release, the release that
 * is needed and one way to get it, and says to keep the target, since an agent
 * told only that a key is in the way tends to delete it.
 */
export function targetRefusal(
  declared: readonly DeclaredTarget[],
  cwd: string,
  release: string | undefined = RELEASE,
): string | undefined {
  const own = releaseVersion(release);
  if (own === undefined) return undefined;
  const newer = declared.filter(
    ({ target }) => compare(target.version, own) > 0,
  );
  if (newer.length === 0) return undefined;

  const needed = newer
    .map(({ target }) => target.version)
    .reduce((a, b) => (compare(a, b) >= 0 ? a : b));
  const fix = `Run vantage-check ${needed.join(".")} or later (for example, \`uvx vantage-check@latest\`), and leave target as it is.`;
  const why =
    "it knows nothing a newer release added, so it can neither check that release's documents nor teach its notation, and stops here";

  if (newer.length === 1) {
    const [{ path, target }] = newer as [DeclaredTarget];
    return `${shownPath(path, cwd)} targets Vantage ${target.written}, and this is ${checkerName(release)}, which is older: ${why}. ${fix}`;
  }
  const lines = newer.map(
    ({ path, target }) =>
      `  ${shownPath(path, cwd)} targets Vantage ${target.written}`,
  );
  return `this is ${checkerName(release)}, older than what these files target: ${why}.\n${lines.join("\n")}\n${fix}`;
}

/** One line for each target a command goes on under, saying what it does. */
export function targetNotes(
  declared: readonly DeclaredTarget[],
  cwd: string,
  release: string | undefined = RELEASE,
): string[] {
  const own = releaseVersion(release);
  return declared.map(({ path, target }) => {
    const file = shownPath(path, cwd);
    const { written } = target;
    if (own === undefined) {
      return `${file} targets Vantage ${written}. ${capitalized(checkerName(release))} checks for its own checkout whatever the target, and never refuses one.`;
    }
    if (compare(target.version, own) === 0) {
      return `${file} targets Vantage ${written}, the release ${checkerName(release)} checks for.`;
    }
    // Never "run an older checker": that one reports this release's notation,
    // which P0 makes safe for an older viewer, as unknown-name errors.
    return `${file} targets Vantage ${written}, and ${checkerName(release)} checks against its own, newer release's notation whatever the target. A release never gives existing notation a new meaning, so a viewer on ${written} drops what it does not know.`;
  });
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
