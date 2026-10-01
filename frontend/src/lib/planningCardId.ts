/**
 * The `id` of a question's card on the planning page: the element the page's
 * outline scrolls to when a document under a section is clicked
 * (`docs/reference/planning-index.md` §6.6).
 *
 * One function, shared by the card that carries the id and every surface that
 * looks it up, so the two can never spell it differently. A question appears on
 * the page at most once: Needs you and Unrouted hold open or answered
 * questions, and Waiting holds blocked ones, so the id is unique on the page.
 *
 * - **The path is percent-encoded,** so a `/`, a space or a `#` in it cannot
 *   collide with the separator or break a fragment. Look the element up with
 *   `document.getElementById`, not a CSS selector, which would need `%`
 *   escaped.
 * - **The question's `id` when it has one** (`OQ-B4`), which survives an edit
 *   above the question; otherwise `L` and the line its unit starts on, the one
 *   thing that tells two unnamed questions in one document apart.
 */
export function planningCardId(
  path: string,
  id: string | null,
  unitLine: number,
): string {
  return `pq-${encodeURIComponent(path)}--${id ?? `L${unitLine}`}`;
}
