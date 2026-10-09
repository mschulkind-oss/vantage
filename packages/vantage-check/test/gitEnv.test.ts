import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { gitEnvScrubbed, makeTree } from "./helpers.js";

// A commit in a linked worktree runs the pre-commit hook with GIT_DIR naming
// the worktree's directory under the shared .git. A test's `git init` that
// inherits it re-initializes that directory and sets core.bare = true in the
// clone's shared config. gitEnvScrubbed is what every test's git runs under.
describe("gitEnvScrubbed", () => {
  const git = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();

  it("leaves no test a repository location to inherit", () => {
    // test/setup.ts runs first, so a test that forgets gitEnvScrubbed still
    // cannot reach the repository a hook names.
    for (const name of [
      "GIT_DIR",
      "GIT_INDEX_FILE",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
    ]) {
      expect(process.env[name]).toBeUndefined();
    }
  });

  it("drops every variable that locates a repository, and keeps the rest", () => {
    const env = gitEnvScrubbed({
      GIT_DIR: "/x/.git",
      GIT_WORK_TREE: "/x",
      GIT_INDEX_FILE: "/x/.git/index",
      GIT_COMMON_DIR: "/x/.git",
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: "/bin",
    });
    expect(env).toEqual({ GIT_CONFIG_NOSYSTEM: "1", PATH: "/bin" });
  });

  it("keeps a test's git init out of the repository a worktree's hook names", () => {
    const clean = gitEnvScrubbed();
    const clone = makeTree({ "a.md": "# A\n" });
    git(clone, clean, "init", "-q");
    git(
      clone,
      clean,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
    const wt = `${clone}/wt`;
    git(clone, clean, "worktree", "add", "-q", wt);
    const admin = git(wt, clean, "rev-parse", "--absolute-git-dir");
    // What the hook hands a test running in that worktree.
    const hook = {
      ...process.env,
      GIT_DIR: admin,
      GIT_INDEX_FILE: `${admin}/index`,
    };
    const tree = makeTree({ "b.md": "# B\n" });
    git(tree, gitEnvScrubbed(hook), "init", "-q");
    expect(git(clone, clean, "config", "--get", "core.bare")).toBe("false");
    expect(git(tree, clean, "rev-parse", "--show-toplevel")).toBe(
      execFileSync("realpath", [tree], { encoding: "utf8" }).trim(),
    );
  });
});
