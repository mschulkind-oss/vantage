import { describe, expect, it } from "vitest";
import { projectFor } from "./cloneLinks";

// The loose project — the one holding the Markdown beside a directory of
// clones — refuses every path inside a clone, because each clone is a project
// of its own (docs/design/serve-clones-directory.md §3). A link or image from a
// loose note into a clone is sent to the clone's project instead.
describe("projectFor", () => {
  const clones = { alpha: "alpha", code: "code-2", link: "alpha" };

  it("sends a path whose first folder is a clone to that clone's project", () => {
    expect(projectFor("code", "alpha/README.md", clones)).toEqual({
      repo: "alpha",
      path: "README.md",
    });
    expect(projectFor("code", "alpha/docs/guide.md", clones)).toEqual({
      repo: "alpha",
      path: "docs/guide.md",
    });
    // A clone named like the directory holding it is served under its suffix.
    expect(projectFor("code", "code/x.md", clones)).toEqual({
      repo: "code-2",
      path: "x.md",
    });
    // So is a symlink to a clone.
    expect(projectFor("code", "link/a.md", clones)).toEqual({
      repo: "alpha",
      path: "a.md",
    });
  });

  it("resolves . and .. before deciding", () => {
    expect(projectFor("code", "drafts/../alpha/./README.md", clones)).toEqual({
      repo: "alpha",
      path: "README.md",
    });
    expect(projectFor("code", "./alpha/README.md", clones)).toEqual({
      repo: "alpha",
      path: "README.md",
    });
  });

  it("names the clone's root for a link to the clone itself", () => {
    expect(projectFor("code", "alpha", clones)).toEqual({
      repo: "alpha",
      path: "",
    });
    expect(projectFor("code", "alpha/", clones)).toEqual({
      repo: "alpha",
      path: "",
    });
  });

  it("leaves every other path where it is, untouched", () => {
    expect(projectFor("code", "drafts/idea.md", clones)).toEqual({
      repo: "code",
      path: "drafts/idea.md",
    });
    expect(projectFor("code", "notes/alpha/x.md", clones)).toEqual({
      repo: "code",
      path: "notes/alpha/x.md",
    });
    expect(projectFor("code", "../outside.md", clones)).toEqual({
      repo: "code",
      path: "../outside.md",
    });
    expect(projectFor("alpha", "alpha/x.md", undefined)).toEqual({
      repo: "alpha",
      path: "alpha/x.md",
    });
  });
});
