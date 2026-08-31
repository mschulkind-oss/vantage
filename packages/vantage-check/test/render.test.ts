import { describe, expect, it } from "vitest";
import { Settings } from "../src/core/settings.js";
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

function offFor(rule: string): Settings {
  return new Settings(new Map<string, RuleSetting>([[rule, "off"]]));
}
