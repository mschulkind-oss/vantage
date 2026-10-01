import type { ElementHandle } from "@playwright/test";

/**
 * A button's border box, and the room inside it before and after what it
 * draws: its icons and its text, as the reader sees them. Nothing invisible
 * counts, so the room a label keeps for a longer one (index.css, "A button
 * whose label changes on click") is room here, wherever it falls.
 *
 * Shared by the specs of each header that has such a button: the viewer's
 * (header_fit.spec.ts) and the planning page's (planning_page.spec.ts).
 */
export function drawnIn(button: ElementHandle<HTMLElement | SVGElement>) {
  return button.evaluate((el) => {
    const shown = (e: Element) =>
      getComputedStyle(e).visibility === "visible" &&
      e.getBoundingClientRect().width > 1;
    const rects: DOMRect[] = [];
    for (const svg of el.querySelectorAll("svg")) {
      if (shown(svg)) rects.push(svg.getBoundingClientRect());
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || !shown(n.parentElement!)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      rects.push(range.getBoundingClientRect());
    }
    const box = el.getBoundingClientRect();
    return {
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      /** The padding and the border: the least room there is. */
      padding:
        parseFloat(getComputedStyle(el).paddingLeft) +
        parseFloat(getComputedStyle(el).borderLeftWidth),
      before: Math.min(...rects.map((r) => r.left)) - box.left,
      after: box.right - Math.max(...rects.map((r) => r.right)),
      text: el.textContent,
    };
  });
}

/** Two boxes the same within half a pixel: what a click must leave alone. */
export function sameBox(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  { size = true, place = true } = {},
) {
  const near = (p: number, q: number) => Math.abs(p - q) <= 0.5;
  return (
    (!size || (near(a.width, b.width) && near(a.height, b.height))) &&
    (!place || (near(a.x, b.x) && near(a.y, b.y)))
  );
}
