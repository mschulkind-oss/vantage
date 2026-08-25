/**
 * math/compile — run every KaTeX expression through the same renderer the
 * viewer uses (`katex.renderToString`, the engine behind rehype-katex) and
 * report expressions that do not compile.
 */

import katex from "katex";
import { visit } from "unist-util-visit";
import type { Finding } from "../types.js";
import { EnvironmentFailure, type Validator } from "./types.js";

const RULE = "math/compile";

function isKatexError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === "ParseError" || /KaTeX parse error/.test(e.message))
  );
}

export const validateMath: Validator = {
  id: "math/compile",
  run(doc) {
    const findings: Finding[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(doc.mdast, (node: any) => {
      if (node.type !== "math" && node.type !== "inlineMath") return;
      const value: string = node.value;
      const line = (node.position?.start?.line ?? 0) + doc.bodyLineOffset;
      try {
        katex.renderToString(value, {
          throwOnError: true,
          displayMode: node.type === "math",
        });
      } catch (e) {
        if (isKatexError(e)) {
          const msg = e instanceof Error ? e.message : String(e);
          findings.push({
            file: doc.rel,
            rule: RULE,
            severity: "error",
            line,
            // Strip katex's long "Unexpected end of input..." tail; keep the
            // leading, actionable part.
            message: `KaTeX does not compile: ${msg.replace(/\s+/g, " ").slice(0, 120)}`,
          });
        } else {
          throw new EnvironmentFailure(
            "math/compile",
            `unexpected katex error: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    });
    return findings;
  },
};
