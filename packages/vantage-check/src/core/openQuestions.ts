import type { Html, Root, RootContent } from "mdast";
import { visit } from "unist-util-visit";
import { scanComments } from "./comments.js";
import {
  VANTAGE_SENTINEL,
  VANTAGE_OQ_ID,
  hasVantageSentinel,
  isQuestionDirective,
  parseVantageDirective,
} from "../../../vantage-md/src/vantageDirectives.js";
import { isCommentOnly } from "../../../vantage-md/src/directiveTargets.js";

/**
 * One question directive's declared id, `oq` or `question` alike, and the node
 * that declared it.
 */
export interface DeclaredOq {
  /** The id exactly as written. */
  id: string;
  /** The `html` node holding the directive, for a position to report at. */
  node: Html;
  /** Whether the id satisfies `VANTAGE_OQ_ID`. */
  wellFormed: boolean;
  /**
   * The first `html` node of the run of directives this one is in. A run
   * merges onto one block, so two directives in it declare one question, and
   * an id they share is that question's, not a duplicate.
   */
  run: Html;
}

/**
 * Every id a question directive declares in this document, in document order.
 * `oq` and `question` share the id grammar and the anchor, so they share the
 * namespace too: the same id on one of each is a duplicate.
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

  visit(mdast, "html", (node: Html, index, parent) => {
    // The cheap prefix test first, as the render pass does: nearly every html
    // node in a document carries no directive at all.
    if (!node.value.includes(VANTAGE_SENTINEL)) return;
    const run =
      parent === undefined || index === undefined
        ? node
        : runStart(parent.children, index);

    for (const segment of scanComments(node.value)) {
      if (segment.kind !== "comment") continue;
      if (!hasVantageSentinel(segment.value)) continue;

      const parsed = parseVantageDirective(segment.value);
      if (parsed?.kind !== "directive" || !isQuestionDirective(parsed.name)) {
        continue;
      }

      // Written order, last one wins — the same resolution the renderer makes,
      // so a directive with a duplicate `id=` key anchors on the same value the
      // page does.
      let id: string | undefined;
      for (const pair of parsed.pairs) {
        if (pair.key === "id") id = pair.value;
      }
      if (id === undefined || id === "") continue;

      declared.push({ id, node, wellFormed: VANTAGE_OQ_ID.test(id), run });
    }
  });

  return declared;
}

/**
 * The first node of the run the `html` node at `index` is in: consecutive
 * comment-only nodes, past the definitions that render nothing between them,
 * as the renderer gathers a run on its way to the block it lands on.
 */
function runStart(children: RootContent[], index: number): Html {
  let first = children[index] as Html;
  for (let i = index - 1; i >= 0; i--) {
    const sibling = children[i];
    if (sibling === undefined) break;
    if (sibling.type === "definition") continue;
    if (sibling.type === "footnoteDefinition") continue;
    if (sibling.type !== "html" || !isCommentOnly(sibling.value)) break;
    first = sibling;
  }
  return first;
}

/**
 * The subset of declared ids that actually become anchors in the page.
 *
 * A malformed id is stamped by the plugin and then refused by the sanitizer's
 * value allowlist, so it reaches no `id` attribute and cannot be linked to. The
 * checker has to agree: counting one here would accept `#OQ-nope` as a live
 * target for a fragment that navigates nowhere.
 */
export function oqAnchors(mdast: Root): string[] {
  return collectOqIds(mdast)
    .filter((oq) => oq.wellFormed)
    .map((oq) => oq.id);
}
