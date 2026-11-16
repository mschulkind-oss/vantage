/**
 * Carry a settled question's exact ID through sanitization to its ledger row.
 * The planning scanner, renderer and checker share the same named-ledger
 * evidence; a row gains an anchor, never a question declaration or controls.
 * See docs/reference/linked-references.md for the compaction contract.
 */
import type { Root, TableRowData } from "mdast";
import type { Properties } from "hast";
import { decisionLedgerRows, textContentOf } from "./planning/evidence.js";

export default function remarkDecisionLedgerAnchors() {
  return (tree: Root) => {
    for (const { id, row } of decisionLedgerRows(tree, textContentOf)) {
      const data: TableRowData & { hProperties?: Properties } = row.data ?? {};
      row.data = data;
      data.hProperties = {
        ...data.hProperties,
        dataVantageOqId: id,
        dataVantageLedger: "true",
      };
    }
  };
}
