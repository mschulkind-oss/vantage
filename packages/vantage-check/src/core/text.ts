/** The most of a question's title a line of output quotes, in characters. */
export const TITLE_WIDTH = 100;

/**
 * Collapse whitespace, and cut a long title where a line would wrap, with an
 * ellipsis where it is cut. A question with no bold title is titled by the
 * whole text of its paragraph, which is exactly the question a length rule
 * reports, so a line quoting it whole would run to a thousand characters.
 */
export function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_WIDTH
    ? flat
    : `${flat.slice(0, TITLE_WIDTH - 1).trimEnd()}…`;
}

/**
 * A question as a finding names it: by its `id=`, or by its title in quotes,
 * cut to one line.
 */
export function questionName(id: string | null, title: string): string {
  return id ?? `“${oneLine(title)}”`;
}
