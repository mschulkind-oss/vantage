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
 * prints a planning link and reuses it after. It never rewrites an id that is
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
 * clone is handed another's id. A `.vantage` that was already there keeps the
 * ignore state its owner gave it, since it may hold the review inbox.
 */
export const SPACE_GITIGNORE =
  "# Made by vantage-check: nothing in .vantage is committed, so every clone keeps its own space id.\n*\n";

/** The checkout's space, as `ensureSpace` found or made it. */
export type Space =
  /**
   * `made` when this run wrote the file, `kept` when it was there.
   * `madeDirectory` says this run made `.vantage` too, and its `.gitignore`.
   */
  | {
      kind: "made" | "kept";
      id: string;
      checkout: string;
      file: string;
      madeDirectory: boolean;
    }
  /** The file is there and holds no space id; it is left as it is. */
  | { kind: "malformed"; checkout: string; file: string }
  /** No file, and none could be made, for `reason`. */
  | { kind: "unwritable"; checkout: string; file: string; reason: string };

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
 * The checkout whose `.vantage/space` names `root`: the main checkout when
 * `root` is a linked worktree, since that is the checkout a Vantage serves,
 * and `root` itself otherwise.
 *
 * A linked worktree's `.git` is a file naming its gitdir, and that gitdir's
 * `commondir` names the repository's own git directory, whose parent is the
 * main checkout. A submodule's `.git` is a file too, but its gitdir has no
 * `commondir`, so it is a checkout of its own; so is a worktree of a bare
 * repository, whose common directory is no checkout's `.git`. Anything that
 * cannot be read as one of these is `root` itself.
 */
export function spaceCheckout(root: string): string {
  const dotGit = join(root, ".git");
  let gitdir: string;
  try {
    if (!lstatSync(dotGit).isFile()) return root;
    const line = readFileSync(dotGit, "utf8").trim();
    if (!line.startsWith("gitdir:")) return root;
    gitdir = resolve(root, line.slice("gitdir:".length).trim());
  } catch {
    return root;
  }
  let common: string;
  try {
    common = resolve(
      gitdir,
      readFileSync(join(gitdir, "commondir"), "utf8").trim(),
    );
  } catch {
    return root;
  }
  if (basename(common) !== ".git") return root;
  const main = dirname(common);
  try {
    return statSync(main).isDirectory() ? main : root;
  } catch {
    return root;
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
 * The space of the checkout `root` is in (`spaceCheckout`), made when it has
 * none. When `.vantage` is not there it is made, with `SPACE_GITIGNORE` as its
 * `.gitignore`, before the id is written; a `.vantage` that is there is
 * written into as it is.
 */
export function ensureSpace(root: string): Space {
  const checkout = spaceCheckout(root);
  const file = join(checkout, PLANNING_SPACE_FILE);
  const dir = dirname(file);
  const fail = (reason: string): Space => ({
    kind: "unwritable",
    checkout,
    file,
    reason,
  });

  try {
    const found = readSpaceFile(file);
    if (found === "malformed") return { kind: "malformed", checkout, file };
    if (found !== "absent") {
      return { kind: "kept", id: found, checkout, file, madeDirectory: false };
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
    // there. Either way its ignore state is not this run's to set.
    if (codeOf(error) !== "EEXIST") return fail(reasonOf(error));
  }
  try {
    if (!statSync(dir).isDirectory()) {
      return fail(`${dir} is not a directory`);
    }
    if (madeDirectory) {
      writeFileSync(join(dir, ".gitignore"), SPACE_GITIGNORE, { flag: "wx" });
    }
    const id = newSpaceId();
    if (publish(file, planningSpaceFileText(id))) {
      return { kind: "made", id, checkout, file, madeDirectory };
    }
    // Another run made it first: use what it wrote.
    const found = readSpaceFile(file);
    if (found === "malformed") return { kind: "malformed", checkout, file };
    if (found === "absent") return fail(`${file} vanished as it was made`);
    return { kind: "kept", id: found, checkout, file, madeDirectory };
  } catch (error) {
    return fail(reasonOf(error));
  }
}
