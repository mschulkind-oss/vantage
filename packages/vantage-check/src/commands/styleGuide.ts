// The guide itself lives in the vantage-md package, next to the renderer whose
// behaviour it describes. The CLI imports that source directly (see
// ../../README.md) rather than depending on the published package, so there is
// exactly one copy of the text in the tree.
import { STYLE_GUIDE } from "../../../vantage-md/src/styleGuide.js";
import { EXIT_OK } from "../exit.js";
import type { Io } from "../io.js";

/** Print the canonical style guide to stdout. */
export function styleGuideCommand(io: Io): number {
  io.out(`${STYLE_GUIDE.trim()}\n`);
  return EXIT_OK;
}
