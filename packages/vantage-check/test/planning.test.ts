import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { parseConfig } from "../src/core/config.js";
import { checkFiles } from "../src/core/runner.js";
import type { RunShard } from "../src/core/parallel.js";
import type { Finding } from "../src/core/types.js";
import { EXIT_FINDINGS, EXIT_OK } from "../src/exit.js";
import { bufferIo } from "../src/io.js";
import { RULES, ruleMeta } from "../src/rules/registry.js";
import { PLANNING_RULES } from "../src/rules/planning.js";
import type { PlanningSections } from "../../vantage-md/src/planning/index.js";
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
 * The four planning rules (`docs/design/planning-index.md` §8). Each is a
 * derivation the planning page also shows, so beyond firing and staying quiet
 * on the cases §4 lists, the thing to prove is that the gate reads each file
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
  it("registers the four rules with the design's defaults", () => {
    expect(PLANNING_RULES.map((id) => [id, ruleMeta(id)?.default])).toEqual([
      ["planning/stage-vocabulary", "error"],
      ["planning/depends-on-missing", "error"],
      ["planning/stage-disagrees", "warning"],
      ["planning/unrouted", "off"],
    ]);
    expect(RULES.filter((r) => r.id.startsWith("planning/"))).toHaveLength(4);
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
      "Stage `DECIDED` says this document is decided, but 1 question is still open (OQ-A1). Rule it, or set a stage that is still open.",
    );
  });

  it("reports a built stage with open questions", async () => {
    expect(
      await messages(tree("BUILT", questions("A", OPEN, OPEN)), "a.md"),
    ).toEqual([
      "Stage `BUILT` says this document is built, but 2 questions are still open (OQ-A1, OQ-A2). Rule them, or set a stage that is still open.",
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
      "Open question OQ-A2 is not routed by the roadmap (roadmap.md). Link it, or this document, from there, so the planning page lists it under Needs you rather than Unrouted.",
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

  // The page hides Unrouted without a roadmap, and so does the gate. A
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
        "OQ-A2 is not routed by the roadmap (plans/next.md)",
      ),
    ]);
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

  // `exclude` is how a repository quiets a foreign `stage` key (design §13),
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
  // file's membership in the full index's Unrouted and Disagrees.
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
