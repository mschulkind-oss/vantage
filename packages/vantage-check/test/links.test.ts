import { describe, expect, it } from "vitest";
// The viewer's own parser, so a test that claims "the viewer resolves this"
// is asking the viewer rather than restating what we believe about it.
import { parseLineAnchor } from "../../vantage-md/src/lineAnchor.js";
import { exitCodeFor } from "../src/commands/check.js";
import { EXIT_OK } from "../src/exit.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

describe("link/leading-slash", () => {
  it("fires on a leading-slash target", async () => {
    const root = makeTree({
      "docs/index.md": "[Guide](/docs/guide.md)\n",
      "docs/guide.md": "# Guide\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["link/leading-slash"]);
  });

  it("suggests the relative path that would have worked", async () => {
    const root = makeTree({
      ".vantage.toml": "\n",
      "docs/index.md": "[Guide](/docs/guide.md)\n",
      "docs/guide.md": "# Guide\n",
    });

    const report = await checkTree(root);

    expect(report.findings[0]?.message).toContain("Write `./guide.md`");
  });

  it("says nothing extra when the target is not there to suggest", async () => {
    const root = makeTree({
      ".vantage.toml": "\n",
      "docs/index.md": "[Guide](/nowhere/guide.md)\n",
    });

    const report = await checkTree(root);

    expect(report.findings[0]?.message).not.toContain("Write `");
  });
});

describe("link/uri-scheme", () => {
  it("fires on a file:// URI", async () => {
    const root = makeTree({
      "index.md": "[Guide](file:///workspace/docs/guide.md)\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual(["link/uri-scheme"]);
  });

  it("fires on a Windows drive letter", async () => {
    const root = makeTree({ "index.md": "[Guide](C:\\docs\\guide.md)\n" });

    expect(ruleIds(await checkTree(root))).toEqual(["link/uri-scheme"]);
  });

  it("leaves web and mail links alone", async () => {
    const root = makeTree({
      "index.md": [
        "[Site](https://example.com/docs/guide.md)",
        "[Mail](mailto:someone@example.com)",
        "[Auto](<https://example.com/x>)",
        "[Editor](vscode://file/x)",
      ].join("\n\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });
});

describe("link/missing-target", () => {
  it("fires when the file is not there", async () => {
    const root = makeTree({ "docs/index.md": "[Other](./other.md)\n" });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["link/missing-target"]);
    expect(report.findings[0]?.message).toContain("./other.md");
  });

  it("accepts a file that is there, however it is spelled", async () => {
    const root = makeTree({
      "docs/index.md": [
        "[Bare](other.md)",
        "[Dotted](./other.md)",
        "[Parent](../top.md)",
        "[Nested](sub/deep.md)",
        "[Encoded](./with%20space.md)",
        "[Directory](./sub)",
      ].join("\n\n"),
      "docs/other.md": "# Other\n",
      "docs/with space.md": "# Spaced\n",
      "docs/sub/deep.md": "# Deep\n",
      "top.md": "# Top\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("checks images and reference definitions too", async () => {
    const root = makeTree({
      "index.md": ["![Diagram](./missing.png)", "", "[ref]: ./gone.md"].join(
        "\n",
      ),
    });

    expect(ruleIds(await checkTree(root))).toEqual([
      "link/missing-target",
      "link/missing-target",
    ]);
  });

  // The obvious way to get link rules wrong: a text search finds link syntax
  // inside code, where it is a code sample rather than a link.
  it("ignores link syntax inside inline code and fenced blocks", async () => {
    const root = makeTree({
      "index.md": [
        "Never write `[Doc](/docs/guide.md)` in a document.",
        "",
        "```markdown",
        "[Doc](/docs/guide.md)",
        "[Other](./nowhere.md)",
        "```",
      ].join("\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });
});

describe("link/line-anchor-range", () => {
  const source = ["one", "two", "three", "four", "five"].join("\n");

  it("accepts an anchor inside the file", async () => {
    const root = makeTree({
      "index.md": "[Code](./code.go#L2-L4) and [One](./code.go#L1)\n",
      "code.go": source,
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("accepts the #L2-4 spelling the viewer also accepts", async () => {
    const root = makeTree({
      "index.md": "[Code](./code.go#L2-4)\n",
      "code.go": source,
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("fires when the range runs off the end", async () => {
    const root = makeTree({
      "index.md": "[Code](./code.go#L4-L400)\n",
      "code.go": source,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["link/line-anchor-range"]);
    expect(report.findings[0]?.message).toContain("5 lines");
  });

  it("does not count a trailing newline as one more line", async () => {
    const root = makeTree({
      "index.md": "[Code](./code.go#L5)\n",
      "code.go": `${source}\n`,
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("checks same-file anchors against this file", async () => {
    const root = makeTree({ "index.md": "[Up](#L1)\n[Off](#L900)\n" });

    expect(ruleIds(await checkTree(root))).toEqual(["link/line-anchor-range"]);
  });
});

/**
 * An inverted range is a warning on purpose, and this is the pin.
 *
 * `parseLineAnchor` normalises with Math.min/Math.max, so `#L4-L2` highlights
 * lines 2–4 in the viewer: the link *works*. A working link must never fail a
 * run — but it is still almost certainly a typo, so it is not silence either.
 */
describe("link/inverted-range", () => {
  const source = ["one", "two", "three", "four", "five"].join("\n");

  it("is what the viewer does with an inverted range", () => {
    expect(parseLineAnchor("#L4-L2")).toEqual({ start: 2, end: 4 });
  });

  it("warns rather than erroring, so the run still passes", async () => {
    const root = makeTree({
      "index.md": "[Code](./code.go#L4-L2)\n",
      "code.go": source,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["link/inverted-range"]);
    expect(report.findings[0]?.severity).toBe("warning");
    expect(report.findings[0]?.message).toContain("is inverted");
    expect(exitCodeFor(report)).toBe(EXIT_OK);
  });

  it("still reports the range error when the range also runs off the end", async () => {
    const root = makeTree({
      "index.md": "[Code](./code.go#L900-L2)\n",
      "code.go": source,
    });

    expect(ruleIds(await checkTree(root))).toEqual([
      "link/inverted-range",
      "link/line-anchor-range",
    ]);
  });
});

describe("link/dead-section-anchor", () => {
  const target = [
    "# Overview",
    "",
    "## System architecture",
    "",
    "## 5. `check` — delegate everything we can",
    "",
    '<a id="hand-written"></a>',
  ].join("\n");

  it("accepts anchors that match a heading", async () => {
    const root = makeTree({
      "index.md": [
        "[Arch](./overview.md#system-architecture)",
        "[Section](./overview.md#5-check--delegate-everything-we-can)",
        "[Manual](./overview.md#hand-written)",
      ].join("\n\n"),
      "overview.md": target,
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("fires on an anchor that matches nothing, and suggests the near miss", async () => {
    const root = makeTree({
      "index.md": "[Arch](./overview.md#system-architectur)\n",
      "overview.md": target,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["link/dead-section-anchor"]);
    expect(report.findings[0]?.message).toContain(
      "Did you mean `#system-architecture`?",
    );
  });

  it("checks same-document anchors", async () => {
    const root = makeTree({
      "index.md": ["# Title", "", "[Here](#title)", "[Gone](#nowhere)"].join(
        "\n",
      ),
    });

    expect(ruleIds(await checkTree(root))).toEqual([
      "link/dead-section-anchor",
    ]);
  });

  it("says nothing about fragments on files it cannot slug", async () => {
    const root = makeTree({
      "index.md": "[Handler](./api.go#handleRequest)\n",
      "api.go": "package main\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });
});

describe("positions", () => {
  it("reports the line in the file, not in the frontmatter-stripped body", async () => {
    const root = makeTree({
      "index.md": [
        "---",
        'title: "Doc"',
        "tags: [a, b]",
        "---",
        "",
        "# Title",
        "",
        "[Gone](./nowhere.md)",
      ].join("\n"),
    });

    const report = await checkTree(root);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.line).toBe(8);
    expect(report.findings[0]?.column).toBe(1);
  });
});
