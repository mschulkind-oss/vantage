/**
 * The space id (`docs/reference/planning-index.md` §13.6): a name coined for
 * this feature, for one random id per checkout, kept as the single line of
 * `<checkout>/.vantage/space`. A planning link carries it as `space=`, so a
 * Vantage serving many projects can open the project the link was made in
 * without knowing the name it gives that project, which the checker cannot
 * learn (§13.5).
 *
 * `vantage-check index --filter` makes the file the first time it prints a
 * planning link and reuses it after; the server reads it for each project it
 * serves (`internal/spaceid`) and answers which one holds an id; the planning
 * page asks it. These are the names all three use. The Go side has its own
 * copy of the pattern and of the file's reading, and
 * `internal/spaceid/testdata/space-files.json` holds both readers to the same
 * answer.
 */

/** The planning page's URL parameter that carries a space id. */
export const PLANNING_SPACE_PARAM = "space";

/** How many characters a space id has: 80 random bits, five to a character. */
export const PLANNING_SPACE_ID_LENGTH = 16;

/**
 * A space id: lowercase RFC 4648 base32 (`a`–`z`, `2`–`7`), exactly
 * `PLANNING_SPACE_ID_LENGTH` characters. Every one of them is a character a
 * planning link writes bare and a pasted link's end keeps (§13.5), so the id
 * can end a link as it is.
 */
export const PLANNING_SPACE_ID_PATTERN = /^[a-z2-7]{16}$/;

/** Where a checkout keeps its space id, relative to the checkout's root. */
export const PLANNING_SPACE_FILE = ".vantage/space";

/** Whether `text` is a space id, by `PLANNING_SPACE_ID_PATTERN`. */
export function isPlanningSpaceId(text: string): boolean {
  return PLANNING_SPACE_ID_PATTERN.test(text);
}

/**
 * The space id a `.vantage/space` file's text holds, or `null` when it holds
 * none. The file is the id and one newline; a reader drops one trailing `\n`,
 * and a `\r` before it, and takes what is left only when it is a space id
 * whole. Any other text, white space around the id included, holds none.
 */
export function parsePlanningSpaceFile(text: string): string | null {
  let line = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (line.endsWith("\r") && line.length !== text.length) {
    line = line.slice(0, -1);
  }
  return isPlanningSpaceId(line) ? line : null;
}

/** The text a `.vantage/space` file holding `id` has: the id and a newline. */
export function planningSpaceFileText(id: string): string {
  return `${id}\n`;
}
