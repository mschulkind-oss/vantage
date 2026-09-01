/**
 * Version-drift guard.
 *
 * The CLI's whole claim is that it validates with the engines the *viewer*
 * renders with, so the two must never resolve different copies of katex or
 * mermaid. Without this the drift is silent, and "valid" quietly means
 * something different in the checker than it does in the browser.
 *
 * This used to compare version *strings* across two independent node_modules
 * trees, which is a weaker thing to ask. Equal versions were possible only by
 * coincidence of when each lockfile was last regenerated, and they diverged
 * twice: katex (fixed by hand in 4ec164ce) and mermaid (#73, which no rebase
 * could fix, because dependabot managed only one of the two directories).
 *
 * The packages are one npm workspace now, so a single hoisted copy serves both
 * and the assertion can be the stronger one: not "the same version" but
 * literally the same file on disk. That fails if anything ever reintroduces a
 * nested install — which is the only way drift could come back.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";

const checkRoot = path.resolve(import.meta.dirname, "..");
const mdRoot = path.resolve(checkRoot, "../vantage-md");

/** Where `pkg` resolves to when imported from `from`. */
function resolvedFrom(from: string, pkg: string): string {
  // A path inside the directory, so resolution starts there.
  const require = createRequire(path.join(from, "noop.js"));
  return require.resolve(`${pkg}/package.json`);
}

for (const pkg of ["katex", "mermaid"]) {
  it(`the CLI and vantage-md resolve one shared ${pkg}`, () => {
    expect(resolvedFrom(checkRoot, pkg)).toBe(resolvedFrom(mdRoot, pkg));
  });

  it(`${pkg} is hoisted to the workspace root, not nested in a package`, () => {
    // Belt and braces: identical paths would also be satisfied by both packages
    // nesting their own copy if the two roots ever collapsed.
    const resolved = resolvedFrom(checkRoot, pkg);
    expect(resolved).not.toContain(path.join("vantage-check", "node_modules"));
    expect(resolved).not.toContain(path.join("vantage-md", "node_modules"));
  });
}
