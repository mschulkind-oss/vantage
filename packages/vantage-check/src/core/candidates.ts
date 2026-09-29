import {
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import { join } from "node:path";
import {
  candidateMatcher,
  compileIgnorePatterns,
  type PlanningConfig,
  type SourceEntry,
} from "../../../vantage-md/src/planning/index.js";

/**
 * Which files are planning candidates, found the way the server finds them
 * (`docs/design/planning-index.md` §3.1, §8).
 *
 * A candidate is a Markdown file the server lists that `[planning] include`
 * matches and `exclude` does not. The server's list is `fs.ListAllFiles`
 * (`internal/fs/service.go`), and this is a mirror of it, not `discover`: that
 * walk takes `.markdown`, descends into `dist/` and `build/`, and ignores
 * `.vantageignore`, and every one of those would put a file on the checker's
 * index that the planning page never shows.
 *
 * The mirror takes the repository's own rules only (Plan Q9). A server's list
 * is also shaped by settings that belong to one reader, its `exclude_dirs` and
 * the user ignore file `~/.config/vantage/ignore`, which the checker cannot
 * see; where those are set, `index` can list a file the page does not.
 *
 * `internal/repoconfig/testdata/planning-candidates.json` holds a tree and the
 * list the Go code produced for it, and both readers are held to it.
 */

/**
 * `config.DefaultExcludeDirs` (`internal/config/config.go`): directory names
 * pruned at any depth. Copied rather than shared, since the server holds it in
 * Go, and a test reads the Go source to hold the two lists equal.
 */
export const DEFAULT_EXCLUDE_DIRS: readonly string[] = [
  ".git",
  ".hg",
  ".svn",
  "worktrees",
  ".worktrees",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".egg-info",
  ".tox",
  ".nox",
  "dist",
  "build",
  "target",
  ".cache",
];

const EXCLUDED = new Set(DEFAULT_EXCLUDE_DIRS);

/** `isMarkdown` in `internal/fs/service.go`: `.md`, case-insensitively. */
function isMarkdownName(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

/**
 * `git.IsWorktree`: a directory whose `.git` is a file pointing at a gitdir,
 * as `git worktree add` leaves it. A nested repository's `.git` directory is
 * not one, and its files are listed.
 */
function isLinkedWorktree(dir: string): boolean {
  const gitPath = join(dir, ".git");
  try {
    if (statSync(gitPath).isDirectory()) return false;
    return readFileSync(gitPath, "utf8").trim().startsWith("gitdir:");
  } catch {
    return false;
  }
}

/** Byte order for ASCII, as the server's `sort.Strings` orders paths. */
function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The server's file listing for one repository root: `ListAllFiles`, with
 * `ExcludeDirs` at its default and `.vantageignore` honored.
 */
export class Listing {
  private readonly ignored: (path: string) => boolean;

  constructor(readonly root: string) {
    this.ignored = compileIgnorePatterns(readVantageIgnore(root));
  }

  /**
   * `matchPath` (`internal/ignore/ignore.go`): a directory is matched as
   * `rel` and again as `rel/`, or a directory-only line such as `ignored/`
   * would never prune anything.
   */
  private isIgnored(rel: string, isDir: boolean): boolean {
    if (rel === ".vantage" || rel.startsWith(".vantage/")) return true;
    if (this.ignored(rel)) return true;
    return isDir && !rel.endsWith("/") && this.ignored(`${rel}/`);
  }

  /** Whether the walk descends into this directory. `rel` is repo-relative. */
  private descends(abs: string, name: string, rel: string): boolean {
    if (EXCLUDED.has(name) || name.startsWith(".")) return false;
    if (isLinkedWorktree(abs)) return false;
    return !this.isIgnored(rel, true);
  }

  /**
   * Every Markdown path the server lists, repo-relative and slash-separated,
   * sorted. An unreadable directory is skipped, as the server skips one,
   * rather than failing the walk.
   */
  list(): string[] {
    const found: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const { name } = entry;
        const abs = join(dir, name);
        const rel = prefix === "" ? name : `${prefix}/${name}`;
        // WalkDir never follows a link, to a file or to a directory.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (this.descends(abs, name, rel)) walk(abs, rel);
        } else if (isMarkdownName(name) && !this.isIgnored(rel, false)) {
          found.push(rel);
        }
      }
    };
    walk(this.root, "");
    return found.sort(byPath);
  }

  /**
   * Whether `list()` would hold `rel`, answered for one path without the walk:
   * every directory above it is one the walk descends into, and it is a
   * Markdown file that is not a link and not ignored.
   */
  isListed(rel: string): boolean {
    const segments = rel.split("/");
    if (segments.some((s) => s === "" || s === "." || s === "..")) {
      return false;
    }
    const name = segments[segments.length - 1] as string;
    if (!isMarkdownName(name)) return false;

    let abs = this.root;
    for (let i = 0; i < segments.length - 1; i++) {
      const dirName = segments[i] as string;
      abs = join(abs, dirName);
      try {
        if (!lstatSync(abs).isDirectory()) return false;
      } catch {
        return false;
      }
      if (!this.descends(abs, dirName, segments.slice(0, i + 1).join("/"))) {
        return false;
      }
    }

    try {
      const stats = lstatSync(join(this.root, rel));
      if (stats.isSymbolicLink() || stats.isDirectory()) return false;
    } catch {
      return false;
    }
    return !this.isIgnored(rel, false);
  }
}

/**
 * `<root>/.vantageignore`'s lines. A missing or unreadable file is empty, and
 * so is a directory of that name, as the server's loader treats them.
 */
function readVantageIgnore(root: string): string[] {
  try {
    return readFileSync(join(root, ".vantageignore"), "utf8").split("\n");
  } catch {
    return [];
  }
}

/**
 * The patterns of one config, compiled once: `check` asks about every file in
 * its run, and each compile translates every line into a regular expression.
 */
const matchers = new WeakMap<PlanningConfig, (path: string) => boolean>();

function matcherFor(config: PlanningConfig): (path: string) => boolean {
  let matcher = matchers.get(config);
  if (matcher === undefined) {
    matcher = candidateMatcher(config);
    matchers.set(config, matcher);
  }
  return matcher;
}

/** Every candidate under `root`, sorted: the listing, through the patterns. */
export function listCandidates(
  listing: Listing,
  config: PlanningConfig,
): string[] {
  return listing.list().filter(matcherFor(config));
}

/** Whether one repo-relative path is a candidate, without walking the tree. */
export function isCandidate(
  listing: Listing,
  config: PlanningConfig,
  rel: string,
): boolean {
  return listing.isListed(rel) && matcherFor(config)(rel);
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Read one candidate the way the planning endpoint reads it: stat for its size
 * before any read, skip it past `maxFileBytes` without opening it, and refuse
 * bytes that are not UTF-8. The answer is the endpoint's single-path shape, so
 * the index is built from the same four kinds whoever read the file.
 *
 * `absent` means there is nothing at the path. Whether it is a candidate at all
 * is the caller's question, answered before it asks for the bytes.
 */
export function readCandidate(
  root: string,
  rel: string,
  maxFileBytes: number,
): SourceEntry {
  const abs = join(root, rel);
  let size: number;
  try {
    const stats = statSync(abs);
    if (!stats.isFile()) {
      return { kind: "unreadable", path: rel, reason: "not a regular file" };
    }
    size = stats.size;
  } catch (error) {
    return failed(rel, error);
  }
  if (size > maxFileBytes) return { kind: "skipped", path: rel, size };

  let bytes: Buffer;
  try {
    bytes = readFileSync(abs);
  } catch (error) {
    return failed(rel, error);
  }
  try {
    return { kind: "file", path: rel, content: UTF8.decode(bytes) };
  } catch {
    return { kind: "unreadable", path: rel, reason: "not UTF-8" };
  }
}

function failed(rel: string, error: unknown): SourceEntry {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return { kind: "absent", path: rel };
  }
  const reason =
    code === "EACCES" || code === "EPERM"
      ? "permission denied"
      : error instanceof Error
        ? error.message
        : String(error);
  return { kind: "unreadable", path: rel, reason };
}
