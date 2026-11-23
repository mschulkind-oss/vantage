import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, it, expect, vi } from "vitest";
import {
  COMMENT_HIGHLIGHT,
  useReviewHighlights,
  type InlineReviewActions,
} from "./useReviewHighlights";
import { blockVisibleText, hashBlockText } from "../lib/reviewAnchor";
import type { ReviewComment } from "../types";

const actions: InlineReviewActions = {
  onDelete: vi.fn(),
  onDismiss: vi.fn(),
  onReopen: vi.fn(),
  editBox: () => null,
  replyBox: () => null,
  onCopy: () => Promise.resolve(true),
};

/**
 * A block React renders, with mixed children so React keeps a text node of its
 * own for the tail and writes edits into that node rather than resetting the
 * block's whole text.
 */
function Doc({ tail, comments }: { tail: string; comments: ReviewComment[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useReviewHighlights(ref, comments, tail, actions);
  return (
    <div ref={ref}>
      <p data-source-line="1">
        Alpha beta <strong>bold</strong>
        {tail}
      </p>
    </div>
  );
}

const painted = () =>
  [...(CSS.highlights.get(COMMENT_HIGHLIGHT) ?? [])].map((r) =>
    (r as Range).toString(),
  );

const commentOn = (block: HTMLElement, word: string): ReviewComment => {
  const text = blockVisibleText(block);
  return {
    id: "c1",
    comment: "why?",
    fallback_text: word,
    created_at: 0,
    anchor: {
      source_line: 1,
      block_text_hash: hashBlockText(text),
      selection_offset: text.indexOf(word),
      selection_length: word.length,
    },
  };
};

describe("useReviewHighlights — the document changes under a highlight", () => {
  // Wrapping the selection in a <mark> split the text node React rendered, and
  // React went on writing to that node alone: an agent's in-place edit showed
  // the new sentence joined to the old one's tail, text in no version of the
  // file, which the reviewer could select and comment on.
  it("shows exactly the new text, never new text spliced with old", () => {
    const before = " gamma delta epsilon.";
    const { container, rerender } = render(<Doc tail={before} comments={[]} />);
    const comment = commentOn(container.querySelector("p")!, "delta");
    rerender(<Doc tail={before} comments={[comment]} />);
    expect(painted()).toEqual(["delta"]);

    rerender(<Doc tail=" gamma rewritten entirely." comments={[comment]} />);
    expect(container.querySelector("p")!.textContent).toBe(
      "Alpha beta bold gamma rewritten entirely.",
    );
  });

  it("leaves the rendered text nodes as React made them", () => {
    const tail = " gamma delta epsilon.";
    const { container, rerender } = render(<Doc tail={tail} comments={[]} />);
    const p = container.querySelector("p")!;
    const nodesBefore = [...p.childNodes];
    rerender(<Doc tail={tail} comments={[commentOn(p, "delta")]} />);
    expect([...p.childNodes]).toEqual(nodesBefore);
  });

  it("stops painting once the viewer goes away", () => {
    const tail = " gamma delta epsilon.";
    const { container, rerender, unmount } = render(
      <Doc tail={tail} comments={[]} />,
    );
    rerender(
      <Doc
        tail={tail}
        comments={[commentOn(container.querySelector("p")!, "delta")]}
      />,
    );
    expect(painted()).toEqual(["delta"]);
    unmount();
    expect(painted()).toEqual([]);
  });
});
