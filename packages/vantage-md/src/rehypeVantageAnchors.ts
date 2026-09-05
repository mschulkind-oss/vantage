/**
 * Promote a carried Open Question id to a real `id`, on the safe side of the
 * sanitiser.
 *
 * `rehypeVantageDirectives` cannot write `id` itself. It runs before
 * `rehypeSanitize` — it must, because it reads HTML comments and the sanitiser
 * deletes them — and the sanitiser's default schema clobbers `id` with the
 * prefix `user-content-`. So the directive plugin stamps `data-vantage-oq-id`,
 * the sanitiser validates that value against the id grammar, and this plugin
 * moves it onto `id` afterwards.
 *
 * That is the same reason `rehypeSlug` is registered after the sanitiser
 * (`pipeline.ts`), and this plugin has to run **before** `rehypeSlug`:
 * `rehype-slug` leaves an element that already has an `id` alone, so promoting
 * first is what lets a question written as a heading keep `OQ-4` instead of
 * acquiring a heading slug. Where both could apply, the Open Question id wins.
 *
 * The data attribute is removed on the way through. Nothing downstream reads it
 * — the review button finds its block by `[data-vantage-oq]` — and leaving a
 * second copy of the id in the markup invites a future reader to use the wrong
 * one.
 */

import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

/** What `rehypeVantageDirectives` stamps, in hast property form. */
const OQ_ID_PROPERTY = "dataVantageOqId";

export default function rehypeVantageAnchors() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
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
      node.properties.id = carried;
    });
  };
}
