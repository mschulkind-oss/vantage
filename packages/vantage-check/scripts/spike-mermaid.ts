/**
 * Mermaid headless spike (design agent-cli.md §5.2 / R5).
 *
 * R5 asked whether validating Mermaid in the CLI needs a DOM shim (jsdom).
 * This script measures the answer on the pinned mermaid version by driving
 * `mermaid.parse` — the headless grammar validator — with no DOM present.
 *
 * Run:  bun scripts/spike-mermaid.ts
 *
 * FINDINGS (mermaid 11.16.0, bun, no DOM):
 *   - `mermaid.parse(text)` resolves for valid diagrams (returns {diagramType}).
 *   - A grammar error THROWS `Error` whose message matches /Parse error on line \d+/.
 *   - An unrecognized/empty diagram THROWS `UnknownDiagramError`
 *     ("No diagram type detected...").
 *   - No `document`/`window` access is required — it runs bare in Node/bun.
 *
 * DECISION: no DOM shim. The mermaid/parse validator calls `mermaid.parse`
 * and classifies: Parse-error and UnknownDiagramError => document-wrong
 * finding; any other throw => EnvironmentFailure (unchecked, exit 2).
 */

export {};

const { default: mermaid } = await import("mermaid");

interface Case {
  label: string;
  text: string;
}

const cases: Case[] = [
  { label: "valid flowchart", text: "graph TD\n  A-->B" },
  { label: "valid sequence", text: "sequenceDiagram\n  A->>B: hi" },
  { label: "valid er", text: "erDiagram\n  A ||--o{ B : has" },
  { label: "grammar error (dangling arrow)", text: "graph TD\n  A-->" },
  { label: "grammar error (trailing op)", text: "graph TD\n  A --> B -->" },
  { label: "unknown diagram type", text: "bogusDiagram\n  A-->B" },
  { label: "empty", text: "" },
];

let grammarErrors = 0;
let unknownType = 0;
let other = 0;
let ok = 0;

for (const c of cases) {
  try {
    const r = (await mermaid.parse(c.text)) as { diagramType: string };
    ok++;
    console.log(`OK     ${c.label.padEnd(28)} diagramType=${r.diagramType}`);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const msg = (err.message || String(err)).replace(/\s+/g, " ").slice(0, 90);
    if (err.name === "UnknownDiagramError") {
      unknownType++;
      console.log(`UNKNW  ${c.label.padEnd(28)} ${msg}`);
    } else if (/Parse error on line \d+/.test(msg)) {
      grammarErrors++;
      console.log(`PARSE  ${c.label.padEnd(28)} ${msg}`);
    } else {
      other++;
      console.log(`OTHER  ${c.label.padEnd(28)} name=${err.name} ${msg}`);
    }
  }
}

console.log(
  `\nsummary: ok=${ok} grammar-errors=${grammarErrors} unknown-type=${unknownType} other=${other}`,
);
console.log(
  "=> 'other' must stay 0 for the validator to be safe; any OTHER throw is classified as an environment failure.",
);
