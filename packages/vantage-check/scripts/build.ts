#!/usr/bin/env bun
/**
 * Build vantage-check into a standalone single-file executable.
 *
 *   bun ./scripts/build.ts                # this host
 *   bun ./scripts/build.ts --target T     # cross-compile (bun-linux-x64, …)
 *
 * `bun build --compile` cross-compiles every target from one host, which is
 * why this replaced the Node SEA build: SEA can only produce a binary for the
 * platform it runs on, so it needed a runner per platform. The version and
 * commit are inlined at compile time via `--define`, so the binary reports its
 * own identity with nothing to read at run time.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { version: string };

const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();

const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target");
const target = targetIndex === -1 ? undefined : args[targetIndex + 1];

// bun appends .exe itself for windows targets; the release workflow relies on
// that, so do not try to spell the extension here.
const outfile = path.join(root, "dist", "vantage-check");
mkdirSync(path.dirname(outfile), { recursive: true });

const buildArgs = [
  "build",
  "--compile",
  path.join(root, "src", "main.ts"),
  `--outfile=${outfile}`,
  // The flag and its expression are separate argv elements — bun ignores a
  // single combined string and the binary silently reports 0.0.0-dev.
  "--define",
  `__VANTAGE_CHECK_VERSION__=${JSON.stringify(pkg.version)}`,
  "--define",
  `__VANTAGE_CHECK_COMMIT__=${JSON.stringify(commit || "unknown")}`,
];
if (target) buildArgs.push(`--target=${target}`);

const res = spawnSync("bun", buildArgs, { cwd: root, stdio: "inherit" });
process.exit(res.status ?? 1);
