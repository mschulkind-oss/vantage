/**
 * The Markdown a question's card on the planning page renders (design §6.3),
 * cut from the parse the scan has already made
 * (`docs/design/planning-index-at-scale.md` §7.4).
 *
 * The card shows the question exactly as the viewer renders it in its
 * document, so it renders a slice of the document through the viewer's own
 * pipeline rather than any summary of it. The slice is the root-level block
 * holding the question: a root-level block parses the same on its own as in
 * place, where an item cut out of a list or a quote would not. The page then
 * hides everything in the card outside the question's own unit.
 *
 * The scan takes an outline of its root before anything rewrites it, and cuts
 * one card block for each distinct block its questions sit in, so a document
 * is parsed once for its facts and its cards together.
 */

import type { Nodes, Root } from "mdast";
import type { CardBlock, PlanningQuestion } from "./scan.js";

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

/** File lines, first and last, both inclusive. */
interface Span {
  from: number;
  to: number;
}

/** What cutting a card needs of its document's parse. */
export interface Outline {
  /** The root-level blocks, and whether each holds a footnote. */
  blocks: (Span & { footnote: boolean })[];
  /** Every link reference definition, written back out. */
  definitions: (Span & { text: string })[];
}

/**
 * The outline of a body already parsed. `bodyLineOffset` is the number of
 * file lines before the body, so every span is in file lines.
 *
 * It reads only the root's own children and the `definition` nodes, so it
 * parses nothing and keeps nothing.
 */
export function outlineOf(root: Root, bodyLineOffset: number): Outline {
  const span = (node: Nodes): Span => ({
    from: (node.position?.start.line ?? 0) + bodyLineOffset,
    to: (node.position?.end.line ?? 0) + bodyLineOffset,
  });

  const definitions: Outline["definitions"] = [];
  const collect = (node: Nodes): void => {
    if (node.type === "definition") {
      definitions.push({ ...span(node), text: definitionText(node) });
      return;
    }
    if ("children" in node) (node.children as Nodes[]).forEach(collect);
  };
  collect(root);
  return {
    blocks: root.children.map((child) => ({
      ...span(child),
      footnote: holdsFootnote(child),
    })),
    definitions,
  };
}

/**
 * One card block for each distinct span in `spans`, in file order.
 *
 * A span is a question's `block`, which for a root-level directive starts at
 * the directive's comment, so the card stamps the same host the document does.
 * The document's link reference definitions follow the slice after one blank
 * line: a definition directly after a paragraph would be read as more of that
 * paragraph. A block holding a footnote gets the whole document instead, with
 * an offset of 0, because footnotes are numbered in document order: sliced
 * out, the second footnote would render as the first, and its text, and so the
 * comment anchor hashed from it, would differ.
 *
 * No two distinct blocks of one document start on the same line. A block
 * starts on the first line of the root-level node its questions sit in, or on
 * the line of a root-level directive run's first comment, which sits in an
 * HTML node holding no questions; no two root-level nodes share a line, and of
 * the runs in one HTML node only the last can reach a host. So `startLine`
 * alone names a block, which `planningCard.test.ts` holds over the corpus.
 */
export function cutCardBlocks(
  source: string,
  outline: Outline,
  spans: readonly { startLine: number; endLine: number }[],
): CardBlock[] {
  const distinct = new Map<string, { startLine: number; endLine: number }>();
  for (const { startLine, endLine } of spans) {
    const key = `${startLine}:${endLine}`;
    if (!distinct.has(key)) distinct.set(key, { startLine, endLine });
  }
  if (distinct.size === 0) return [];

  const lines = source.split("\n");
  return [...distinct.values()]
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)
    .map(({ startLine, endLine }) => {
      const inSlice = (span: Span): boolean =>
        span.from <= endLine && span.to >= startLine;
      if (outline.blocks.some((block) => inSlice(block) && block.footnote)) {
        return { startLine, endLine, markdown: source, lineOffset: 0 };
      }
      const outside = outline.definitions
        .filter((definition) => !inSlice(definition))
        .map((definition) => definition.text);
      const slice = lines.slice(startLine - 1, endLine).join("\n");
      const markdown =
        outside.length === 0
          ? `${slice}\n`
          : `${slice}\n\n${outside.join("\n")}\n`;
      return { startLine, endLine, markdown, lineOffset: startLine - 1 };
    });
}

/** The card block `question` renders, from its document's scanned `cards`. */
export function cardBlockFor(
  cards: readonly CardBlock[],
  question: Pick<PlanningQuestion, "block">,
): CardBlock | undefined {
  const { startLine, endLine } = question.block;
  return cards.find(
    (card) => card.startLine === startLine && card.endLine === endLine,
  );
}
