/**
 * The hold (`docs/design/planning-index-at-scale.md` §11.3, the design's
 * term): a document's first paint waits, at most `planningLimits.holdMs` after
 * its content arrives, for data already on its way, so that data is in the
 * first paint instead of landing in it afterwards and moving what was drawn.
 *
 * While it holds, whatever was on screen stays: the previous document when
 * moving between documents, or the app's shell on a first load. It never
 * waits on work of unknown length (L4): the caller says what is on its way,
 * and the deadline ends the wait whatever is still out.
 */
import { useEffect, useState } from "react";
import { planningLimits } from "../planningScan/limits";
import type { FileContent, FileNode } from "../types";

/** What the viewer draws a path from: the repo store's view of it. */
export interface ViewedPath {
  fileContent: FileContent | null;
  currentPath: string | null;
  currentDirectory: FileNode[] | null;
  error: string | null;
  isLoading: boolean;
}

const samePath = (a: ViewedPath, b: ViewedPath) =>
  a.fileContent === b.fileContent &&
  a.currentPath === b.currentPath &&
  a.currentDirectory === b.currentDirectory &&
  a.error === b.error &&
  a.isLoading === b.isLoading;

/**
 * `live`, or what was shown before it while a document that has just arrived
 * is held.
 *
 * Only a document's arrival is held: content for a path other than the one on
 * screen. A live reload of the document on screen is the same path, and a
 * directory, an error or a load starting are not a document's first paint, so
 * each is shown at once.
 *
 * `waiting` says whether data for `live`'s path is still on its way. A hold
 * ends when it turns false or at the deadline, whichever comes first; one that
 * would start with nothing on its way never starts.
 */
export function useFirstPaintHold(
  live: ViewedPath,
  waiting: boolean,
): ViewedPath {
  const [shown, setShown] = useState(live);
  // The arrival whose deadline has passed, by its content's identity: each
  // document's content is a new object, so its deadline is its own.
  const [expired, setExpired] = useState<FileContent | null>(null);
  const arrived = live.fileContent;
  const arriving =
    arrived !== null &&
    live.error === null &&
    live.currentPath !== shown.currentPath;
  const holding = arriving && waiting && expired !== arrived;

  // Everything not held is shown as it is, and remembered as what to go on
  // showing if the next arrival is held.
  if (!holding && !samePath(shown, live)) setShown(live);

  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setExpired(arrived), planningLimits.holdMs);
    return () => clearTimeout(timer);
  }, [holding, arrived]);

  return holding ? shown : live;
}
