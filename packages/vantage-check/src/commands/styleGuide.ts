// The guide itself lives in the vantage-md package, next to the renderer whose
// behavior it describes. The CLI imports that source directly (see
// ../../README.md) rather than depending on the published package, so there is
// exactly one copy of the text in the tree.
import { STYLE_GUIDE } from "../../../vantage-md/src/styleGuide.js";
import { EXIT_OK } from "../exit.js";
import type { Io } from "../io.js";
import { COMMIT, DEVELOPMENT_BUILD, RELEASE, knownCommit } from "../version.js";

/**
 * The line `style-guide` prints above the guide, naming the release whose
 * conventions follow (`docs/design/checker-version-skew.md` §6.1).
 *
 * An agent's checker is whichever release it fetched last, not the one its
 * readers' viewer runs, so a guide that does not say which release it describes
 * teaches conventions some reader's viewer may not have. A copy pasted into
 * agent instructions keeps this line, so the copy says which release it froze.
 *
 * It is the checker's line, not part of the guide: the in-app modal and the
 * npm export print `STYLE_GUIDE` alone and are unchanged, and everything after
 * this line is the guide byte for byte.
 */
export function styleGuideHeader(
  release: string | undefined = RELEASE,
  commit: string = COMMIT,
): string {
  if (release !== undefined) {
    return `Vantage ${release}'s conventions: for readers on ${release} or later.`;
  }
  const at = knownCommit(commit);
  return `A Vantage ${DEVELOPMENT_BUILD}'s conventions${at === undefined ? "" : ` (${at})`}: they can be newer than every release, so a reader on a released viewer may not have all of them.`;
}

/** Print the canonical style guide to stdout, after the line naming its release. */
export function styleGuideCommand(io: Io): number {
  io.out(`${styleGuideHeader()}\n${STYLE_GUIDE.trim()}\n`);
  return EXIT_OK;
}
