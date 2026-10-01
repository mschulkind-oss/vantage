import { describe, expect, it } from "vitest";
import { pickPreviousRelease } from "./previousRelease";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [0.8.0] - 2026-09-30",
  "",
  "Being prepared.",
  "",
  "## [0.7.1] - 2026-09-27",
  "",
  "## [0.7.0] - 2026-09-23",
  "",
  "## 0.6.x",
  "",
].join("\n");

const PUBLISHED = ["0.1.7", "0.6.2", "0.7.0", "0.7.1"];

describe("pickPreviousRelease", () => {
  it("takes the newest release tag npm has, ignoring every other kind of tag", () => {
    expect(
      pickPreviousRelease({
        tags: [
          "v0.6.2",
          "v0.7.1",
          "v0.7.0",
          "vantage-check@0.9.0",
          "v0.9.0-rc.1",
        ],
        changelog: CHANGELOG,
        published: PUBLISHED,
      }),
    ).toEqual({
      kind: "found",
      version: "0.7.1",
      source: "the newest release tag",
      unpublished: [],
    });
  });

  it("orders by version, not by text", () => {
    const picked = pickPreviousRelease({
      tags: ["v0.9.0", "v0.10.0"],
      changelog: "",
      published: ["0.9.0", "0.10.0"],
    });
    expect(picked).toMatchObject({ kind: "found", version: "0.10.0" });
  });

  it("passes over a tag whose publish has not reached npm yet, and says so", () => {
    expect(
      pickPreviousRelease({
        tags: ["v0.7.1", "v0.8.0"],
        changelog: CHANGELOG,
        published: PUBLISHED,
      }),
    ).toEqual({
      kind: "found",
      version: "0.7.1",
      source: "the newest release tag",
      unpublished: ["0.8.0"],
    });
  });

  it("reads CHANGELOG.md when the clone has no release tags, skipping the section being prepared", () => {
    expect(
      pickPreviousRelease({
        tags: [],
        changelog: CHANGELOG,
        published: PUBLISHED,
      }),
    ).toEqual({
      kind: "found",
      version: "0.7.1",
      source: "CHANGELOG.md",
      unpublished: ["0.8.0"],
    });
  });

  it("takes a version asked for by name, with or without its v", () => {
    for (const requested of ["0.7.0", "v0.7.0"]) {
      expect(
        pickPreviousRelease({
          tags: ["v0.7.1"],
          changelog: CHANGELOG,
          published: PUBLISHED,
          requested,
        }),
      ).toMatchObject({ kind: "found", version: "0.7.0", source: "asked for" });
    }
  });

  it("treats an empty request as no request, which is what the recipe passes by default", () => {
    expect(
      pickPreviousRelease({
        tags: ["v0.7.1"],
        changelog: CHANGELOG,
        published: PUBLISHED,
        requested: "",
      }),
    ).toMatchObject({ kind: "found", version: "0.7.1" });
  });

  it("refuses a version npm does not have, or one that is not a release", () => {
    const base = { tags: [], changelog: CHANGELOG, published: PUBLISHED };
    expect(pickPreviousRelease({ ...base, requested: "0.8.0" })).toEqual({
      kind: "none",
      reason: "vantage-md@0.8.0 is not on npm",
    });
    expect(pickPreviousRelease({ ...base, requested: "latest" })).toMatchObject(
      {
        kind: "none",
      },
    );
  });

  it("finds nothing when neither list names a published version", () => {
    expect(
      pickPreviousRelease({
        tags: [],
        changelog: "# Changelog\n",
        published: PUBLISHED,
      }),
    ).toMatchObject({ kind: "none" });
    expect(
      pickPreviousRelease({
        tags: ["v9.0.0"],
        changelog: "",
        published: PUBLISHED,
      }),
    ).toEqual({
      kind: "none",
      reason:
        "npm has none of the versions the newest release tag names (9.0.0)",
    });
  });
});
