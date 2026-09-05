import { describe, expect, it } from "vitest";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

const OQ = '<!-- vantage: oq id=OQ-4 leaning="Yes." -->';

describe("ref/unlinked-oq", () => {
  it("fires on an id written as prose", async () => {
    const root = makeTree({
      "docs/index.md": `# Q\n\n${OQ}\n\nA question.\n\nWe still owe OQ-4 an answer.\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-oq"]);
  });

  it("accepts one linked to its own anchor", async () => {
    const root = makeTree({
      "docs/index.md": `# Q\n\n${OQ}\n\nA question.\n\nWe still owe [OQ-4](#OQ-4) an answer.\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("accepts one linked across documents", async () => {
    const root = makeTree({
      "docs/index.md": "Blocked on [`OQ-4`](./questions.md#OQ-4).\n",
      "docs/questions.md": `# Questions\n\n${OQ}\n\nA question.\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  // The link resolves to the document and stops there, which is the shape that
  // looks right in a diff and leaves the reader hunting.
  it("fires on a link that names no fragment", async () => {
    const root = makeTree({
      "docs/index.md": "Blocked on [`OQ-4`](./questions.md).\n",
      "docs/questions.md": `# Questions\n\n${OQ}\n\nA question.\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-oq"]);
    expect(report.findings[0]?.message).toContain("names no fragment");
  });

  it("finds one nested inside emphasis inside a link", async () => {
    const root = makeTree({
      "docs/index.md": `# Q\n\n${OQ}\n\nA question.\n\nSee [*the **OQ-4** ruling*](#OQ-4).\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  describe("definition sites are not references to themselves", () => {
    it("leaves a question declared by a directive alone", async () => {
      const root = makeTree({
        "docs/index.md": `# Q\n\n${OQ}\n\n**OQ-4: Should the gate stay fatal?**\n`,
      });

      const report = await checkTree(root);

      expect(ruleIds(report)).toEqual([]);
    });

    // 🔒 and ✅ questions carry no directive by convention, so the title is the
    // only thing marking them as a definition.
    it("leaves a bold title alone even with no directive", async () => {
      const root = makeTree({
        "docs/index.md":
          "# Q\n\n1. 🔒 **OQ-B7: One distribution or two? — MOVED.**\n\n   Blocked upstream.\n",
      });

      const report = await checkTree(root);

      expect(ruleIds(report)).toEqual([]);
    });

    // A compacted question lives in a ledger row; that row is the record, not a
    // reference to one.
    it("leaves a Decision Ledger's ID column alone", async () => {
      const root = makeTree({
        "docs/index.md":
          "# Q\n\n## Decision Ledger\n\n" +
          "| ID | Ruling | Date | Settled in |\n| :--- | :--- | :--- | :--- |\n" +
          "| OQ-4 | Back of the queue | 2026-09-04 | body |\n",
      });

      const report = await checkTree(root);

      expect(ruleIds(report)).toEqual([]);
    });

    // …but a reference inside the ruling text of that same row is a reference.
    it("still fires inside a ledger row's other columns", async () => {
      const root = makeTree({
        "docs/index.md":
          "# Q\n\n## Decision Ledger\n\n" +
          "| ID | Ruling | Date | Settled in |\n| :--- | :--- | :--- | :--- |\n" +
          "| OQ-4 | Supersedes OQ-9 | 2026-09-04 | body |\n",
      });

      const report = await checkTree(root);

      expect(ruleIds(report)).toEqual(["ref/unlinked-oq"]);
      expect(report.findings[0]?.message).toContain("OQ-9");
    });
  });

  it("says nothing about a fenced block", async () => {
    const root = makeTree({
      "docs/index.md": "# Q\n\n```markdown\nOQ-4 is still open.\n```\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("does not recognise a hyphenless OQ4 as a reference", async () => {
    const root = makeTree({
      "docs/index.md": "# Q\n\nOQ4 and OQ 4 are prose.\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });
});

describe("ref/unlinked-section", () => {
  const NUMBERED =
    "# Doc\n\n## 4. The shape\n\n## 4.1 The grammar\n\n## 7. Risks\n";

  it("fires on a bare section reference", async () => {
    const root = makeTree({
      "docs/index.md": `${NUMBERED}\nAs §4.1 explains.\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-section"]);
  });

  it("accepts one pointing at the section it names", async () => {
    const root = makeTree({
      "docs/index.md": `${NUMBERED}\nAs [§4.1](#41-the-grammar) explains.\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  // The whole point of the target check: a link that resolves and goes to the
  // wrong place would satisfy a rule that only asked "is it a link?".
  it("fires on a link pointing at a different section", async () => {
    const root = makeTree({
      "docs/index.md": `${NUMBERED}\nAs [§4.1](#7-risks) explains.\n`,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-section"]);
    expect(report.findings[0]?.message).toContain("#41-the-grammar");
  });

  it("checks the target document, not this one", async () => {
    const root = makeTree({
      "docs/index.md": "See [§7](./design.md#4-the-shape).\n",
      "docs/design.md": NUMBERED,
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-section"]);
    expect(report.findings[0]?.message).toContain("#7-risks");
  });

  // An unnumbered document has no §N to resolve against, and guessing would
  // invent findings on every document that never adopted the convention.
  it("says nothing about where a link points when the target has no numbers", async () => {
    const root = makeTree({
      "docs/index.md": "See [§4.1](./notes.md#background).\n",
      "docs/notes.md": "# Notes\n\n## Background\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("still requires the link when the target has no numbers", async () => {
    const root = makeTree({
      "docs/index.md": "# Notes\n\n## Background\n\nSee §4.1 for that.\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-section"]);
  });
});

describe("ref/unlinked-file", () => {
  it("fires on a filename that resolves beside the document", async () => {
    const root = makeTree({
      "docs/index.md": "The pipeline lives in `design.md`.\n",
      "docs/design.md": "# Design\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-file"]);
  });

  it("accepts one linked to the file it names", async () => {
    const root = makeTree({
      "docs/index.md": "The pipeline lives in [`design.md`](./design.md).\n",
      "docs/design.md": "# Design\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("fires on a link to a different file than the token names", async () => {
    const root = makeTree({
      "docs/index.md": "The pipeline lives in [`design.md`](./other.md).\n",
      "docs/design.md": "# Design\n",
      "docs/other.md": "# Other\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-file"]);
    expect(report.findings[0]?.message).toContain("a different file");
  });

  // Doc-relative only. A manifest at the repo root is not what a document five
  // directories down means when it says `package.json` in passing.
  it("does not resolve against the repository root", async () => {
    const root = makeTree({
      "package.json": "{}\n",
      "docs/deep/index.md":
        "A `package.json` change lands with its lockfile.\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("says nothing about a token that resolves nowhere", async () => {
    const root = makeTree({
      "docs/index.md": "Ported from `some-other-repo.md` last year.\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  // The whitespace test is what keeps commands out without a command allowlist.
  it("says nothing about a command in inline code", async () => {
    const root = makeTree({
      "docs/index.md":
        "Run `npm ci` first, then `git config core.hooksPath`.\n",
      "docs/npm.md": "# npm\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("never reports a document naming itself", async () => {
    const root = makeTree({
      "docs/index.md": "This file, `index.md`, is the entry point.\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("says nothing about a directory", async () => {
    const root = makeTree({
      "docs/index.md": "Sources live in `sub.d/`.\n",
      "docs/sub.d/keep.md": "# Keep\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("says nothing inside a fenced block", async () => {
    const root = makeTree({
      "docs/index.md": "```bash\ncat design.md\n```\n",
      "docs/design.md": "# Design\n",
    });

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });
});
