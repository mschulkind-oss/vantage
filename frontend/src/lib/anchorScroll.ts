/**
 * The one place a `#slug` turns into a scroll.
 *
 * Three callers arrive at the same job from different directions: the
 * in-document link handler and the heading's own `#` anchor in `MarkdownViewer`,
 * and the hash effect in `ViewerPage` that runs when the reader arrives from
 * `other.md#slug`. Each of them used to resolve the id and measure the box
 * itself, and each of them measured a `display: none` box as all zeros — so a
 * link into a `<!-- vantage: section collapsed=true -->` section scrolled the
 * reader somewhere unrelated, left the target hidden, and gave no cue that the
 * link had done anything at all (P1/D8).
 *
 * `collapseSections.ts` names all three callers that have to force a collapsed
 * section open — "a `#L42` link, a heading anchor or a review comment" — and the
 * heading-anchor one was the case that shipped unimplemented, in all three of
 * its sites. So the reveal and the measurement live together here, in that
 * order, and no caller keeps a copy of either: the next site to need an anchor
 * scroll cannot forget the reveal because it is not a separate step.
 *
 * No `requestAnimationFrame`: `revealCollapsedBlock` writes the attributes
 * synchronously, and the `getBoundingClientRect()` below forces the relayout
 * that makes them count. Measured in Chrome against the real stylesheet.
 */

import { revealCollapsedBlock } from "./collapseSections";

/**
 * How far above the target the scroll stops. Not cosmetic in the collapsed case:
 * the reader has to see the heading whose caret was just opened, not its first
 * pixel row.
 */
const ANCHOR_MARGIN = 16;

/**
 * The element `#id` addresses, or `null`.
 *
 * The `user-content-` fallback is `rehype-sanitize`'s id clobbering: the default
 * schema rewrites a *hand-written* `id` with that prefix, while `rehypeSlug` runs
 * after the sanitiser and its heading ids are untouched. Both spellings are live,
 * so both are tried — in that order, because the unprefixed one is the heading.
 */
export function anchorTarget(id: string): HTMLElement | null {
  if (!id) return null;
  return (
    document.getElementById(id) ?? document.getElementById(`user-content-${id}`)
  );
}

/**
 * Reveal whatever collapsed section is hiding `el`, then scroll it into view.
 *
 * `container` is the scroll container when the caller already holds one
 * (`ViewerPage` does); otherwise the nearest one is resolved from `el`.
 */
export function scrollToAnchorElement(
  el: HTMLElement,
  container?: Element | null,
): void {
  // BEFORE the measurement below, never after. This is the whole reason the
  // function exists.
  revealCollapsedBlock(el);

  const scroller =
    container ??
    el.closest("[data-content-scroll]") ??
    el.closest(".overflow-y-auto");
  if (scroller && typeof scroller.scrollTo === "function") {
    const offset =
      el.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    scroller.scrollTo({ top: offset - ANCHOR_MARGIN });
    return;
  }
  // Nothing scrollable around it — a bare document, or a test environment that
  // implements neither method.
  el.scrollIntoView?.();
}

/**
 * Resolve `id`, reveal it, scroll to it. Whether there was anything to scroll to.
 */
export function scrollToAnchor(
  id: string,
  container?: Element | null,
): boolean {
  const el = anchorTarget(id);
  if (!el) return false;
  scrollToAnchorElement(el, container);
  return true;
}
