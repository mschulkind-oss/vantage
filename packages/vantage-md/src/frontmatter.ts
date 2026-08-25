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

/**
 * A frontmatter block as `parseFrontmatterStrict` reports it: the usual
 * fields, plus whether the block is broken and how.
 */
export interface StrictFrontmatter extends ParsedFrontmatter {
  /**
   * True when a delimiter was opened but never closed, so the "frontmatter"
   * would render as visible body text. Only set when the block actually looks
   * like frontmatter (not a `---` used as a horizontal rule).
   */
  unclosed: boolean;
  /** The parser's own message when the block is present but invalid; else null. */
  error: string | null;
}

/**
 * Heuristic that keeps the strict parser from misreading a `---` used as a
 * horizontal rule (or a setext underline) as frontmatter: the first meaningful
 * line must look like a `key:` / `key =` pair or a TOML `[section]`.
 */
function looksLikeFrontmatter(text: string): boolean {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#") || t.startsWith("//")) continue;
    if (/^[A-Za-z_][A-Za-z0-9_.-]*\s*[:=]/.test(t)) return true;
    if (/^\[[A-Za-z_]/.test(t)) return true;
    return false;
  }
  return false;
}

/**
 * Like `parseFrontmatter`, but instead of silently swallowing a broken block it
 * reports it: `unclosed` when a delimiter was never closed, `error` (the
 * parser's message) when the block is present but not valid YAML/TOML. A block
 * that does not look like frontmatter (a `---` horizontal rule) is left
 * unflagged. The returned `body`/`frontmatter`/`format` are identical to
 * `parseFrontmatter`'s, so this is safe to use alongside it.
 */
export function parseFrontmatterStrict(content: string): StrictFrontmatter {
  if (content.startsWith("+++")) {
    return strictWithDelimiter(content, "+++", "toml");
  }
  if (content.startsWith("---")) {
    return strictWithDelimiter(content, "---", "yaml");
  }
  return withStrict(
    content,
    { frontmatter: {}, body: content, format: "none" },
    false,
    null,
  );
}

function strictWithDelimiter(
  content: string,
  delimiter: string,
  format: "yaml" | "toml",
): StrictFrontmatter {
  const searchStart = delimiter.length;
  const endIndex = content.indexOf(`\n${delimiter}`, searchStart);

  if (endIndex === -1) {
    // Delimiter opened but never closed. Only a finding if it actually looks
    // like frontmatter — otherwise it is a `---` horizontal rule.
    const unclosed = looksLikeFrontmatter(content.slice(searchStart + 1));
    return withStrict(
      content,
      { frontmatter: {}, body: content, format: "none" },
      unclosed,
      null,
    );
  }

  const raw = content.slice(searchStart + 1, endIndex).trim();
  const bodyStart = endIndex + 1 + delimiter.length;
  const body = content.slice(bodyStart).replace(/^\n/, "");

  try {
    const frontmatter =
      format === "toml"
        ? (parseTOML(raw) as Record<string, unknown>)
        : (YAML.parse(raw) as Record<string, unknown>);
    return withStrict(content, { frontmatter: frontmatter || {}, body, format }, false, null);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A parse failure is only a finding if the block looks like frontmatter;
    // a top `---` hr followed by a mid-file `---` is not.
    const error = looksLikeFrontmatter(raw) ? message : null;
    return withStrict(
      content,
      { frontmatter: {}, body: content, format: "none" },
      false,
      error,
    );
  }
}

function withStrict(
  content: string,
  parsed: Omit<StrictFrontmatter, "bodyLineOffset" | "unclosed" | "error">,
  unclosed: boolean,
  error: string | null,
): StrictFrontmatter {
  return { ...withOffset(content, parsed), unclosed, error };
}
