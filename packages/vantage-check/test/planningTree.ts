import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTree } from "./helpers.js";
import {
  questionDirectiveFor,
  vantageOqStatus,
} from "../../vantage-md/src/vantageDirectives.js";

/**
 * Planning fixtures shared by the `index` and planning-rule suites: small
 * repositories whose documents land in every section of the planning page
 * (`docs/reference/planning-index.md` §6.2).
 */

/**
 * A loose list of questions, `OQ-<prefix>1`, `OQ-<prefix>2`, …, one per
 * marker, each with a directive and a leaning, as the design-doc convention
 * writes them: an open question's `oq` restates the leaning, and a 🔒 or ✅
 * one is declared with a `question` directive, which takes none.
 */
export function questions(prefix: string, ...markers: string[]): string {
  return markers
    .map((marker, i) => {
      const id = `OQ-${prefix}${i + 1}`;
      const directive =
        questionDirectiveFor(vantageOqStatus(marker)) === "oq"
          ? `oq id=${id} leaning="Yes."`
          : `question id=${id}`;
      return [
        `${i + 1}. ${marker} **${id}: Question ${prefix}${i + 1}?**`,
        "",
        `   <!-- vantage: ${directive} -->`,
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
