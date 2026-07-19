import { renderHook, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "./useReviewHighlights";
import { blockVisibleText, hashBlockText } from "../lib/reviewAnchor";
import { useReviewStore } from "../stores/useReviewStore";
import type { CommentAnchor, CommentReaction, ReviewComment } from "../types";

const agentAddressed: CommentReaction = {
  actor: "agent",
  kind: "addressed",
  summary: "I reworded it",
  before_text: "",
  after_text: "",
  timestamp: 10,
};

const reviewerNoted: CommentReaction = {
  actor: "reviewer",
  kind: "noted",
  summary: "Accepted",
  before_text: "",
  after_text: "",
  timestamp: 20,
};

const baseComment = (overrides: Partial<ReviewComment>): ReviewComment => ({
  id: "c1",
  comment: "please change this",
  fallback_text: "First paragraph",
  created_at: 0,
  ...overrides,
});

/** A document whose blocks carry the `data-source-line` attrs the hook anchors on. */
const DOC_HTML = `
  <p data-source-line="1">First paragraph about anchors.</p>
  <p data-source-line="5">Second paragraph about hashes.</p>
`;

let container: HTMLDivElement;

/**
 * The anchor a comment would have been created with against a live block —
 * hashed with the real helper so the hook's own lookup matches it.
 */
const anchorAt = (line: number): CommentAnchor => {
  const block = container.querySelector<HTMLElement>(
    `[data-source-line="${line}"]`,
  )!;
  return {
    source_line: line,
    block_text_hash: hashBlockText(blockVisibleText(block)),
    selection_offset: 0,
    selection_length: 0,
  };
};

/** An anchor pointing at a block that no longer exists — renders as Outdated. */
const orphanAnchor: CommentAnchor = {
  source_line: 999,
  block_text_hash: "deadbeef",
  selection_offset: 0,
  selection_length: 0,
};

let actions: InlineReviewActions;

const renderInline = (comments: ReviewComment[]) => {
  const ref = { current: container };
  return renderHook(
    ({ cs }: { cs: ReviewComment[] }) =>
      useReviewHighlights(ref, cs, "doc content", actions),
    { initialProps: { cs: comments } },
  );
};

const blockFor = (id: string) =>
  container.querySelector<HTMLElement>(`[data-review-inline-comment="${id}"]`);

beforeEach(() => {
  container = document.createElement("div");
  container.innerHTML = DOC_HTML;
  document.body.appendChild(container);

  useReviewStore.setState({ outdatedCommentIds: new Set() });

  actions = {
    onDelete: vi.fn(),
    onResolve: vi.fn(),
    onDismiss: vi.fn(),
    onReopen: vi.fn(),
    onEdit: vi.fn(),
    onReply: vi.fn(),
    onCopy: vi.fn().mockResolvedValue(true),
  };
});

afterEach(() => {
  container.remove();
});

describe("useReviewHighlights — inline Copy", () => {
  it("renders Copy on a comment still owed to the agent and passes its id", () => {
    const comment = baseComment({ anchor: anchorAt(1), reactions: [] });
    renderInline([comment]);

    const copy = blockFor("c1")!.querySelector<HTMLElement>(
      ".review-inline-comment-copy",
    );
    expect(copy).not.toBeNull();

    fireEvent.click(copy!);
    expect(actions.onCopy).toHaveBeenCalledWith("c1");
  });

  it("reports a refused clipboard write on the button itself", async () => {
    actions.onCopy = vi.fn().mockResolvedValue(false);
    renderInline([baseComment({ anchor: anchorAt(1) })]);

    const copy = blockFor("c1")!.querySelector<HTMLElement>(
      ".review-inline-comment-copy",
    )!;
    fireEvent.click(copy);

    // A silent no-op would be indistinguishable from a dead button.
    await waitFor(() => expect(copy.textContent).toBe("Copy failed"));
  });

  it("does not render Copy once the agent has answered the current wording", () => {
    const comment = baseComment({
      anchor: anchorAt(1),
      reactions: [agentAddressed],
    });
    renderInline([comment]);

    const block = blockFor("c1");
    // The comment itself is rendered — only the Copy affordance is withheld.
    expect(block).not.toBeNull();
    expect(block!.querySelector(".review-inline-comment-copy")).toBeNull();
    expect(block!.querySelector(".review-inline-comment-reply")).not.toBeNull();
  });
});

describe("useReviewHighlights — outdated comments", () => {
  it("offers Edit and Delete on a comment whose block is gone", () => {
    const comment = baseComment({ anchor: orphanAnchor });
    renderInline([comment]);

    const block = blockFor("c1")!;
    expect(block.classList.contains("review-inline-comment--outdated")).toBe(
      true,
    );
    expect(useReviewStore.getState().outdatedCommentIds.has("c1")).toBe(true);

    // Without these the orphan can only be cleaned up from the sidebar.
    expect(block.querySelector(".review-inline-comment-edit")).not.toBeNull();
    expect(block.querySelector(".review-inline-comment-delete")).not.toBeNull();
  });

  it("deletes an outdated comment from the document, on the second click", () => {
    renderInline([baseComment({ anchor: orphanAnchor })]);

    const btn = blockFor("c1")!.querySelector<HTMLElement>(
      ".review-inline-comment-delete",
    )!;
    // First click only arms it — delete discards the whole thread, no undo.
    fireEvent.click(btn);
    expect(actions.onDelete).not.toHaveBeenCalled();
    expect(btn.textContent).toBe("Delete?");

    // The confirm ignores a second click inside one gesture (a physical
    // double-click), so move the clock past that window.
    const base = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => base + 1000);
    fireEvent.click(btn);
    expect(actions.onDelete).toHaveBeenCalledWith("c1");
  });

  it("edits an outdated comment from the document", () => {
    renderInline([baseComment({ anchor: orphanAnchor })]);
    const block = blockFor("c1")!;

    fireEvent.click(
      block.querySelector<HTMLElement>(".review-inline-comment-edit")!,
    );
    const area = block.querySelector<HTMLTextAreaElement>(
      ".review-inline-edit-area",
    )!;
    fireEvent.change(area, { target: { value: "reworded request" } });
    fireEvent.click(
      block.querySelector<HTMLElement>(".review-inline-edit-save")!,
    );

    expect(actions.onEdit).toHaveBeenCalledWith("c1", "reworded request");
  });
});

describe("useReviewHighlights — resolved comments", () => {
  // anchorAt reads the container, so the comment is built per-test.
  const seedResolved = () =>
    renderInline([
      baseComment({
        id: "r1",
        comment: "archive me please",
        anchor: anchorAt(1),
        resolved: true,
        reactions: [agentAddressed, reviewerNoted],
      }),
    ]);

  it("renders each resolved comment's text, not just a count", () => {
    seedResolved();

    const bar = container.querySelector(".review-resolved-indicator")!;
    expect(bar.textContent).toContain("1 resolved comment");

    const block = blockFor("r1");
    expect(block).not.toBeNull();
    expect(block!.closest(".review-resolved-list")).not.toBeNull();
    expect(block!.textContent).toContain("archive me please");
  });

  it("reopens a resolved comment from the document", () => {
    seedResolved();

    const reopen = blockFor("r1")!.querySelector<HTMLElement>(
      ".review-inline-comment-reopen",
    );
    expect(reopen).not.toBeNull();

    fireEvent.click(reopen!);
    expect(actions.onReopen).toHaveBeenCalledWith("r1");
  });

  it("expands and collapses the resolved section when the bar is clicked", () => {
    seedResolved();

    const bar = container.querySelector<HTMLElement>(
      ".review-resolved-indicator",
    )!;
    const list = container.querySelector<HTMLElement>(".review-resolved-list")!;
    const before = list.style.display;

    fireEvent.click(bar);
    const after = list.style.display;
    expect(after).not.toBe(before);

    // Restore the module-level open state so test order stays irrelevant.
    fireEvent.click(bar);
    expect(list.style.display).toBe(before);
  });

  it("labels a reviewer 'noted' turn as accepted rather than a follow-up", () => {
    seedResolved();

    const badges = blockFor("r1")!.querySelectorAll(".review-thread-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe("Agent");
    // "You" here would read as a follow-up the agent still owes an answer to.
    expect(badges[1].textContent).toBe("You accepted");
    expect(badges[1].classList.contains("review-thread-badge--noted")).toBe(
      true,
    );
    expect(badges[1].classList.contains("review-thread-badge--reviewer")).toBe(
      false,
    );
  });
});

describe("useReviewHighlights — draft preservation", () => {
  it("keeps an unsent reply when the comments array changes underneath", () => {
    const answered = baseComment({
      anchor: anchorAt(1),
      reactions: [agentAddressed],
    });
    const { rerender } = renderInline([answered]);

    fireEvent.click(
      blockFor("c1")!.querySelector<HTMLElement>(
        ".review-inline-comment-reply",
      )!,
    );
    fireEvent.change(
      blockFor("c1")!.querySelector<HTMLTextAreaElement>(
        ".review-inline-reply-area",
      )!,
      { target: { value: "half-written thought" } },
    );

    // Any store write hands the hook a fresh array and rebuilds the whole
    // inline layer — here, a second comment arriving.
    const other = baseComment({ id: "c2", anchor: anchorAt(5) });
    rerender({ cs: [answered, other] });

    const area = blockFor("c1")!.querySelector<HTMLTextAreaElement>(
      ".review-inline-reply-area",
    );
    expect(area).not.toBeNull();
    expect(area!.value).toBe("half-written thought");
    // Still unsent — the rebuild must not submit it.
    expect(actions.onReply).not.toHaveBeenCalled();
  });

  it("keeps an unsent edit when the comments array changes underneath", () => {
    const comment = baseComment({ anchor: anchorAt(1) });
    const { rerender } = renderInline([comment]);

    fireEvent.click(
      blockFor("c1")!.querySelector<HTMLElement>(
        ".review-inline-comment-edit",
      )!,
    );
    fireEvent.change(
      blockFor("c1")!.querySelector<HTMLTextAreaElement>(
        ".review-inline-edit-area",
      )!,
      { target: { value: "mid-edit wording" } },
    );

    rerender({ cs: [{ ...comment }] });

    const area = blockFor("c1")!.querySelector<HTMLTextAreaElement>(
      ".review-inline-edit-area",
    );
    expect(area).not.toBeNull();
    expect(area!.value).toBe("mid-edit wording");
    expect(actions.onEdit).not.toHaveBeenCalled();
  });
});

describe("useReviewHighlights — armed delete across a rebuild", () => {
  /** Comfortably past the hook's minimum gap between arming and accepting. */
  const PAST_CONFIRM_FLOOR = 1000;
  const ARMED_CLASS = "review-inline-comment-delete--armed";

  // The clock is driven by hand: the arm is timestamped, and both the
  // double-click floor and the arm's expiry are measured against Date.now().
  let now = 0;

  const deleteBtn = (id: string) =>
    blockFor(id)!.querySelector<HTMLElement>(".review-inline-comment-delete")!;

  beforeEach(() => {
    now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    // The arm is module-level state, so it outlives the test that set it — and
    // the click handler trusts it without re-checking expiry. Left behind, it
    // would make the *first* delete click of a later test destructive. Clear it
    // the only way the module offers: click until the button reports itself
    // disarmed. One click makes this button the armed one if it wasn't; the
    // next, past the floor, confirms and clears it.
    container
      .querySelectorAll<HTMLElement>(".review-inline-comment-delete--armed")
      .forEach((btn) => {
        for (let i = 0; i < 2 && btn.classList.contains(ARMED_CLASS); i++) {
          now += PAST_CONFIRM_FLOOR;
          fireEvent.click(btn);
        }
        expect(btn.classList.contains(ARMED_CLASS)).toBe(false);
      });
    vi.restoreAllMocks();
  });

  it("stays armed when a store write rebuilds the inline layer", () => {
    const target = baseComment({ id: "d1", anchor: anchorAt(1) });
    const { rerender } = renderInline([target]);

    fireEvent.click(deleteBtn("d1"));
    expect(deleteBtn("d1").textContent).toBe("Delete?");

    // Any store write — an agent reaction landing, a reply saving — hands the
    // hook a fresh array and tears the whole inline layer down. That happens
    // constantly, and it used to land between the reviewer's two clicks.
    rerender({ cs: [target, baseComment({ id: "d2", anchor: anchorAt(5) })] });

    expect(deleteBtn("d1").textContent).toBe("Delete?");
    expect(actions.onDelete).not.toHaveBeenCalled();
  });

  it("deletes on the next click after the rebuild, without re-arming first", () => {
    const target = baseComment({ id: "d1", anchor: anchorAt(1) });
    const { rerender } = renderInline([target]);

    fireEvent.click(deleteBtn("d1"));
    rerender({ cs: [{ ...target }] });

    now += PAST_CONFIRM_FLOOR;
    fireEvent.click(deleteBtn("d1"));

    expect(actions.onDelete).toHaveBeenCalledWith("d1");
  });

  it("still refuses a physical double-click that straddles the rebuild", () => {
    const target = baseComment({ id: "d1", anchor: anchorAt(1) });
    const { rerender } = renderInline([target]);

    fireEvent.click(deleteBtn("d1"));
    rerender({ cs: [{ ...target }] });

    // Both clicks of one gesture arrive within the floor; the second must not
    // delete just because the rebuild happened in between.
    fireEvent.click(deleteBtn("d1"));

    expect(actions.onDelete).not.toHaveBeenCalled();
    expect(deleteBtn("d1").textContent).toBe("Delete?");
  });

  it("arms only the comment that was clicked", () => {
    const armedOne = baseComment({ id: "d1", anchor: anchorAt(1) });
    const other = baseComment({
      id: "d2",
      comment: "a different request",
      anchor: anchorAt(5),
    });
    const { rerender } = renderInline([armedOne, other]);

    fireEvent.click(deleteBtn("d1"));
    rerender({ cs: [{ ...armedOne }, { ...other }] });

    expect(deleteBtn("d2").textContent).toBe("×");
    expect(deleteBtn("d2").classList.contains(ARMED_CLASS)).toBe(false);

    // And the neighbour's first click only arms it, even well past the floor.
    now += PAST_CONFIRM_FLOOR;
    fireEvent.click(deleteBtn("d2"));
    expect(actions.onDelete).not.toHaveBeenCalled();
  });
});
