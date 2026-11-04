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

/** The text nodes of `root` outside review UI, in document order. */
function textNodesOf(root: Element, skip?: (node: Text) => boolean): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (skip?.(text)) continue;
    out.push(text);
  }
  return out;
}

/** Where, in `nodes` read as one string, the boundary `(node, offset)` is; clamped. */
function rawPosition(nodes: Text[], node: Node, offset: number): number {
  let at = 0;
  for (const text of nodes) {
    if (text === node) return at + Math.min(offset, text.data.length);
    at += text.data.length;
  }
  // A boundary outside the title's own text (its status marker, or the element
  // itself): before everything if it comes first, else after everything.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[offset];
    for (const text of nodes) {
      if (child !== undefined && child.contains(text))
        return rawBefore(nodes, text);
    }
  }
  return nodes.length > 0 &&
    nodes[0].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
    ? at
    : 0;
}

function rawBefore(nodes: Text[], target: Text): number {
  let at = 0;
  for (const text of nodes) {
    if (text === target) return at;
    at += text.data.length;
  }
  return at;
}

/** The DOM position `raw` characters into `nodes` read as one string. */
function domPosition(
  nodes: Text[],
  raw: number,
): { node: Text; offset: number } | null {
  let at = 0;
  for (const text of nodes) {
    if (raw <= at + text.data.length) return { node: text, offset: raw - at };
    at += text.data.length;
  }
  return null;
}

/**
 * The anchor of a selection made in a planning card's headline. The headline
 * is the card's own element, not a block of the document; its words are the
 * question's bold title, which the card keeps, hidden, in the rendered
 * question (`title`), inside the block `line` of the document. So the
 * selection is carried onto those words and anchored in that block, and kept
 * only where the document's scan proves the result: the block starts at
 * `line` (the question's own line, from the scan) and its text hash is one the
 * scan holds at exactly that line (`blockLines`). `null` where any of that
 * does not hold, and the card then offers Open document and no anchor.
 */
export function anchorFromHeadline(
  headline: HTMLElement,
  body: HTMLElement,
  title: HTMLElement | null,
  range: Range,
  line: number,
  blockLines: Readonly<Record<string, number>>,
  marker: string,
): CapturedSelection | null {
  if (title === null || range.collapsed) return null;
  if (
    !headline.contains(range.startContainer) ||
    !headline.contains(range.endContainer)
  ) {
    return null;
  }
  const host = resolveAnchorBlock(body, title);
  if (host === null || Number(host.getAttribute("data-source-line")) !== line) {
    return null;
  }
  const marked = (text: Text) =>
    text.parentElement?.closest("[aria-hidden]") != null;
  const mine = textNodesOf(headline, marked);
  const theirs = textNodesOf(title);
  const words = mine.map((t) => t.data).join("");
  if (words !== theirs.map((t) => t.data).join("")) return null;
  const from = rawPosition(mine, range.startContainer, range.startOffset);
  const to = rawPosition(mine, range.endContainer, range.endOffset);
  if (to <= from) return null;
  const start = domPosition(theirs, from);
  const end = domPosition(theirs, to);
  if (start === null || end === null) return null;
  const carried = document.createRange();
  carried.setStart(start.node, start.offset);
  carried.setEnd(end.node, end.offset);
  const offsets = canonicalOffsetsFromRange(host, carried);
  if (!offsets || offsets.length < MIN_SELECTION_LENGTH) return null;
  const got = buildCapturedSelection(host, carried);
  if (got === null) return null;
  const rect = range.getBoundingClientRect();
  const provenAt = (hash: string) =>
    Object.hasOwn(blockLines, hash) ? blockLines[hash] : undefined;
  if (provenAt(got.anchor.block_text_hash) === line) return { ...got, rect };
  // The card empties the status marker that opens the title's block, so the
  // block's text lacks it where the document has it: put it back, shifting
  // the offset by the words it adds, and accept only what the scan holds.
  const lead = stripBlockText(marker);
  if (lead === "") return null;
  const withMarker = hashBlockText(`${marker} ${blockVisibleText(host)}`);
  if (provenAt(withMarker) !== line) return null;
  return {
    ...got,
    rect,
    anchor: {
      ...got.anchor,
      block_text_hash: withMarker,
      selection_offset: got.anchor.selection_offset + lead.length + 1,
    },
  };
}
