/**
 * The disclosure control for `<!-- vantage: section collapsed=true -->` —
 * `docs/design/inline-markup.md` §4.3.
 *
 * A post-render pass in the same idiom as `useOpenQuestionButtons`: find what
 * the plugin stamped, hang one injected node off it, and sweep that node before
 * every pass so a re-run replaces the control rather than stacking a second one.
 *
 * Two things it does that no `<details>` would have to:
 *
 * - It writes both of the markers the hiding CSS is gated on, and writes them
 *   **after** attaching: `data-vantage-collapse-ready` on the prose container,
 *   and `data-vantage-collapse-armed` on each block of a group it actually gave a
 *   caret. Anything that renders the same HTML without this pass — the CLI
 *   checker, a static export read with JS off, an external consumer of the
 *   package's viewer — shows every block, and so does any block this pass could
 *   not give a control, rather than hiding content nothing can reveal (P1/D8).
 * - It writes `aria-expanded` and `aria-controls` by hand. A `<summary>` would
 *   have inherited them; a heading plus a flat run of siblings has to say so.
 *
 * The control is a `<button>` for three separate reasons: it is keyboard
 * operable, `aria-expanded` belongs on an element allowed to carry it (a heading
 * is not one), and the review-mode click handler in `MarkdownViewer` bails on
 * `button` — so a click that opens a section does not also open the comment
 * popover, which is one of the four measured breakages that ruled `<details>`
 * out.
 */

import { useEffect, type RefObject } from "react";
import {
  COLLAPSE_ARMED_ATTR,
  COLLAPSE_CARET_ATTR,
  COLLAPSE_READY_ATTR,
  COLLAPSE_TOGGLE_ATTR,
  collapseGroupOf,
  groupMembers,
  isGroupExpanded,
  setGroupCollapsed,
} from "../lib/collapseSections";

/** Marks an `id` this pass minted, so the sweep can take it back out again. */
const MINTED_ID_ATTR = "data-vantage-collapse-id";

/**
 * The caret's accessible name. Deliberately not "Expand"/"Collapse": the state
 * lives in `aria-expanded`, and a label that also carried it would be read out
 * twice and go stale the moment the two disagreed.
 */
export const COLLAPSE_LABEL = "Toggle section";

/**
 * Undo everything this pass added. The listeners go with the nodes.
 *
 * The collapsed attributes themselves are the plugin's output, not ours, so they
 * are left exactly as they are: sweeping them would mean a document rendered
 * with the JS torn down disagreed with the same document rendered without it.
 * The armed markers are ours and do go — with no control left in the DOM, a block
 * that stayed armed would be hidden by a stylesheet nothing could answer.
 */
function sweep(el: HTMLElement): void {
  el.removeAttribute(COLLAPSE_READY_ATTR);
  el.querySelectorAll(`[${COLLAPSE_ARMED_ATTR}]`).forEach((n) =>
    n.removeAttribute(COLLAPSE_ARMED_ATTR),
  );
  el.querySelectorAll(`[${COLLAPSE_CARET_ATTR}]`).forEach((n) => n.remove());
  el.querySelectorAll(`[${MINTED_ID_ATTR}]`).forEach((n) => {
    n.removeAttribute("id");
    n.removeAttribute(MINTED_ID_ATTR);
  });
}

/**
 * `aria-controls` needs an id per member, and a paragraph has none.
 *
 * Only ever mints one where there is nothing to point at, so a heading's
 * `rehype-slug` id — which in-document links depend on — is never touched, and
 * records what it minted so the sweep can remove it.
 */
function idFor(member: HTMLElement, fallback: string): string {
  if (member.id) return member.id;
  member.id = fallback;
  member.setAttribute(MINTED_ID_ATTR, "true");
  return fallback;
}

/**
 * Give every `[data-vantage-collapse-toggle]` heading in the prose container a
 * caret that opens and closes the run of blocks stamped with its group.
 *
 * `currentContent` is unused in the body and load-bearing in the dep array: a
 * content change re-renders `<ReactMarkdown>`, which may discard these foreign
 * nodes, and this is what re-runs the pass to put them back. The highlighter and
 * the Open Question pass take the same parameter for the same reason.
 *
 * Unlike those two this pass has **no review-mode gate and no static-mode gate**.
 * It writes nothing to the server and it is not a review affordance — it is how
 * the document reads — so gating it would leave a static export or a
 * reading-mode session showing sections the author collapsed with no way to open
 * them, which is the content loss the readiness marker exists to prevent.
 */
export function useCollapseSections(
  containerRef: RefObject<HTMLDivElement | null>,
  currentContent: string | null,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    sweep(el);

    const toggles = Array.from(
      el.querySelectorAll<HTMLElement>(`[${COLLAPSE_TOGGLE_ATTR}]`),
    );

    let attached = false;
    for (const toggle of toggles) {
      const group = collapseGroupOf(toggle, COLLAPSE_TOGGLE_ATTR);
      if (group === null) continue;
      const members = groupMembers(el, group);
      // A toggle whose group has no members would be a caret that hides
      // nothing. The plugin does not emit one; a hand-edited DOM could. It did
      // once, and not hypothetically: a heading whose only body block was a
      // `$$…$$` formula opened a group of one, and `rehype-katex` then replaced
      // the stamped `<pre>`, leaving the caret with nothing to hide.
      // `rehypeVantageMathStamps` carries the stamp across that replacement now,
      // so this guard is back to being defence rather than the fix.
      if (members.length === 0) continue;

      const caret = document.createElement("button");
      caret.type = "button";
      caret.className = "vantage-collapse-caret";
      caret.setAttribute(COLLAPSE_CARET_ATTR, group);
      caret.setAttribute("aria-label", COLLAPSE_LABEL);
      caret.setAttribute("aria-expanded", String(isGroupExpanded(el, group)));
      caret.setAttribute(
        "aria-controls",
        members
          .map((member, index) =>
            idFor(member, `vantage-collapse-${group}-${index}`),
          )
          .join(" "),
      );
      caret.addEventListener("click", (event) => {
        // The container's own click handler opens the comment popover in review
        // mode, and this click is not a request for that. It already bails on
        // `button`; stopping here too is the same belt the Open Question button
        // wears, and it keeps a click off the heading's `#` anchor.
        event.stopPropagation();
        event.preventDefault();
        setGroupCollapsed(el, group, isGroupExpanded(el, group));
      });
      // First child, ahead of the heading's `#` anchor: the anchor is absolutely
      // positioned in the gutter, so DOM order is not visual order there.
      toggle.insertBefore(caret, toggle.firstChild);
      // Arm this group's blocks — the per-block half of the hiding rule's
      // precondition, and deliberately AFTER the caret that opens them is in the
      // DOM. A block nothing arms stays on the page however collapsed it claims
      // to be, which is what keeps a group with no toggle, or a `collapsed=true`
      // written in raw HTML with no group at all, from becoming content nobody
      // can reach (P1/D8).
      for (const member of members) {
        member.setAttribute(COLLAPSE_ARMED_ATTR, "true");
      }
      attached = true;
    }

    // AFTER attaching, and only if a working control exists. This is the other
    // gate the hiding CSS rests on, so setting it earlier would open a window —
    // however short — in which blocks are hidden and nothing can bring them
    // back. It is keyed on having attached rather than on finding a
    // currently-collapsed block, because the reader may have opened every
    // section, and a marker withdrawn at that point would leave the next click
    // closing a section that then refuses to hide.
    if (attached) el.setAttribute(COLLAPSE_READY_ATTR, "true");

    return () => sweep(el);
  }, [containerRef, currentContent]);
}
