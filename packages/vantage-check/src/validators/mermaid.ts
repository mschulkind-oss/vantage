/**
 * mermaid/parse — run each Mermaid code block through `mermaid.parse`, the
 * headless grammar validator (see scripts/spike-mermaid.ts for the measurement
 * that established this needs no DOM). Classification, per the spike:
 *
 *   - `Parse error on line N`  => the block is malformed (document-wrong)
 *   - `UnknownDiagramError`    => not a recognized diagram type (document-wrong)
 *   - anything else            => EnvironmentFailure (unchecked, exit 2)
 */

import { visit } from "unist-util-visit";
import type { Finding } from "../types.js";
import type { ParsedDoc } from "../parse.js";
import { EnvironmentFailure, type Validator } from "./types.js";

const RULE = "mermaid/parse";

// Loaded lazily so an import-time problem (e.g. a version that expects a DOM)
// surfaces as an EnvironmentFailure rather than crashing the binary.
let mermaidModule: typeof import("mermaid") | undefined;

async function getMermaid(): Promise<(typeof import("mermaid"))["default"]> {
  if (!mermaidModule) {
    try {
      mermaidModule = await import("mermaid");
    } catch (e) {
      throw new EnvironmentFailure(
        RULE,
        `could not load mermaid: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return mermaidModule.default;
}

interface Block {
  value: string;
  /** 1-based file line of the opening fence. */
  line: number;
}

function mermaidBlocks(doc: ParsedDoc): Block[] {
  const out: Block[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(doc.mdast, (node: any) => {
    if (node.type === "code" && node.lang === "mermaid") {
      out.push({
        value: node.value,
        line: (node.position?.start?.line ?? 0) + doc.bodyLineOffset,
      });
    }
  });
  return out;
}

export const validateMermaid: Validator = {
  id: "mermaid/parse",
  async run(doc) {
    const findings: Finding[] = [];
    const mermaid = await getMermaid();
    for (const block of mermaidBlocks(doc)) {
      try {
        await mermaid.parse(block.value);
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const msg = (err.message || String(e)).replace(/\s+/g, " ");
        if (err.name === "UnknownDiagramError") {
          findings.push({
            file: doc.rel,
            rule: RULE,
            severity: "error",
            line: block.line,
            message: `mermaid block is not a recognized diagram type (${msg.slice(0, 100)})`,
          });
        } else if (/Parse error on line \d+/.test(msg)) {
          findings.push({
            file: doc.rel,
            rule: RULE,
            severity: "error",
            line: block.line,
            message: `mermaid block has a syntax error: ${msg.slice(0, 120)}`,
          });
        } else {
          throw new EnvironmentFailure(
            RULE,
            `unexpected mermaid.parse error: ${msg.slice(0, 160)}`,
          );
        }
      }
    }
    return findings;
  },
};
