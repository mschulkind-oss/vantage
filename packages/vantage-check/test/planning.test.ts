import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import { Listing } from "../src/core/candidates.js";
import { parseConfig } from "../src/core/config.js";
import { checkFiles } from "../src/core/runner.js";
import type { RunShard } from "../src/core/parallel.js";
import type { Finding } from "../src/core/types.js";
import { EXIT_FINDINGS, EXIT_OK } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { RULES, ruleMeta } from "../src/rules/registry.js";
import { PLANNING_RULES } from "../src/rules/planning.js";
import { QUESTION_WORDS_DEFAULT } from "../src/rules/questionLength.js";
import type { PlanningSections } from "../../vantage-md/src/planning/index.js";
import { QUESTION_SHAPE } from "../../vantage-md/src/planning/leaning.js";
import { makeTree } from "./helpers.js";
import {
  ANSWERED,
  BLOCKED,
  FULL_TREE,
  OPEN,
  STAGES_TOML,
  doc,
  fullTree,
  questions,
} from "./planningTree.js";

/**
 * The planning rules (`docs/reference/planning-index.md` §13). Each is a
 * derivation the planning page also shows, so beyond firing and staying quiet
 * on the cases §3.4 lists, the thing to prove is that the gate reads each file
 * the way the full index reads it, although it reads only that file and the
 * roadmap.
 */

const UNROUTED_ON = '[check.rules]\n"planning/unrouted" = "warning"\n';

/** A repository: `.git` marks the root, and the rest is `files`. */
function repo(files: Record<string, string>): string {
  return makeTree({ ".git/HEAD": "ref: refs/heads/main\n", ...files });
}

async function check(cwd: string, ...args: string[]) {
  const io = bufferIo(cwd);
  const code = await run(["check", "--format", "json", ...args], io);
  const payload = JSON.parse(io.stdout) as {
    findings: Finding[];
    failures: unknown[];
  };
  return { code, payload, stderr: io.stderr };
}

/** The planning findings a check reports, as `file:line rule`. */
async function planning(cwd: string, ...args: string[]): Promise<string[]> {
  const { payload } = await check(cwd, ...args);
  return payload.findings
    .filter((f) => f.rule.startsWith("planning/"))
    .map((f) => `${f.file}:${f.line} ${f.rule}`);
}

async function messages(cwd: string, ...args: string[]): Promise<string[]> {
  const { payload } = await check(cwd, ...args);
  return payload.findings
    .filter((f) => f.rule.startsWith("planning/"))
    .map((f) => f.message);
}

describe("the registry", () => {
  it("registers the five rules with their defaults", () => {
    expect(PLANNING_RULES.map((id) => [id, ruleMeta(id)?.default])).toEqual([
      ["planning/stage-vocabulary", "error"],
      ["planning/depends-on-missing", "error"],
      ["planning/stage-disagrees", "warning"],
      ["planning/unrouted", "off"],
      ["planning/question-length", "warning"],
    ]);
    expect(RULES.filter((r) => r.id.startsWith("planning/"))).toHaveLength(5);
  });

  // This repository's own .vantage.toml turns `planning/unrouted` up to a
  // warning (Plan Q4); before this rule existed, that line was an unknown rule
  // and exit 2.
  it("accepts the rules, and the family, in [check.rules]", () => {
    expect(parseConfig(UNROUTED_ON).settings.setting("planning/unrouted")).toBe(
      "warning",
    );
    expect(
      parseConfig('[check.rules]\n"planning/*" = "off"\n').settings.enabled(
        "planning/depends-on-missing",
      ),
    ).toBe(false);
  });

  it("lists every rule in the user guide's table of them", () => {
    const guide = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../userguide/guides/vantage-check.md",
      ),
      "utf8",
    );
    for (const id of PLANNING_RULES) {
      expect(guide).toMatch(new RegExp(`^\\| \`${id}\` \\|`, "m"));
    }
    expect(guide).toMatch(
      new RegExp(
        `^\\| \`planning/question-length\` \\| .*${QUESTION_WORDS_DEFAULT} words \\| warning \\|$`,
        "m",
      ),
    );
  });

  it("lists the rules in the help", async () => {
    const io = bufferIo();
    await run(["help"], io);

    for (const id of PLANNING_RULES) expect(io.stdout).toContain(`  ${id} `);
    expect(io.stdout).toContain("for index and the planning/* rules");
  });
});

describe("planning/stage-vocabulary", () => {
  const tree = (stage: string, toml = STAGES_TOML) =>
    repo({
      ".vantage.toml": toml,
      "a.md": doc(`status: draft\nstage: ${stage}`),
    });

  it("reports a stage outside the declared words, at its line", async () => {
    const root = tree("DRAFT");

    expect(await planning(root, "a.md")).toEqual([
      "a.md:3 planning/stage-vocabulary",
    ]);
    const { code, payload } = await check(root, "a.md");
    expect(code).toBe(EXIT_FINDINGS);
    expect(payload.findings[0]?.severity).toBe("error");
  });

  it("says which words are declared", async () => {
    expect(await messages(tree("DRAFT"), "a.md")).toEqual([
      "Stage `DRAFT` is not declared under [planning.stages], which declares `DESIGN`, `DECIDED`, `BUILT` and `RETIRED`. Matching is exact and case-sensitive.",
    ]);
  });

  it("is exact and case-sensitive, and names the near miss", async () => {
    const [message] = await messages(tree("Decided"), "a.md");

    expect(message).toBe(
      "Stage `Decided` is not declared under [planning.stages], which declares `DESIGN`, `DECIDED`, `BUILT` and `RETIRED`. Matching is exact and case-sensitive: did you mean `DECIDED`?",
    );
  });

  it("accepts a declared word, trimmed as the scan trims it", async () => {
    expect(await planning(tree("DECIDED"), "a.md")).toEqual([]);
    expect(await planning(tree('"  DESIGN "'), "a.md")).toEqual([]);
  });

  it("reports a stage that is not a word at all", async () => {
    const [message] = await messages(tree("[DESIGN]"), "a.md");

    expect(message).toContain("`stage` must be one word written as text");
  });

  // Inert without a vocabulary, even when turned up: there is nothing to be
  // outside of.
  it("is quiet when no stages are declared, even at error", async () => {
    const toml = '[check.rules]\n"planning/stage-vocabulary" = "error"\n';

    expect(await planning(tree("ANYTHING", toml), "a.md")).toEqual([]);
    expect(await planning(tree("[1, 2]", toml), "a.md")).toEqual([]);
    expect(
      await planning(tree("DRAFT", "[planning.stages]\n"), "a.md"),
    ).toEqual([]);
  });
});

// The planning rules read the [planning] table the server would for the
// file's project: its root's own .vantage.toml, or an explicit --config.
describe("the [planning] table each file is judged by", () => {
  it("is its root's own, not one above the root", async () => {
    const outer = makeTree({
      ".vantage.toml": STAGES_TOML,
      "repo/.git/HEAD": "ref: refs/heads/main\n",
      "repo/docs/a.md": doc("status: draft\nstage: Foo"),
    });

    expect(await planning(join(outer, "repo"), "docs/a.md")).toEqual([]);
  });

  it("is the root's own for each root a run spans", async () => {
    const outer = makeTree({
      "one/.git/HEAD": "ref: refs/heads/main\n",
      "one/.vantage.toml": STAGES_TOML,
      "one/a.md": doc("status: draft\nstage: Foo"),
      "two/.git/HEAD": "ref: refs/heads/main\n",
      "two/b.md": doc("status: draft\nstage: Foo"),
    });

    expect(await planning(outer, "one/a.md", "two/b.md")).toEqual([
      "one/a.md:3 planning/stage-vocabulary",
    ]);
  });

  it("says it could not run for a root whose own config is malformed", async () => {
    const outer = makeTree({
      "one/.git/HEAD": "ref: refs/heads/main\n",
      "one/a.md": doc("status: draft\nstage: Foo"),
      "two/.git/HEAD": "ref: refs/heads/main\n",
      "two/.vantage.toml": "[planning]\nroadmap = 3\n",
      "two/b.md": doc("status: draft\nstage: Foo"),
    });
    const { payload } = await check(outer, "one/a.md", "two/b.md");

    expect(JSON.stringify(payload.failures)).toContain("two/.vantage.toml");
  });

  // With no root there is no repository to anchor the patterns to, so they
  // are read against the working directory, as `index` scans it (§13).
  it("applies include and exclude without a root, from the working directory", async () => {
    const tree = makeTree({
      "cfg/v.toml": `[planning]\nexclude = ["docs/**"]\n\n${STAGES_TOML}`,
      "docs/a.md": doc("status: draft\nstage: Foo"),
      "b.md": doc("status: draft\nstage: Foo"),
    });

    expect(
      await planning(tree, "--config", "cfg/v.toml", "docs/a.md", "b.md"),
    ).toEqual(["b.md:3 planning/stage-vocabulary"]);
  });
});

describe("planning/depends-on-missing", () => {
  const target = doc(
    "status: accepted",
    `${questions("T", OPEN)}\n## Decision Ledger\n\n| OQ-T7 | ruled |\n`,
  );
  const dependent = (dependsOn: string) =>
    doc(`status: draft\ndepends-on:${dependsOn}`);
  const tree = (dependsOn: string, extra: Record<string, string> = {}) =>
    repo({
      "docs/target.md": target,
      "docs/plain.md": "# Plain\n\nMentions OQ-P3 in prose.\n",
      "docs/a.md": dependent(dependsOn),
      ...extra,
    });

  it.each([
    ["an existing document", "\n  - target.md"],
    ["a question it holds", "\n  - target.md#OQ-T1"],
    ["a ruled id kept in its ledger", "\n  - target.md#OQ-T7"],
    ["an id in a document that is not a planning one", "\n  - plain.md#OQ-P3"],
    ["a heading, which is not an id", "\n  - target.md#decision-ledger"],
    ["a single path, not a list", " target.md"],
    ["a directory", "\n  - ../docs"],
  ])("is quiet on %s", async (_name, entries) => {
    expect(await planning(tree(entries), "docs/a.md")).toEqual([]);
  });

  it("reports a target that does not exist, at the entry's line", async () => {
    const root = tree("\n  - target.md\n  - gone.md");

    expect(await planning(root, "docs/a.md")).toEqual([
      "docs/a.md:5 planning/depends-on-missing",
    ]);
    expect(await messages(root, "docs/a.md")).toEqual([
      "`depends-on` entry `gone.md` names docs/gone.md, which does not exist.",
    ]);
  });

  it("reports a target outside the repository", async () => {
    const root = tree("\n  - ../../outside.md");

    expect(await messages(root, "docs/a.md")).toEqual([
      "`depends-on` entry `../../outside.md` does not name a path inside this repository, so nothing can wait on it. Write a path relative to this document.",
    ]);
  });

  it("reports a path from the root, which names nothing here", async () => {
    expect(await planning(tree("\n  - /docs/target.md"), "docs/a.md")).toEqual([
      "docs/a.md:4 planning/depends-on-missing",
    ]);
  });

  it("reports an #OQ- id that appears nowhere in its target", async () => {
    expect(await messages(tree("\n  - target.md#OQ-T9"), "docs/a.md")).toEqual([
      "`depends-on` entry `target.md#OQ-T9` names OQ-T9, which appears nowhere in docs/target.md, not even in its Decision Ledger.",
    ]);
  });

  // The path is inside, but a symbolic link takes it out: the verdict would
  // rest on a file the repository does not hold, and read a device whole.
  it("reports a target a symbolic link takes outside the repository", async () => {
    const outside = makeTree({ "elsewhere.md": "# Elsewhere\n\nOQ-T9\n" });
    const root = tree("\n  - out.md#OQ-T9\n  - null.md");
    symlinkSync(join(outside, "elsewhere.md"), join(root, "docs/out.md"));
    symlinkSync("/dev/null", join(root, "docs/null.md"));

    expect(await messages(root, "docs/a.md")).toEqual([
      "`depends-on` entry `out.md#OQ-T9` names docs/out.md, which lies outside this repository through a symbolic link.",
      "`depends-on` entry `null.md` names docs/null.md, which lies outside this repository through a symbolic link.",
    ]);
  });

  it("follows a symbolic link that stays inside the repository", async () => {
    const root = tree("\n  - alias.md#OQ-T1");
    symlinkSync(join(root, "docs/target.md"), join(root, "docs/alias.md"));

    expect(await planning(root, "docs/a.md")).toEqual([]);
  });

  // The endpoint never reads past max-file-bytes, and neither does the rule:
  // a target it cannot read has settled nothing either way.
  it("reads no target past max-file-bytes", async () => {
    const root = tree("\n  - big.md#OQ-T9", {
      ".vantage.toml": "[planning]\nmax-file-bytes = 64\n",
      "docs/big.md": `# Big\n\n${"x".repeat(100)}\n`,
    });

    expect(await planning(root, "docs/a.md")).toEqual([]);
  });

  it("reports an entry that is not a path, which the scan drops", async () => {
    const root = tree("\n  - target.md\n  - 3");

    expect(await planning(root, "docs/a.md")).toEqual([
      "docs/a.md:5 planning/depends-on-missing",
    ]);
    expect((await messages(root, "docs/a.md"))[0]).toContain(
      "Entry 2 of `depends-on` is",
    );
  });
});

describe("planning/stage-disagrees", () => {
  const tree = (stage: string, body: string) =>
    repo({
      ".vantage.toml": STAGES_TOML,
      "a.md": doc(`status: accepted\nstage: ${stage}`, body),
    });

  it("reports a ready stage with an open question, as a warning", async () => {
    const root = tree("DECIDED", questions("A", OPEN, ANSWERED));
    const { code, payload } = await check(root, "a.md");

    expect(code).toBe(EXIT_OK);
    expect(payload.findings.map((f) => [f.rule, f.severity, f.line])).toEqual([
      ["planning/stage-disagrees", "warning", 3],
    ]);
    expect(payload.findings[0]?.message).toBe(
      "Stage `DECIDED` says this document is decided, but 1 question is still open (OQ-A1). Have it ruled, or set a stage that is still open.",
    );
  });

  it("reports a built stage with open questions", async () => {
    expect(
      await messages(tree("BUILT", questions("A", OPEN, OPEN)), "a.md"),
    ).toEqual([
      "Stage `BUILT` says this document is built, but 2 questions are still open (OQ-A1, OQ-A2). Have them ruled, or set a stage that is still open.",
    ]);
  });

  it.each([
    [
      "answered and blocked questions only",
      "DECIDED",
      questions("A", ANSWERED, BLOCKED),
    ],
    ["an open stage", "DESIGN", questions("A", OPEN)],
    ["the done role", "RETIRED", questions("A", OPEN)],
    ["no questions", "BUILT", ""],
  ])("is quiet with %s", async (_name, stage, body) => {
    expect(await planning(tree(stage, body), "a.md")).toEqual([]);
  });

  it("is quiet when no stages are declared", async () => {
    const root = repo({
      "a.md": doc("status: accepted\nstage: BUILT", questions("A", OPEN)),
    });

    expect(await planning(root, "a.md")).toEqual([]);
  });
});

describe("planning/unrouted", () => {
  const tree = (roadmap: string, extra: Record<string, string> = {}) =>
    repo({
      ".vantage.toml": `${STAGES_TOML}\n${UNROUTED_ON}`,
      "roadmap.md": `# Roadmap\n\n## Next\n\n${roadmap}\n`,
      "docs/a.md": doc(
        "status: draft\nstage: DESIGN",
        questions("A", OPEN, OPEN),
      ),
      ...extra,
    });

  it("is off until configured", async () => {
    const root = repo({
      "roadmap.md": "# Roadmap\n",
      "docs/a.md": doc("status: draft", questions("A", OPEN)),
    });

    expect(await planning(root, "docs/a.md")).toEqual([]);
  });

  it("reports an open question the roadmap does not route, at its item", async () => {
    const root = tree("- [The first](docs/a.md#OQ-A1)");

    expect(await planning(root, "docs/a.md")).toEqual([
      "docs/a.md:14 planning/unrouted",
    ]);
    expect(await messages(root, "docs/a.md")).toEqual([
      "Open question OQ-A2 is not on a roadmap: the roadmap (roadmap.md) links neither to it nor to this document as a whole, so the planning page lists it under Not on a roadmap. Where it goes is the human's to confirm; `vantage-check index --request unrouted` asks an agent for a proposal.",
    ]);
  });

  it("is quiet when a bare link routes the whole document", async () => {
    expect(await planning(tree("- [A](docs/a.md)"), "docs/a.md")).toEqual([]);
  });

  // Plan Q12: a compacted question is cited through its document's
  // #decision-ledger heading, and routing that would route the rest.
  it("does not count a link to a heading as routing", async () => {
    expect(
      await planning(
        tree("- [A's ledger](docs/a.md#decision-ledger)"),
        "docs/a.md",
      ),
    ).toHaveLength(2);
  });

  it("is quiet on blocked and answered questions", async () => {
    const root = tree("", {
      "docs/a.md": doc("status: draft", questions("A", BLOCKED, ANSWERED)),
    });

    expect(await planning(root, "docs/a.md")).toEqual([]);
  });

  it("is quiet on a done document's open question", async () => {
    const root = tree("", {
      "docs/a.md": doc("status: draft\nstage: RETIRED", questions("A", OPEN)),
    });

    expect(await planning(root, "docs/a.md")).toEqual([]);
  });

  // The page hides Not on a roadmap without a roadmap, and so does the gate. A
  // skipped roadmap counts as missing (Plan Q20).
  it("is quiet when the roadmap is missing or too large", async () => {
    const missing = repo({
      ".vantage.toml": UNROUTED_ON,
      "docs/a.md": doc("status: draft", questions("A", OPEN)),
    });
    const huge = repo({
      ".vantage.toml": `[planning]\nmax-file-bytes = 64\n\n${UNROUTED_ON}`,
      "roadmap.md": `# Roadmap\n\n${"x".repeat(100)}\n`,
      "docs/a.md": doc("status: draft", questions("A", OPEN)),
    });

    expect(await planning(missing, "docs/a.md")).toEqual([]);
    expect(await planning(huge, "docs/a.md")).toEqual([]);
  });

  // The roadmap has no header and no directive, so no rule can report on it
  // and the pass leaves it out of the index as one of the run's files; it
  // still has to be read as the roadmap.
  it("routes through a roadmap that is itself one of the run's files", async () => {
    const root = tree("- [The first](docs/a.md#OQ-A1)");

    expect(await planning(root, "roadmap.md", "docs/a.md")).toEqual([
      "docs/a.md:14 planning/unrouted",
    ]);
  });

  it("reads another roadmap when [planning] names one", async () => {
    const root = repo({
      ".vantage.toml": `[planning]\nroadmap = "plans/next.md"\n\n${UNROUTED_ON}`,
      "roadmap.md": "# Not this one\n\n- [A](docs/a.md)\n",
      "plans/next.md": "# Next\n\n- [A's first](../docs/a.md#OQ-A1)\n",
      "docs/a.md": doc("status: draft", questions("A", OPEN, OPEN)),
    });

    expect(await messages(root, "docs/a.md")).toEqual([
      expect.stringContaining(
        "OQ-A2 is not on a roadmap: the roadmap (plans/next.md) links neither",
      ),
    ]);
  });
});

// §4.1 and §13.3: with no roadmap listed, every candidate named
// roadmap.md is one, and a question is routed when any of them routes it.
describe("planning/unrouted, with several roadmaps", () => {
  const tree = (extra: Record<string, string> = {}) =>
    repo({
      ".vantage.toml": `${STAGES_TOML}\n${UNROUTED_ON}`,
      "roadmap.md": "# Roadmap\n\n- [A's first](docs/a.md#OQ-A1)\n",
      "docs/plans/roadmap.md": "# Plans\n\n- [A's second](../a.md#OQ-A2)\n",
      "docs/a.md": doc(
        "status: draft\nstage: DESIGN",
        questions("A", OPEN, OPEN, OPEN),
      ),
      ...extra,
    });

  it("reports only what no roadmap routes, and names them all", async () => {
    const root = tree();

    expect(await planning(root, "docs/a.md")).toEqual([
      "docs/a.md:20 planning/unrouted",
    ]);
    expect(await messages(root, "docs/a.md")).toEqual([
      "Open question OQ-A3 is not on a roadmap: no roadmap (roadmap.md, docs/plans/roadmap.md) links to it or to this document as a whole, so the planning page lists it under Not on a roadmap. Where it goes is the human's to confirm; `vantage-check index --request unrouted` asks an agent for a proposal.",
    ]);
  });

  it("finds a roadmap in any directory, and in any ASCII case", async () => {
    const root = repo({
      ".vantage.toml": UNROUTED_ON,
      "docs/plans/ROADMAP.md": "# Plans\n\n- [A](../a.md)\n",
      "docs/a.md": doc("status: draft", questions("A", OPEN)),
    });

    expect(await planning(root, "docs/a.md")).toEqual([]);
  });

  it("reads no roadmap.md that exclude rules out", async () => {
    const root = tree({
      ".vantage.toml": `[planning]\nexclude = ["docs/plans/**"]\n\n${STAGES_TOML}\n${UNROUTED_ON}`,
    });

    expect(await messages(root, "docs/a.md")).toEqual([
      expect.stringContaining(
        "OQ-A2 is not on a roadmap: the roadmap (roadmap.md) links neither",
      ),
      expect.stringContaining(
        "OQ-A3 is not on a roadmap: the roadmap (roadmap.md) links neither",
      ),
    ]);
  });

  it("reads a listed roadmap that exclude rules out, and only the listed ones", async () => {
    const root = tree({
      ".vantage.toml": `[planning]\nroadmap = ["docs/plans/roadmap.md", "plans/gone.md"]\nexclude = ["docs/plans/**"]\n\n${STAGES_TOML}\n${UNROUTED_ON}`,
    });

    expect(await messages(root, "docs/a.md")).toEqual([
      expect.stringContaining(
        "OQ-A1 is not on a roadmap: the roadmap (docs/plans/roadmap.md) links neither",
      ),
      expect.stringContaining(
        "OQ-A3 is not on a roadmap: the roadmap (docs/plans/roadmap.md) links neither",
      ),
    ]);
  });

  it("routes nothing from a roadmap with a done stage", async () => {
    const root = tree({
      "docs/plans/roadmap.md": doc("stage: RETIRED", "- [A](../a.md)"),
    });

    expect(await planning(root, "docs/a.md")).toEqual([
      "docs/a.md:14 planning/unrouted",
      "docs/a.md:20 planning/unrouted",
    ]);
  });

  it("is quiet when the list is empty, since there is no roadmap", async () => {
    const root = tree({
      ".vantage.toml": `[planning]\nroadmap = []\n\n${STAGES_TOML}\n${UNROUTED_ON}`,
    });

    expect(await planning(root, "docs/a.md")).toEqual([]);
  });
});

// §13.3: finding roadmaps by name costs check one walk of the listing,
// and only when planning/unrouted is on and a checked document could fire it.
describe("planning/question-length", () => {
  /** `n` words of prose. */
  const prose = (n: number) =>
    Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");

  /**
   * One question in the convention's shape whose text runs to `words` words:
   * a title of three ("OQ-L1: Which wins?") and the rest below it, then its
   * directive, a leaning of `leaning` words and the empty Answer.
   */
  const question = (id: string, words: number, leaning = 3, marker = OPEN) =>
    [
      `1. ${marker} **${id}: Which wins?**`,
      "",
      `   ${prose(words - 3)}`,
      "",
      `   <!-- vantage: question id=${id} leaning="The last." -->`,
      "",
      `   _Leaning:_ ${prose(leaning)}`,
      "",
      "   **Answer:**",
      "",
      "   > _(empty \u2014 fill in when decided)_",
      "",
    ].join("\n");

  const tree = (body: string, header = "status: draft", toml = "") =>
    repo({
      ".vantage.toml": `${STAGES_TOML}\n${toml}`,
      "a.md": doc(header, body),
    });

  it("warns on a question past 120 words, at its item", async () => {
    const root = tree(question("OQ-L1", 121));

    expect(await planning(root, "a.md")).toEqual([
      "a.md:7 planning/question-length",
    ]);
    const { code, payload } = await check(root, "a.md");
    expect(code).toBe(EXIT_OK);
    expect(payload.findings[0]?.severity).toBe("warning");
  });

  it("says how long the question is and what the limit is", async () => {
    const [message] = await messages(tree(question("OQ-L1", 121)), "a.md");

    expect(message).toMatch(
      /^Question OQ-L1 runs to 121 words, not counting its leaning and its Answer, past the limit of 120\./,
    );
    expect(message).toContain("put the question itself in the title");
  });

  it("is quiet at the limit, whatever the leaning and the Answer hold", async () => {
    expect(await planning(tree(question("OQ-L1", 120, 400)), "a.md")).toEqual(
      [],
    );
  });

  it("names a question with no id by its title", async () => {
    const body = question("OQ-L1", 130).replace(" id=OQ-L1", "");

    expect(await messages(tree(body), "a.md")).toEqual([
      expect.stringMatching(
        /^Question “OQ-L1: Which wins\?” runs to 130 words/,
      ),
    ]);
  });

  // A question with no bold title is titled by the whole text of its
  // paragraph, which is the very question this rule reports: quoted whole,
  // a finding ran to a line of a thousand characters and more.
  it("names a question with no id or bold title by its first 100 characters", async () => {
    const body = [
      '<!-- vantage: question leaning="A paragraph." -->',
      "",
      `A question written as a plain paragraph with no id, ${prose(150)}.`,
      "",
    ].join("\n");

    const [message] = await messages(tree(body), "a.md");
    const name = /^Question “([^”]*)” runs to (\d+) words/.exec(message ?? "");
    expect(name).not.toBeNull();
    expect(name![1]!.length).toBeLessThanOrEqual(100);
    expect(name![1]!.length).toBeGreaterThan(90);
    expect(
      name![1]!.startsWith("A question written as a plain paragraph"),
    ).toBe(true);
    expect(name![1]!.endsWith("…")).toBe(true);
    expect(Number(name![2])).toBeGreaterThan(150);
    // The shape every such finding quotes aside, the message stays a line.
    expect(message).toContain(QUESTION_SHAPE);
    expect(message!.replace(QUESTION_SHAPE, "").length).toBeLessThan(700);
  });

  it("measures every state a card is shown for", async () => {
    const body = [
      question("OQ-L1", 130, 3, BLOCKED),
      question("OQ-L2", 130, 3, ANSWERED).replace("1. ", "2. "),
    ].join("\n");

    expect(await planning(tree(body), "a.md")).toEqual([
      "a.md:7 planning/question-length",
      "a.md:19 planning/question-length",
    ]);
  });

  it("leaves a done document's questions alone", async () => {
    const root = tree(question("OQ-L1", 400), "status: draft\nstage: RETIRED");

    expect(await planning(root, "a.md")).toEqual([]);
  });

  it("takes its limit from max-words", async () => {
    const lower =
      '[check.rules]\n"planning/question-length" = { max-words = 20 }\n';
    const higher =
      '[check.rules]\n"planning/question-length" = { max-words = 500 }\n';

    expect(
      await planning(
        tree(question("OQ-L1", 21), "status: draft", lower),
        "a.md",
      ),
    ).toEqual(["a.md:7 planning/question-length"]);
    expect(
      await messages(
        tree(question("OQ-L1", 21), "status: draft", lower),
        "a.md",
      ),
    ).toEqual([expect.stringContaining("past the limit of 20.")]);
    expect(
      await planning(
        tree(question("OQ-L1", 400), "status: draft", higher),
        "a.md",
      ),
    ).toEqual([]);
  });

  it("takes a severity beside its limit", async () => {
    const toml =
      '[check.rules]\n"planning/question-length" = { severity = "error", max-words = 20 }\n';
    const { code, payload } = await check(
      tree(question("OQ-L1", 21), "status: draft", toml),
      "a.md",
    );

    expect(code).toBe(EXIT_FINDINGS);
    expect(payload.findings.map((f) => [f.rule, f.severity])).toEqual([
      ["planning/question-length", "error"],
    ]);
  });

  it("turns off, alone or with its family", async () => {
    for (const setting of [
      '"planning/question-length" = "off"',
      '"planning/*" = "off"',
      '"planning/question-length" = { severity = "off", max-words = 20 }',
    ]) {
      const root = tree(
        question("OQ-L1", 400),
        "status: draft",
        `[check.rules]\n${setting}\n`,
      );
      expect(await planning(root, "a.md")).toEqual([]);
    }
  });

  it("is quiet on a file that is not a candidate", async () => {
    const root = tree(
      question("OQ-L1", 400),
      "status: draft",
      '[planning]\nexclude = ["a.md"]\n',
    );

    expect(await planning(root, "a.md")).toEqual([]);
  });

  it("measures a question with no project root", async () => {
    const root = makeTree({
      "a.md": doc("status: draft", question("OQ-L1", 121)),
    });

    expect(await planning(root, "a.md")).toEqual([
      "a.md:7 planning/question-length",
    ]);
  });
});

describe("the listing walk check makes for roadmaps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const walks = async (
    files: Record<string, string>,
    ...paths: string[]
  ): Promise<number> => {
    const list = vi.spyOn(Listing.prototype, "list");
    await planning(repo(files), ...paths);
    return list.mock.calls.length;
  };
  const OPEN_A = doc("status: draft", questions("A", OPEN));

  it("walks once per run with nothing listed", async () => {
    expect(
      await walks(
        {
          ".vantage.toml": UNROUTED_ON,
          "roadmap.md": "# Roadmap\n",
          "a.md": OPEN_A,
          "b.md": doc("status: draft", questions("B", OPEN)),
        },
        "a.md",
        "b.md",
      ),
    ).toBe(1);
  });

  it("never walks for listed roadmaps", async () => {
    expect(
      await walks(
        {
          ".vantage.toml": `[planning]\nroadmap = "roadmap.md"\n\n${UNROUTED_ON}`,
          "roadmap.md": "# Roadmap\n",
          "a.md": OPEN_A,
        },
        "a.md",
      ),
    ).toBe(0);
  });

  it("never walks with planning/unrouted off", async () => {
    expect(
      await walks({ "roadmap.md": "# Roadmap\n", "a.md": OPEN_A }, "a.md"),
    ).toBe(0);
  });

  it("never walks when no checked document has an open question", async () => {
    expect(
      await walks(
        {
          ".vantage.toml": `${STAGES_TOML}\n${UNROUTED_ON}`,
          "roadmap.md": "# Roadmap\n",
          "a.md": doc("status: draft\nstage: DESIGN"),
          "b.md": doc("status: draft", questions("B", BLOCKED, ANSWERED)),
          "c.md": doc("stage: RETIRED", questions("C", OPEN)),
        },
        "a.md",
        "b.md",
        "c.md",
      ),
    ).toBe(0);
  });
});

describe("which files the rules report on", () => {
  it("reports only for the files in the run", async () => {
    const root = repo({
      ".vantage.toml": `${STAGES_TOML}\n${UNROUTED_ON}`,
      "roadmap.md": "# Roadmap\n\n- [Gone](docs/gone.md#OQ-1)\n",
      "docs/a.md": doc("stage: WRONG", questions("A", OPEN)),
      "docs/b.md": doc(
        "stage: WRONG\ndepends-on: gone.md",
        questions("B", OPEN),
      ),
    });

    expect(await planning(root, "docs/a.md")).toEqual([
      "docs/a.md:2 planning/stage-vocabulary",
      "docs/a.md:7 planning/unrouted",
    ]);
  });

  // `exclude` is how a repository quiets a foreign `stage` key (§3.1),
  // and a file the server would never list is no planning document either.
  it("is quiet on a file that is not a candidate", async () => {
    const root = repo({
      ".vantage.toml": `[planning]\nexclude = ["site/**"]\n\n${STAGES_TOML}`,
      ".vantageignore": "scratch/\n",
      "site/page.md": doc("stage: production"),
      "scratch/note.md": doc("stage: production"),
      "notes.markdown": doc("stage: production"),
      "docs/a.md": doc("stage: production"),
    });

    expect(
      await planning(
        root,
        "site/page.md",
        "scratch/note.md",
        "notes.markdown",
        "docs/a.md",
      ),
    ).toEqual(["docs/a.md:2 planning/stage-vocabulary"]);
  });

  it("is quiet on a file whose header does not parse", async () => {
    const root = repo({
      ".vantage.toml": STAGES_TOML,
      "a.md": "---\nstage: [WRONG\n---\n\n# A\n",
    });

    expect(await planning(root, "a.md")).toEqual([]);
  });

  it("is quiet on a file past max-file-bytes, as the page skips it", async () => {
    const root = repo({
      ".vantage.toml": `[planning]\nmax-file-bytes = 64\n\n${STAGES_TOML}`,
      "a.md": doc("stage: WRONG", "x".repeat(100)),
    });

    expect(await planning(root, "a.md")).toEqual([]);
  });

  it("reports a file checked through a directory", async () => {
    const root = repo({
      ".vantage.toml": STAGES_TOML,
      "docs/a.md": doc("stage: WRONG"),
      "docs/b.md": doc("stage: DESIGN"),
    });

    expect(await planning(root, "docs")).toEqual([
      "docs/a.md:2 planning/stage-vocabulary",
    ]);
  });

  it("finds each repository's own roadmap in a run over two", async () => {
    const one = repo({
      ".vantage.toml": UNROUTED_ON,
      "roadmap.md": "# Roadmap\n\n- [A](a.md)\n",
      "a.md": doc("status: draft", questions("A", OPEN)),
    });
    const two = repo({
      "roadmap.md": "# Roadmap\n",
      "b.md": doc("status: draft", questions("B", OPEN)),
    });
    const findings = await planning(one, "a.md", join(two, "b.md"));

    expect(findings).toEqual([`${join(two, "b.md")}:7 planning/unrouted`]);
  });
});

describe("the project root, as check finds it", () => {
  const rules = `${STAGES_TOML}\n${UNROUTED_ON}`;

  // `just _self-check` passes `--config "$(mktemp)"`, whose directory is /tmp.
  it("derives what index derives when --config points outside the tree", async () => {
    const root = fullTree();
    const elsewhere = makeTree({
      "cfg.toml": `[planning]\nexclude = ["drafts/**"]\nmax-file-bytes = 4096\n\n${rules}`,
    });
    const config = join(elsewhere, "cfg.toml");

    const io = bufferIo(join(root, "docs"));
    await run(["index", "--format", "json", "--config", config], io);
    const sections = JSON.parse(io.stdout).sections as PlanningSections;
    const found = await planning(join(root, "docs"), "--config", config, ".");

    expect(found.filter((f) => f.endsWith("planning/unrouted"))).toEqual(
      (sections.unrouted ?? []).map(
        (ref) =>
          `${ref.path.replace(/^docs\//, "")}:${unitLineOf(ref.path, ref.id)} planning/unrouted`,
      ),
    );
    expect(found.filter((f) => f.endsWith("planning/stage-disagrees"))).toEqual(
      (sections.disagrees ?? []).map(
        (path) => `${path.replace(/^docs\//, "")}:3 planning/stage-disagrees`,
      ),
    );
  });

  it("stops at the git root, below a .vantage.toml further up", async () => {
    // The config is the outer one, found by walking up from the file, and it
    // turns unrouted on. The root is the repository's: its roadmap routes
    // the question, and the outer roadmap, which does not, is never read.
    const outer = makeTree({
      ".vantage.toml": UNROUTED_ON,
      "roadmap.md": "# Outer roadmap\n",
      "repo/.git/HEAD": "",
      "repo/roadmap.md": "# Roadmap\n\n- [A](a.md)\n",
      "repo/a.md": doc("status: draft", questions("A", OPEN)),
    });

    expect(await planning(join(outer, "repo"), "a.md")).toEqual([]);
  });

  it("gives per-document findings only when there is no root", async () => {
    // No .git and no .vantage.toml anywhere above: the file stands alone, so
    // there is no roadmap to route anything, and its own header is all that
    // is judged. With no repository there is nothing to lie outside of, so
    // `..` (the temporary directory) is simply a path that exists.
    const loose = makeTree({
      "roadmap.md": "# Roadmap\n",
      "a.md": doc(
        "status: accepted\nstage: BUILT\ndepends-on:\n  - gone.md\n  - ..",
        questions("A", OPEN),
      ),
      "b.md": doc("stage: WRONG"),
    });
    const config = join(makeTree({ "cfg.toml": rules }), "cfg.toml");

    expect(await planning(loose, "--config", config, "a.md", "b.md")).toEqual([
      "a.md:3 planning/stage-disagrees",
      "a.md:5 planning/depends-on-missing",
      "b.md:2 planning/stage-vocabulary",
    ]);
  });
});

/** Where `FULL_TREE` writes a question's list item. */
function unitLineOf(path: string, id: string | null): number {
  const lines = (FULL_TREE[path] as string).split("\n");
  return lines.findIndex((line) => line.includes(`**${id}:`)) + 1;
}

describe("the narrow index agrees with the full one", () => {
  const rules = '"planning/unrouted" = "warning"\n';

  // For every candidate, checked alone, the gate's findings are exactly that
  // file's membership in the full index's Not on a roadmap and Stage
  // conflict.
  it("for every file in the full fixture, checked alone", async () => {
    const root = fullTree();
    writeFileSync(
      join(root, ".vantage.toml"),
      `${FULL_TREE[".vantage.toml"]}\n[check.rules]\n${rules}`,
    );
    const io = bufferIo(root);
    await run(["index", "--format", "json"], io);
    const { index, sections } = JSON.parse(io.stdout) as {
      index: { documents: { path: string }[] };
      sections: PlanningSections;
    };

    for (const { path } of index.documents) {
      const found = await planning(root, path);
      const expected = [
        ...(sections.disagrees ?? [])
          .filter((p) => p === path)
          .map((p) => `${p}:3 planning/stage-disagrees`),
        ...(sections.unrouted ?? [])
          .filter((ref) => ref.path === path)
          .map(
            (ref) => `${path}:${unitLineOf(path, ref.id)} planning/unrouted`,
          ),
      ];
      expect(
        found.filter((f) => !f.includes("depends-on")).sort(),
        path,
      ).toEqual(expected.sort());
    }
  });
});

describe("the narrow index agrees with the full one, over several roadmaps", () => {
  // Every roadmap.md is found by name, one of them retired, one excluded,
  // and each routes a different part of docs/a.md.
  const files: Record<string, string> = {
    ".vantage.toml": `[planning]\nexclude = ["vendor/**"]\n\n${STAGES_TOML}\n${UNROUTED_ON}`,
    "roadmap.md": "# Roadmap\n\n- [A's first](docs/a.md#OQ-A1)\n",
    "docs/plans/roadmap.md": `# Plans\n\n- [A's second](../a.md#OQ-A2)\n\n${questions("P", OPEN, OPEN)}`,
    "docs/old/roadmap.md": doc("stage: RETIRED", "- [A](../a.md)"),
    "vendor/roadmap.md": "# Theirs\n\n- [A](../docs/a.md)\n",
    "docs/a.md": doc(
      "status: draft\nstage: DESIGN",
      questions("A", OPEN, OPEN, OPEN),
    ),
    "docs/b.md": doc("status: draft", questions("B", OPEN, BLOCKED)),
  };

  it("for every document, checked alone", async () => {
    const root = repo(files);
    const io = bufferIo(root);
    await run(["index", "--format", "json"], io);
    const { index, sections } = JSON.parse(io.stdout) as {
      index: {
        documents: {
          path: string;
          questions: { id: string; unitLine: number }[];
        }[];
      };
      sections: PlanningSections;
    };

    expect(sections.roadmaps.map((r) => r.path)).toEqual([
      "roadmap.md",
      "docs/old/roadmap.md",
      "docs/plans/roadmap.md",
    ]);
    const lineOf = (path: string, id: string | null) =>
      index.documents
        .find((d) => d.path === path)
        ?.questions.find((q) => q.id === id)?.unitLine;
    const expected = (sections.unrouted ?? []).map(
      (ref) => `${ref.path}:${lineOf(ref.path, ref.id)} planning/unrouted`,
    );
    expect(expected).toHaveLength(4);

    const found: string[] = [];
    for (const { path } of index.documents) {
      found.push(...(await planning(root, path)));
    }
    expect(found.sort()).toEqual(expected.sort());
  });
});

describe("threads", () => {
  /** The seam, wired to the real checker in this process. */
  const inProcess: RunShard = (files, cwd, settings) =>
    checkFiles(files, cwd, settings);

  it("reports the same planning findings at 1 and 4 jobs", async () => {
    const files: Record<string, string> = {
      ".vantage.toml": `${STAGES_TOML}\n${UNROUTED_ON}`,
      "roadmap.md": "# Roadmap\n\n- [First](d0.md)\n",
    };
    for (let i = 0; i < 8; i++) {
      files[`d${i}.md`] = doc(
        `status: draft\nstage: ${i % 2 === 0 ? "BUILT" : "WRONG"}\ndepends-on: gone${i}.md`,
        questions(`D${i}`, OPEN),
      );
    }
    const root = repo(files);

    const one = bufferIo(root);
    const many = bufferIo(root);
    await run(
      ["check", "--format", "json", "--jobs", "1", "."],
      one,
      inProcess,
    );
    await run(
      ["check", "--format", "json", "--jobs", "4", "."],
      many,
      inProcess,
    );

    expect(many.stdout).toBe(one.stdout);
    const findings = JSON.parse(one.stdout).findings as Finding[];
    expect(findings.filter((f) => f.rule.startsWith("planning/")).length).toBe(
      // Every file's missing depends-on; four off-vocabulary stages; four
      // BUILT stages that disagree; seven unrouted questions.
      8 + 4 + 4 + 7,
    );
  });
});
