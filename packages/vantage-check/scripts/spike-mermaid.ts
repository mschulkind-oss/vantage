/**
 * Mermaid headless spike (design agent-cli.md §5.2 / R5).
 *
 * R5 asked whether validating Mermaid in the CLI needs a DOM shim (jsdom).
 * This script measures the answer on the pinned mermaid version by driving
 * `mermaid.parse` — the headless grammar validator — with no DOM present.
 *
 * Run:  bun scripts/spike-mermaid.ts
 *
 * FINDINGS (mermaid 11.16.0, bun and node, no DOM):
 *   - `mermaid.parse(text)` resolves for valid diagrams (returns {diagramType}).
 *   - A grammar error THROWS `Error` whose message matches /Parse error on line \d+/.
 *   - An unrecognized/empty diagram THROWS `UnknownDiagramError`
 *     ("No diagram type detected...").
 *   - No `document`/`window` access is required for *unlabeled* diagrams.
 *   - TRAP (found by dogfooding the CLI on this repo's own userguide): a
 *     flowchart with labeled nodes or edges (`A[Start]`, `B -->|Yes| C`)
 *     pushes `mermaid.parse` through its bundled DOMPurify — hook setup then
 *     `sanitize` of each label. DOMPurify's factory given no DOM returns a
 *     method-less stub, so the hook setup throws
 *     `TypeError: DOMPurify.addHook is not a function` — on node *and* bun,
 *     i.e. systematically, not a broken environment. Left unaddressed, this
 *     made every labeled-flowchart repo a permanently exit-2 run.
 *
 * DECISION: no jsdom (the design rejected a DOM shim; it is heavy and parse
 * never renders). Instead the CLI bundles a headless stand-in for dompurify
 * (src/shims/dompurify.ts, aliased in tsconfig paths + vitest): an identity
 * sanitize, since `mermaid.parse` only validates grammar and never emits
 * HTML — sanitization is a render-time concern the browser's real DOMPurify
 * handles. The jison grammar check then runs exactly as in the browser, and
 * the classifier is unchanged: Parse-error and UnknownDiagramError =>
 * document-wrong finding; any other throw => EnvironmentFailure (exit 2).
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
