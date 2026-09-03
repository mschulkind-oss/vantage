/**
 * Canonicalization + hashing for review-mode block anchors.
 *
 * The same algorithm runs server-side in `vantage/services/review_anchor.py`.
 * Both sides MUST produce byte-identical output, otherwise the per-block
 * hash check (used to detect drift between the captured block and the
 * currently-rendered block) will spuriously fail.
 *
 * Canonical form: lowercase the text, collapse runs of whitespace to a
 * single space, and trim.  This matches what the agent's edits look like
 * after re-rendering: minor whitespace shuffling shouldn't invalidate an
 * anchor, but a substantive content change should.
 *
 * Hash: FNV-1a 32-bit, hex-encoded.  Sync, no Web Crypto, fits the
 * synchronous render pass.  Collisions are vanishingly rare for our
 * purpose (uniqueness within a single document, ~hundreds of blocks).
 */

import type { CommentAnchor } from "../types";

/**
 * Review UI injected into the prose container, as one selector.
 *
 * Every text-reading helper here excludes it: a block's hash must describe the
 * *document*, not the affordances review mode hangs off it. jsdom has no
 * `innerText`, so `blockVisibleText` falls back to `textContent` and an
 * unstripped injected node changes the hash of its block — which reads
 * downstream as "the document changed under this comment". Add a new kind of
 * injected element without adding it here and every anchor on its block
 * silently drifts.
 *
 * The collapse caret is listed even though it carries no text of its own — its
 * glyph is drawn by CSS `content`, precisely so a heading's hash cannot depend on
 * whether the toggle JS ran — because "injected UI is not document" is the rule,
 * and a caret that later gained a visible label should not have to rediscover it.
 */
/**
 * Max ±`source_line` distance at which two anchors are still "the same block".
 *
 * Lives here, not in a hook, because two surfaces ask the question and they must
 * not answer it differently. `useReviewHighlights` walks this radius to re-anchor
 * a comment whose block moved (`findHashNeighbor`), and
 * `useOpenQuestionButtons` needs the same tolerance to decide whether a leaning
 * has already been taken. While the hook used exact line equality and the
 * highlighter used this walk, inserting a line above an `oq` block rendered the
 * "Leaning taken" chip *and* a live "Take this leaning" button on the same
 * paragraph — one surface saying the comment was still attached, the other
 * saying it had never existed.
 */
export const NEIGHBOR_RADIUS = 10;

export const REVIEW_UI_SELECTOR =
  "[data-review-inline-comment], .review-revision-badge, .review-addressed-badge, [data-vantage-oq-button], [data-vantage-collapse-caret]";

/**
 * Tags a comment may anchor to, as a selector that also requires
 * `data-source-line`. The container-only tags `rehypeSourceLines` stamps
 * (`ul`, `ol`, `tr`, `div`, `hr`) are deliberately absent: "an item in a list"
 * anchors on the `<li>`, not on the `<ul>` holding it. `useReviewHighlights`
 * indexes blocks with this selector, so anything resolving an anchor must use
 * the same one or it will name a block the highlighter never looks at.
 *
 * `td`/`th` are here and `tr` is not, for the same reason: a reviewer points at
 * one cell, never at "the row". Cells are the one anchorable kind that does not
 * own a unique `data-source-line` — every cell in a row carries the row's line —
 * so a line can name several blocks and the tie is broken by hash. They are also
 * the one kind that cannot hold the comment card that answers them; see
 * {@link commentCardHost}.
 */
export const ANCHORABLE_BLOCK_SELECTOR =
  "p[data-source-line], h1[data-source-line], h2[data-source-line], h3[data-source-line], h4[data-source-line], h5[data-source-line], h6[data-source-line], li[data-source-line], blockquote[data-source-line], pre[data-source-line], table[data-source-line], td[data-source-line], th[data-source-line]";

/**
 * The element a comment card for `block` is inserted after.
 *
 * For everything but a table cell that is `block` itself. A card placed after a
 * `<td>` would be a `<div>` between two cells of a `<tr>`, which HTML parsing
 * rules hoist straight out of the table — the card renders *above* the table,
 * detached from the row it belongs to, and the table's own layout shifts. So a
 * cell's card goes after the whole table instead: the nearest legal position
 * that still reads as "about this table".
 */
export function commentCardHost(block: HTMLElement): HTMLElement {
  if (!block.matches("td, th")) return block;
  return block.closest("table") ?? block;
}

const lineOf = (el: Element): number =>
  Number.parseInt(el.getAttribute("data-source-line") ?? "", 10);

export function stripBlockText(input: string): string {
  return input.replace(/\s+/gu, " ").trim().toLowerCase();
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit hash of a string, returned as 8-char lowercase hex. */
export function fnv1a(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i) & 0xff;
    // The standard 32-bit multiply, kept inside JS's safe integer range
    // by Math.imul (which performs C-style 32-bit signed multiplication).
    hash = Math.imul(hash, FNV_PRIME);
  }
  // Convert to unsigned 32-bit, then 8-char hex.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Canonicalize then hash — what gets stored in CommentAnchor.block_text_hash. */
export function hashBlockText(input: string): string {
  return fnv1a(stripBlockText(input));
}

/**
 * Visible text of a block element, normalized for hashing.  Uses
 * innerText (which respects block structure / whitespace collapsing the
 * way the user sees it) and strips review-injected UI text (revision
 * badges, inline comment blocks) before canonicalization.
 */
export function blockVisibleText(block: HTMLElement): string {
  // Clone so we can strip review UI without mutating the live DOM.
  const clone = block.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll(REVIEW_UI_SELECTOR)) {
    el.remove();
  }
  return clone.innerText || clone.textContent || "";
}

/**
 * The block a review comment would anchor to for `scope` — `scope` itself when
 * it is anchorable, otherwise the anchorable block inside it.
 *
 * The tie-break is load-bearing, not cosmetic. `useReviewHighlights` indexes
 * blocks by source line into a Map with last-write-wins in document order, and
 * a block that contains another (a `blockquote` and its first `<p>`, an `<li>`
 * and its first `<p>`) gives both the SAME `data-source-line` — so the block it
 * resolves for that line is the LAST candidate in document order, the inner
 * one. Anchoring on any other candidate stores a hash of different text than
 * the highlighter will compute, and the comment renders divergent (and trips
 * `commentsDrifted`) the instant it is created.
 */
export function anchorBlockWithin(scope: HTMLElement): HTMLElement | null {
  const candidates: HTMLElement[] = [];
  if (scope.matches(ANCHORABLE_BLOCK_SELECTOR)) candidates.push(scope);
  candidates.push(
    ...scope.querySelectorAll<HTMLElement>(ANCHORABLE_BLOCK_SELECTOR),
  );
  const withLine = candidates.filter((el) => Number.isFinite(lineOf(el)));
  if (withLine.length === 0) return null;
  const firstLine = Math.min(...withLine.map(lineOf));
  const atFirstLine = withLine.filter((el) => lineOf(el) === firstLine);
  return atFirstLine[atFirstLine.length - 1];
}

/**
 * The whole-block anchor for `block`, identical in shape to what a click on it
 * in review mode produces — `MarkdownViewer`'s `buildCapturedSelection` with no
 * selection: offset 0, length 0, and the canonicalized block text as the
 * comment's `fallback_text`.
 */
export function buildWholeBlockAnchor(
  block: HTMLElement,
): { anchor: CommentAnchor; fallbackText: string } | null {
  const line = lineOf(block);
  if (!Number.isFinite(line)) return null;
  const text = blockVisibleText(block);
  return {
    anchor: {
      source_line: line,
      block_text_hash: hashBlockText(text),
      selection_offset: 0,
      selection_length: 0,
    },
    fallbackText: stripBlockText(text),
  };
}

/**
 * Walk the text nodes inside `block` and find the [start, end) character
 * range — within stripBlockText-canonicalized space — that corresponds
 * to the substring of length `length` starting at `offset`.  Returns a
 * DOM Range, or null if the offset/length is out of bounds.
 *
 * "Canonicalized space" means: lowercase, whitespace collapsed.  We map
 * canonical positions back to raw text-node positions on the fly.
 */
export function rangeFromCanonicalOffsets(
  block: HTMLElement,
  offset: number,
  length: number,
): Range | null {
  if (length <= 0) return null;
  const target = offset + length;

  // Build a map: canonicalIndex -> { node, rawIndex }
  type Entry = { node: Text; rawIdx: number };
  const map: Entry[] = [];
  let inSpace = true; // leading whitespace collapses away (matches trim())
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (parent?.closest(REVIEW_UI_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const text = (n as Text).data;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s/u.test(ch)) {
        if (!inSpace && map.length > 0) {
          map.push({ node: n as Text, rawIdx: i });
          inSpace = true;
        }
      } else {
        map.push({ node: n as Text, rawIdx: i });
        inSpace = false;
      }
    }
  }
  // Trim trailing space from the canonical map (matches String.trim()).
  while (map.length > 0) {
    const last = map[map.length - 1];
    const ch = last.node.data[last.rawIdx];
    if (/\s/u.test(ch)) map.pop();
    else break;
  }

  if (offset >= map.length || target > map.length) return null;
  const startEntry = map[offset];
  const endEntry = map[target - 1];
  const range = document.createRange();
  range.setStart(startEntry.node, startEntry.rawIdx);
  range.setEnd(endEntry.node, endEntry.rawIdx + 1);
  return range;
}

/**
 * Compute a canonical-space offset/length describing the user's selection
 * within the given block.  Returns null if the selection's start isn't
 * inside the block.
 */
export function canonicalOffsetsFromRange(
  block: HTMLElement,
  range: Range,
): { offset: number; length: number } | null {
  if (!block.contains(range.startContainer)) return null;

  const map: { node: Text; rawIdx: number }[] = [];
  let inSpace = true;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (parent?.closest(REVIEW_UI_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let startCanonical = -1;
  let endCanonical = -1;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const text = (n as Text).data;
    for (let i = 0; i < text.length; i++) {
      const isStart = n === range.startContainer && i === range.startOffset;
      const isEnd = n === range.endContainer && i === range.endOffset;
      if (isStart) startCanonical = map.length;
      if (isEnd) endCanonical = map.length;
      const ch = text[i];
      if (/\s/u.test(ch)) {
        if (!inSpace && map.length > 0) {
          map.push({ node: n as Text, rawIdx: i });
          inSpace = true;
        }
      } else {
        map.push({ node: n as Text, rawIdx: i });
        inSpace = false;
      }
    }
    if (n === range.endContainer && range.endOffset === text.length) {
      endCanonical = map.length;
    }
  }

  // Trim trailing whitespace from canonical map (matches trim()).
  while (map.length > 0) {
    const last = map[map.length - 1];
    const ch = last.node.data[last.rawIdx];
    if (/\s/u.test(ch)) {
      if (startCanonical > map.length - 1) startCanonical = map.length - 1;
      if (endCanonical > map.length) endCanonical = map.length;
      map.pop();
    } else break;
  }

  if (startCanonical < 0) return null;
  if (endCanonical < 0) endCanonical = map.length;
  const length = Math.max(0, endCanonical - startCanonical);
  return { offset: startCanonical, length };
}

/**
 * Subset of the block's canonical text given offset/length — useful when
 * we want to preview what was selected without going back to the DOM.
 */
export function sliceCanonical(
  blockCanonical: string,
  offset: number,
  length: number,
): string {
  if (length <= 0) return blockCanonical;
  return blockCanonical.slice(offset, offset + length);
}
