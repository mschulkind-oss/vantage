#!/usr/bin/env bun
/**
 * Build vantage-check into a standalone single-file executable.
 *
 * Usage:
 *   bun ./scripts/build.ts                # current host
 *   bun ./scripts/build.ts --target T     # cross-compile to a bun target
 *                                         # (bun-linux-x64, bun-darwin-arm64, …)
 *
 * The version and commit are stamped in at compile time via `--define`, so the
 * binary reports its own version with no runtime environment. `bun build
 * --compile` cross-compiles: one host produces every target.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const pkg = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { version: string };
const version = pkg.version;
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();

const args = process.argv.slice(2);
let target: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--target" && args[i + 1]) target = args[i + 1];
}

const outfile = path.join(root, "dist", "vantage-check");
mkdirSync(path.dirname(outfile), { recursive: true });

const buildArgs = [
  "build",
  "--compile",
  path.join(root, "src", "main.ts"),
  `--outfile=${outfile}`,
  // `--define` and the expression are separate argv elements (bun's form);
  // the value is a JSON string literal inlined at compile time.
  "--define",
  `process.env.VANTAGE_CHECK_VERSION=${JSON.stringify(version)}`,
  "--define",
  `process.env.VANTAGE_CHECK_COMMIT=${JSON.stringify(commit)}`,
];
if (target) buildArgs.push(`--target=${target}`);

console.log(`[vantage-check] bun ${buildArgs.join(" ")}`);
const res = spawnSync("bun", buildArgs, { cwd: root, stdio: "inherit" });
process.exit(res.status ?? 1);
