/**
 * Check that every stylesheet the built package exports can be loaded whole.
 *
 * The `exports` map points `vantage-md/styles` and `vantage-md/prose` at files
 * in `dist/`, and `dist/styles.css` is `src/styles/index.css` copied as-is — a
 * file made of relative `@import`s. Until this check existed the build copied
 * that one file and none of the files it imports, so a consumer of
 * `vantage-md/styles` got a stylesheet whose every rule was in a file that was
 * not in the package. Nothing in this repo noticed, because everything here
 * imports the package's source rather than `dist/`.
 *
 * So follow every relative `@import`, from every CSS file the `exports` map
 * names, and require each target to exist inside `dist/`. A bare specifier
 * (`@import "tailwindcss"`) is the consumer's to resolve and is not followed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const dist = path.join(packageRoot, "dist");

if (!existsSync(dist)) {
  console.error(
    "dist/ is missing — build first: npm run build --workspace vantage-md",
  );
  process.exit(1);
}

/** Every string in the `exports` map, however deeply nested. */
function targets(value) {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(targets);
  }
  return [];
}

const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const entries = targets(manifest.exports)
  .filter((target) => target.endsWith(".css"))
  .map((target) => path.join(packageRoot, target));

const IMPORT = /@import\s+(?:url\(\s*)?["']([^"']+)["']/g;
const problems = [];
const seen = new Set();
const queue = [...entries];

while (queue.length > 0) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const shown = path.relative(packageRoot, file);
  if (!existsSync(file)) {
    problems.push(`${shown} is missing`);
    continue;
  }
  if (path.relative(dist, file).startsWith("..")) {
    problems.push(`${shown} is outside dist/`);
    continue;
  }
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, specifier] of css.matchAll(IMPORT)) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
    const imported = path.resolve(path.dirname(file), specifier);
    if (!existsSync(imported)) {
      problems.push(
        `${shown} imports ${specifier}, which is not in the package (${path.relative(packageRoot, imported)})`,
      );
      continue;
    }
    queue.push(imported);
  }
}

if (entries.length === 0) {
  problems.push("the exports map names no stylesheet");
}

if (problems.length > 0) {
  console.error("✗ the published stylesheets do not load whole:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `✓ ${seen.size} published stylesheets, every relative @import resolved`,
);
