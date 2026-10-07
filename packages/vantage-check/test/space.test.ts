import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLANNING_SPACE_FILE,
  PLANNING_SPACE_ID_LENGTH,
  PLANNING_SPACE_ID_PATTERN,
  PLANNING_SPACE_PARAM,
  isPlanningSpaceId,
  parsePlanningSpaceFile,
  planningSpaceFileText,
} from "../../vantage-md/src/planning/index.js";
import {
  SPACE_GITIGNORE,
  SPACE_GITIGNORE_BESIDE,
  ensureSpace,
  isBareGitConfig,
  mainCheckoutOf,
  newSpaceId,
} from "../src/core/space.js";
import { makeTree } from "./helpers.js";

/**
 * The space id (`docs/reference/planning-index.md` §13.6), below the command:
 * how one is made, which checkout keeps it, and how a `.vantage/space` is
 * read. What `index --filter` prints with it is in `index.test.ts`.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");

/** `internal/spaceid/testdata/space-files.json`, the server's suite's too. */
const FIXTURE = JSON.parse(
  readFileSync(
    join(REPO, "internal", "spaceid", "testdata", "space-files.json"),
    "utf8",
  ),
) as {
  files: { text: string; id: string | null }[];
  ids: { id: string; valid: boolean }[];
  configs: { text: string; bare: boolean }[];
};

/**
 * A main checkout and a linked worktree of it, laid out as `git worktree add`
 * leaves them: the worktree's `.git` is a file naming its gitdir under the
 * main checkout's `.git/worktrees/`, whose `commondir` leads back to `.git`.
 */
function worktreePair(): { main: string; worktree: string } {
  const main = makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".git/worktrees/wt/commondir": "../..\n",
    ".git/worktrees/wt/HEAD": "ref: refs/heads/wt\n",
    "a.md": "# A\n",
  });
  const worktree = makeTree({ "a.md": "# A\n" });
  writeFileSync(
    join(main, ".git/worktrees/wt/gitdir"),
    `${join(worktree, ".git")}\n`,
  );
  writeFileSync(
    join(worktree, ".git"),
    `gitdir: ${join(main, ".git/worktrees/wt")}\n`,
  );
  return { main, worktree };
}

describe("the space id's names and file", () => {
  it("are one parameter, one pattern and one path", () => {
    expect(PLANNING_SPACE_PARAM).toBe("space");
    expect(PLANNING_SPACE_FILE).toBe(".vantage/space");
    expect(PLANNING_SPACE_ID_LENGTH).toBe(16);
    expect(PLANNING_SPACE_ID_PATTERN.source).toBe("^[a-z2-7]{16}$");
    expect(planningSpaceFileText("abcdefghijklmnop")).toBe(
      "abcdefghijklmnop\n",
    );
  });

  // The server reads the same file with its own code, and the fixture holds
  // both readers to one answer for every text in it.
  it.each(FIXTURE.files)("reads $text as $id, as the server does", (entry) => {
    expect(parsePlanningSpaceFile(entry.text)).toBe(entry.id);
  });

  it.each(FIXTURE.ids)("takes $id as an id: $valid", ({ id, valid }) => {
    expect(isPlanningSpaceId(id)).toBe(valid);
  });

  // Whether a main checkout's worktrees are its own: the server answers for
  // their ids only when it is not bare, and the hint names it only then.
  it.each(FIXTURE.configs)(
    "reads the git config $text as bare: $bare, as the server does",
    ({ text, bare }) => {
      expect(isBareGitConfig(text)).toBe(bare);
    },
  );
});

describe("newSpaceId", () => {
  it("writes ten bytes as RFC 4648 base32, lowercased", () => {
    const fixed = (bytes: number[]) => (n: number) => {
      expect(n).toBe(10);
      return Uint8Array.from(bytes);
    };
    // Python's base64.b32encode, lowercased.
    expect(newSpaceId(fixed([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(
      "aaaqeayeaudaocaj",
    );
    expect(newSpaceId(fixed(Array(10).fill(255)))).toBe("7777777777777777");
    expect(newSpaceId(fixed([...Buffer.from("foobarbaz!")]))).toBe(
      "mzxw6ytbojrgc6rb",
    );
  });

  it("makes an id each time, from a random source", () => {
    const ids = new Set(Array.from({ length: 32 }, () => newSpaceId()));
    expect(ids.size).toBe(32);
    for (const id of ids) expect(isPlanningSpaceId(id), id).toBe(true);
  });
});

describe("mainCheckoutOf", () => {
  it("is null for a main checkout, or a root with no .git", () => {
    const main = makeTree({ ".git/HEAD": "" });
    const plain = makeTree({ "a.md": "# A\n" });
    expect(mainCheckoutOf(main)).toBeNull();
    expect(mainCheckoutOf(plain)).toBeNull();
  });

  it("is the main checkout for a linked worktree", () => {
    const { main, worktree } = worktreePair();
    expect(mainCheckoutOf(worktree)).toBe(main);
  });

  it("is null for a gitdir it cannot follow, a submodule, or a bare repository's worktree", () => {
    // A gitdir that is not there.
    const lost = makeTree({ ".git": "gitdir: /elsewhere/.git/worktrees/a\n" });
    expect(mainCheckoutOf(lost)).toBeNull();
    // A submodule: its gitdir has no commondir, so it is its own checkout.
    const outer = makeTree({ ".git/modules/sub/HEAD": "" });
    const sub = join(outer, "sub");
    writeFileSync(join(outer, ".git/modules/sub/config"), "");
    makeTreeAt(sub, { ".git": `gitdir: ../.git/modules/sub\n` });
    expect(mainCheckoutOf(sub)).toBeNull();
    // A worktree of a bare repository: the common directory is no .git.
    const bare = makeTree({
      "repo.git/HEAD": "",
      "repo.git/worktrees/wt/commondir": "../..\n",
    });
    const wt = makeTree({
      ".git": `gitdir: ${join(bare, "repo.git/worktrees/wt")}\n`,
    });
    expect(mainCheckoutOf(wt)).toBeNull();
    // Not a gitdir line at all.
    const odd = makeTree({ ".git": "something else\n" });
    expect(mainCheckoutOf(odd)).toBeNull();
  });

  // `git clone --bare url proj/.git`, then worktrees under proj: the common
  // directory is named .git, but it is a bare repository, and the folder
  // holding it is no checkout.
  it("is null for a worktree of a bare repository kept as a folder's .git", () => {
    const proj = makeTree({
      ".git/HEAD": "",
      ".git/config": "[core]\n\trepositoryformatversion = 0\n\tbare = true\n",
      ".git/worktrees/main/commondir": "../..\n",
    });
    const main = join(proj, "main");
    makeTreeAt(main, {
      ".git": `gitdir: ${join(proj, ".git/worktrees/main")}\n`,
    });
    expect(mainCheckoutOf(main)).toBeNull();
    writeFileSync(join(proj, ".git/config"), "[core]\n\tbare = false\n");
    expect(mainCheckoutOf(main)).toBe(proj);
  });
});

/** Write `files` under `dir`, which `makeTree` already removes with its root. */
function makeTreeAt(dir: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(dir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
}

describe("ensureSpace", () => {
  it("makes .vantage, its .gitignore and the id once, then keeps them", () => {
    const root = makeTree({ ".git/HEAD": "" });
    const made = ensureSpace(root);
    expect(made).toMatchObject({
      kind: "made",
      file: join(root, ".vantage/space"),
      madeDirectory: true,
    });
    const id = "id" in made ? made.id : "";
    expect(readFileSync(join(root, ".vantage/space"), "utf8")).toBe(`${id}\n`);
    expect(readFileSync(join(root, ".vantage/.gitignore"), "utf8")).toBe(
      SPACE_GITIGNORE,
    );
    expect(SPACE_GITIGNORE.split("\n")).toEqual([
      expect.stringMatching(/^# /),
      "*",
      "",
    ]);
    expect(ensureSpace(root)).toEqual({
      kind: "kept",
      id,
      file: join(root, ".vantage/space"),
      madeDirectory: false,
    });
  });

  // vantage-check makes the id in the checkout it runs in, so the link names
  // the worktree: a Vantage serving it opens it, and one serving only the
  // main checkout finds the id through the main checkout's .git/worktrees.
  it("makes a linked worktree's id in the worktree, and none in its main checkout", () => {
    const { main, worktree } = worktreePair();
    expect(ensureSpace(worktree)).toMatchObject({
      kind: "made",
      file: join(worktree, ".vantage/space"),
      madeDirectory: true,
    });
    expect(readFileSync(join(worktree, ".vantage/.gitignore"), "utf8")).toBe(
      SPACE_GITIGNORE,
    );
    expect(() => readFileSync(join(main, ".vantage/space"))).toThrow();
  });

  // A .vantage that is there with no .gitignore, which an agent made for the
  // review inbox, say, gets one ignoring only the id and its own scratch
  // names, so a `git add -A` cannot commit the id and the inbox's ignore
  // state is as it was. One that has a .gitignore keeps it untouched.
  it("ignores the id in a .vantage that was there with no .gitignore, and nothing else", () => {
    const root = makeTree({ ".git/HEAD": "", ".vantage/inbox/.keep": "" });
    expect(ensureSpace(root)).toMatchObject({
      kind: "made",
      madeDirectory: false,
    });
    expect(readFileSync(join(root, ".vantage/.gitignore"), "utf8")).toBe(
      SPACE_GITIGNORE_BESIDE,
    );
    expect(SPACE_GITIGNORE_BESIDE.split("\n")).toEqual([
      expect.stringMatching(/^# /),
      "/space",
      "/space.*.tmp",
      "/.gitignore",
      "",
    ]);

    // Made again when it is missing, as after a run stopped between making
    // .vantage and writing its .gitignore, and kept as it is when it is not.
    const stopped = makeTree({ ".git/HEAD": "", ".vantage/.keep": "" });
    ensureSpace(stopped);
    rmSync(join(stopped, ".vantage/.gitignore"));
    expect(ensureSpace(stopped)).toMatchObject({ kind: "kept" });
    expect(readFileSync(join(stopped, ".vantage/.gitignore"), "utf8")).toBe(
      SPACE_GITIGNORE_BESIDE,
    );
    const owned = makeTree({
      ".git/HEAD": "",
      ".vantage/.gitignore": "inbox/\n",
    });
    ensureSpace(owned);
    expect(readFileSync(join(owned, ".vantage/.gitignore"), "utf8")).toBe(
      "inbox/\n",
    );
  });

  it("says why when it cannot make one", () => {
    const root = makeTree({ ".git/HEAD": "", ".vantage": "a file\n" });
    expect(ensureSpace(root)).toMatchObject({
      kind: "unwritable",
      file: join(root, ".vantage/space"),
      reason: expect.any(String),
    });
    expect(readFileSync(join(root, ".vantage"), "utf8")).toBe("a file\n");
  });
});
