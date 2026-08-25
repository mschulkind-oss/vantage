/**
 * Load a document and compute everything the rules need, using vantage-md so
 * the CLI validates against the exact pipeline the viewer runs.
 */

import { readFileSync } from "node:fs";
import { headingIds, parseFrontmatter, parseToMdast } from "vantage-md";

export interface ParsedDoc {
  /** Absolute path on disk. */
  abs: string;
  /** Path used in reports (relative to the working directory). */
  rel: string;
  /** The raw file content, frontmatter included. */
  content: string;
  /** Content with frontmatter stripped — what the viewer renders. */
  body: string;
  /**
   * Number of source lines in the original file. Line anchors are file line
   * numbers (`data-source-line` = body line + frontmatter offset), so this is
   * the highest line a `#L<n>` anchor can point at.
   */
  lineCount: number;
  /** Lines the frontmatter consumed: fileLine = bodyLine + bodyLineOffset. */
  bodyLineOffset: number;
  /** The remark tree the viewer parses this document to. */
  mdast: ReturnType<typeof parseToMdast>;
  /** Heading ids the viewer assigns, in document order. */
  headingIds: string[];
}

/**
 * Count the lines in a piece of text the way a file has them: a trailing
 * newline terminates the last line rather than starting an empty one.
 */
export function countLines(text: string): number {
  if (text === "") return 0;
  let n = 1;
  for (const ch of text) if (ch === "\n") n++;
  if (text.endsWith("\n")) n--;
  return n;
}

/**
 * Parse markdown content the way the viewer would: strip frontmatter, then run
 * the body through the viewer's remark/rehype pipeline. Works on an in-memory
 * string so callers (and tests) can build a doc without a file on disk.
 */
export function docFromContent(
  content: string,
  abs: string,
  rel: string,
): ParsedDoc {
  const { body, bodyLineOffset } = parseFrontmatter(content);
  return {
    abs,
    rel,
    content,
    body,
    lineCount: countLines(content),
    bodyLineOffset,
    mdast: parseToMdast(body),
    headingIds: headingIds(body),
  };
}

/**
 * Read a file and parse it the way the viewer would.
 */
export function parseDoc(abs: string, rel: string): ParsedDoc {
  return docFromContent(readFileSync(abs, "utf8"), abs, rel);
}
