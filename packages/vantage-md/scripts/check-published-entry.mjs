/**
 * Check that the built package's entry points import — and that one of them
 * renders.
 *
 * The CommonJS entry used to throw before a single call: `require("vantage-md")`
 * died inside `unified` with "an empty preset", because the bundler's
 * `require()` interop handed `.use()` the ESM namespace instead of the plugin.
 * Nothing in this repo noticed. Everything here imports the package's
 * TypeScript source, so the build succeeded, the declarations were right, and
 * only the artifact a consumer installs was broken.
 *
 * This runs the artifact. It also pins the 2026-11-13 decision to ship ESM only
 * (`docs/design/vantage-md-consumer-requests.md` §2): a `main` field, a
 * `require` condition, or a leftover `.cjs` file is how that regression would
 * come back.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve(import.meta.dirname, "..");
const dist = path.join(packageRoot, "dist");

let failed = false;
function fail(message) {
  console.error(`✗ ${message}`);
  failed = true;
}

if (!existsSync(dist)) {
  console.error(
    "dist/ is missing — build first: npm run build --workspace vantage-md",
  );
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);

if (manifest.main) {
  fail(`package.json still names a CommonJS entry in "main": ${manifest.main}`);
}
if (JSON.stringify(manifest.exports).includes('"require"')) {
  fail('package.json exports still carries a "require" condition');
}
for (const name of ["index.cjs", "react.cjs", "index.d.cts", "react.d.cts"]) {
  if (existsSync(path.join(dist, name))) {
    fail(`dist/${name} exists; the package is ESM only`);
  }
}

async function importsAndWorks(name, exercise) {
  const entry = path.join(dist, name);
  if (!existsSync(entry)) {
    fail(`dist/${name} is missing`);
    return;
  }
  try {
    const mod = await import(pathToFileURL(entry).href);
    if (exercise) await exercise(mod);
  } catch (error) {
    fail(`dist/${name} failed: ${error.message}`);
  }
}

await importsAndWorks("index.js", async (mod) => {
  if (typeof mod.renderMarkdown !== "function") {
    fail("dist/index.js does not export renderMarkdown");
    return;
  }
  const { html } = await mod.renderMarkdown("# Hello\n\nSome **bold** text.");
  if (!html.includes("<h1")) fail("renderMarkdown did not render a heading");
  if (!html.includes("<strong>bold</strong>")) {
    fail("renderMarkdown did not render emphasis");
  }
});

// The React entry is a second package entry point (the `.` and `./react`
// `exports` conditions), so a throw there is a broken package even when the
// core entry works.
await importsAndWorks("react.js", async (mod) => {
  // `MarkdownViewer` is a `memo()` component, so it is an object rather than a
  // function; presence is the whole assertion here.
  if (!mod.MarkdownViewer) {
    fail("dist/react.js does not export MarkdownViewer");
  }
});

if (failed) {
  console.error("\nThe published entry point does not work.");
  process.exit(1);
}
console.log("✓ the published entry points import and render");
