import type { Nodes, Paragraph, PhrasingContent, RootContent } from "mdast";
import {
  LEANING_MARKER,
  QUESTION_SHAPE,
} from "../../../vantage-md/src/planning/leaning.js";
import type { Collector } from "../core/collector.js";
import { fileLine } from "../core/document.js";

/**
 * `vantage/question-layout` — a question's leaning run into a paragraph with
 * other text.
 *
 * A question is written in parts (`QUESTION_SHAPE`), and two readers lay it
 * out by them: the planning page's card, which draws the `_Leaning:_`
 * paragraph as a block of its own that never folds away, and
 * `planning/question-length`, which leaves it out of a question's length. Both
 * find the leaning by `LEANING_MARKER` at the *start* of a paragraph, so a
 * leaning written after the title or the context in one run-together paragraph
 * is neither: the card folds it away with everything else, past the clamp, and
 * the length counts it as the question's own text. The same goes for an
 * `**Answer:**` run into the leaning's paragraph, which the card then cannot
 * find either.
 *
 * Nothing breaks, and the text is all there, so a warning. It fires only on a
 * question written to the convention, which is what keeps it off prose that
 * merely mentions a leaning: the paragraph's question — the list item or
 * footnote holding it, else the paragraph and the block just above it — names
 * an `OQ-…` id. And the marker has to sit where a label sits: set in emphasis
 * or bold, as the convention writes it (`_Leaning:_`, `**Leaning:**`), or
 * opening a sentence or a line, capitalized, as `Leaning:` written bare does.
 */
export function checkQuestionLayout(collector: Collector): void {
  if (!collector.enabled("vantage/question-layout")) return;
  const { doc } = collector;
  // The cheap gate: almost no document writes the word at all.
  if (!/leaning/i.test(doc.text)) return;

  const walk = (
    node: Nodes,
    unit: Nodes | undefined,
    above: RootContent | undefined,
  ): void => {
    if (node.type === "paragraph") {
      const scope = unit === undefined ? [node, above] : [unit];
      if (!scope.some((block) => block !== undefined && namesId(block))) {
        return;
      }
      const at = runTogether(node);
      if (at === undefined) return;
      collector.report(
        "vantage/question-layout",
        {
          line: fileLine(doc, at.position?.start.line ?? 1),
          column: at.position?.start.column ?? 1,
        },
        `This question's leaning shares a paragraph with other text, so neither the page nor the question's card on the planning page can lay it out as its leaning: the card folds it away with the rest of the text, and \`planning/question-length\` counts it as the question's own words. ${QUESTION_SHAPE}`,
      );
      return;
    }
    if (!("children" in node)) return;
    const inner =
      node.type === "listItem" || node.type === "footnoteDefinition"
        ? node
        : unit;
    let previous: RootContent | undefined;
    for (const child of node.children as RootContent[]) {
      walk(child, inner, previous);
      if (child.type !== "html") previous = child;
    }
  };
  walk(doc.mdast, undefined, undefined);
}

/** The convention's stable id, as `vantage/oq-missing` keys on it. */
const OQ_ID = /\bOQ-[A-Za-z]*\d+\b/;

/** Whether `node`'s text, code aside, names an `OQ-…` id. */
function namesId(node: Nodes): boolean {
  return OQ_ID.test(proseOf(node));
}

/**
 * A `Leaning:` written bare, where a label sits: after the end of a sentence
 * or a line, capitalized as a label is, and never inside a word.
 */
const BARE_LABEL = /(?:[.!?)\]…]|\n)\s*Leaning\s*(?:\([^)]*\)\s*)?(?::|—|–)/;

/** The convention's `**Answer:**`, as the card's own reading names it. */
const ANSWER_LABEL = /^\s*answer\s*:/i;

/**
 * Where in `paragraph` a leaning runs together with other text, or `undefined`
 * when it does not: the node to report at.
 *
 * - **A leaning after other text**: a `Leaning:` label, in emphasis or bold,
 *   that something written precedes; or one written bare at the start of a
 *   sentence or a line after the first.
 * - **An Answer after the leaning**: a paragraph that opens with the leaning
 *   and goes on to an `Answer:` label in bold or emphasis.
 */
function runTogether(paragraph: Paragraph): Nodes | undefined {
  const children = paragraph.children;
  const whole = proseOf(paragraph);
  const opensWithLeaning = LEANING_MARKER.test(whole);

  let before = "";
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as PhrasingContent;
    const emphasized = child.type === "emphasis" || child.type === "strong";
    if (emphasized) {
      const rest = children
        .slice(i)
        .map((c) => proseOf(c))
        .join("");
      if (LEANING_MARKER.test(rest) && before.trim() !== "") return child;
      if (
        opensWithLeaning &&
        before.trim() !== "" &&
        ANSWER_LABEL.test(proseOf(child))
      ) {
        return child;
      }
    }
    before += proseOf(child);
  }
  return BARE_LABEL.test(whole) ? paragraph : undefined;
}

/**
 * A node's text as the page shows it, with a code span reduced to one neutral
 * character: a `Leaning:` quoted as code is a specimen, never a label.
 */
function proseOf(node: Nodes): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      return "·";
    case "break":
      return "\n";
    case "code":
    case "math":
    case "inlineMath":
    case "html":
    case "image":
    case "imageReference":
    case "definition":
    case "footnoteReference":
      return "";
  }
  if (!("children" in node)) return "";
  return (node.children as Nodes[]).map(proseOf).join("");
}
