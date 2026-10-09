import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { checkFiles } from "../src/core/runner.js";
import { Collector } from "../src/core/collector.js";
import { discover } from "../src/core/discover.js";
import { loadDocument } from "../src/core/document.js";
import { Settings } from "../src/core/settings.js";
import type { RunReport } from "../src/core/types.js";
import { Workspace } from "../src/core/workspace.js";
import { GIT_LOCATION_ENV } from "../src/core/gitIgnore.js";

/**
 * This process's environment without the variables that locate a repository,
 * for a test's own `git` commands. A commit made in a linked worktree runs the
 * pre-commit hook, and so these tests, with `GIT_DIR` naming that worktree's
 * directory under the shared `.git`; inherited, a test's `git init` in its own
 * tree re-initializes that directory instead, and sets `core.bare = true` in
 * the shared config, which leaves every checkout of the clone unusable.
 */
export function gitEnvScrubbed(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const scrubbed = { ...env };
  for (const name of GIT_LOCATION_ENV) delete scrubbed[name];
  return scrubbed;
}

const trees: string[] = [];

afterEach(() => {
  while (trees.length > 0) {
    rmSync(trees.pop() as string, { recursive: true, force: true });
  }
});

/**
 * Write a throwaway document tree and return its root.
 *
 * The link rules answer questions about the filesystem, so their tests need a
 * real filesystem — mocking `fs` here would test the mock. Trees are tiny and
 * removed after each test.
 */
export function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vantage-check-"));
  trees.push(root);

  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }

  return root;
}

/** Check paths inside a tree, exactly as the command would. */
export async function checkTree(
  root: string,
  paths: string[] = ["."],
  settings: Settings = Settings.defaults(),
): Promise<RunReport> {
  const { files, errors } = discover(paths, root);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return checkFiles(files, root, settings);
}

/**
 * A Collector over one file in a tree.
 *
 * For rules that take a delegate: `checkTree` can only run the real one, and
 * the interesting half of a delegated rule is what it does when the delegate
 * misbehaves.
 */
export function collectorFor(
  root: string,
  file: string,
  settings: Settings = Settings.defaults(),
): Collector {
  return new Collector(
    loadDocument(file, root),
    settings,
    new Workspace(),
    root,
  );
}

/** The rule ids a run produced, in report order. */
export function ruleIds(report: RunReport): string[] {
  return report.findings.map((finding) => finding.rule);
}
