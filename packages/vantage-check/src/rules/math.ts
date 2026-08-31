import katex from "katex";
import { visit } from "unist-util-visit";
import type { Collector } from "../core/collector.js";

/**
 * Math, delegated to KaTeX itself.
 *
 * The viewer renders `$$...$$` with rehype-katex, which turns a formula KaTeX
 * rejects into red error text in the page. So the question "does this render"
 * is exactly "does KaTeX parse it", and the only honest way to answer it is to
 * hand the formula to KaTeX.
 *
 * `singleDollarTextMath` is off in the parser (see core/document.ts), matching
 * the viewer: `$HOME` and `$100` in prose are text, not a broken formula.
 */
export function checkMath(collector: Collector): void {
  if (!collector.enabled("katex/parse")) return;

  visit(collector.doc.mdast, (node) => {
    if (node.type !== "math" && node.type !== "inlineMath") return;
    const value = (node as { value?: string }).value ?? "";

    try {
      katex.renderToString(value, {
        displayMode: node.type === "math",
        throwOnError: true,
        // KaTeX's "strict" mode warns to the console about things that render
        // perfectly well (Unicode text in math mode, for one). The viewer
        // leaves those alone, so reporting them here would be inventing a
        // standard the renderer does not hold anyone to.
        strict: false,
      });
    } catch (error) {
      const classified = classify(error);
      if (classified.kind === "document") {
        collector.report(
          "katex/parse",
          collector.at(node),
          "KaTeX cannot parse this formula, so Vantage renders it as red error text.",
          classified.message,
        );
      } else {
        collector.fail("katex/parse", classified.message);
      }
    }
  });
}

/**
 * Is this KaTeX telling us the *formula* is wrong, or telling us KaTeX itself
 * is unhappy?
 *
 * Only `ParseError` is a statement about the document. Anything else — a
 * TypeError, a missing font table, a version mismatch — is our problem, and
 * reporting it as a defect in someone's document is how a checker loses its
 * reader.
 */
function classify(error: unknown): {
  kind: "document" | "environment";
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const name = (error as { name?: string } | undefined)?.name;

  if (name === "ParseError" || message.startsWith("KaTeX parse error")) {
    return { kind: "document", message };
  }
  return { kind: "environment", message };
}
