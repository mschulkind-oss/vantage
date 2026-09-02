/**
 * Type-check a consumer of the built package under every TypeScript version we
 * claim to support.
 *
 * Until 2026-09-01 this guarantee was a side effect: `frontend` pinned
 * TypeScript 5.9 and vantage-md pinned 6.0, and because `frontend/tsconfig.json`
 * references this package, its sources got compiled by both. That was real but
 * it was a lie about what it proved — it compiled `src/`, while npm consumers
 * only ever see the emitted `dist/`. The two can diverge, and nothing checked
 * the half that ships.
 *
 * So the versions are aligned now, and this replaces the accident: build the
 * package, then compile `typetest/consumer.ts` against the published `exports`
 * map with each supported compiler. `typescript-5` is an alias in package.json
 * so the old one is lockfile-pinned rather than fetched at run time.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(import.meta.dirname, "..");

if (!existsSync(path.join(packageRoot, "dist", "index.d.ts"))) {
  console.error(
    "dist/ is missing — build first: npm run build --workspace vantage-md",
  );
  process.exit(1);
}

/** Oldest first, so the likelier failure reports first. */
const COMPILERS = [
  ["typescript-5", "the oldest TypeScript we support"],
  ["typescript", "the version this package builds with"],
];

let failed = false;
for (const [pkg, why] of COMPILERS) {
  const version = require(`${pkg}/package.json`).version;
  console.log(`\n--- consumer types under TypeScript ${version} (${why}) ---`);
  try {
    execFileSync(
      process.execPath,
      [require.resolve(`${pkg}/bin/tsc`), "-p", "typetest/tsconfig.json"],
      { cwd: packageRoot, stdio: "inherit" },
    );
    console.log(`✓ ${version}`);
  } catch {
    console.error(`✗ ${version} cannot consume the published types`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
