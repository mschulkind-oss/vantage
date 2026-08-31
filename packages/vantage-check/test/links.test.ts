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

/**
 * The format half of "the anchor is correct, the line exists, the doc exists".
 *
 * Every near miss in here was checked against the viewer's own code before it
 * was left out — see the comment on `malformedLineAnchor` for the list. The
 * tests below pin the two that are easiest to "fix" into false positives: a
 * lowercase `#l42`, which is a real heading slug, and an uppercase fragment
 * that a hand-written HTML id makes resolve.
 */
describe("link/line-anchor-format", () => {
  const source = ["one", "two", "three", "four", "five"].join("\n");

  it("fires on line anchors the viewer cannot parse", async () => {
    const root = makeTree({
      "index.md": [
        "[Bare](./code.go#L)",
        "[Typo](./code.go#L4x)",
        "[Half](./code.go#L2-)",
        "[HalfL](./code.go#L2-L)",
        "[Both](./code.go#L2-L4x)",
      ].join("\n\n"),
      "code.go": source,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([
      "link/line-anchor-format",
      "link/line-anchor-format",
      "link/line-anchor-format",
      "link/line-anchor-format",
      "link/line-anchor-format",
    ]);
    expect(report.findings[1]?.message).toContain("#L4x");
    expect(report.findings[1]?.message).toContain("`#L42-L50`");
  });

  it("says nothing about the spellings the viewer does parse", async () => {
    const root = makeTree({
      "index.md": [
        "[One](./code.go#L2)",
        "[Range](./code.go#L2-L4)",
        "[Short](./code.go#L2-4)",
        "[Padded](./code.go#L002)",
      ].join("\n\n"),
      "code.go": source,
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  // The judgement call, pinned to the viewer: `#l42` is not a line anchor
  // (parseLineAnchor wants an uppercase L), but it *is* the slug of a heading
  // called "L42", so the link resolves and must not be a format finding.
  it("leaves a lowercase #l42 alone, because a heading can own that slug", async () => {
    expect(parseLineAnchor("#l42")).toBeNull();

    const root = makeTree({
      "index.md": "[Line](./target.md#l42)\n",
      "target.md": "# Target\n\n## L42\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  // ...and when no heading owns it, the existing rule speaks, in words that
  // suit a slug rather than a line anchor.
  it("leaves a dead lowercase #l42 to the dead-anchor rule", async () => {
    const root = makeTree({
      "index.md": "[Line](./target.md#l42)\n",
      "target.md": "# Target\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual([
      "link/dead-section-anchor",
    ]);
  });

  // rehype-sanitize rewrites a hand-written id to `user-content-<id>` and the
  // viewer looks up both spellings, so this link works even though nothing
  // could ever slug to it.
  it("accepts an anchor a hand-written HTML id makes resolve", async () => {
    const root = makeTree({
      "index.md": "[Marked](./target.md#L42-cache)\n",
      "target.md": '# Target\n\n<a id="L42-cache"></a>\n',
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("does not mistake ordinary slugs starting with L for line anchors", async () => {
    const root = makeTree({
      "index.md": "[Load](./target.md#load-balancing) [Miss](./api.go#Lorem)\n",
      "target.md": "# Target\n\n## Load balancing\n",
      "api.go": "package main\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  // A directory has no lines for an anchor to name, so the anchor's shape is
  // not the interesting thing about that link.
  it("says nothing about a fragment on a directory", async () => {
    const root = makeTree({
      "index.md": "[Sub](./sub#L4x)\n",
      "sub/deep.md": "# Deep\n",
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });

  it("checks same-document fragments too", async () => {
    const root = makeTree({ "index.md": "# Title\n\n[Here](#L1x)\n" });

    expect(ruleIds(await checkTree(root))).toEqual(["link/line-anchor-format"]);
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
