/**
 * Promote a carried Open Question id to a real `id`, on the safe side of the
 * sanitizer.
 *
 * `rehypeVantageDirectives` cannot write `id` itself. It runs before
 * `rehypeSanitize` — it must, because it reads HTML comments and the sanitizer
 * deletes them — and the sanitizer's default schema clobbers `id` with the
 * prefix `user-content-`. So the directive plugin stamps `data-vantage-oq-id`,
 * the sanitizer validates that value against the id grammar, and this plugin
 * moves it onto `id` afterwards.
 *
 * That is the same reason `rehypeSlug` is registered after the sanitizer
 * (`pipeline.ts`), and this plugin has to run **before** `rehypeSlug`:
 * `rehype-slug` leaves an element that already has an `id` alone, so promoting
 * first is what lets a question written as a heading keep `OQ-4` instead of
 * acquiring a heading slug. Where both could apply, the Open Question id wins.
 *
 * The data attribute is removed on the way through. Nothing downstream reads
 * it — every reader finds a question by `[data-vantage-question]`
 * (`VANTAGE_QUESTION_SELECTOR`) — and leaving a second copy of the id in the
 * markup invites a future reader to use the wrong one.
 *
 * Compacted IDs use the same carrier on Decision Ledger rows. Their separate
 * marker distinguishes a historical row from a live question. A live anchor
 * wins regardless of document order, and repeated ledger IDs anchor only the
 * first row; no question controls or declarations are introduced.
 *
 * Architecture and invariants: docs/reference/linked-references.md
 */

import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

/** What `rehypeVantageDirectives` stamps, in hast property form. */
const OQ_ID_PROPERTY = "dataVantageOqId";
const LEDGER_PROPERTY = "dataVantageLedger";
const isLedgerRow = (node: Element): boolean =>
  node.tagName === "tr" && node.properties[LEDGER_PROPERTY] === "true";

export default function rehypeVantageAnchors() {
  return (tree: Root) => {
    const claimed = new Set<string>();
    // Reserve live and explicit anchors before minting any historical ones:
    // a ledger placed before a live question cannot steal its fragment.
    visit(tree, "element", (node: Element) => {
      const id = node.properties.id;
      if (typeof id === "string" && id !== "") claimed.add(id);
      const carried = node.properties[OQ_ID_PROPERTY];
      if (!isLedgerRow(node) && typeof carried === "string" && carried !== "") {
        claimed.add(carried);
      }
    });
    visit(tree, "element", (node: Element) => {
      const ledger = isLedgerRow(node);
      delete node.properties[LEDGER_PROPERTY];
      const carried = node.properties?.[OQ_ID_PROPERTY];
      if (typeof carried !== "string" || carried === "") return;

      delete node.properties[OQ_ID_PROPERTY];

      // An element that already carries an `id` keeps it. Nothing in the
      // pipeline produces one this early, but a document can hand-write raw
      // HTML, and silently overwriting an author's own id would be a surprise
      // with no error attached.
      if (typeof node.properties.id === "string" && node.properties.id !== "") {
        return;
      }
      if (ledger && claimed.has(carried)) return;
      node.properties.id = carried;
      claimed.add(carried);
    });
  };
}
