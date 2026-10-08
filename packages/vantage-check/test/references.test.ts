import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkTree, makeTree, ruleIds } from "./helpers.js";

/**
 * A tree that is a git repository, so ignore rules apply to it.
 *
 * `ref/unlinked-file` asks git which files it excludes, so these tests need a
 * real repository. The global and system config are neutralized for the whole
 * file in `beforeEach`, and here for the setup commands too, so the only
 * exclude rule in play is the one a test wrote — a developer's own global
 * excludes must not decide the expectation.
 */
function gitTree(files: Record<string, string>): string {
  const root = makeTree(files);
  execFileSync("git", ["-c", "core.excludesFile=/dev/null", "init", "-q"], {
    cwd: root,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  return root;
}

beforeEach(() => {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const OQ = '<!-- vantage: question id=OQ-4 leaning="Yes." -->';

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

  it("does not recognize a hyphenless OQ4 as a reference", async () => {
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

  // A leading slash leaves the document behind entirely: `resolve` discards the
  // document's directory, so the token is statted against the machine's root.
  // A runbook naming `/etc/mkinitcpio.conf` was told the file "exists beside
  // this document" and offered `](.//etc/mkinitcpio.conf)` as the fix.
  it("says nothing about an absolute path, even one that exists", async () => {
    const root = makeTree({
      "docs/design.md": "# Design\n",
      "docs/index.md": "placeholder\n",
    });
    const absolute = join(root, "docs/design.md");
    writeFileSync(join(root, "docs/index.md"), `Edit \`${absolute}\`.\n`);

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  it("says nothing about an absolute path written in prose", async () => {
    const root = makeTree({
      "docs/design.md": "# Design\n",
      "docs/index.md": "placeholder\n",
    });
    const absolute = join(root, "docs/design.md");
    writeFileSync(join(root, "docs/index.md"), `Edit ${absolute} first.\n`);

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual([]);
  });

  // A file git ignores is private to the machine holding it, so a committed
  // document that names it in passing must read the same whether or not the
  // file is there. Before the checker asked git, creating `settings.local.md`
  // turned a clean document into a finding that demanded a link no other
  // reader could follow — the report that a committed `CHANGELOG.md` naming
  // `yolo-jail.local.jsonc` failed on a machine that had the file and passed
  // in a clean worktree.
  it("reads the same before and after an ignored local file appears", async () => {
    const root = gitTree({
      "docs/index.md": "Local overrides live in `settings.local.md`.\n",
      ".gitignore": "settings.local.md\n",
    });

    const before = await checkTree(root);
    writeFileSync(join(root, "docs/settings.local.md"), "# private\n");
    const after = await checkTree(root);

    expect(ruleIds(before)).toEqual([]);
    expect(ruleIds(after)).toEqual(ruleIds(before));
  });

  // The exemption is for files git excludes, not for every file that is merely
  // untracked: a file the repository has not committed and does not ignore is
  // still one a document should link to.
  it("still fires on an untracked file git does not ignore", async () => {
    const root = gitTree({
      "docs/index.md": "The pipeline lives in `design.md`.\n",
      ".gitignore": "unrelated.md\n",
    });
    writeFileSync(join(root, "docs/design.md"), "# Design\n");

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-file"]);
  });

  // An explicit link is a claim the document makes and has to resolve; only
  // the demand for a link is dropped when the file is private. A token that
  // names one file and links to another is still reported.
  it("still checks a link naming an ignored file but opening another", async () => {
    const root = gitTree({
      "docs/index.md": "See [`settings.local.md`](./other.md).\n",
      ".gitignore": "settings.local.md\n",
      "docs/other.md": "# Other\n",
    });
    writeFileSync(join(root, "docs/settings.local.md"), "# private\n");

    const report = await checkTree(root);

    expect(ruleIds(report)).toEqual(["ref/unlinked-file"]);
    expect(report.findings[0]?.message).toContain("a different file");
  });
});
