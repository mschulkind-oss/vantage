import { useEffect, useCallback, type RefObject } from "react";
import { clearLineAnchorHighlights } from "./scrollToLineAnchor.js";
import { parseLineAnchor } from "./lineAnchor.js";

const HIGHLIGHT_CLASS = "line-anchor-highlight";

/**
 * React hook that handles GitHub-style line anchors (#L42, #L42-L50).
 *
 * - Parses the URL hash for line references
 * - Finds block elements with matching `data-source-line` attributes
 * - Scrolls to and highlights them
 * - Dismisses on Escape or click on the highlight
 *
 * @param containerRef - Ref to the DOM element containing rendered markdown
 * @param hash - The current URL hash (e.g. "#L42", from location.hash or window.location.hash)
 */
export function useLineAnchor(
  containerRef: RefObject<HTMLElement | null>,
  hash: string,
) {
  const clearHighlights = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    clearLineAnchorHighlights(el);
  }, [containerRef]);

  // Apply highlights when hash changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    clearHighlights();

    const range = parseLineAnchor(hash);
    if (!range) return;

    const blocks = el.querySelectorAll("[data-source-line]");
    let firstMatch: HTMLElement | null = null;

    for (const block of blocks) {
      const line = parseInt(
        (block as HTMLElement).dataset.sourceLine || "0",
        10,
      );
      if (line >= range.start && line <= range.end) {
        (block as HTMLElement).classList.add(HIGHLIGHT_CLASS);
        if (!firstMatch) firstMatch = block as HTMLElement;
      }
    }

    // If exact line not found, find the nearest block before the target line
    if (!firstMatch) {
      let closest: HTMLElement | null = null;
      let closestLine = 0;
      for (const block of blocks) {
        const line = parseInt(
          (block as HTMLElement).dataset.sourceLine || "0",
          10,
        );
        if (line <= range.start && line > closestLine) {
          closestLine = line;
          closest = block as HTMLElement;
        }
      }
      if (closest) {
        closest.classList.add(HIGHLIGHT_CLASS);
        firstMatch = closest;
      }
    }

    // Scroll to the first highlighted element
    if (firstMatch) {
      // Find the scrollable parent
      let scrollParent: HTMLElement | null = el;
      while (scrollParent) {
        const overflow = getComputedStyle(scrollParent).overflowY;
        if (overflow === "auto" || overflow === "scroll") break;
        scrollParent = scrollParent.parentElement;
      }
      if (scrollParent) {
        const target = firstMatch;
        requestAnimationFrame(() => {
          const offset =
            target.getBoundingClientRect().top -
            scrollParent!.getBoundingClientRect().top +
            scrollParent!.scrollTop;
          scrollParent!.scrollTo({ top: offset - 32, behavior: "smooth" });
        });
      }
    }
  }, [hash, containerRef, clearHighlights]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearHighlights();
        if (window.location.hash) {
          history.replaceState(null, "", window.location.pathname);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [clearHighlights]);

  // Dismiss on click on highlighted area
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(`.${HIGHLIGHT_CLASS}`)) {
        clearHighlights();
        if (window.location.hash) {
          history.replaceState(null, "", window.location.pathname);
        }
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [containerRef, clearHighlights]);

  return { clearHighlights };
}
