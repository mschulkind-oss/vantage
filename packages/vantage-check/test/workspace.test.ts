import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDocument } from "../src/core/document.js";
import { Workspace } from "../src/core/workspace.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

/**
 * `Workspace.offer` is an optimization, so every test here is the same
 * question asked of a different answer: **does the shortcut agree with the long
 * way round?** A cache that is merely fast is a cache that invents findings.
 */
describe("Workspace.offer", () => {
  const DOCUMENT = [
    "---",
    'title: "Target"',
    "---",
    "",
    "# Target",
    "",
    "## 4.1 The id grammar",
    "",
    '<a id="notes"></a>',
    "",
    '<!-- vantage: oq id=OQ-4 leaning="Yes." -->',
    "",
    "A question.",
    "",
  ].join("\n");

  it("answers every question exactly as reading the file does", () => {
    const root = makeTree({ "target.md": DOCUMENT });
    const path = join(root, "target.md");

    const fromDisk = new Workspace();
    const offered = new Workspace();
    offered.offer(loadDocument("target.md", root));

    expect(offered.kind(path)).toBe(fromDisk.kind(path));
    expect(offered.lineCount(path)).toBe(fromDisk.lineCount(path));
    expect(offered.documentAnchors(path)).toEqual(
      fromDisk.documentAnchors(path),
    );
    expect(offered.numberedHeadings(path)).toEqual(
      fromDisk.numberedHeadings(path),
    );
    // And the answers are the real ones, not two matching nulls.
    expect(offered.documentAnchors(path)).toContain("41-the-id-grammar");
    expect(offered.documentAnchors(path)).toContain("OQ-4");
    expect(offered.lineCount(path)).toBe(13);
  });

  // A file named on the command line is checked whatever its extension, so a
  // non-Markdown document reaches `offer` with an mdast anyway. Crediting it
  // with anchors would make `notes.txt#anything` resolvable — and, worse, make
  // `notes.txt#missing` a finding, which reading from disk never produces.
  it("credits a non-Markdown file with no anchors, as disk does not", () => {
    const root = makeTree({ "notes.txt": "# Heading\n" });
    const path = join(root, "notes.txt");
    const workspace = new Workspace();

    workspace.offer(loadDocument("notes.txt", root));

    expect(workspace.documentAnchors(path)).toBeNull();
    expect(workspace.numberedHeadings(path)).toBeNull();
    // The cheap answers are still worth having.
    expect(workspace.kind(path)).toBe("file");
    expect(workspace.lineCount(path)).toBe(1);
  });

  it("changes no verdict in a run that cross-links in both directions", async () => {
    // `a.md` links forward to a file the run has not loaded yet, and `b.md`
    // links back to one it has — so the run exercises the cache both cold and
    // warm, and must be silent either way.
    const root = makeTree({
      "a.md": [
        "# A",
        "",
        "See [§4.1](./b.md#41-the-id-grammar) and [line](./b.md#L7).",
        "",
      ].join("\n"),
      "b.md": DOCUMENT,
      "c.md": "# C\n\nSee [A](./a.md#a) and [gone](./b.md#nope).\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["link/dead-section-anchor"]);
    expect(report.findings[0]?.file).toBe("c.md");
  });
});
