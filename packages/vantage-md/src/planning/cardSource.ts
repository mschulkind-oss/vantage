/**
 * The Markdown a question's card on the planning page renders (design §6.3).
 *
 * The card shows the question exactly as the viewer renders it in its
 * document, so it renders a slice of the document through the viewer's own
 * pipeline rather than any summary of it. The slice is the root-level block
 * holding the question: a root-level block parses the same on its own as in
 * place, where an item cut out of a list or a quote would not. The page then
 * hides everything in the card outside the question's own unit.
 */

import type { Nodes, Root } from "mdast";
import { parseFrontmatter } from "../frontmatter.js";
import { parseBody, type PlanningQuestion } from "./scan.js";

/** Backslash-escape what an angle-bracket destination or a title would read. */
function escape(text: string, specials: RegExp): string {
  return text.replace(specials, (ch) => `\\${ch}`);
}

/** A link reference definition, written back out from its parse. */
function definitionText(node: Extract<Nodes, { type: "definition" }>): string {
  const label = node.label ?? node.identifier;
  const url = `<${escape(node.url, /[<>\\&]/g)}>`;
  const title =
    node.title === null || node.title === undefined
      ? ""
      : ` "${escape(node.title, /["\\&]/g)}"`;
  return `[${label}]: ${url}${title}`;
}

function holdsFootnote(node: Nodes): boolean {
  if (node.type === "footnoteReference" || node.type === "footnoteDefinition") {
    return true;
  }
  return "children" in node && (node.children as Nodes[]).some(holdsFootnote);
}

/**
 * The card's Markdown, and the number of file lines before its first line —
 * pass that to the viewer as its source-line offset and every
 * `data-source-line` in the card is the document's own.
 *
 * The slice is `question.block`, which for a root-level directive starts at
 * the directive's comment, so the card stamps the same host the document does.
 * The document's link reference definitions follow it after one blank line: a
 * definition directly after a paragraph would be read as more of that
 * paragraph. A block holding a footnote gets the whole document instead, with
 * an offset of 0, because footnotes are numbered in document order: sliced out,
 * the second footnote would render as the first, and its text, and so the
 * comment anchor hashed from it, would differ.
 */
export function questionCardSource(
  source: string,
  question: PlanningQuestion,
): { markdown: string; lineOffset: number } {
  const parsed = parseFrontmatter(source);
  const root: Root = parseBody(parsed.body);
  const offset = parsed.bodyLineOffset;
  const { startLine, endLine } = question.block;
  const inSlice = (node: Nodes): boolean => {
    const from = (node.position?.start.line ?? 0) + offset;
    const to = (node.position?.end.line ?? 0) + offset;
    return from <= endLine && to >= startLine;
  };

  if (root.children.some((child) => inSlice(child) && holdsFootnote(child))) {
    return { markdown: source, lineOffset: 0 };
  }

  const definitions: string[] = [];
  const collect = (node: Nodes): void => {
    if (node.type === "definition") {
      if (!inSlice(node)) definitions.push(definitionText(node));
      return;
    }
    if ("children" in node) (node.children as Nodes[]).forEach(collect);
  };
  collect(root);

  const slice = source
    .split("\n")
    .slice(startLine - 1, endLine)
    .join("\n");
  const markdown =
    definitions.length === 0
      ? `${slice}\n`
      : `${slice}\n\n${definitions.join("\n")}\n`;
  return { markdown, lineOffset: startLine - 1 };
}
