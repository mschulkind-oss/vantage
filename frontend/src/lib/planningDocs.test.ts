/**
 * The planning docs say what the built code does.
 *
 * `docs/reference/planning-index.md` is the reference of record for the
 * planning index, and `docs/design/technical_spec.md` and the user guide's
 * `userguide/guides/planning.md` retell parts of it. Each case holds one claim
 * a reader acts on to the code, the server or the other doc it describes, so a
 * change that leaves one of them behind fails here rather than misleading
 * whoever reads it next.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANNING_LIMITS } from "../planningScan/limits";
import { readRepoFile, repoPath } from "../test/planning";

const REFERENCE = "docs/reference/planning-index.md";
const SPEC = "docs/design/technical_spec.md";
const GUIDE = "userguide/guides/planning.md";
const FEATURES = "userguide/features.md";

/** Markdown with its line wrapping undone, so a quote may cross a line. */
function flat(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

/**
 * The section under the first heading starting with `heading`, such as
 * `"### 12.3"`, up to the next heading of the same level or higher.
 */
function section(markdown: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 0;
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start < 0) throw new Error(`no heading starting "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const hashes = /^(#+) /.exec(line)?.[1].length;
    return hashes !== undefined && hashes <= level;
  });
  return rest.slice(0, end < 0 ? undefined : end).join("\n");
}

describe("the old planning batch's 410", () => {
  const detail = /const planningBatchGone = "([^"]+)"/.exec(
    readRepoFile("internal/api/planning_handlers.go"),
  )?.[1];

  it("is quoted in the reference exactly as the server writes it", () => {
    expect(detail).toBeDefined();
    expect(
      flat(section(readRepoFile(REFERENCE), "## Current values")),
    ).toContain(detail);
  });

  it("is never promised to a reader as what a page shows", () => {
    // No page reads the detail. The one client that ever asked for the batch,
    // the store before the stream, showed its own "Could not load the
    // planning index" with axios's status text, and no release ever shipped
    // it, so the detail is for a direct API caller only.
    expect(flat(readRepoFile(GUIDE))).not.toContain(detail);
  });
});

/** Each `.vantage.toml` stage word's role. */
function stageRoles(): Map<string, string> {
  const table = readRepoFile(".vantage.toml").split("[planning.stages]")[1];
  if (table === undefined) throw new Error("no [planning.stages] table");
  const body = table.split(/^\[/m)[0] ?? "";
  return new Map(
    [...body.matchAll(/^(\w+)\s*=\s*"(\w+)"/gm)].map((m) => [m[1], m[2]]),
  );
}

describe("the reference", () => {
  it("anchors to symbols and packages, never to a line", () => {
    // A system doc outlives its own line numbers: a `#L42` link is wrong the
    // first time anyone edits the file above it, and a reader who finds one
    // stale stops trusting the rest. The reference names a symbol and the
    // package it lives in instead, which a search finds after it moves.
    const reference = readRepoFile(REFERENCE);
    const inline = [...reference.matchAll(/\]\(([^)\s]+)\)/g)];
    const defined = [...reference.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)];
    const anchored = [...inline, ...defined]
      .map((match) => match[1] ?? "")
      .filter((target) => /#L\d/.test(target));

    expect(inline.length).toBeGreaterThan(0);
    expect(anchored).toEqual([]);
  });

  it("is filed under a stage whose role is done", () => {
    // The reference describes what is built, so it owes nobody a ruling or a
    // build: a `done` role keeps it out of every section of the planning page.
    const stage = /^stage:\s*(\S+)/m.exec(readRepoFile(REFERENCE))?.[1] ?? "";
    expect(stageRoles().get(stage)).toBe("done");
  });
});

/** The section numbers the reference's own headings carry, as `6` and `6.4`. */
function referenceSections(): Set<string> {
  const numbers = [
    ...readRepoFile(REFERENCE).matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? /gm),
  ].map((match) => match[1] ?? "");
  return new Set(numbers);
}

/** Every source file under `dir`, repository-relative, tests included. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(repoPath(dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...sourceFiles(rel));
    } else if (/\.(?:ts|tsx|go|css|toml)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe("a citation of the reference in code", () => {
  it("names a section the reference has", () => {
    // Code comments cite the reference by section number, and no Markdown
    // checker reads a comment. Each section a comment names right after the
    // reference's file name, as `planning-index.md` §6.4, or §9.1 and §9.4,
    // has to be a numbered heading of the reference, or the pointer leads
    // nowhere once the reference is renumbered.
    const sections = referenceSections();
    expect(sections.has("6.4")).toBe(true);

    const citation =
      /planning-index\.md`?,?\s*((?:§\d+(?:\.\d+)?(?:(?:,\s*|\s+and\s+|–)(?=§))?)+)/g;
    const dangling: string[] = [];
    let cited = 0;
    for (const dir of [
      "frontend/src",
      "frontend/e2e",
      "packages/vantage-md/src",
      "packages/vantage-check/src",
      "packages/vantage-check/test",
      "internal",
    ]) {
      for (const file of sourceFiles(dir)) {
        // Comments are wrapped, so a citation may cross a line.
        const text = flat(
          readRepoFile(file).replace(/\n\s*(?:\*|\/\/|#)\s?/g, " "),
        );
        for (const match of text.matchAll(citation)) {
          for (const number of (match[1] ?? "").matchAll(/§(\d+(?:\.\d+)?)/g)) {
            cited++;
            if (!sections.has(number[1] ?? "")) {
              dangling.push(`${file}: §${number[1] ?? ""}`);
            }
          }
        }
      }
    }
    expect(cited).toBeGreaterThan(50);
    expect(dangling).toEqual([]);
  });
});

describe("a document's first paint", () => {
  const holdMs = `${DEFAULT_PLANNING_LIMITS.holdMs} ms`;

  /**
   * What the hold waits on, by the name `ViewerPage`'s `firstPaintWaiting`
   * reads it under, and the words a doc that lists them uses.
   */
  const INPUTS: Record<string, string> = {
    statusByPath: "git status",
    historyByPath: "history",
    warmBuild: "warm build",
    isRecentLoading: "recent-files list",
    recentFiles: "recent-files list",
    isRepoInfoLoading: "`/info`",
  };
  /** The names in that expression that are not something waited on. */
  const NOT_INPUTS = new Set([
    "loadedPath",
    "null",
    "undefined",
    "toLowerCase",
    "endsWith",
    "length",
  ]);

  it("names everything the hold waits on, in the reference and the spec", () => {
    const expression = /const firstPaintWaiting =([\s\S]*?);/.exec(
      readRepoFile("frontend/src/pages/ViewerPage.tsx"),
    )?.[1];
    expect(expression, "ViewerPage's firstPaintWaiting").toBeDefined();
    const names = new Set(
      (expression ?? "")
        .replace(/"[^"]*"/g, "")
        .match(/[A-Za-z_$][\w$]*/g)
        ?.filter((name) => !NOT_INPUTS.has(name)),
    );
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      expect(
        INPUTS,
        `the hold waits on ${name}; add it here and to the docs`,
      ).toHaveProperty(name);
    }

    const reference = readRepoFile(REFERENCE);
    const hold = flat(section(reference, "### 12.3"));
    const spec = flat(readRepoFile(SPEC));
    const specBullet = /\*\*Document pages\*\*[^*]*?(?= - \*\*|$)/.exec(
      spec,
    )?.[0];
    expect(specBullet, "technical_spec's Document pages bullet").toBeDefined();
    for (const name of names) {
      const words = INPUTS[name] ?? name;
      expect(hold, `the reference's §12.3 on ${name}`).toContain(words);
      expect(specBullet, `technical_spec on ${name}`).toContain(words);
    }
    // The reference states a number once, in its Current values table.
    expect(flat(section(reference, "## Current values"))).toContain(
      `| The hold | ${holdMs}`,
    );
    expect(specBullet).toContain(holdMs);
  });

  it("is said to wait for git's answer, for at most the hold, wherever the guide says it waits", () => {
    // features.md said the header's git facts are waited for, and the planning
    // guide said a document paints as soon as its content arrives; both are
    // read by the same person, about the same paint.
    const paragraphs = [GUIDE, FEATURES]
      .flatMap((path) => readRepoFile(path).split(/\n\s*\n/))
      .map(flat)
      .filter((paragraph) => /first paint waits/.test(paragraph));

    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    for (const paragraph of paragraphs) {
      expect(paragraph).toContain(holdMs);
      expect(paragraph).toMatch(/\bgit\b/);
    }
  });
});
