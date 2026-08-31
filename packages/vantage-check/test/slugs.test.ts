import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../vantage-md/src/renderMarkdown.js";
import { parseMarkdown } from "../src/core/document.js";
import {
  documentAnchors,
  headingSlugs,
  nearestAnchor,
} from "../src/core/slugs.js";

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
