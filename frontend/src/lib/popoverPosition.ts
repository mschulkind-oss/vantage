/**
 * Placement for the review "Add Comment" popover.
 *
 * Kept out of the component so it can be tested at phone widths without a DOM,
 * and so the component file stays a pure fast-refresh boundary.
 */

/** Nominal popover box: width matches the element's class, height is approximate. */
const POPOVER_WIDTH = 440;
const POPOVER_HEIGHT = 360;
/** Gutter kept between the popover and the viewport edge. */
const MARGIN = 16;

/** The subset of a DOMRect the positioner reads. */
export interface SelectionRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

/**
 * Place the popover near the selection without letting it leave the viewport.
 *
 * The width is clamped exactly the way the element's `max-w-[calc(100vw-32px)]`
 * clamps it, and every phone is narrower than the nominal 440px — so centering
 * and the right-edge limit both have to be computed from the *clamped* width.
 * The previous version subtracted the nominal width from the viewport, which on
 * a 393px phone gives a limit of -67px: the popover was pushed off the left edge
 * of the screen with its first 67px unreachable.
 */
export function popoverPosition(
  rect: SelectionRect,
  viewportWidth: number,
  viewportHeight: number,
): { top: number; left: number } {
  const width = Math.min(POPOVER_WIDTH, viewportWidth - MARGIN * 2);
  const centered = rect.left + rect.width / 2 - width / 2;
  // max(MARGIN, …) keeps the limit sane when the popover fills the viewport.
  const rightLimit = Math.max(MARGIN, viewportWidth - width - MARGIN);
  const left = Math.min(Math.max(MARGIN, centered), rightLimit);

  // Prefer below the selection; flip above when that would run off the bottom.
  const top =
    rect.bottom + POPOVER_HEIGHT + MARGIN > viewportHeight
      ? Math.max(8, rect.top - POPOVER_HEIGHT - 8)
      : rect.bottom + 8;

  return { top, left };
}
