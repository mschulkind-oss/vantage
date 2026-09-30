/**
 * The planning docs say what the built code does.
 *
 * `docs/design/planning-index.md` and its amendment for large repositories,
 * `docs/design/planning-index-at-scale.md`, are the design of record, and
 * `docs/design/technical_spec.md` and the user guide's
 * `userguide/guides/planning.md` retell parts of them. Each case holds one
 * claim a reader acts on to the code, the server or the other doc it
 * describes, so a change that leaves one of them behind fails here rather than
 * misleading whoever reads it next.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PLANNING_LIMITS } from "../planningScan/limits";
import { readRepoFile } from "../test/planning";

const DESIGN = "docs/design/planning-index-at-scale.md";
const BASE_DESIGN = "docs/design/planning-index.md";
const SPEC = "docs/design/technical_spec.md";
const GUIDE = "userguide/guides/planning.md";
const FEATURES = "userguide/features.md";

/** Markdown with its line wrapping undone, so a quote may cross a line. */
function flat(markdown: string): string {
  return markdown.replace(/\s+/g, " ");
}

/**
 * The section under the first heading starting with `heading`, such as
 * `"### 11.3"`, up to the next heading of the same level or higher.
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

/** The anchors of the links in `markdown` that point into `file`. */
function anchorsInto(markdown: string, file: string): Set<string> {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\]\\(${escaped}(#[\\w-]+)\\)`, "g");
  return new Set([...markdown.matchAll(pattern)].map((match) => match[1]));
}

describe("the old planning batch's 410", () => {
  const detail = /const planningBatchGone = "([^"]+)"/.exec(
    readRepoFile("internal/api/planning_handlers.go"),
  )?.[1];

  it("is quoted in the design exactly as the server writes it", () => {
    expect(detail).toBeDefined();
    expect(flat(section(readRepoFile(DESIGN), "### 6.1"))).toContain(detail);
  });

  it("is never promised to a reader as what a page shows", () => {
    // No page reads the detail. The one client that ever asked for the batch,
    // the store before the stream, showed its own "Could not load the
    // planning index" with axios's status text, and no release ever shipped
    // it, so the detail is for a direct API caller only.
    expect(flat(readRepoFile(GUIDE))).not.toContain(detail);
  });
});

describe("the amendment's evidence", () => {
  const design = readRepoFile(DESIGN);

  it("pins every line-anchored link to the tree it was verified against", () => {
    // A relative link carries a line number into whatever the file holds now,
    // so once the code moved it landed on unrelated lines. The design's
    // evidence is the tree its status line names, which a permalink keeps.
    const verified = /verified against the tree at `([0-9a-f]{7,40})`/.exec(
      flat(design),
    )?.[1];
    expect(verified).toBeDefined();

    const inline = [...design.matchAll(/\]\(([^)\s]+)\)/g)];
    const defined = [...design.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)];
    const anchored = [...inline, ...defined]
      .map((match) => match[1])
      .filter((target) => /#L\d/.test(target));

    expect(anchored.length).toBeGreaterThan(0);
    for (const target of anchored) {
      const sha =
        /^https:\/\/github\.com\/mschulkind-oss\/vantage\/blob\/([0-9a-f]{40})\//.exec(
          target,
        )?.[1];
      expect(sha, target).toBeDefined();
      expect(sha?.startsWith(verified ?? "?"), target).toBe(true);
    }
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

/** The `Built` cells of a design's Decision Ledger, one per ruling. */
function builtCells(markdown: string): string[] {
  const ledger = section(markdown, "## Decision Ledger");
  const rows = ledger.split("\n").filter((line) => line.startsWith("| "));
  const header = rows[0]?.split("|").map((cell) => cell.trim()) ?? [];
  const column = header.indexOf("Built");
  if (column < 0) throw new Error("the ledger has no Built column");
  return rows.slice(2).map((row) => row.split("|")[column]?.trim() ?? "");
}

describe("a planning design's stage", () => {
  // A `—` in the Built column is a ruling nothing has built yet, so the
  // design still owes work and is filed under Ready; a design whose every
  // ruling is built owes nothing, and Ready would send a reader to build it
  // again.
  it.each([BASE_DESIGN, DESIGN])("agrees with %s's own ledger", (path) => {
    const markdown = readRepoFile(path);
    const stage = /^stage:\s*(\S+)/m.exec(markdown)?.[1] ?? "";
    const role = stageRoles().get(stage);
    const cells = builtCells(markdown);

    expect(cells.length).toBeGreaterThan(0);
    const unbuilt = cells.filter((cell) => !cell.startsWith("✅"));
    if (role === "built") expect(unbuilt).toEqual([]);
    if (unbuilt.length === 0) expect(role).not.toBe("ready");
  });
});

describe("planning-index.md, once amended", () => {
  const base = readRepoFile(BASE_DESIGN);
  const changes = section(readRepoFile(DESIGN), "## 14.");

  /** The planning-index.md sections the amendment's §14 table names. */
  const changed = new Set(
    changes
      .split("\n")
      .filter((line) => line.startsWith("| [§"))
      .flatMap((line) => [
        ...anchorsInto(line.split("|")[1] ?? "", "planning-index.md"),
      ]),
  );

  it("names in Reads with every section the amendment changed", () => {
    const readsWith = /^\*\*Reads with:\*\*[\s\S]*?\n\n/m.exec(base)?.[0] ?? "";
    const named = new Set(
      [...readsWith.matchAll(/\]\((#[\w-]+)\)/g)].map((m) => m[1]),
    );

    expect(changed.size).toBeGreaterThan(0);
    expect([...changed].filter((anchor) => !named.has(anchor))).toEqual([]);
  });

  it("lists in the amendment every section that carries its dated note", () => {
    // Each heading whose own text, before the next heading, carries an
    // "Amended 2026-09-29" note, as its anchor.
    const amended = base
      .split(/^(?=#+ )/m)
      .filter((part) => part.includes("> **Amended 2026-09-29"))
      .map(
        (part) =>
          "#" +
          (/^#+ (.+)/.exec(part)?.[1] ?? "")
            .toLowerCase()
            .replace(/[^\w\s-]/g, "")
            .replace(/\s/g, "-"),
      );

    expect(amended.length).toBeGreaterThan(0);
    expect(amended.filter((anchor) => !changed.has(anchor))).toEqual([]);
  });

  it("describes the built system in its bodies, not the batch", () => {
    // Its bodies were kept frozen at the 2026-09-28 ruling while the
    // amendment was unbuilt. Built, a body that still describes the batch
    // tells a reader how a system works that no longer exists.
    expect(base).not.toMatch(/text below is the design as ruled/);
    const transport = flat(section(base, "### 3.4"));
    expect(transport).toContain("POST …/planning/stream");
    expect(transport).not.toContain("one request returns every candidate");
    expect(flat(section(base, "### 3.6"))).not.toMatch(/\bbatch\b/);
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

  it("names everything the hold waits on, in the design and the spec", () => {
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

    const hold = flat(section(readRepoFile(DESIGN), "### 11.3"));
    const spec = flat(readRepoFile(SPEC));
    const specBullet = /\*\*Document pages\*\*[^*]*?(?= - \*\*|$)/.exec(
      spec,
    )?.[0];
    expect(specBullet, "technical_spec's Document pages bullet").toBeDefined();
    for (const name of names) {
      const words = INPUTS[name] ?? name;
      expect(hold, `design §11.3 on ${name}`).toContain(words);
      expect(specBullet, `technical_spec on ${name}`).toContain(words);
    }
    expect(hold).toContain(holdMs);
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
