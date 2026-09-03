/**
 * Hand-placed geometry for tests.
 *
 * jsdom has no layout engine: every `getBoundingClientRect()` it answers is a
 * zero-sized box at the origin, which makes any hit-test indistinguishable from
 * any other. These helpers give named elements the rectangles a browser would
 * have measured, so a pointer position means something.
 */

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Give one element a fixed rect. */
export function place(el: Element, box: Box): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      ...box,
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
      toJSON: () => box,
    }) as DOMRect;
}

/**
 * Place every element matching each selector.
 *
 * A single box applies to all matches; an array applies one box per match, in
 * document order, and matches past the end of the array are left alone.
 */
export function layout(
  root: ParentNode,
  boxes: Record<string, Box | Box[]>,
): void {
  for (const [selector, box] of Object.entries(boxes)) {
    const found = root.querySelectorAll(selector);
    if (Array.isArray(box)) {
      box.forEach((b, i) => {
        const el = found[i];
        if (el) place(el, b);
      });
    } else {
      found.forEach((el) => place(el, box));
    }
  }
}
