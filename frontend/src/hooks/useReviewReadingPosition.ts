import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { subscribeBeforeReviewModeChange } from "../stores/useReviewStore";
import {
  captureReadingPosition,
  restoreReadingPosition,
  type ReadingPosition,
} from "../lib/readingPosition";

interface Pending {
  pane: HTMLElement;
  point: ReadingPosition;
  mode: boolean;
  scope: string;
  release: () => void;
}

/** Keep the reader's top text through an explicit review-mode layout change. */
export function useReviewReadingPosition(
  paneRef: RefObject<HTMLElement | null>,
  mode: boolean,
  scope: string,
): void {
  const latest = useRef({ mode, scope });
  const pending = useRef<Pending | null>(null);
  const frame = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current?.release();
    pending.current = null;
  }, []);

  useLayoutEffect(() => {
    latest.current = { mode, scope };
    if (pending.current && pending.current.scope !== scope) cancel();
  }, [mode, scope, cancel]);
  useLayoutEffect(() => cancel, [cancel]);

  const capture = useCallback(() => {
    cancel();
    const pane = paneRef.current;
    if (!pane) return;
    const point = captureReadingPosition(pane);
    if (!point) return;
    const anchoring = pane.style.overflowAnchor;
    const behavior = pane.style.scrollBehavior;
    pane.style.overflowAnchor = "none";
    pane.style.scrollBehavior = "auto";
    const key = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        cancel();
    };
    pane.addEventListener("wheel", cancel, { passive: true });
    pane.addEventListener("touchstart", cancel, { passive: true });
    pane.addEventListener("pointerdown", cancel);
    pane.ownerDocument.addEventListener("keydown", key);
    const captured: Pending = {
      pane,
      point,
      ...latest.current,
      release: () => {
        pane.style.overflowAnchor = anchoring;
        pane.style.scrollBehavior = behavior;
        pane.removeEventListener("wheel", cancel);
        pane.removeEventListener("touchstart", cancel);
        pane.removeEventListener("pointerdown", cancel);
        pane.ownerDocument.removeEventListener("keydown", key);
      },
    };
    pending.current = captured;
    // A refused/no-op toggle must not leave our temporary styles installed.
    // A real commit cancels this frame before scheduling its settling frames.
    frame.current = requestAnimationFrame(() => {
      if (pending.current === captured && latest.current.mode === captured.mode)
        cancel();
    });
  }, [paneRef, cancel]);

  useLayoutEffect(() => {
    const captured = pending.current;
    if (!captured || captured.mode === mode || captured.scope !== scope) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const restore = () => {
      if (pending.current !== captured || paneRef.current !== captured.pane)
        return false;
      return restoreReadingPosition(captured.pane, captured.point);
    };
    if (!restore()) {
      cancel();
      return;
    }
    // Layout first, then two bounded frames for the review highlighter's
    // passive DOM work. This is not a lasting scroll lock: a wheel, touch,
    // pointer or scrolling key cancels it immediately.
    frame.current = requestAnimationFrame(() => {
      if (!restore()) {
        cancel();
        return;
      }
      frame.current = requestAnimationFrame(() => {
        restore();
        cancel();
      });
    });
  }, [mode, scope, paneRef, cancel]);

  useLayoutEffect(() => subscribeBeforeReviewModeChange(capture), [capture]);
}
