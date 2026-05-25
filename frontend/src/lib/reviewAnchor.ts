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
  for (const el of clone.querySelectorAll(
    "[data-review-inline-comment], .review-revision-badge, .review-addressed-badge",
  )) {
    el.remove();
  }
  return clone.innerText || clone.textContent || "";
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
      if (
        parent?.closest(
          "[data-review-inline-comment], .review-revision-badge, .review-addressed-badge",
        )
      ) {
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
      if (
        parent?.closest(
          "[data-review-inline-comment], .review-revision-badge, .review-addressed-badge",
        )
      ) {
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
