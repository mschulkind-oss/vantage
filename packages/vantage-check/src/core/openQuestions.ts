import type { Html, Root } from "mdast";
import { visit } from "unist-util-visit";
import { scanComments } from "./comments.js";
import {
  VANTAGE_SENTINEL,
  VANTAGE_OQ_ID,
  hasVantageSentinel,
  parseVantageDirective,
} from "../../../vantage-md/src/vantageDirectives.js";

/** One `oq` directive's declared id, and the node that declared it. */
export interface DeclaredOq {
  /** The id exactly as written. */
  id: string;
  /** The `html` node holding the directive, for a position to report at. */
  node: Html;
  /** Whether the id satisfies `VANTAGE_OQ_ID`. */
  wellFormed: boolean;
}

/**
 * Every id an `oq` directive declares in this document, in document order.
 *
 * Read from the *comments*, not from the rendered tree: the checker has an
 * mdast and no hast, so it sees `<!-- vantage: oq id=OQ-4 -->` the way the
 * renderer's plugin does, through the same parser. A second parser here is how
 * the checker starts disagreeing with the page about which anchors exist.
 *
 * Malformed ids are returned too, flagged rather than dropped — `documentAnchors`
 * wants only the ones that reach the DOM, while `vantage/oq-id-format` wants
 * precisely the ones that do not.
 */
export function collectOqIds(mdast: Root): DeclaredOq[] {
  const declared: DeclaredOq[] = [];

  visit(mdast, "html", (node: Html) => {
    // The cheap prefix test first, as the render pass does: nearly every html
    // node in a document carries no directive at all.
    if (!node.value.includes(VANTAGE_SENTINEL)) return;

    for (const segment of scanComments(node.value)) {
      if (segment.kind !== "comment") continue;
      if (!hasVantageSentinel(segment.value)) continue;

      const parsed = parseVantageDirective(segment.value);
      if (parsed?.kind !== "directive" || parsed.name !== "oq") continue;

      // Written order, last one wins — the same resolution the renderer makes,
      // so a directive with a duplicate `id=` key anchors on the same value the
      // page does.
      let id: string | undefined;
      for (const pair of parsed.pairs) {
        if (pair.key === "id") id = pair.value;
      }
      if (id === undefined || id === "") continue;

      declared.push({ id, node, wellFormed: VANTAGE_OQ_ID.test(id) });
    }
  });

  return declared;
}

/**
 * The subset of declared ids that actually become anchors in the page.
 *
 * A malformed id is stamped by the plugin and then refused by the sanitiser's
 * value allowlist, so it reaches no `id` attribute and cannot be linked to. The
 * checker has to agree: counting one here would accept `#OQ-nope` as a live
 * target for a fragment that navigates nowhere.
 */
export function oqAnchors(mdast: Root): string[] {
  return collectOqIds(mdast)
    .filter((oq) => oq.wellFormed)
    .map((oq) => oq.id);
}
