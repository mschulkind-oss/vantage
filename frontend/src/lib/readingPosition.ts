import { ANCHORABLE_BLOCK_SELECTOR, REVIEW_UI_SELECTOR } from "./reviewAnchor";
import { holdScrollRoom } from "./scrollRoom";

/** A character in unchanged document text, and its offset from the pane's top. */
export interface ReadingPosition {
  block: Element;
  line: string | null;
  tag: string;
  text: string;
  offset: number;
  top: number;
}

const EXCLUDED = `${REVIEW_UI_SELECTOR}, .not-prose, button, input, textarea, select, script, style, svg, [aria-hidden="true"], [hidden]`;

function textNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent && !node.parentElement?.closest(EXCLUDED)) {
      nodes.push(node as Text);
    }
  }
  return nodes;
}

const textOf = (root: Element) =>
  textNodes(root)
    .map((n) => n.data)
    .join("");

function intersects(rect: DOMRect, viewport: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > viewport.top &&
    rect.top < viewport.bottom
  );
}

/** Measure the first visible text character, not just its paragraph's top. */
export function captureReadingPosition(
  pane: HTMLElement,
): ReadingPosition | null {
  const root = pane.querySelector(".prose");
  if (!root) return null;
  const viewport = pane.getBoundingClientRect();
  if (viewport.height <= 0) return null;
  for (const node of textNodes(root)) {
    if (!node.data.trim()) continue;
    const range = pane.ownerDocument.createRange();
    if (typeof range.getClientRects !== "function") return null;
    range.selectNodeContents(node);
    if (![...range.getClientRects()].some((r) => intersects(r, viewport)))
      continue;

    // Prefix visibility is monotonic, including collapsed whitespace. Search
    // Unicode character boundaries so a surrogate pair is never split.
    const boundaries = [0];
    for (const character of node.data) {
      boundaries.push(boundaries.at(-1)! + character.length);
    }
    let lo = 0;
    let hi = boundaries.length - 2;
    while (lo < hi) {
      const middle = Math.floor((lo + hi) / 2);
      range.setStart(node, 0);
      range.setEnd(node, boundaries[middle + 1]);
      if ([...range.getClientRects()].some((r) => intersects(r, viewport)))
        hi = middle;
      else lo = middle + 1;
    }
    range.setStart(node, boundaries[lo]);
    range.setEnd(node, boundaries[lo + 1]);
    const rect = [...range.getClientRects()].find((r) =>
      intersects(r, viewport),
    );
    if (!rect) continue;
    const block =
      node.parentElement?.closest(ANCHORABLE_BLOCK_SELECTOR) ?? root;
    const nodes = textNodes(block);
    const before = nodes
      .slice(0, nodes.indexOf(node))
      .reduce((n, text) => n + text.length, 0);
    return {
      block,
      line: block.getAttribute("data-source-line"),
      tag: block.tagName,
      text: nodes.map((n) => n.data).join(""),
      offset: before + boundaries[lo],
      top: rect.top - viewport.top,
    };
  }
  return null;
}

/** Restore that character after wrapping or review-highlight DOM changes. */
export function restoreReadingPosition(
  pane: HTMLElement,
  position: ReadingPosition,
): boolean {
  let block = position.block;
  if (!pane.contains(block)) {
    const root = pane.querySelector(".prose");
    if (!root || position.line === null) return false;
    const matches = [...root.querySelectorAll("[data-source-line]")].filter(
      (el) =>
        el.tagName === position.tag &&
        el.getAttribute("data-source-line") === position.line &&
        textOf(el) === position.text,
    );
    if (matches.length !== 1) return false;
    block = matches[0];
  }
  if (textOf(block) !== position.text) return false;
  let offset = position.offset;
  for (const node of textNodes(block)) {
    if (offset >= node.length) {
      offset -= node.length;
      continue;
    }
    const range = pane.ownerDocument.createRange();
    if (typeof range.getBoundingClientRect !== "function") return false;
    range.setStart(node, offset);
    const length = node.data.codePointAt(offset)! > 0xffff ? 2 : 1;
    range.setEnd(node, Math.min(node.length, offset + length));
    const rect = range.getBoundingClientRect();
    if (rect.height <= 0) return false;
    const delta = rect.top - pane.getBoundingClientRect().top - position.top;
    // Near the end, widening can otherwise clamp the pane before the text
    // reaches its old position. The existing room helper releases this space
    // as it scrolls out of view, without moving the reader again.
    if (delta > 0) holdScrollRoom(pane, delta);
    pane.scrollTop = Math.max(0, pane.scrollTop + delta);
    return true;
  }
  return false;
}
