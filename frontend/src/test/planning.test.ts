import { existsSync } from "node:fs";
import { repoPath } from "./planning";

describe("repoPath", () => {
  it("finds a file in this repository", () => {
    expect(existsSync(repoPath("docs/development.md"))).toBe(true);
  });

  // A URL's pathname percent-encodes a space, so a checkout under a directory
  // with one in its name once failed every suite that reads a document.
  it("names a file in a checkout whose path holds a space", () => {
    const from =
      "file:///home/dev/with%20space/vantage/frontend/src/test/planning.ts";

    expect(repoPath("docs/a b.md", from)).toBe(
      "/home/dev/with space/vantage/docs/a b.md",
    );
  });
});
