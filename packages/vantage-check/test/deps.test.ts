/**
 * Version-drift guard.
 *
 * The CLI and vantage-md have independent node_modules trees, so each resolves
 * its own katex and mermaid. The whole claim of this tool is that it validates
 * with the engines the *viewer* renders with — so the two copies must be the
 * same version. Without this test the drift is silent, and "valid" quietly
 * means something different in the checker than it does in the browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

function installedVersion(tree: string, pkg: string): string {
  const file = path.resolve(
    import.meta.dirname,
    "..",
    tree,
    "node_modules",
    pkg,
    "package.json",
  );
  return JSON.parse(readFileSync(file, "utf8")).version as string;
}

for (const pkg of ["katex", "mermaid"]) {
  it(`the CLI's ${pkg} matches the version vantage-md renders with`, () => {
    expect(installedVersion(".", pkg)).toBe(
      installedVersion("../vantage-md", pkg),
    );
  });
}
