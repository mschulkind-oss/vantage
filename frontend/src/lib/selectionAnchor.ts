/**
 * How a text selection becomes a comment anchor: the block it starts in, found
 * by `data-source-line`, that block's text hash, and the selection's canonical
 * offsets and length in it. The viewer anchors a click or a drag in review
 * mode with it, and a planning card anchors a selection in its question.
 */
import {
  blockVisibleText,
  canonicalOffsetsFromRange,
  hashBlockText,
  stripBlockText,
} from "./reviewAnchor";
import type { CommentAnchor } from "../types";

/**
 * Tags eligible to be the anchor block for a comment — the tags
 * `resolveAnchorBlock` stops on. Container-only tags that `rehypeSourceLines`
 * also stamps (`ul`, `ol`, `tr`, `div`, `hr`) are deliberately absent:
 * selecting "an item in a list" should anchor on the `<li>` rather than
 * collapse to the parent `<ul>`. This mirrors `ANCHORABLE_BLOCK_SELECTOR`'s tag
 * list — keep the two together, or a selection will anchor to a block the
 * highlighter never indexes.
 *
 * `td`/`th` are reached before `table` by virtue of being deeper, so a
 * selection inside a cell anchors to the cell. That is also what makes a
 * cross-cell drag report itself as clamped — two different cells, where both
 * ends used to resolve to the one table — and hint that the comment lands
 * where the selection started.
 */
const ANCHOR_TAGS =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, td, th";

/** The fewest canonical characters a selection anchors on. */
const MIN_SELECTION_LENGTH = 3;

export interface CapturedSelection {
  anchor: CommentAnchor;
  block: HTMLElement;
  displayText: string;
  rect: DOMRect;
  clamped: boolean;
}

/**
 * Resolve the anchor block for a DOM node.  Walks ancestors looking for
 * the closest `[data-source-line]` whose tag is in ANCHOR_TAGS — this
 * keeps comments off of pure-container elements.
 */
export function resolveAnchorBlock(
  container: HTMLElement,
  node: Node | null,
): HTMLElement | null {
  if (!node) return null;
  const start =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  if (!start) return null;
  let cur: HTMLElement | null = start;
  while (cur && cur !== container) {
    if (cur.matches?.(ANCHOR_TAGS) && cur.hasAttribute("data-source-line")) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Capture `block` and, when there is one, the selection `range` in it: the
 * whole block (offset 0, length 0) for a click or for a selection under three
 * characters, which is what the viewer's review mode does. `null` for a block
 * without a source line.
 */
export function buildCapturedSelection(
  block: HTMLElement,
  range: Range | null,
): CapturedSelection | null {
  const sourceLineAttr = block.getAttribute("data-source-line");
  if (!sourceLineAttr) return null;
  const sourceLine = Number.parseInt(sourceLineAttr, 10);
  if (!Number.isFinite(sourceLine)) return null;

  const blockText = blockVisibleText(block);
  const blockHash = hashBlockText(blockText);
  const canonicalBlock = stripBlockText(blockText);

  let offset = 0;
  let length = 0;
  let displayText = canonicalBlock;
  let clamped = false;
  let rect: DOMRect;

  if (range && !range.collapsed) {
    const offsets = canonicalOffsetsFromRange(block, range);
    if (offsets && offsets.length >= MIN_SELECTION_LENGTH) {
      offset = offsets.offset;
      length = offsets.length;
      displayText = canonicalBlock.slice(offset, offset + length);
    }
    rect = range.getBoundingClientRect();
  } else {
    rect = block.getBoundingClientRect();
  }

  if (range && !range.collapsed) {
    const scope =
      (block.closest("[data-content-scroll]") as HTMLElement | null) ??
      block.parentElement!;
    const startBlock = resolveAnchorBlock(scope, range.startContainer);
    const endBlock = resolveAnchorBlock(scope, range.endContainer);
    if (startBlock && endBlock && startBlock !== endBlock) {
      clamped = true;
    }
  }

  const anchor: CommentAnchor = {
    source_line: sourceLine,
    block_text_hash: blockHash,
    selection_offset: offset,
    selection_length: length,
  };
  return { anchor, block, displayText, rect, clamped };
}

/**
 * The anchor of the selection `range` inside `container`, from the block it
 * starts in. `null` when it starts or ends outside `container`, starts in no source-backed block, or selects
 * fewer than three characters: a selection too short to anchor is ignored
 * here, never widened to its block.
 */
export function anchorFromRange(
  container: HTMLElement,
  range: Range,
): CapturedSelection | null {
  if (range.collapsed) return null;
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return null;
  }
  const block = resolveAnchorBlock(container, range.startContainer);
  if (!block) return null;
  const offsets = canonicalOffsetsFromRange(block, range);
  if (!offsets || offsets.length < MIN_SELECTION_LENGTH) return null;
  return buildCapturedSelection(block, range);
}
