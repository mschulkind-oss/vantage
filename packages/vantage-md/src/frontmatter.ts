/**
 * Frontmatter parser for YAML (---) and TOML (+++) delimited content.
 * Works in both browser and server environments.
 */

import YAML from "yaml";
import { parse as parseTOML } from "smol-toml";

export type FrontmatterFormat = "yaml" | "toml" | "none";

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
    });
  }

  const raw = content.slice(searchStart + 1, endIndex).trim();
  const bodyStart = endIndex + 1 + delimiter.length;
  const body = content.slice(bodyStart).replace(/^\n/, "");

  try {
    const frontmatter =
      format === "toml"
        ? (parseTOML(raw) as Record<string, unknown>)
        : (YAML.parse(raw) as Record<string, unknown>);
    return withOffset(content, {
      frontmatter: frontmatter || {},
      body,
      format,
    });
  } catch {
    return withOffset(content, {
      frontmatter: {},
      body: content,
      format: "none",
    });
  }
}
