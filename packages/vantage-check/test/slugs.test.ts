import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../vantage-md/src/renderMarkdown.js";
import { parseMarkdown } from "../src/core/document.js";
import {
  documentAnchors,
  headingSlugs,
  indexDocument,
  nearestAnchor,
  numberedHeadings,
} from "../src/core/slugs.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

/**
 * Section slugs are not reasonable to guess. An em dash leaves two hyphens, a
 * trailing colon leaves none, a repeated heading gets a numeric suffix — and
 * getting one of those wrong invents a dead-anchor finding for a link that
 * works.
 *
 * So this does not assert slugs we wrote down by hand. It renders with the real
 * pipeline and asserts that what we compute is character-for-character what
 * rehype-slug put in the HTML. If the renderer's slugging ever changes, this
 * fails rather than the checker quietly lying.
 */
const HEADINGS = [
  "# Title",
  "",
  "## 5. `check` — delegate everything we can",
  "",
  "### Trailing colon:",
  "",
  "#### Emphasis *and* **bold**",
  "",
  "##### 100% done!",
  "",
  "###### Foo <span>bar</span>",
  "",
  "## ![diagram](./x.png) With an image",
  "",
  "## Title",
  "",
  "## Title",
].join("\n");

async function renderedHeadingIds(markdown: string): Promise<string[]> {
  const { html } = await renderMarkdown(markdown);
  return [...html.matchAll(/<h[1-6][^>]*\bid="([^"]*)"/g)].map(
    (match) => match[1] as string,
  );
}

describe("headingSlugs", () => {
  it("matches the ids rehype-slug puts in the rendered HTML", async () => {
    expect(headingSlugs(parseMarkdown(HEADINGS))).toEqual(
      await renderedHeadingIds(HEADINGS),
    );
  });

  it("gets the em-dash case right, which is the one people hand-derive wrongly", () => {
    expect(headingSlugs(parseMarkdown("## 5. `check` — delegate it"))).toEqual([
      "5-check--delegate-it",
    ]);
  });

  it("numbers repeated headings the way the renderer does", () => {
    expect(headingSlugs(parseMarkdown("# A\n\n# A\n\n# A"))).toEqual([
      "a",
      "a-1",
      "a-2",
    ]);
  });
});

describe("documentAnchors", () => {
  it("includes ids written by hand in raw HTML", () => {
    const anchors = documentAnchors(
      parseMarkdown(
        '# Title\n\n<a id="notes"></a>\n\n<div name="legacy">x</div>',
      ),
    );

    expect([...anchors].sort()).toEqual(["legacy", "notes", "title"]);
  });
});

describe("indexDocument", () => {
  // The invariant that makes one pass worth having: `github-slugger` is
  // stateful, so a number resolved against one slugging and a link checked
  // against another could disagree about `#a-1`. Sharing the pass is what makes
  // that impossible rather than merely unlikely.
  it("numbers a repeated heading once, for both answers", () => {
    const tree = parseMarkdown("## 4.1 A\n\n## 4.1 A\n\n## 4.2 B");
    const index = indexDocument(tree);

    expect(index.slugs).toEqual(["41-a", "41-a-1", "42-b"]);
    // First number wins, and the slug it names is the one the anchors hold.
    expect([...index.numbered]).toEqual([
      ["4.1", "41-a"],
      ["4.2", "42-b"],
    ]);
    for (const slug of index.numbered.values()) {
      expect(index.anchors.has(slug)).toBe(true);
    }
  });

  it("is what the three single-answer helpers return", () => {
    const tree = parseMarkdown(
      '# Title\n\n## 2. Second\n\n<a id="notes"></a>\n',
    );
    const index = indexDocument(tree);

    expect(headingSlugs(tree)).toEqual(index.slugs);
    expect(documentAnchors(tree)).toEqual(index.anchors);
    expect(numberedHeadings(tree)).toEqual(index.numbered);
  });
});

describe("nearestAnchor", () => {
  it("suggests a near miss", () => {
    expect(nearestAnchor("system-architectur", ["system-architecture"])).toBe(
      "system-architecture",
    );
  });

  it("suggests nothing when nothing is close", () => {
    expect(nearestAnchor("usage", ["system-architecture"])).toBeUndefined();
  });
});

describe("open question anchors", () => {
  const OQ = '<!-- vantage: oq id=OQ-4 leaning="Yes." -->';

  it("counts a well-formed oq id as a link target", async () => {
    const root = makeTree({
      "docs/index.md": `# Anchors\n\n${OQ}\n\nA question.\n\nSee [OQ-4](#OQ-4).\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("resolves one across documents", async () => {
    const root = makeTree({
      "docs/index.md": "See [OQ-4](./questions.md#OQ-4).\n",
      "docs/questions.md": `# Questions\n\n${OQ}\n\nA question.\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("still reports a fragment no oq declares", async () => {
    const root = makeTree({
      "docs/index.md": `# Anchors\n\n${OQ}\n\nA question.\n\nSee [OQ-9](#OQ-9).\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["link/dead-section-anchor"]);
    expect(report.findings[0]?.message).toContain("#OQ-4");
  });

  // The sanitizer refuses a malformed id, so it reaches no `id` attribute and
  // the fragment navigates nowhere. Counting it here would call a dead link
  // live — the one direction the checker must not err in.
  it("does not count a malformed id", async () => {
    const root = makeTree({
      "docs/index.md":
        '# Anchors\n\n<!-- vantage: oq id=OQ-nope leaning="Yes." -->\n\nA question.\n\nSee [OQ-nope](#OQ-nope).\n',
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toContain("link/dead-section-anchor");
  });

  it("leaves heading slugs alone", async () => {
    const root = makeTree({
      "docs/index.md": `# Anchors\n\n## Open questions\n\n${OQ}\n\nA question.\n\nSee [the list](#open-questions).\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });
});
