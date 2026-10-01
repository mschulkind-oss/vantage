// The guide itself lives in the vantage-md package, next to the renderer whose
// behavior it describes. The CLI imports that source directly (see
// ../../README.md) rather than depending on the published package, so there is
// exactly one copy of the text in the tree.
import { STYLE_GUIDE } from "../../../vantage-md/src/styleGuide.js";
import { ConfigError } from "../core/config.js";
import {
  declaredTargets,
  noteTargets,
  refuseTargets,
  styleGuideTargetPath,
} from "../core/target.js";
import { EXIT_OK, EXIT_USAGE } from "../exit.js";
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

/**
 * Print the canonical style guide to stdout, after the line naming its release.
 *
 * It reads one key of one file, the `target` of its project root's
 * `.vantage.toml`, and refuses when that names a release newer than this
 * checker, whose guide would teach notation older than the readers'
 * (`core/target.ts`). Nothing else in the file is its business, so a file it
 * cannot read is passed over as before, and only a malformed target stops it.
 */
export function styleGuideCommand(io: Io): number {
  let targets;
  try {
    targets = declaredTargets([styleGuideTargetPath(io.cwd)], io.cwd);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    io.err(`vantage-check: ${error.message}\n`);
    return EXIT_USAGE;
  }
  const refused = refuseTargets(targets, io);
  if (refused !== undefined) return refused;
  noteTargets(targets, io);
  io.out(`${styleGuideHeader()}\n${STYLE_GUIDE.trim()}\n`);
  return EXIT_OK;
}
