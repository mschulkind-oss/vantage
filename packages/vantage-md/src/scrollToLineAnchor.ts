/**
 * Framework-agnostic line anchor utilities.
 * Scroll to and highlight the elements a GitHub-style line anchor
 * (#L42, #L42-L50) names. The parsing half lives in lineAnchor.ts, which has
 * no DOM dependency.
 */

import { parseLineAnchor } from "./lineAnchor.js";

const HIGHLIGHT_CLASS = "line-anchor-highlight";

/**
 * Clear all line anchor highlights from a container.
 */
export function clearLineAnchorHighlights(container: HTMLElement): void {
  container.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
    (node as HTMLElement).classList.remove(HIGHLIGHT_CLASS);
  });
}

/**
 * Scroll to and highlight line-anchored elements in a container.
 *
 * @param container - The DOM element containing rendered markdown
 * @param hash - The URL hash (e.g. "#L42" or "#L42-L50")
 * @returns A cleanup function that removes the highlights
 */
export function scrollToLineAnchor(
  container: HTMLElement,
  hash: string,
): (() => void) | null {
  clearLineAnchorHighlights(container);

  const range = parseLineAnchor(hash);
  if (!range) return null;

  const blocks = container.querySelectorAll("[data-source-line]");
  let firstMatch: HTMLElement | null = null;

  for (const block of blocks) {
    const line = parseInt((block as HTMLElement).dataset.sourceLine || "0", 10);
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
    requestAnimationFrame(() => {
      // Find the nearest scrollable ancestor
      const scrollParent = findScrollParent(container);
      if (scrollParent) {
        const offset =
          firstMatch!.getBoundingClientRect().top -
          scrollParent.getBoundingClientRect().top +
          scrollParent.scrollTop;
        scrollParent.scrollTo({ top: offset - 32, behavior: "smooth" });
      } else {
        firstMatch!.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  return () => clearLineAnchorHighlights(container);
}

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}
