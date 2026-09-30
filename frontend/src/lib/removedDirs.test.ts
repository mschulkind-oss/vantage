import { describe, it, expect } from "vitest";
import { filesWithin, isWithin, renamedTo } from "./removedDirs";
import type { FileNode } from "../types";

describe("isWithin", () => {
  it("holds of the directory itself and of everything below it", () => {
    expect(isWithin("docs/old", "docs/old")).toBe(true);
    expect(isWithin("docs/old/a.md", "docs/old")).toBe(true);
    expect(isWithin("docs/old/sub/b.md", "docs/old")).toBe(true);
  });

  it("does not hold of a sibling that only shares the name's prefix", () => {
    expect(isWithin("docs/old-x/a.md", "docs/old")).toBe(false);
    expect(isWithin("docs/olda.md", "docs/old")).toBe(false);
    expect(isWithin("docs", "docs/old")).toBe(false);
  });
});

// A renamed directory's files move without an event of their own, so a push
// reports `mv docs/old docs/new` as removed_dirs ["docs/old"] and the new
// directory's Markdown in paths (internal/live/watcher.go,
// filesChangedMessage).
describe("renamedTo", () => {
  it("finds the document under the directory's new name", () => {
    expect(renamedTo("docs/old/a.md", ["docs/old"], ["docs/new/a.md"])).toBe(
      "docs/new/a.md",
    );
  });

  it("keeps the path below the renamed directory", () => {
    expect(
      renamedTo(
        "docs/old/sub/b.md",
        ["docs/old"],
        ["docs/new/a.md", "docs/new/sub/b.md"],
      ),
    ).toBe("docs/new/sub/b.md");
  });

  it("follows a directory moved elsewhere under its own name", () => {
    expect(renamedTo("docs/old/a.md", ["docs/old"], ["archive/old/a.md"])).toBe(
      "archive/old/a.md",
    );
  });

  it("follows a document whose parent's parent was renamed", () => {
    expect(renamedTo("docs/old/a.md", ["docs"], ["notes/old/a.md"])).toBe(
      "notes/old/a.md",
    );
  });

  // A README in every folder is the common case: docs/new/sub/README.md ends
  // the same way docs/new/README.md does, but it lies inside the other
  // candidate's new directory, and a renamed directory has one new name.
  it("is not confused by a same-named file deeper in the renamed directory", () => {
    expect(
      renamedTo(
        "docs/old/README.md",
        ["docs/old"],
        ["docs/new/README.md", "docs/new/sub/README.md"],
      ),
    ).toBe("docs/new/README.md");
  });

  it("says nothing when the push does not show where it went", () => {
    // Moved out of the served tree, or removed without the files' own events.
    expect(renamedTo("docs/old/a.md", ["docs/old"], [])).toBeNull();
    expect(
      renamedTo("docs/old/a.md", ["docs/old"], ["docs/new/b.md"]),
    ).toBeNull();
  });

  it("says nothing when two places could be it", () => {
    expect(
      renamedTo("docs/old/a.md", ["docs/old"], ["one/a.md", "two/a.md"]),
    ).toBeNull();
  });

  it("says nothing of a document outside every removed directory", () => {
    expect(
      renamedTo("docs/keep/a.md", ["docs/old"], ["docs/new/a.md"]),
    ).toBeNull();
  });

  // An agent that fixes a document and then files it away pushes both in one
  // batch. The edit is heard, so the document is no witness of its own; its
  // folder's other files, which moved without a word, are.
  it("follows a document edited just before its directory was renamed", () => {
    expect(
      renamedTo(
        "docs/old/a.md",
        ["docs/old"],
        ["docs/old/a.md", "docs/new/a.md", "docs/new/b.md"],
        ["docs/old/a.md", "docs/old/b.md"],
      ),
    ).toBe("docs/new/a.md");
  });

  it("says nothing of a document heard in a batch that nothing else vouches for", () => {
    // Alone in its folder, edited and then renamed: nothing tells that apart
    // from a deletion beside an unrelated file of the same name.
    expect(
      renamedTo(
        "docs/old/a.md",
        ["docs/old"],
        ["docs/old/a.md", "docs/new/a.md"],
        ["docs/old/a.md"],
      ),
    ).toBeNull();
    // Removed along with its directory, as kqueue reports it on macOS.
    expect(
      renamedTo("docs/old/a.md", ["docs/old"], ["docs/old/a.md"]),
    ).toBeNull();
  });

  // A removed directory's files are pushed by their own removals, and a
  // renamed one's never are, so a document whose old path was pushed was
  // deleted or rebuilt, not renamed. A file of its name elsewhere in the same
  // batch is some other document.
  describe("a document deleted or rebuilt where it was", () => {
    it("is not taken to an unrelated file of its name created in the same batch", () => {
      expect(
        renamedTo(
          "gone/x.md",
          ["gone"],
          ["elsewhere/x.md", "gone/x.md"],
          ["gone/x.md"],
        ),
      ).toBeNull();
    });

    it("is not taken to a sibling folder's README edited in the same batch", () => {
      expect(
        renamedTo(
          "docs/plans/foo/README.md",
          ["docs/plans/foo"],
          ["docs/plans/foo/README.md", "docs/plans/bar/README.md"],
          ["docs/plans/foo/README.md", "docs/plans/foo/notes.md"],
        ),
      ).toBeNull();
    });

    it("stays where a rebuild put it back", () => {
      expect(
        renamedTo(
          "out/index.md",
          ["out"],
          ["docs/index.md", "out/index.md", "out/other.md"],
          ["out/index.md", "out/other.md"],
        ),
      ).toBeNull();
    });

    it("is not followed to a copy made before the folder was deleted", () => {
      // Every file of the folder was heard going.
      expect(
        renamedTo(
          "gone/x.md",
          ["gone"],
          ["gone/x.md", "gone/y.md", "elsewhere/x.md", "elsewhere/y.md"],
          ["gone/x.md", "gone/y.md"],
        ),
      ).toBeNull();
    });
  });

  // A file of the document's name can change anywhere in the same batch.
  describe("an unrelated file of the same name in the same batch", () => {
    it("loses to the folder more of the directory's files arrived in", () => {
      expect(
        renamedTo(
          "docs/old/a.md",
          ["docs/old"],
          ["docs/new/a.md", "docs/new/b.md", "nearby/a.md"],
          ["docs/old/a.md", "docs/old/b.md"],
        ),
      ).toBe("docs/new/a.md");
    });

    it("loses to the folder's new name beside the old one", () => {
      expect(
        renamedTo(
          "docs/old/a.md",
          ["docs/old"],
          ["docs/new/a.md", "nearby/a.md"],
          ["docs/old/a.md"],
        ),
      ).toBe("docs/new/a.md");
    });

    it("loses to the folder moved elsewhere under its own name", () => {
      expect(
        renamedTo(
          "docs/old/a.md",
          ["docs/old"],
          ["archive/old/a.md", "nearby/a.md"],
          ["docs/old/a.md"],
        ),
      ).toBe("archive/old/a.md");
    });

    it("leaves it open when either could be a single change away", () => {
      // Renamed beside itself, or moved elsewhere under its own name: the batch
      // cannot say which, so it says nothing.
      expect(
        renamedTo(
          "docs/plans/foo/README.md",
          ["docs/plans/foo"],
          ["docs/archive/foo/README.md", "docs/plans/bar/README.md"],
          ["docs/plans/foo/README.md"],
        ),
      ).toBeNull();
      // Until the folder's other files say where it went.
      expect(
        renamedTo(
          "docs/plans/foo/README.md",
          ["docs/plans/foo"],
          [
            "docs/archive/foo/README.md",
            "docs/archive/foo/notes.md",
            "docs/plans/bar/README.md",
          ],
          ["docs/plans/foo/README.md", "docs/plans/foo/notes.md"],
        ),
      ).toBe("docs/archive/foo/README.md");
    });
  });

  // A folder view has no file of its own to arrive anywhere; the files it
  // listed are what say where it went.
  describe("a folder view", () => {
    it("follows the folder shown to its new name", () => {
      expect(
        renamedTo(
          "docs/old",
          ["docs/old"],
          ["docs/new/a.md", "docs/new/b.md"],
          ["docs/old/a.md", "docs/old/b.md"],
        ),
      ).toBe("docs/new");
    });

    it("follows a folder inside the renamed one", () => {
      expect(
        renamedTo(
          "docs/old/sub",
          ["docs/old"],
          ["docs/new/sub/c.md"],
          ["docs/old/sub/c.md"],
        ),
      ).toBe("docs/new/sub");
    });

    it("says nothing when none of its files arrived anywhere", () => {
      expect(
        renamedTo("docs/old", ["docs/old"], ["docs/new/a.md"], []),
      ).toBeNull();
      expect(
        renamedTo(
          "docs/old",
          ["docs/old"],
          ["docs/old/a.md"],
          ["docs/old/a.md"],
        ),
      ).toBeNull();
    });
  });

  // A directory renamed to R contained neither itself nor its parents: a file
  // in one of those is an edit that happened to land in the same batch, not the
  // document arriving.
  it("never takes an ancestor of the removed directory for its new name", () => {
    expect(
      renamedTo("docs/old/README.md", ["docs/old"], ["docs/README.md"]),
    ).toBeNull();
  });

  it("never takes a file inside a removed directory", () => {
    expect(
      renamedTo(
        "docs/old/a.md",
        ["docs/old", "docs/tmp"],
        ["docs/tmp/a.md", "docs/newer/a.md"],
      ),
    ).toBe("docs/newer/a.md");
  });

  it("follows a document whose own directory went separately from its parent", () => {
    // `mv docs/old/sub docs/sub2`, then `mv docs/old docs/new`, heard in one
    // batch as two pushes.
    expect(
      renamedTo(
        "docs/old/sub/a.md",
        ["docs/old", "docs/old/sub"],
        ["docs/sub2/a.md", "docs/new/x.md"],
      ),
    ).toBe("docs/sub2/a.md");
  });
});

describe("filesWithin", () => {
  const file = (path: string): FileNode => ({
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    is_dir: false,
  });
  const dir = (path: string, children?: FileNode[]): FileNode => ({
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    is_dir: true,
    children,
  });

  it("lists the files the trees hold inside the directories, at any depth", () => {
    const tree = [
      dir("docs", [
        dir("docs/old", [
          file("docs/old/a.md"),
          dir("docs/old/sub", [file("docs/old/sub/b.md")]),
        ]),
        dir("docs/keep", [file("docs/keep/c.md")]),
        file("docs/README.md"),
      ]),
      dir("closed"),
    ];
    // A folder view's listing, which repeats one of the tree's files.
    const listing = [file("docs/old/a.md"), file("docs/old/z.md")];
    expect(filesWithin([tree, listing, null], ["docs/old"]).sort()).toEqual([
      "docs/old/a.md",
      "docs/old/sub/b.md",
      "docs/old/z.md",
    ]);
  });
});
