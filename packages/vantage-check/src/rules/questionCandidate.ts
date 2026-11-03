import type { ListItem, Root, RootContent, Table, TableRow } from "mdast";
import { visit } from "unist-util-visit";
import {
  VANTAGE_OQ_STATUS,
  vantageOqStatus,
} from "../../../vantage-md/src/vantageDirectives.js";
import type { Collector } from "../core/collector.js";
import { fileLine } from "../core/document.js";
import {
  OQ_ID,
  leaningParagraph,
  nodeText,
  questionDirectiveScopes,
} from "./directives.js";

/**
 * `vantage/question-candidate` — a parsed structure with the shape of a
 * question and no directive, in the two cases `vantage/oq-missing` does not
 * cover (docs/design/agent-planning-handoff.md §5.2). Read from the shared
 * mdast, never from the prose.
 *
 * - A list item that opens with a 💬 or 🔒 marker and then an `OQ-` id, with no
 *   question directive in the item. Items `vantage/oq-missing` reports (open,
 *   id, `_Leaning:_`) are left to it, so no occurrence is reported twice.
 * - A GFM table with a `Leaning` or `Answer` header, whose first header is not
 *   `ID`, with an `OQ-` id as plain text or inline code in a body cell. A table
 *   whose first header is exactly `ID` is the ledger form and is never reported;
 *   an id inside a link is a reference.
 *
 * Ids in fences, prose, links and ✅ items are not candidates.
 */
export function checkQuestionCandidates(collector: Collector): void {
  if (!collector.enabled("vantage/question-candidate")) return;
  const root = collector.doc.mdast;
  const filed = questionDirectiveScopes(root);

  visit(root, "listItem", (item: ListItem) => {
    if (filed.has(item)) return;
    const first = item.children[0];
    if (first?.type !== "paragraph") return;
    if (!OPENS_WITH_MARKED_ID.test(nodeText(first))) return;
    const status = vantageOqStatus(nodeText(first));
    if (status === "settled") return;
    if (status === "open" && leaningParagraph(item) !== undefined) return;
    report(collector, first, ITEM_MESSAGE);
  });

  visit(root, "table", (table: Table) => {
    const [header, ...body] = table.children;
    if (header === undefined) return;
    const headings = header.children.map((cell) => nodeText(cell).trim());
    if (headings[0] === "ID") return;
    if (!headings.some((h) => h === "Leaning" || h === "Answer")) return;
    if (!body.some(rowHoldsPlainId)) return;
    report(collector, table, TABLE_MESSAGE);
  });
}

const OPENS_WITH_MARKED_ID = new RegExp(
  `^\\s*(?:${VANTAGE_OQ_STATUS.open}|${VANTAGE_OQ_STATUS.blocked})[^\\p{L}\\p{N}]*${OQ_ID.source}`,
  "u",
);

/** An id as text or inline code in a cell; text inside a link is a reference. */
function rowHoldsPlainId(row: TableRow): boolean {
  let found = false;
  for (const cell of row.children) {
    const walk = (node: RootContent | Root): void => {
      if (node.type === "link" || node.type === "linkReference") return;
      if (
        (node.type === "text" || node.type === "inlineCode") &&
        OQ_ID.test(node.value)
      ) {
        found = true;
      }
      if ("children" in node) for (const child of node.children) walk(child);
    };
    walk(cell);
  }
  return found;
}

function report(
  collector: Collector,
  node: RootContent,
  message: string,
): void {
  collector.report(
    "vantage/question-candidate",
    {
      line: fileLine(collector.doc, node.position?.start.line ?? 1),
      column: node.position?.start.column ?? 1,
    },
    message,
  );
}

const ITEM_MESSAGE =
  "This list item reads as a question (a \u{1F4AC} or \u{1F512} marker and an " +
  "`OQ-` id) but carries no `question` directive, so the planning index " +
  "does not count it and the owner cannot answer it. File it with " +
  "`<!-- vantage: question id=\u2026 -->` indented into the item, or mark " +
  "it \u2705 if it is decided.";

const TABLE_MESSAGE =
  "This table carries `OQ-` ids beside a Leaning or Answer column, but a " +
  "table declares no question: the planning index counts none of them. " +
  "Do not hand it over as open questions. File each decision as a list " +
  "item with a `question` directive, or convert or omit the table.";
