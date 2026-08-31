/**
 * Frontmatter parser for YAML (---) and TOML (+++) delimited content.
 * Works in both browser and server environments.
 */

import YAML from "yaml";
import { parse as parseTOML } from "smol-toml";

export type FrontmatterFormat = "yaml" | "toml" | "none";

/**
 * Why a document that *looks* like it has frontmatter ended up without any.
 *
 * The parser deliberately never throws: a document whose frontmatter is broken
 * still renders, with the block treated as body text. That is the right
 * behaviour for a viewer and the wrong one for an author, who gets no signal
 * at all — so the reason is recorded here for anything that wants to report it
 * (`vantage-check` does; see its frontmatter rules).
 *
 * - `unterminated` — an opening delimiter with no closing one.
 * - `invalid` — the block did not parse; `message` is the parser's own words,
 *   and `line`/`column` are 1-based *within the block* when it said.
 * - `not-a-mapping` — it parsed, but to a string or a list rather than a table
 *   of fields, which is not something a metadata card can render.
 */
export interface FrontmatterProblem {
  kind: "unterminated" | "invalid" | "not-a-mapping";
  /** The delimiter the document opened with. */
  delimiter: string;
  message?: string;
  line?: number;
  column?: number;
}

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
  format: FrontmatterFormat;
  /**
   * How many source lines the frontmatter block consumed — the shift between a
   * line number in `body` and the same line in the original file:
   * `fileLine = bodyLine + bodyLineOffset`.
   *
   * Anything that renders `body` and reports line numbers (line anchors, review
   * comment anchors) has to add this back, or every number it produces points
   * `bodyLineOffset` lines short of the text it names.
   */
  bodyLineOffset: number;
  /**
   * Set when the document opens with a frontmatter delimiter that did not
   * yield a metadata table. Everything else in this result is unchanged —
   * this records *why*, it does not change what rendering does.
   */
  problem?: FrontmatterProblem;
}

/**
 * Parse frontmatter from markdown content.
 * Supports YAML (delimited by ---) and TOML (delimited by +++).
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (content.startsWith("+++")) {
    return parseFrontmatterWithDelimiter(content, "+++", "toml");
  }
  if (content.startsWith("---")) {
    return parseFrontmatterWithDelimiter(content, "---", "yaml");
  }
  return withOffset(content, { frontmatter: {}, body: content, format: "none" });
}

/**
 * Fill in `bodyLineOffset`. `body` is always a suffix of `content`, so the
 * newlines in the prefix that was stripped are exactly the shift — which also
 * accounts for the blank line consumed after the closing delimiter.
 */
function withOffset(
  content: string,
  parsed: Omit<ParsedFrontmatter, "bodyLineOffset">,
): ParsedFrontmatter {
  const stripped = content.slice(0, content.length - parsed.body.length);
  let bodyLineOffset = 0;
  for (const ch of stripped) {
    if (ch === "\n") bodyLineOffset++;
  }
  return { ...parsed, bodyLineOffset };
}

function parseFrontmatterWithDelimiter(
  content: string,
  delimiter: string,
  format: "yaml" | "toml",
): ParsedFrontmatter {
  const searchStart = delimiter.length;
  const endIndex = content.indexOf(`\n${delimiter}`, searchStart);
  if (endIndex === -1) {
    return withOffset(content, {
      frontmatter: {},
      body: content,
      format: "none",
      problem: { kind: "unterminated", delimiter },
    });
  }

  const raw = content.slice(searchStart + 1, endIndex).trim();
  const bodyStart = endIndex + 1 + delimiter.length;
  const body = content.slice(bodyStart).replace(/^\n/, "");

  try {
    const parsed: unknown = format === "toml" ? parseTOML(raw) : YAML.parse(raw);
    return withOffset(content, {
      frontmatter: (parsed as Record<string, unknown>) || {},
      body,
      format,
      ...(isMapping(parsed)
        ? {}
        : { problem: { kind: "not-a-mapping" as const, delimiter } }),
    });
  } catch (error) {
    return withOffset(content, {
      frontmatter: {},
      body: content,
      format: "none",
      problem: { kind: "invalid", delimiter, ...errorPosition(error) },
    });
  }
}

/** Empty frontmatter is fine; a scalar or a list where a table belongs is not. */
function isMapping(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "object" && !Array.isArray(value))
  );
}

/**
 * Pull the parser's message and, where it gave one, the position inside the
 * frontmatter block. `yaml` reports `linePos`; `smol-toml` reports `line` and
 * `column`. Both are optional and both are read defensively — a missing
 * position costs a less precise report, a wrong assumption costs a crash.
 */
function errorPosition(error: unknown): {
  message: string;
  line?: number;
  column?: number;
} {
  const message = error instanceof Error ? error.message : String(error);
  const source = error as {
    linePos?: Array<{ line?: number; col?: number }>;
    line?: number;
    column?: number;
  };

  const yamlPosition = source?.linePos?.[0];
  if (typeof yamlPosition?.line === "number") {
    return {
      message,
      line: yamlPosition.line,
      ...(typeof yamlPosition.col === "number" ? { column: yamlPosition.col } : {}),
    };
  }
  if (typeof source?.line === "number") {
    return {
      message,
      line: source.line,
      ...(typeof source.column === "number" ? { column: source.column } : {}),
    };
  }
  return { message };
}
