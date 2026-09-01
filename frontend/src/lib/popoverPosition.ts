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

/** The subset of a DOMRect an anchored menu reads from its trigger. */
export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Gap between a trigger and the menu hanging off it, matching the old `mt-1`. */
const ANCHOR_GAP = 4;

/**
 * Place a menu against the button that opens it, without letting it leave the
 * viewport.
 *
 * Menus used to be plain `absolute right-0 top-full` — right-aligned to the
 * trigger with no collision handling at all. That is fine until the trigger is
 * near an edge: the settings gear sits in the sidebar header, the sidebar
 * resizes down to 200px, and a 224px menu right-aligned inside it starts at
 * roughly -40px. Worse, the sidebar's ancestors are `overflow-hidden`, so the
 * overflow was *clipped* rather than merely offscreen — the menu lost its left
 * edge instead of hanging over the content.
 *
 * Right alignment is still the preference, because that is where these menus
 * have always sat and the trigger is usually at the right of its container. It
 * is a preference rather than a rule: the result is clamped into the viewport,
 * flipped above the trigger when there is no room below, and given a maxHeight
 * so a menu taller than the screen scrolls instead of running off it.
 *
 * Callers position with `fixed` from a portal. Rendering in place cannot work,
 * however good the arithmetic, while an ancestor clips.
 */
export function anchoredMenuPosition(
  anchor: AnchorRect,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { top: number; left: number; maxHeight: number } {
  const width = Math.min(menuWidth, viewportWidth - MARGIN * 2);
  // max(MARGIN, …) keeps the limit sane when the menu fills the viewport.
  const rightLimit = Math.max(MARGIN, viewportWidth - width - MARGIN);
  const left = Math.min(Math.max(MARGIN, anchor.right - width), rightLimit);

  const roomBelow = viewportHeight - anchor.bottom - ANCHOR_GAP - MARGIN;
  const roomAbove = anchor.top - ANCHOR_GAP - MARGIN;

  // Below unless it does not fit and above is roomier — a menu that fits below
  // stays below even when above is larger, so it does not jump around.
  if (menuHeight <= roomBelow || roomBelow >= roomAbove) {
    return {
      top: anchor.bottom + ANCHOR_GAP,
      left,
      maxHeight: Math.max(0, roomBelow),
    };
  }
  const height = Math.min(menuHeight, roomAbove);
  return {
    top: Math.max(MARGIN, anchor.top - ANCHOR_GAP - height),
    left,
    maxHeight: Math.max(0, roomAbove),
  };
}
