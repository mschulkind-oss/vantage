#!/usr/bin/env bun
/**
 * Build vantage-check into a standalone single-file executable.
 *
 *   bun ./scripts/build.ts                # this host
 *   bun ./scripts/build.ts --target T     # cross-compile (bun-linux-x64, …)
 *   bun ./scripts/build.ts --manifest-version 9.9.9 --outfile F
 *                                         # what a release stamps, into F
 *
 * `bun build --compile` cross-compiles every target from one host, which is
 * why this replaced the Node SEA build: SEA can only produce a binary for the
 * platform it runs on, so it needed a runner per platform. The version and
 * commit are inlined at compile time via `--define`, so the binary reports its
 * own identity with nothing to read at run time.
 *
 * The version is package.json's, and only the release workflow puts a release
 * there: publish.yml stamps the tag into the manifest (`npm version`) before it
 * runs this. Anywhere else the manifest holds its placeholder, which `stampFor`
 * turns into an empty version, so a local build calls itself a development
 * build instead of claiming to be release 0.1.0 (src/version.ts).
 *
 * `--manifest-version` stands in for the manifest's version, and exists so
 * that `just _self-check` can build what a release stamps without the tag: the
 * stamp reaches a compiled binary only through `--define`, which no unit test
 * runs, and a tag is never moved, so the release workflow's own smoke test is
 * too late to find it broken. The release workflow does not pass it; it stamps
 * the manifest instead. `--outfile` puts that build beside, not over, dist/.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stampFor } from "../src/version.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { version: string };

const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
const target = flag("--target");
const version = flag("--manifest-version") ?? pkg.version;

// bun appends .exe itself for windows targets; the release workflow relies on
// that, so do not try to spell the extension here.
const outfile = path.resolve(
  flag("--outfile") ?? path.join(root, "dist", "vantage-check"),
);
mkdirSync(path.dirname(outfile), { recursive: true });

const buildArgs = [
  "build",
  "--compile",
  path.join(root, "src", "main.ts"),
  `--outfile=${outfile}`,
  // The flag and its expression are separate argv elements — bun ignores a
  // single combined string and a release binary silently reports itself as a
  // development build, which publish.yml's smoke test catches.
  "--define",
  `__VANTAGE_CHECK_VERSION__=${JSON.stringify(stampFor(version))}`,
  "--define",
  `__VANTAGE_CHECK_COMMIT__=${JSON.stringify(commit || "unknown")}`,
];
if (target) buildArgs.push(`--target=${target}`);

const res = spawnSync("bun", buildArgs, { cwd: root, stdio: "inherit" });
process.exit(res.status ?? 1);
