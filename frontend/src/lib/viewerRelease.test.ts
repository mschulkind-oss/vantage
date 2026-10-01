import { describe, it, expect } from "vitest";
import { releaseFrom, VIEWER_RELEASE } from "./viewerRelease";

describe("releaseFrom", () => {
  // Only a plain X.Y.Z is a release, with or without the `v` a tag carries.
  // Anything else is a development build, which names no release
  // (docs/design/checker-version-skew.md §4.2, §5).
  it.each([
    ["0.8.0", "0.8.0"],
    ["v0.8.0", "0.8.0"],
    ["10.20.3", "10.20.3"],
  ])("reads %j as the release %j", (raw, release) => {
    expect(releaseFrom(raw)).toBe(release);
  });

  it.each([
    undefined,
    "",
    "dev",
    "0.8",
    "0.8.0.1",
    "0.08.0",
    "vv0.8.0",
    "0.9.0-rc.1",
    "v0.8.1-0.20260930120000-abcdef123456",
    "0.8.0+dirty",
    " 0.8.0",
  ])("reads %j as a development build", (raw) => {
    expect(releaseFrom(raw)).toBeUndefined();
  });
});

describe("VIEWER_RELEASE", () => {
  // The tests build nothing, so nothing baked a release in: a development
  // build, whose payload names no release.
  it("is undefined outside a release build", () => {
    expect(VIEWER_RELEASE).toBeUndefined();
  });
});
