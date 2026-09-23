import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../vantage-md/src/renderMarkdown.js";
import { Settings } from "../src/core/settings.js";
import { loadDocument } from "../src/core/document.js";
import type { RuleSetting } from "../src/core/types.js";
import { checkPipeline, type Render } from "../src/rules/render.js";
import { checkTree, collectorFor, makeTree } from "./helpers.js";

/**
 * The end-to-end backstop, and the delegate whose failure mode is the whole
 * point: if the pipeline ever stops running in this environment, every
 * document in the tree looks broken. So the canary comes first, and a pipeline
 * that cannot render a document we know is good reports *nothing* about
 * anybody's — it fails the run instead.
 *
 * A renderer is injected in the failure tests because the real pipeline is, by
 * design, extremely hard to make throw: remark and rehype recover from almost
 * anything a person can type, which is exactly why this rule is a backstop and
 * not a parser of its own. The first test below is the one that has to hold —
 * documents that render must produce silence.
 */

/** Renders the canary happily; throws on the document under test. */
const throwsOn =
  (needle: string, error: unknown): Render =>
  (content: string) =>
    content.includes(needle) ? Promise.reject(error) : Promise.resolve({});

describe("render/pipeline", () => {
  it("says nothing about a document the viewer really renders", async () => {
    const root = makeTree({
      "index.md": [
        "---",
        'title: "Everything"',
        "---",
        "",
        "# Everything at once",
        "",
        "Prose with `code`, a [link](./other.md) and $$E = mc^2$$.",
        "",
        "| Column | Value |",
        "| ------ | ----- |",
        "| one    | two   |",
        "",
        "```mermaid",
        "flowchart TD",
        '    a["Client (React SPA)"] --> b["Server"]',
        "```",
        "",
        '<div id="raw">raw html</div>',
      ].join("\n"),
      "other.md": "# Other\n",
    });

    const report = await checkTree(root);

    expect(report.findings).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  it("reports a document the pipeline throws on, in the pipeline's words", async () => {
    const root = makeTree({ "index.md": "# Title\n\nexplode here\n" });
    const collector = collectorFor(root, "index.md");

    await checkPipeline(
      collector,
      throwsOn("explode", new Error("boom: plugin exploded")),
    );

    expect(collector.findings).toHaveLength(1);
    expect(collector.failures).toEqual([]);
    expect(collector.findings[0]).toMatchObject({
      rule: "render/pipeline",
      severity: "error",
      line: 1,
      column: 1,
    });
    expect(collector.findings[0]?.detail).toContain("boom: plugin exploded");
  });

  // The one that keeps a broken environment from becoming everybody's broken
  // document.
  it("fails the run, with no findings, when the pipeline cannot run at all", async () => {
    const root = makeTree({ "index.md": "# Title\n" });
    const collector = collectorFor(root, "index.md");
    const dead: Render = () =>
      Promise.reject(new ReferenceError("document is not defined"));

    await checkPipeline(collector, dead);

    expect(collector.findings).toEqual([]);
    expect(collector.failures).toHaveLength(1);
    expect(collector.failures[0]?.rule).toBe("render/pipeline");
    expect(collector.failures[0]?.message).toContain("document is not defined");
  });

  // Positions out of the pipeline are relative to the body, because
  // renderMarkdown strips frontmatter before parsing.
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
        "explode here",
      ].join("\n"),
    });
    const collector = collectorFor(root, "index.md");
    const positioned = Object.assign(new Error("bad node"), {
      line: 4,
      column: 3,
    });

    await checkPipeline(collector, throwsOn("explode", positioned));

    expect(collector.findings[0]).toMatchObject({ line: 8, column: 3 });
  });

  it("stays quiet when the rule is turned off", async () => {
    const root = makeTree({ "index.md": "# Title\n\nexplode here\n" });
    const collector = collectorFor(root, "index.md", offFor("render/pipeline"));

    await checkPipeline(collector, throwsOn("explode", new Error("boom")));

    expect(collector.findings).toEqual([]);
    expect(collector.failures).toEqual([]);
  });
});

/**
 * The optimization the rule rests on: the pipeline is fed the tree
 * `loadDocument` already built, instead of parsing the same bytes twice.
 *
 * Both halves of the claim are tested here rather than in `vantage-md`, which
 * has no runner of its own — and this is the only caller that passes a tree, so
 * this is where a regression would actually bite.
 */
describe("rendering from an already-parsed body", () => {
  /** Frontmatter and one of everything the chain can trip over. */
  const DOCUMENT = [
    "---",
    'title: "Everything"',
    "tags: [a, b]",
    "---",
    "",
    "# Everything at once",
    "",
    "> [!NOTE]",
    "> An alert, which is markup rather than a broken reference.",
    "",
    "Prose with `code`, ~~strike~~, a [link](./other.md) and $$E = mc^2$$.",
    "",
    "| Column | Value |",
    "| ------ | ----- |",
    "| one    | two   |",
    "",
    "- [x] a task",
    "",
    "```ts",
    "export const x = 1;",
    "```",
    "",
    '<div id="raw">raw html</div>',
    "",
  ].join("\n");

  it("produces byte-identical HTML either way", async () => {
    const root = makeTree({ "index.md": DOCUMENT, "other.md": "# Other\n" });
    const doc = loadDocument("index.md", root);

    const fromString = await renderMarkdown(doc.text);
    const fromTree = await renderMarkdown(doc.text, { tree: doc.mdast });

    // Not "close enough": the checker's whole claim is that it renders through
    // the viewer's pipeline, so skipping the parse has to change nothing at
    // all — including the `data-source-line` numbers, which depend on the
    // frontmatter offset above.
    expect(fromTree.html).toBe(fromString.html);
    // And it really did render the whole chain, rather than agreeing about a
    // document neither of them got very far with.
    expect(fromTree.html).toContain('data-vantage-alert="note"');
    expect(fromTree.html).toContain("katex");
    // Line 23 of the *file*, four of which are frontmatter: the offset the
    // viewer's `#L` anchors depend on survives the shortcut.
    expect(fromTree.html).toContain(
      '<div id="user-content-raw" data-source-line="23">',
    );
  });

  it("leaves the tree as it found it, so a second reader sees the same document", async () => {
    const root = makeTree({ "index.md": DOCUMENT, "other.md": "# Other\n" });
    const doc = loadDocument("index.md", root);
    const before = JSON.stringify(doc.mdast);

    const first = await renderMarkdown(doc.text, { tree: doc.mdast });
    const second = await renderMarkdown(doc.text, { tree: doc.mdast });

    expect(JSON.stringify(doc.mdast)).toBe(before);
    expect(second.html).toBe(first.html);
  });

  it("hands the rule's own document tree to the renderer", async () => {
    const root = makeTree({ "index.md": DOCUMENT, "other.md": "# Other\n" });
    const collector = collectorFor(root, "index.md");
    const seen: { content?: string; tree?: unknown }[] = [];
    const spy: Render = (content, options) => {
      seen.push({ content, tree: options?.tree });
      return Promise.resolve({});
    };

    await checkPipeline(collector, spy);

    // The canary renders from a string; the document renders from its tree.
    const forDocument = seen.find(
      (call) => call.content === collector.doc.text,
    );
    expect(forDocument?.tree).toBe(collector.doc.mdast);
  });
});

function offFor(rule: string): Settings {
  return new Settings(new Map<string, RuleSetting>([[rule, "off"]]));
}
