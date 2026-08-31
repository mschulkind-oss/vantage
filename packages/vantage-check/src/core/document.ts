import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
// The viewer's own frontmatter parser, imported from source. Re-implementing
// it here would let the checker accept documents the viewer mangles.
import {
  parseFrontmatter,
  type ParsedFrontmatter,
} from "../../../vantage-md/src/frontmatter.js";

/**
 * A Markdown file, parsed exactly the way the viewer parses it.
 *
 * The `mdast` is of the *body* — frontmatter stripped — which is what
 * renderMarkdown feeds the pipeline. Every position that comes out of it is
 * therefore short by however many lines the frontmatter took, and has to be
 * put back through `fileLine` before a human sees it.
 */
export interface Document {
  /** Absolute path. */
  path: string;
  /** Path relative to the working directory, for display. */
  display: string;
  /** The whole file. */
  text: string;
  /** The file's lines, split on newlines. */
  lines: string[];
  frontmatter: ParsedFrontmatter;
  /** mdast of the body. */
  mdast: Root;
}

/**
 * The same processor the viewer parses with: GFM on, and `$` disabled as a math
 * delimiter so `$HOME` in prose is text rather than a broken formula.
 */
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath, { singleDollarTextMath: false });

export function parseMarkdown(body: string): Root {
  return parser.parse(body) as Root;
}

export function loadDocument(path: string, cwd: string): Document {
  const absolute = resolve(cwd, path);
  const text = readFileSync(absolute, "utf8");
  const frontmatter = parseFrontmatter(text);

  return {
    path: absolute,
    display: displayPath(absolute, cwd),
    text,
    lines: text.split("\n"),
    frontmatter,
    mdast: parseMarkdown(frontmatter.body),
  };
}

/**
 * Turn a line number in the parsed body into a line number in the file.
 *
 * Frontmatter is stripped before parsing, so every mdast position is offset by
 * the lines it consumed. Anything that reports a number without this points
 * `bodyLineOffset` lines above the text it names.
 */
export function fileLine(doc: Document, bodyLine: number): number {
  return bodyLine + doc.frontmatter.bodyLineOffset;
}

/** A path to show a human: relative to cwd, unless that is uglier. */
export function displayPath(absolute: string, cwd: string): string {
  const rel = relative(cwd, absolute);
  if (rel === "") return ".";
  return rel.startsWith("..") ? absolute : rel;
}
