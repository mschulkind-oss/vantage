import { describe, it, expect } from "vitest";
import { bookmarkTargetFromRoute } from "./bookmarkTarget";

describe("bookmarkTargetFromRoute", () => {
  describe("single-repo", () => {
    it("uses the whole route as the path", () => {
      expect(bookmarkTargetFromRoute("docs/a.md", false)).toEqual({
        repo: "",
        path: "docs/a.md",
      });
    });

    it("has no target at the root", () => {
      expect(bookmarkTargetFromRoute("", false)).toBeNull();
      expect(bookmarkTargetFromRoute(undefined, false)).toBeNull();
    });
  });

  describe("daemon", () => {
    // The case the store cannot answer: a retired repo leaves currentRepo
    // cleared and the whole route in currentPath.
    it("splits the repo off the front", () => {
      expect(bookmarkTargetFromRoute("beta/b.md", true)).toEqual({
        repo: "beta",
        path: "b.md",
      });
    });

    it("keeps nested paths intact", () => {
      expect(bookmarkTargetFromRoute("beta/docs/guides/a.md", true)).toEqual({
        repo: "beta",
        path: "docs/guides/a.md",
      });
    });

    it("has no target for a repo root or the picker", () => {
      expect(bookmarkTargetFromRoute("beta", true)).toBeNull();
      expect(bookmarkTargetFromRoute("", true)).toBeNull();
    });
  });

  it("ignores empty segments from stray slashes", () => {
    expect(bookmarkTargetFromRoute("/docs//a.md/", false)).toEqual({
      repo: "",
      path: "docs/a.md",
    });
  });
});
