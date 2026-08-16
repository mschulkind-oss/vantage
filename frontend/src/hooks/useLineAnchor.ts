import { useEffect, useCallback, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const HIGHLIGHT_CLASS = "line-anchor-highlight";

/**
 * Parse a GitHub-style line anchor hash.
 * Supports: #L42, #L42-L50, #L42-50
 * Returns null if the hash is not a line anchor.
 */
function parseLineAnchor(hash: string): { start: number; end: number } | null {
  if (!hash) return null;
  const frag = hash.startsWith("#") ? hash.slice(1) : hash;

  // #L42 or #L42-L50 or #L42-50
  const match = frag.match(/^L(\d+)(?:-L?(\d+))?$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : start;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Hook that handles GitHub-style line anchors (#L42, #L42-L50).
 *
 * - Parses the URL hash for line references
 * - Finds block elements with matching `data-source-line` attributes
 * - Scrolls to and highlights them
 * - Dismisses on Escape or click on the highlight
 */
export function useLineAnchor(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
) {
  // The markdown content lives inside the scroll container
  const containerRef = scrollContainerRef;
  const location = useLocation();
  const navigate = useNavigate();

  const clearHighlights = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
      (node as HTMLElement).classList.remove(HIGHLIGHT_CLASS);
    });
  }, [containerRef]);

  /**
   * Drop the highlights *and* the anchor that produced them.
   *
   * The anchor has to leave through the router rather than a raw
   * `history.replaceState`: react-router never observes a bare replaceState, so
   * its `location.hash` would keep the anchor we just dismissed and re-apply it
   * on the next render that reaches `applyAnchor`.
   */
  const dismiss = useCallback(() => {
    clearHighlights();
    // Only line anchors are ours to strip — a heading anchor (#some-heading)
    // belongs to whoever navigated here.
    if (parseLineAnchor(location.hash)) {
      navigate(location.pathname + location.search, { replace: true });
    }
  }, [
    clearHighlights,
    navigate,
    location.hash,
    location.pathname,
    location.search,
  ]);

  const applyAnchor = useCallback(() => {
    const el = containerRef.current;
    if (!el) return false;

    clearHighlights();

    const range = parseLineAnchor(location.hash);
    if (!range) return false;

    const blocks = el.querySelectorAll("[data-source-line]");
    if (blocks.length === 0) return false;

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

    // If no block-level match, try inline anchors (id="user-content-L{n}")
    // which exist inside large blocks that span many source lines.
    if (!firstMatch) {
      for (let ln = range.start; ln <= range.end; ln++) {
        const anchor = el.querySelector(
          `#user-content-L${ln}`,
        ) as HTMLElement | null;
        if (anchor) {
          anchor.classList.add(HIGHLIGHT_CLASS);
          if (!firstMatch) firstMatch = anchor;
        }
      }
    }

    // Last resort: find the nearest block before the target line
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

    if (firstMatch) {
      const scrollContainer = scrollContainerRef.current;
      if (scrollContainer) {
        requestAnimationFrame(() => {
          const offset =
            firstMatch!.getBoundingClientRect().top -
            scrollContainer.getBoundingClientRect().top +
            scrollContainer.scrollTop;
          scrollContainer.scrollTo({ top: offset - 32, behavior: "smooth" });
        });
      }
    }
    return true;
  }, [location.hash, containerRef, scrollContainerRef, clearHighlights]);

  // Apply highlights when hash changes or content renders.
  // Observes document.body so it works even when the scroll container hasn't
  // mounted yet (e.g. behind a loading gate).
  useEffect(() => {
    // Clear before the guard, every time.  Nothing else removes these classes
    // when the anchor leaves the URL, and react-markdown reuses the rendered
    // DOM nodes across updates — so a bail-out here used to leave the previous
    // anchor's boxes painted over whatever the reader looked at next.
    clearHighlights();

    if (!parseLineAnchor(location.hash)) return;

    if (applyAnchor()) return;

    const observer = new MutationObserver(() => {
      if (applyAnchor()) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
    // `location.pathname` is a dependency because switching documents has to
    // re-run this even when the hash string is unchanged.
  }, [location.hash, location.pathname, applyAnchor, clearHighlights]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dismiss]);

  // Dismiss on click anywhere in the highlighted area
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(`.${HIGHLIGHT_CLASS}`)) dismiss();
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [containerRef, dismiss]);

  return { clearHighlights };
}
