import { randomBytes } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  PLANNING_SPACE_FILE,
  PLANNING_SPACE_ID_LENGTH,
  parsePlanningSpaceFile,
  planningSpaceFileText,
} from "../../../vantage-md/src/planning/index.js";

/**
 * The space id (`docs/reference/planning-index.md` §13.6): one random id per
 * checkout, the single line of `<checkout>/.vantage/space`, which a planning
 * link carries as `space=` so a Vantage serving many projects opens the one
 * the link was made in.
 *
 * `index --filter` is its one writer: it makes the file the first time it
 * prints a planning link in a checkout, a linked worktree included, and
 * reuses it after. It never rewrites an id that is
 * there, since every link already handed over names it, and it leaves a file
 * it cannot read as one alone. The filesystem stays the only channel
 * (`docs/reference/agent-cli.md` P1): nothing here asks a server anything.
 */

/** RFC 4648's base32 alphabet, lowercased. */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Past this many bytes a `.vantage/space` holds no id, and it is not read: the
 * id and its newline are 17.
 */
const MAX_FILE_BYTES = 64;

/**
 * What `.vantage/.gitignore` holds when the checker made `.vantage` itself:
 * everything in the directory, the file itself included, is ignored, so no
 * clone is handed another's id.
 */
export const SPACE_GITIGNORE =
  "# Made by vantage-check: nothing in .vantage is committed, so every clone keeps its own space id.\n*\n";

/**
 * What `.vantage/.gitignore` holds when the checker found `.vantage` there
 * with no `.gitignore`, as an agent leaves it after delivering into the
 * review inbox: the id, its scratch names (`publish`) and the file itself, and
 * nothing else, so whatever the directory holds keeps the ignore state it had,
 * and a `git add -A` cannot commit the id for every clone to inherit. A
 * `.gitignore` that is there is its owner's, and is left as it is.
 */
export const SPACE_GITIGNORE_BESIDE =
  "# Made by vantage-check: this clone's space id is its own, so it is never committed.\n/space\n/space.*.tmp\n/.gitignore\n";

/** The checkout's space, as `ensureSpace` found or made it. */
export type Space =
  /**
   * `made` when this run wrote the file, `kept` when it was there.
   * `madeDirectory` says this run made `.vantage` too, and its `.gitignore`.
   */
  | {
      kind: "made" | "kept";
      id: string;
      file: string;
      madeDirectory: boolean;
    }
  /** The file is there and holds no space id; it is left as it is. */
  | { kind: "malformed"; file: string }
  /** No file, and none could be made, for `reason`. */
  | { kind: "unwritable"; file: string; reason: string };

/** The id `space` gives a link, or `null` when it has none to give. */
export function spaceIdOf(space: Space | null): string | null {
  return space?.kind === "made" || space?.kind === "kept" ? space.id : null;
}

/** A new space id: 80 bits from a cryptographic source, in lowercase base32. */
export function newSpaceId(
  random: (n: number) => Uint8Array = randomBytes,
): string {
  const bytes = random((PLANNING_SPACE_ID_LENGTH * 5) / 8);
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  return out;
}

/**
 * Whether a git config's whole text says its repository is bare, as git reads
 * `core.bare`: the last value wins, a key with no value is true, and `true`,
 * `yes`, `on` and `1` are true whatever their case. Sections are matched by
 * name alone, so `[core "x"]` is not `core`. The server reads it the same way
 * (`internal/spaceid`), and `internal/spaceid/testdata/space-files.json` holds
 * the two to one answer.
 */
export function isBareGitConfig(text: string): boolean {
  let section = "";
  let bare = false;
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (line.startsWith("[")) {
      const end = line.indexOf("]");
      if (end < 0) {
        section = "";
        continue;
      }
      section = line.slice(1, end).trim().toLowerCase();
      line = line.slice(end + 1).trim();
    }
    if (section !== "core" || line === "" || /^[#;]/.test(line)) continue;
    const eq = line.indexOf("=");
    const key = (eq < 0 ? line : line.slice(0, eq)).trim();
    if (key.toLowerCase() !== "bare") continue;
    if (eq < 0) {
      bare = true;
      continue;
    }
    const value = line
      .slice(eq + 1)
      .replace(/[#;].*$/, "")
      .trim()
      .replace(/^"+|"+$/g, "")
      .toLowerCase();
    bare = ["true", "yes", "on", "1"].includes(value);
  }
  return bare;
}

/** Past this many bytes a git config is not read for `core.bare`. */
const MAX_CONFIG_BYTES = 1 << 20;

/** Whether the git directory `gitDir` is a bare repository (`isBareGitConfig`). */
function isBareGitDir(gitDir: string): boolean {
  try {
    const config = join(gitDir, "config");
    if (statSync(config).size > MAX_CONFIG_BYTES) return false;
    return isBareGitConfig(readFileSync(config, "utf8"));
  } catch {
    return false;
  }
}

/**
 * The main checkout of `root` when `root` is a linked worktree, and `null`
 * otherwise. The id is the worktree's own either way (`ensureSpace`): this
 * names the checkout a Vantage opens for its links when it serves only that
 * one, which the server finds through its `.git/worktrees`.
 *
 * A linked worktree's `.git` is a file naming its gitdir, and that gitdir's
 * `commondir` names the repository's own git directory, whose parent is the
 * main checkout. A submodule's `.git` is a file too, but its gitdir has no
 * `commondir`, so it has none; nor has a worktree of a bare repository, whose
 * common directory is no checkout's `.git`, or is a `.git` that is bare
 * (`git clone --bare url proj/.git`). Anything that cannot be read as one of
 * these has none.
 */
export function mainCheckoutOf(root: string): string | null {
  const dotGit = join(root, ".git");
  let gitdir: string;
  try {
    if (!lstatSync(dotGit).isFile()) return null;
    const line = readFileSync(dotGit, "utf8").trim();
    if (!line.startsWith("gitdir:")) return null;
    gitdir = resolve(root, line.slice("gitdir:".length).trim());
  } catch {
    return null;
  }
  let common: string;
  try {
    common = resolve(
      gitdir,
      readFileSync(join(gitdir, "commondir"), "utf8").trim(),
    );
  } catch {
    return null;
  }
  if (basename(common) !== ".git" || isBareGitDir(common)) return null;
  const main = dirname(common);
  try {
    return statSync(main).isDirectory() ? main : null;
  } catch {
    return null;
  }
}

/** `error`'s code, as Node's file system calls report one. */
function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** `error`'s message without the stack, for a stderr line. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What `file` holds: its id, `malformed`, or `absent`. */
function readSpaceFile(file: string): string | "malformed" | "absent" {
  let size: number;
  try {
    const info = lstatSync(file);
    // A symlink, a directory or a device is no space file, and is not
    // followed: the server refuses one too.
    if (!info.isFile()) return "malformed";
    size = info.size;
  } catch (error) {
    if (codeOf(error) === "ENOENT") return "absent";
    throw error;
  }
  if (size > MAX_FILE_BYTES) return "malformed";
  return parsePlanningSpaceFile(readFileSync(file, "utf8")) ?? "malformed";
}

/**
 * Publish `text` at `file` only if nothing is there, whole or not at all: it
 * is written to a scratch name beside it and hard-linked into place, which
 * fails when `file` exists, so a run that races another never overwrites the
 * id the other wrote, nor reads one half written. A file system without hard
 * links gets an exclusive create instead. `false` when `file` was there.
 */
function publish(file: string, text: string): boolean {
  const scratch = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(scratch, text, { flag: "wx" });
  try {
    linkSync(scratch, file);
    return true;
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    try {
      writeFileSync(file, text, { flag: "wx" });
      return true;
    } catch (fallback) {
      if (codeOf(fallback) === "EEXIST") return false;
      throw fallback;
    }
  } finally {
    try {
      unlinkSync(scratch);
    } catch {
      // A scratch name left behind is harmless: the id is published, or
      // not, either way.
    }
  }
}

/**
 * Give `dir`, the `.vantage` the id is in, a `.gitignore` when it has none:
 * `SPACE_GITIGNORE` when this run made the directory, `SPACE_GITIGNORE_BESIDE`
 * when it was there. Asked on every run that prints a link, so one stopped
 * between making the directory and writing the file, or a file removed since,
 * gets it back. An exclusive create, so one that is there, or that another run
 * wrote a moment ago, is never touched.
 */
function ensureIgnore(dir: string, madeDirectory: boolean): void {
  try {
    writeFileSync(
      join(dir, ".gitignore"),
      madeDirectory ? SPACE_GITIGNORE : SPACE_GITIGNORE_BESIDE,
      { flag: "wx" },
    );
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error;
  }
}

/**
 * The space of the checkout `root`, made when it has none: a linked worktree
 * is a checkout of its own, so the id names the checkout the link was made
 * in. When `.vantage` is not there it is made, with `SPACE_GITIGNORE` as its
 * `.gitignore`, before the id is written; a `.vantage` that is there with no
 * `.gitignore` gets `SPACE_GITIGNORE_BESIDE` (`ensureIgnore`).
 */
export function ensureSpace(root: string): Space {
  const file = join(root, PLANNING_SPACE_FILE);
  const dir = dirname(file);
  const fail = (reason: string): Space => ({
    kind: "unwritable",
    file,
    reason,
  });

  try {
    const found = readSpaceFile(file);
    if (found === "malformed") return { kind: "malformed", file };
    if (found !== "absent") {
      try {
        ensureIgnore(dir, false);
      } catch {
        // The id is there and the link names it; an ignore file that cannot
        // be written now is written by a later run that can.
      }
      return { kind: "kept", id: found, file, madeDirectory: false };
    }
  } catch (error) {
    return fail(reasonOf(error));
  }

  let madeDirectory = false;
  try {
    mkdirSync(dir);
    madeDirectory = true;
  } catch (error) {
    // There already: another run made it a moment ago, or it was always
    // there. Either way it gets only the narrow ignore, and only if it has
    // no .gitignore at all.
    if (codeOf(error) !== "EEXIST") return fail(reasonOf(error));
  }
  try {
    if (!statSync(dir).isDirectory()) {
      return fail(`${dir} is not a directory`);
    }
    ensureIgnore(dir, madeDirectory);
    const id = newSpaceId();
    if (publish(file, planningSpaceFileText(id))) {
      return { kind: "made", id, file, madeDirectory };
    }
    // Another run made it first: use what it wrote.
    const found = readSpaceFile(file);
    if (found === "malformed") return { kind: "malformed", file };
    if (found === "absent") return fail(`${file} vanished as it was made`);
    return { kind: "kept", id: found, file, madeDirectory };
  } catch (error) {
    return fail(reasonOf(error));
  }
}
