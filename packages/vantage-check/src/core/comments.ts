/**
 * Comments inside one mdast html node.
 *
 * Lives in `core` rather than beside its first caller because two things need
 * it now: the directive rules, and the Open Question ids that `documentAnchors`
 * has to know about. `core` cannot import from `rules`, and a second scanner
 * would be a second answer to "where does this comment end".
 */

export const COMMENT_OPEN = "<!--";
/**
 * The terminators parse5 honours. `--!>` really does close a comment for the
 * HTML parser — measured through `rehype-raw` — which is why a scanner that
 * looks only for `-->` both misses the directive after one and calls a closed
 * comment unterminated.
 */
const COMMENT_CLOSE = /--!?>/;

export interface CommentSegment {
  kind: "comment";
  /** Inner text: `<!--` and the terminator stripped, verbatim otherwise. */
  value: string;
  /** Offset of `<!--` within the html node's value. */
  offset: number;
  /** Offset of the first character after `<!--`. */
  innerOffset: number;
  /** Offset of the first character after the terminator. */
  endOffset: number;
  terminator: "-->" | "--!>" | null;
}

export interface TextSegment {
  kind: "text";
  value: string;
  offset: number;
}

export type Segment = CommentSegment | TextSegment;

/**
 * Split an mdast `html` node's raw text into comments and the text between
 * them.
 *
 * mdast keeps raw HTML as opaque text, so one node is not one comment:
 * `<!-- a --><!-- vantage: b -->` is a single node, and so is a whole
 * `<div>…</div>` with a directive inside it. hast, after `rehype-raw`, has
 * already split those into separate `comment` nodes with their own positions —
 * so this is the one place the checker does by hand what parse5 does for the
 * viewer, and it is kept deliberately narrow.
 */
export function scanComments(raw: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (;;) {
    const open = raw.indexOf(COMMENT_OPEN, cursor);
    if (open === -1) {
      if (cursor < raw.length) {
        segments.push({
          kind: "text",
          value: raw.slice(cursor),
          offset: cursor,
        });
      }
      return segments;
    }
    if (open > cursor) {
      segments.push({
        kind: "text",
        value: raw.slice(cursor, open),
        offset: cursor,
      });
    }

    const innerOffset = open + COMMENT_OPEN.length;
    const close = COMMENT_CLOSE.exec(raw.slice(innerOffset));
    if (close === null) {
      segments.push({
        kind: "comment",
        value: raw.slice(innerOffset),
        offset: open,
        innerOffset,
        endOffset: raw.length,
        terminator: null,
      });
      return segments;
    }

    const terminator = close[0] as "-->" | "--!>";
    const endOffset = innerOffset + close.index + terminator.length;
    segments.push({
      kind: "comment",
      value: raw.slice(innerOffset, innerOffset + close.index),
      offset: open,
      innerOffset,
      endOffset,
      terminator,
    });
    cursor = endOffset;
  }
}
