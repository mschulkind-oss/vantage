import { useEffect, useSyncExternalStore } from "react";
import {
  boxesToReport,
  flushAllBoxes,
  hasUnsavedText,
  boxesVersion,
  subscribeBoxes,
  type BoxState,
  type CommentBox,
} from "../lib/commentAutosave";

/** A comment box's state (`lib/commentAutosave.ts`), re-rendering on every change. */
export function useCommentBox(box: CommentBox): BoxState {
  return useSyncExternalStore(box.subscribe, box.getState);
}

/**
 * The comment boxes the app shell reports: those whose save failed and is
 * being retried (`boxesToReport`).
 */
export function useBoxesToReport(): CommentBox[] {
  useSyncExternalStore(subscribeBoxes, boxesVersion);
  return boxesToReport();
}

/**
 * Ask before the tab goes while any comment text is unsaved, and send it at
 * once, so a reader who stays finds it saved.
 */
export function useUnsavedCommentsGuard(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedText()) return;
      flushAllBoxes();
      e.preventDefault();
      // Older browsers ask only when this is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
