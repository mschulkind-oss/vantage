import { describe, it, expect } from "vitest";
import { starredHref } from "./starredLinks";
import type { StarredEntry } from "../types";

const entry = (over: Partial<StarredEntry> = {}): StarredEntry => ({
  repo: "",
  path: "docs/a.md",
  is_dir: false,
  starred_at: "2026-09-20T12:00:00Z",
  ...over,
});

describe("starredHref", () => {
  it("omits the repo segment for the single-repo sentinel", () => {
    expect(starredHref(entry())).toBe("/docs/a.md");
  });

  it("includes the repo segment in daemon mode", () => {
    expect(starredHref(entry({ repo: "alpha", path: "a.md" }))).toBe(
      "/alpha/a.md",
    );
  });

  it("links a directory the same way", () => {
    expect(starredHref(entry({ path: "docs", is_dir: true }))).toBe("/docs");
  });

  // Filenames may hold characters the address bar reads as structure. Left
  // raw, "docs/#todo.md" arrives as a fragment on "/docs/" and opens the wrong
  // thing entirely.
  it("encodes characters that would otherwise change the URL's meaning", () => {
    expect(starredHref(entry({ path: "docs/#todo.md" }))).toBe(
      "/docs/%23todo.md",
    );
    expect(starredHref(entry({ path: "docs/a?b.md" }))).toBe("/docs/a%3Fb.md");
  });

  it("keeps the separators as separators", () => {
    expect(starredHref(entry({ path: "a/b/c.md" }))).toBe("/a/b/c.md");
  });

  it("encodes a space the same way the rest of the app does", () => {
    expect(starredHref(entry({ path: "my notes.md" }))).toBe("/my%20notes.md");
  });

  it("encodes the repo segment too", () => {
    expect(starredHref(entry({ repo: "my repo", path: "a.md" }))).toBe(
      "/my%20repo/a.md",
    );
  });
});
