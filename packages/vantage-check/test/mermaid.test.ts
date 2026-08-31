import { describe, expect, it } from "vitest";
import { classify } from "../src/rules/mermaid.js";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

/**
 * The delegate the design warns about. Mermaid's grammar works headless but
 * its sanitisation step does not, so a naive `try { mermaid.parse() } catch`
 * reports every valid flowchart in a repository as broken.
 *
 * The first test here is the one that matters: valid diagrams, of the kinds
 * this project actually writes, must produce nothing at all.
 */
describe("mermaid/parse", () => {
  it("says nothing about diagrams that are valid", async () => {
    const root = makeTree({
      "index.md": [
        "```mermaid",
        "flowchart TD",
        '    client["Client (React SPA)"] -->|WebSocket| srv["Server (Go)"]',
        "```",
        "",
        "```mermaid",
        "sequenceDiagram",
        "    Alice->>John: Hello",
        "```",
        "",
        "```mermaid",
        "stateDiagram-v2",
        "    [*] --> Still",
        "```",
      ].join("\n"),
    });

    const report = await checkTree(root);

    expect(report.findings).toEqual([]);
    expect(report.failures).toEqual([]);
  });

  it("reports an unquoted label, which is the style guide's own example", async () => {
    const root = makeTree({
      "index.md": [
        "# Title",
        "",
        "```mermaid",
        "flowchart TD",
        "    a[Client (React SPA)] --> b[Server]",
        "```",
      ].join("\n"),
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["mermaid/parse"]);
    expect(report.failures).toEqual([]);
    // Line 3 opens the fence, so the offending line 2 of the diagram is line 5.
    expect(report.findings[0]?.line).toBe(5);
    expect(report.findings[0]?.detail).toContain("Parse error on line 2");
  });

  it("reports a diagram type mermaid does not know", async () => {
    const root = makeTree({
      "index.md": ["```mermaid", "flowhcart TD", "  a --> b", "```"].join("\n"),
    });

    expect(ruleIds(await checkTree(root))).toEqual(["mermaid/parse"]);
  });

  it("leaves other fenced languages alone", async () => {
    const root = makeTree({
      "index.md": ["```ts", "flowchart TD", "  a[Bad (label)]", "```"].join(
        "\n",
      ),
    });

    expect(ruleIds(await checkTree(root))).toEqual([]);
  });
});

describe("classification", () => {
  it("treats a jison grammar error as a verdict on the document", () => {
    const error = Object.assign(new Error("Parse error on line 2:\n..."), {
      hash: {},
    });

    expect(classify(error, "")).toMatchObject({ kind: "document", line: 2 });
  });

  it("treats a Langium grammar error as a verdict on the document", () => {
    const error = new Error(
      "Parsing failed: unexpected character: ->(<- at offset: 29",
    );

    expect(
      classify(error, "architecture-beta\n  group api(cloud[API]"),
    ).toMatchObject({
      kind: "document",
      line: 2,
    });
  });

  it("treats an unknown diagram type as a verdict on the document", () => {
    const error = Object.assign(
      new Error(
        "No diagram type detected matching given configuration for text: x",
      ),
      { name: "UnknownDiagramError" },
    );

    expect(classify(error, "")).toMatchObject({ kind: "document" });
  });

  // The measured trap: this is what a *valid* flowchart throws when mermaid
  // runs without a DOM. Reporting it as a finding would condemn every correct
  // diagram in the tree.
  it("treats the headless DOMPurify failure as an environment failure", () => {
    const error = new TypeError("DOMPurify.addHook is not a function");

    expect(classify(error, "")).toMatchObject({ kind: "environment" });
  });

  it("treats anything else it does not recognise as an environment failure", () => {
    expect(
      classify(new ReferenceError("document is not defined"), ""),
    ).toMatchObject({ kind: "environment" });
  });
});
