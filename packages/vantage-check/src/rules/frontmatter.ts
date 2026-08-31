import type { Collector } from "../core/collector.js";

/**
 * Frontmatter, delegated to the viewer's own parser.
 *
 * `parseFrontmatter` never throws — a document with broken frontmatter still
 * renders, with the block silently treated as body text. That is right for a
 * viewer and useless for an author, who sees a metadata card quietly missing
 * and no reason why. All this rule does is surface what the parser already
 * knew, in the parser's own words.
 */
export function checkFrontmatter(collector: Collector): void {
  const { problem } = collector.doc.frontmatter;
  if (!problem) return;

  // The block starts on line 1, so a position inside it is offset by the
  // opening delimiter's line.
  const at = {
    line: problem.line === undefined ? 1 : problem.line + 1,
    column: problem.column ?? 1,
  };

  switch (problem.kind) {
    case "invalid":
      collector.report(
        "frontmatter/parse",
        at,
        `The frontmatter block does not parse, so Vantage renders it as body text instead of a metadata card.`,
        problem.message,
      );
      break;

    case "unterminated":
      collector.report(
        "frontmatter/unterminated",
        { line: 1, column: 1 },
        `The document opens with \`${problem.delimiter}\` but never closes it, so the metadata is rendered as body text.`,
      );
      break;

    case "not-a-mapping":
      collector.report(
        "frontmatter/not-a-mapping",
        { line: 1, column: 1 },
        `The frontmatter parses to a value rather than a table of fields. Vantage expects \`key: value\` pairs; a \`${problem.delimiter}\` at the top of a document is read as frontmatter, not as a horizontal rule.`,
      );
      break;
  }
}
