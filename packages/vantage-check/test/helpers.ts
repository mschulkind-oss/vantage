import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { checkFiles } from "../src/commands/check.js";
import { discover } from "../src/core/discover.js";
import { Settings } from "../src/core/settings.js";
import type { RunReport } from "../src/core/types.js";

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

/** The rule ids a run produced, in report order. */
export function ruleIds(report: RunReport): string[] {
  return report.findings.map((finding) => finding.rule);
}
