/**
 * Version-drift guard. vantage-check and vantage-md have independent
 * node_modules trees (no npm workspaces), so each resolved its own katex and
 * mermaid. The CLI validates against the *viewer's* pipeline, so the two
 * copies must stay on the same version — this makes drift loud instead of
 * silently changing what "valid" means.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

function installedVersion(tree: string, pkg: string): string {
  const file = path.resolve(
    process.cwd(),
    tree,
    "node_modules",
    pkg,
    "package.json",
  );
  return JSON.parse(readFileSync(file, "utf8")).version;
}

for (const pkg of ["katex", "mermaid"]) {
  it(`vantage-check's ${pkg} matches vantage-md's installed version`, () => {
    expect(installedVersion(".", pkg)).toBe(
      installedVersion("../vantage-md", pkg),
    );
  });
}
