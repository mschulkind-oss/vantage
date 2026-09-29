import { chmodSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDE_DIRS,
  Listing,
  isCandidate,
  listCandidates,
  readCandidate,
} from "../src/core/candidates.js";
import { DEFAULT_PLANNING_CONFIG } from "../../vantage-md/src/planning/index.js";
import { makeTree } from "./helpers.js";

/**
 * The candidate walk is a mirror of the server's `ListAllFiles`, so the one
 * thing worth proving is that it gives the server's answer. The shared fixture
 * holds a tree and the list the Go code produced for it; this suite and the
 * server's `internal/fs` test both read it.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");

function testdata(name: string): string {
  return join(REPO, "internal", "repoconfig", "testdata", name);
}

const fixture = JSON.parse(
  readFileSync(testdata("planning-candidates.json"), "utf8"),
) as { tree: Record<string, string>; listed: string[] };

const config = { ...DEFAULT_PLANNING_CONFIG };

describe("the listing, against planning-candidates.json", () => {
  it("lists what the server lists for the fixture's tree", () => {
    const root = makeTree(fixture.tree);

    expect(new Listing(root).list()).toEqual(fixture.listed);
  });

  it("answers isListed as the walk does, for every path in the tree", () => {
    const root = makeTree(fixture.tree);
    const listing = new Listing(root);
    const listed = new Set(listing.list());

    for (const path of Object.keys(fixture.tree)) {
      expect(listing.isListed(path), path).toBe(listed.has(path));
    }
  });

  // The listing takes `.md` case-insensitively and the patterns do not: Go's
  // regular expressions are case-sensitive, so `**/*.md` passes over
  // `docs/NOTES.MD` although the server lists it. A quirk of the matcher,
  // kept, since the point of the port is to give the server's answer.
  it("makes the default patterns pass every listed path but an upper-case .MD", () => {
    const root = makeTree(fixture.tree);
    const listing = new Listing(root);
    const expected = fixture.listed.filter((p) => p !== "docs/NOTES.MD");

    expect(fixture.listed).toContain("docs/NOTES.MD");
    expect(listCandidates(listing, config)).toEqual(expected);
    for (const path of Object.keys(fixture.tree)) {
      expect(isCandidate(listing, config, path), path).toBe(
        expected.includes(path),
      );
    }
  });
});

describe("the listing's own rules", () => {
  it("holds DefaultExcludeDirs equal to the server's", () => {
    const source = readFileSync(
      join(REPO, "internal", "config", "config.go"),
      "utf8",
    );
    const block = /var DefaultExcludeDirs = \[\]string\{([\s\S]*?)\n\}/.exec(
      source,
    )?.[1];
    expect(block).toBeDefined();
    const names = [...(block ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    expect([...DEFAULT_EXCLUDE_DIRS]).toEqual(names);
  });

  it("skips a symlinked file and never follows a symlinked directory", () => {
    const root = makeTree({
      "real/doc.md": "# Real\n",
      "keep.md": "# Keep\n",
    });
    symlinkSync(join(root, "keep.md"), join(root, "link.md"));
    symlinkSync(join(root, "real"), join(root, "linked-dir"));
    const listing = new Listing(root);

    expect(listing.list()).toEqual(["keep.md", "real/doc.md"]);
    expect(listing.isListed("link.md")).toBe(false);
    expect(listing.isListed("linked-dir/doc.md")).toBe(false);
  });

  it("filters candidates through [planning] include and exclude", () => {
    const root = makeTree({
      "roadmap.md": "# Roadmap\n",
      "docs/a.md": "# A\n",
      "docs/gallery/b.md": "# B\n",
      "notes/c.md": "# C\n",
    });
    const listing = new Listing(root);
    const narrowed = {
      ...config,
      include: ["docs/**"],
      exclude: ["docs/gallery/**"],
    };

    // The roadmap is a candidate whatever the patterns say (Plan Q2).
    expect(listCandidates(listing, narrowed)).toEqual([
      "docs/a.md",
      "roadmap.md",
    ]);
    expect(isCandidate(listing, narrowed, "docs/gallery/b.md")).toBe(false);
    expect(isCandidate(listing, narrowed, "roadmap.md")).toBe(true);
    expect(isCandidate(listing, narrowed, "notes/c.md")).toBe(false);
  });

  it("refuses a path that is not a plain repo-relative one", () => {
    const listing = new Listing(makeTree({ "a.md": "# A\n" }));

    for (const path of ["", "./a.md", "../a.md", "x//a.md", "missing.md"]) {
      expect(listing.isListed(path), path).toBe(false);
    }
  });
});

describe("readCandidate", () => {
  it("returns the text of a readable file", () => {
    const root = makeTree({ "a.md": "﻿# A\n" });

    // The byte order mark stays, as the server sends a file's bytes as-is.
    expect(readCandidate(root, "a.md", 100)).toEqual({
      kind: "file",
      path: "a.md",
      content: "﻿# A\n",
    });
  });

  it("skips a file over the limit without opening it", () => {
    const root = makeTree({ "big.md": "x".repeat(11) });
    // Unreadable to anyone but root: a read would fail, so `skipped` proves it
    // was never opened.
    chmodSync(join(root, "big.md"), 0o000);

    expect(readCandidate(root, "big.md", 10)).toEqual({
      kind: "skipped",
      path: "big.md",
      size: 11,
    });
    expect(readCandidate(root, "big.md", 11).kind).not.toBe("skipped");
  });

  it("refuses bytes that are not UTF-8", () => {
    const root = makeTree({ "latin1.md": "" });
    writeFileSync(join(root, "latin1.md"), Buffer.from([0x23, 0x20, 0xe9]));

    expect(readCandidate(root, "latin1.md", 100)).toEqual({
      kind: "unreadable",
      path: "latin1.md",
      reason: "not UTF-8",
    });
  });

  it("calls a missing file absent", () => {
    expect(readCandidate(makeTree({}), "gone.md", 100)).toEqual({
      kind: "absent",
      path: "gone.md",
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    "calls a file it may not read unreadable, never absent",
    () => {
      const root = makeTree({ "locked.md": "# Locked\n" });
      chmodSync(join(root, "locked.md"), 0o000);

      expect(readCandidate(root, "locked.md", 100)).toEqual({
        kind: "unreadable",
        path: "locked.md",
        reason: "permission denied",
      });
    },
  );
});
