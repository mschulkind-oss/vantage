import type { Nodes, Root } from "mdast";
import type { PlanningQuestion } from "../../../vantage-md/src/planning/index.js";
import { LEANING_MARKER } from "../../../vantage-md/src/planning/leaning.js";

/**
 * How long a question is, for `planning/question-length`: the words of its
 * text, counted the way a reader meets them on its card.
 *
 * The planning page shows a question as a card that leads with its bold title
 * and clamps the rest to a few lines. A question that runs long buries itself
 * there: the background, the history and the cross-references come first,
 * and what is being asked is somewhere past the clamp. The rule asks the
 * author to put the question in the title and keep the body to what a ruling
 * needs.
 *
 * **The default limit is 120 words**, calibrated on 2026-09-30 against every
 * question this repository has written to the Open Questions convention: a
 * list item whose first paragraph holds a bold `OQ-…` title, 54 of them in 9
 * documents, the newest version of each in the history of `docs/`, the
 * gallery's specimens left out, measured with {@link questionWords}. Half run
 * to 52 words or fewer, 43 to 80 or fewer and 48 to 93 or fewer; the other six
 * run from 132 to 233, and none falls between 93 and 132. 120 sits in that
 * gap, so on this repository's history the rule fires on those six alone,
 * among them `OQ-CT6` in `docs/design/color-themes.md` (189 words), the one
 * still open.
 *
 * What that shows is where this repository's questions thin out, not a line
 * between a question that buries what it asks and one that does not: 54
 * questions from one repository are too few for that, and one of 93 words
 * below the limit is as dense as one of 132 above it. The limit is also well
 * past what a folded card shows, the headline and about three lines of the
 * rest, so the rule reports a question that is long by this repository's
 * measure rather than every question the card cuts short. A repository whose
 * questions run longer will see many warnings — the one the card's layout
 * was first asked for runs to a median of 187 words, and 62% of its questions
 * pass 120 — and should raise `max-words` or turn the rule off
 * (`[check.rules]`).
 */
export const QUESTION_WORDS_DEFAULT = 120;

/** The convention's `**Answer:**`, read the same way. */
const ANSWER = /^\s*answer\s*:/i;

/** The node types a question's unit can be (`PlanningQuestion.unitLine`). */
const UNIT_TYPES = new Set<string>([
  "listItem",
  "footnoteDefinition",
  "paragraph",
  "heading",
  "blockquote",
]);

/** Nodes whose children run on in one line of text rather than as blocks. */
const PHRASING = new Set<string>([
  "paragraph",
  "heading",
  "tableCell",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
]);

/**
 * A node's text as the rendered page shows it, the way the planning scan reads
 * a question's title: inline text and code as written, a link by its label and
 * not its target, and nothing for a comment, an image or a definition.
 */
function textOf(node: Nodes): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
    case "math":
    case "inlineMath":
      return node.value;
    case "break":
      return "\n";
    case "html":
    case "image":
    case "imageReference":
    case "definition":
    case "footnoteReference":
      return "";
  }
  if (!("children" in node)) return "";
  const parts = (node.children as Nodes[]).map(textOf);
  return parts.join(PHRASING.has(node.type) ? "" : "\n");
}

/**
 * The node a question's card is about: its unit, the list item or footnote
 * that holds it, or the block that hosts it when nothing does. The scan gives
 * the unit's first and last lines, and the outermost block of a unit's kind
 * spanning exactly those lines is it.
 */
function unitOf(
  root: Root,
  question: Pick<PlanningQuestion, "unitLine" | "unitEndLine">,
  bodyLineOffset: number,
): Nodes | undefined {
  const from = question.unitLine - bodyLineOffset;
  const to = question.unitEndLine - bodyLineOffset;
  const find = (node: Nodes): Nodes | undefined => {
    const start = node.position?.start.line;
    const end = node.position?.end.line;
    if (start === undefined || end === undefined) return undefined;
    if (start > to || end < from) return undefined;
    if (start === from && end === to && UNIT_TYPES.has(node.type)) return node;
    if (!("children" in node)) return undefined;
    for (const child of node.children as Nodes[]) {
      const found = find(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const child of root.children) {
    const found = find(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The number of words in a question's text: its unit, less every paragraph
 * that states a leaning (`LEANING_MARKER`: `Leaning:`, with or without a note
 * in parentheses before the colon, or `Leaning —`) and less its Answer, which
 * is the `**Answer:**` paragraph and everything after it in the unit. So the empty placeholder the convention
 * writes below the label counts for nothing, and neither does a ruling written
 * in its place: the author of a question writes neither. The bold title is
 * part of the text.
 *
 * A word is a run of anything but white space that holds a letter or a digit,
 * so the status emoji and a dash set between spaces are none, a path in a code
 * span is one, and a link counts its label alone. Text written without spaces
 * between words, as Chinese and Japanese are, counts for far less than it
 * reads, which only ever keeps the rule quiet.
 *
 * `null` when the unit cannot be found in `root`, which is the body the scan
 * read the question from, so it never is.
 */
export function questionWords(
  root: Root,
  question: Pick<PlanningQuestion, "unitLine" | "unitEndLine">,
  bodyLineOffset: number,
): number | null {
  const unit = unitOf(root, question, bodyLineOffset);
  if (unit === undefined) return null;
  const blocks =
    unit.type === "paragraph" || unit.type === "heading"
      ? [unit]
      : ((unit as { children: Nodes[] }).children ?? []);
  let text = "";
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const said = textOf(block);
      if (ANSWER.test(said)) break;
      if (LEANING_MARKER.test(said)) continue;
    }
    text += `${textOf(block)}\n`;
  }
  return text.split(/\s+/).filter((token) => WORD.test(token)).length;
}

/** What makes a run of text between spaces a word. */
const WORD = /[\p{L}\p{N}]/u;
