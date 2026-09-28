/**
 * Comments inside one mdast html node — re-exported from `vantage-md`.
 *
 * The scanner moved to `vantage-md/src/htmlComments.ts` when the planning
 * index's scan became its third caller: that scan runs in the viewer as well as
 * here, so it cannot import from the checker. This module stays so that `core`
 * callers keep one import path, and so a second scanner never grows back here.
 */

export {
  COMMENT_OPEN,
  scanComments,
} from "../../../vantage-md/src/htmlComments.js";
export type {
  CommentSegment,
  Segment,
  TextSegment,
} from "../../../vantage-md/src/htmlComments.js";
