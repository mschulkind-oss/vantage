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
});
