/**
 * Which block the review-mode cursor is pointing at.
 *
 * Kept out of `MarkdownViewer` so the hit-test can be exercised against
 * hand-placed rectangles — jsdom has no layout engine, so every
 * `getBoundingClientRect()` in a rendered test is zero-sized and a hit-test
 * written inline in the component is effectively untestable.
 *
 * Two hit-tests, not one, because the two kinds of block occupy space
 * differently:
 *
 * - **Prose** (`p`, `h1`–`h6`, `li`, `blockquote`) is matched on the cursor's
 *   **Y alone**. A paragraph owns its whole horizontal band, so pointing at the
 *   ragged right of a short line, or out in the left margin, still means "this
 *   paragraph" — and that generosity is the entire reason hover-to-comment feels
 *   like pointing at prose rather than at text.
 * - **Table cells** are matched on **X and Y both**. Y alone cannot work here:
 *   every cell in a row shares one band, so a Y-only test would resolve a whole
 *   row to whichever cell it happened to visit last. This is why cells were
 *   simply absent from the hover selector until now — and why pointing at one
 *   highlighted nothing and clicking it opened no popover.
 */

/** Prose blocks, matched on the cursor's Y band. */
export const HOVER_PROSE_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote";

/** Table cells, matched on X and Y both. */
export const HOVER_CELL_SELECTOR = "td, th";

/**
 * Shortest text a prose block must hold to be worth commenting on.
 *
 * Cells are deliberately exempt: a cell reading `3`, `n/a` or `✓` is a perfectly
 * ordinary thing to have an opinion about, and in a table it is the *column* that
 * says what the value means. A prose block that short is a rendering artifact.
 */
const MIN_PROSE_TEXT = 3;

/** Depth of `el` below `container`, for the deepest-match tie-break. */
function depthWithin(container: HTMLElement, el: Element): number {
  let depth = 0;
  let cur: Element | null = el;
  while (cur && cur !== container) {
    depth++;
    cur = cur.parentElement;
  }
  return depth;
}

/** Text of `el` as the document wrote it, with review-injected UI excluded. */
function documentText(el: HTMLElement): string {
  if (el.querySelector("[data-review-inline-comment]")) {
    const clone = el.cloneNode(true) as HTMLElement;
    for (const ui of clone.querySelectorAll("[data-review-inline-comment]")) {
      ui.remove();
    }
    return (clone.textContent || "").trim();
  }
  return (el.innerText || el.textContent || "").trim();
}

/** Is this element part of the review layer rather than the document? */
function isReviewUI(el: HTMLElement): boolean {
  return el.closest("[data-review-inline-comment]") !== null;
}

/**
 * The block the cursor at (`clientX`, `clientY`) is pointing at, or null.
 *
 * Resolution order, and the reason for it:
 *
 * 1. **The cell under the cursor**, when it has text. The most specific thing
 *    the cursor can be inside wins outright — including over a `<p>` nested in
 *    the cell by hand-written HTML, which a plain deepest-match would prefer.
 * 2. **The enclosing table**, when the cursor is inside an *empty* cell or
 *    inside the table but between cells (the borders, and the strip to the right
 *    of a table narrower than the prose column). "Comment on this table" is the
 *    honest reading of those positions, and answering with the table is what
 *    keeps a table from having dead spots that read as the feature being broken.
 * 3. **The deepest prose block** whose Y band contains the cursor, so a nested
 *    `li` resolves to itself rather than to the list item wrapping it.
 */
export function hoverTargetAt(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  // 1 & 2 — anywhere inside a table.
  let cell: HTMLElement | null = null;
  let cellDepth = -1;
  for (const candidate of container.querySelectorAll<HTMLElement>(
    HOVER_CELL_SELECTOR,
  )) {
    if (isReviewUI(candidate)) continue;
    const r = candidate.getBoundingClientRect();
    if (clientY < r.top || clientY > r.bottom) continue;
    if (clientX < r.left || clientX > r.right) continue;
    const depth = depthWithin(container, candidate);
    if (depth > cellDepth) {
      cellDepth = depth;
      cell = candidate;
    }
  }
  if (cell) {
    if (documentText(cell).length > 0) return cell;
    return cell.closest("table") ?? cell;
  }

  let table: HTMLElement | null = null;
  let tableDepth = -1;
  for (const candidate of container.querySelectorAll<HTMLElement>("table")) {
    if (isReviewUI(candidate)) continue;
    const r = candidate.getBoundingClientRect();
    if (clientY < r.top || clientY > r.bottom) continue;
    const depth = depthWithin(container, candidate);
    if (depth > tableDepth) {
      tableDepth = depth;
      table = candidate;
    }
  }
  if (table) return table;

  // 3 — prose, on the Y band alone.
  let best: HTMLElement | null = null;
  let bestDepth = -1;
  for (const candidate of container.querySelectorAll<HTMLElement>(
    HOVER_PROSE_SELECTOR,
  )) {
    if (isReviewUI(candidate)) continue;
    if (documentText(candidate).length < MIN_PROSE_TEXT) continue;
    const r = candidate.getBoundingClientRect();
    if (clientY < r.top || clientY > r.bottom) continue;
    const depth = depthWithin(container, candidate);
    if (depth > bestDepth) {
      bestDepth = depth;
      best = candidate;
    }
  }
  return best;
}
