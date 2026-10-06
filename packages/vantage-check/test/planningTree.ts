import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLANNING_SECTION_GUIDE,
  PLANNING_SECTION_IDS,
  type PlanningFilterReason,
  type PlanningSections,
  type QuestionRef,
  type WaitingEntry,
} from "../../vantage-md/src/planning/index.js";
import { makeTree } from "./helpers.js";

/**
 * Planning fixtures shared by the `index` and planning-rule suites: small
 * repositories whose documents land in every section of the planning page
 * (`docs/reference/planning-index.md` §6.2).
 */

/**
 * A loose list of questions, `OQ-<prefix>1`, `OQ-<prefix>2`, …, one per
 * marker, each with a directive and a leaning, as the design-doc convention
 * writes them: a `question` directive in every state, restating the leaning,
 * which only an open question offers to take.
 */
export function questions(prefix: string, ...markers: string[]): string {
  return markers
    .map((marker, i) => {
      const id = `OQ-${prefix}${i + 1}`;
      return [
        `${i + 1}. ${marker} **${id}: Question ${prefix}${i + 1}?**`,
        "",
        `   <!-- vantage: question id=${id} leaning="Yes." -->`,
        "",
        "   _Leaning:_ yes.",
        "",
      ].join("\n");
    })
    .join("\n");
}

/** A document with a YAML header and a body under one heading. */
export function doc(header: string, body = ""): string {
  return `---\n${header}\n---\n\n# Title\n\n${body}\n`;
}

export const OPEN = "\u{1F4AC}";
export const BLOCKED = "\u{1F512}";
export const ANSWERED = "✅";
export const PREFERENCE = "\u{1F937}";

export const STAGES_TOML = [
  "[planning.stages]",
  'DESIGN = "open"',
  'DECIDED = "ready"',
  'BUILT = "built"',
  'RETIRED = "done"',
  "",
].join("\n");

/** The config the full fixture declares. */
export const FULL_TOML = [
  "[planning]",
  'exclude = ["drafts/**"]',
  "max-file-bytes = 4096",
  "",
  STAGES_TOML,
].join("\n");

/**
 * Every section of the page, from one tree. The paths each file lands in:
 *
 * - `docs/a.md`: OQ-A1 routed (Needs you), OQ-A2 unrouted (Not on a
 *   roadmap), OQ-A3 blocked (Blocked).
 * - `docs/b.md`: routed whole by a bare link, so its ✅ OQ-B1 and 🤷 OQ-B2
 *   are in Needs you.
 * - `docs/c.md`: DECIDED with no questions (Ready to build), and it waits on
 *   OQ-A2.
 * - `docs/d.md`: BUILT with no questions (Ready to graduate).
 * - `docs/e.md`: BUILT with an open question (Stage conflict, and Not on a
 *   roadmap).
 * - `docs/old.md`: RETIRED, the `done` role, so its open question is nowhere.
 * - `docs/huge.md` is over `max-file-bytes`, `docs/latin1.md` is not UTF-8
 *   and `docs/broken.md`'s header does not parse.
 * - `drafts/x.md` is excluded and `node_modules/pkg/x.md` is never listed,
 *   so neither is a candidate. `README.md` is a candidate and not a planning
 *   document.
 */
export const FULL_TREE: Record<string, string> = {
  ".git/HEAD": "ref: refs/heads/main\n",
  ".vantage.toml": FULL_TOML,
  "roadmap.md": [
    "# Roadmap",
    "",
    "## Rule these first",
    "",
    "- [A's first question](docs/a.md#OQ-A1): it gates the rest.",
    "- [B, all of it](docs/b.md): small.",
    "",
    "## Later",
    "",
    "- [C's ledger](docs/c.md#decision-ledger) routes nothing.",
    "- [A compacted one](docs/a.md#OQ-A9) is not found.",
    "- [The readme](README.md) is not a planning document.",
    "",
  ].join("\n"),
  "README.md": "# Readme\n",
  "docs/a.md": doc(
    "status: in-review\nstage: DESIGN",
    [
      questions("A", OPEN, OPEN, BLOCKED),
      "See [the readme](../README.md), [a draft](../drafts/x.md),",
      "[a package](../node_modules/pkg/x.md) and [myself](#title).",
    ].join("\n"),
  ),
  "docs/b.md": doc(
    "status: draft\nstage: DESIGN",
    questions("B", ANSWERED, `${OPEN} ${PREFERENCE}`),
  ),
  "docs/c.md": doc(
    "status: accepted\nstage: DECIDED\ndepends-on:\n  - a.md#OQ-A2",
    "## Decision Ledger\n\n| OQ-C1 | ruled |",
  ),
  "docs/d.md": doc("status: accepted\nstage: BUILT"),
  "docs/e.md": doc("status: accepted\nstage: BUILT", questions("E", OPEN)),
  "docs/old.md": doc("stage: RETIRED", questions("O", OPEN)),
  "docs/huge.md": doc("status: draft", "x".repeat(5000)),
  "docs/latin1.md": "",
  "docs/broken.md": "---\nstatus: [\n---\n\n# Broken\n",
  "drafts/x.md": doc("status: draft", questions("X", OPEN)),
  "node_modules/pkg/x.md": doc("status: draft", questions("N", OPEN)),
};

/** The tree above, written out, with `docs/latin1.md` given its bad byte. */
export function fullTree(): string {
  const root = makeTree(FULL_TREE);
  writeFileSync(join(root, "docs/latin1.md"), Buffer.from([0x23, 0x20, 0xe9]));
  return root;
}

/**
 * The planning filter's fixture of forms (`docs/design/planning-filter.md`
 * §10.4), which the page's tests load too (`frontend/src/test/planning.ts`):
 * a small index, every text this release reads with the documents and
 * entries it keeps there, and texts it does not understand with the term each
 * names, or the reason where there is none.
 */
export interface PlanningFilterForms {
  index: {
    stages: Record<string, string>;
    maxFileBytes: number;
    files: Record<string, string>;
    skipped: { path: string; size: number }[];
  };
  read: {
    text: string;
    canonical: string;
    documents: string[];
    questions: string[];
    keeps: string[];
    unmatched: string[];
    unknownKeys: string[];
  }[];
  notUnderstood: (
    | { text: string; term: string }
    | { text: string; reason: PlanningFilterReason }
  )[];
}

/** Where the fixture of forms lives: in the planning module, beside its reader. */
export const FILTER_FORMS_FILE = join(
  import.meta.dirname,
  "..",
  "..",
  "vantage-md",
  "src",
  "planning",
  "filterForms.json",
);

/** The fixture of forms, read fresh from disk. */
export function filterForms(): PlanningFilterForms {
  return JSON.parse(
    readFileSync(FILTER_FORMS_FILE, "utf8"),
  ) as PlanningFilterForms;
}

/** The `.vantage.toml` the fixture of forms' index is configured by. */
export function filterFormsToml(forms: PlanningFilterForms): string {
  return [
    "[planning]",
    `max-file-bytes = ${forms.index.maxFileBytes}`,
    "",
    "[planning.stages]",
    ...Object.entries(forms.index.stages).map(
      ([word, role]) => `${word} = "${role}"`,
    ),
    "",
  ].join("\n");
}

/**
 * The fixture of forms' index written out as a repository: its files, each
 * Too large path as a file of its size, and a `.vantage.toml` declaring its
 * stages and its lowered `max-file-bytes`.
 */
export function filterFormsTree(forms: PlanningFilterForms): string {
  const tree: Record<string, string> = {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".vantage.toml": filterFormsToml(forms),
    ...forms.index.files,
  };
  for (const { path, size } of forms.index.skipped) {
    tree[path] = "x".repeat(size);
  }
  return makeTree(tree);
}

/**
 * Every entry `sections` lists, in page order, as the fixture of forms names
 * one: `"<section id> <path>"` for a row, and `"<section id> <path>#<id>"` for
 * a question.
 */
export function entryKeys(sections: PlanningSections): string[] {
  type Entry = string | WaitingEntry | QuestionRef | { path: string };
  const question = (id: string, ref: QuestionRef) =>
    `${id} ${ref.path}#${ref.id ?? `line ${ref.line}`}`;
  return PLANNING_SECTION_IDS.flatMap((id) => {
    const key = PLANNING_SECTION_GUIDE[id].key;
    const entries = (sections[key] ?? []) as readonly Entry[];
    return entries.map((entry) => {
      if (typeof entry === "string") return `${id} ${entry}`;
      if ("kind" in entry) {
        return entry.kind === "document"
          ? `${id} ${entry.path}`
          : question(id, entry.question);
      }
      if ("line" in entry) return question(id, entry);
      return `${id} ${entry.path}`;
    });
  });
}
