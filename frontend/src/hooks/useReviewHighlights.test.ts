import { renderHook, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "./useReviewHighlights";
import { blockVisibleText, hashBlockText } from "../lib/reviewAnchor";
import type { CommentAnchor, CommentReaction, ReviewComment } from "../types";
import { useReviewStore } from "../stores/useReviewStore";

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

  actions = {
    onDelete: vi.fn(),
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

  it("badges an answered comment whose anchor still resolves", () => {
    // The regression this pins: the status badge lived only inside the orphan
    // renderer, so an answered comment still anchored to its block showed no
    // status at all — two comments in the same state, one badged and one not,
    // for a reason ("is your anchor still findable") nobody is thinking about.
    renderInline([
      baseComment({ anchor: anchorAt(1), reactions: [agentAddressed] }),
    ]);

    const badge = blockFor("c1")!.querySelector(".review-status-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("Addressed");
  });

  it("badges a declined comment as Declined, not Addressed", () => {
    renderInline([
      baseComment({
        anchor: anchorAt(1),
        reactions: [{ ...agentAddressed, kind: "wont_fix" }],
      }),
    ]);

    const badge = blockFor("c1")!.querySelector(".review-status-badge");
    expect(badge!.textContent).toBe("Declined");
  });

  it("shows no badge while a comment is still waiting on the agent", () => {
    renderInline([baseComment({ anchor: anchorAt(1) })]);

    expect(blockFor("c1")!.querySelector(".review-status-badge")).toBeNull();
  });

  it("drops the badge back off when the reviewer replies again", () => {
    // Answered-then-replied is pending, not answered: badging it "Addressed"
    // would claim the agent had the last word when the reviewer just spoke.
    renderInline([
      baseComment({
        anchor: anchorAt(1),
        reactions: [
          agentAddressed,
          {
            actor: "reviewer",
            kind: "needs_clarification",
            summary: "still wrong",
            before_text: "",
            after_text: "",
            timestamp: 30,
          },
        ],
      }),
    ]);

    expect(blockFor("c1")!.querySelector(".review-status-badge")).toBeNull();
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
    // Without these the orphan can only be cleaned up from the sidebar.
    expect(block.querySelector(".review-inline-comment-edit")).not.toBeNull();
    expect(block.querySelector(".review-inline-comment-delete")).not.toBeNull();
  });

  it("says where a detached comment used to live", () => {
    // Placement is the nearest surviving block above, which is a neighborhood
    // and not a position — so it is stated rather than left to be inferred
    // from whatever block the comment happens to follow.
    renderInline([baseComment({ anchor: orphanAnchor })]);

    const locator = blockFor("c1")!.querySelector(".review-detached-locator");
    expect(locator).not.toBeNull();
    expect(locator!.textContent).toContain("999");
    expect(locator!.textContent).toContain("no longer found");
  });

  it("quotes the selected text without striking it through", () => {
    // fallback_text is the record of what the reviewer chose to comment on.
    // Struck through it read as retracted, when the text is usually still in
    // the document — just past where the anchor could follow it.
    renderInline([baseComment({ anchor: orphanAnchor })]);

    const quote = blockFor("c1")!.querySelector(".review-outdated-quote")!;
    expect(quote.textContent).toBe("First paragraph");
    expect(quote.className).not.toContain("line-through");
  });

  it("shows no turn-state badge on a detached comment awaiting the agent", () => {
    // "Outdated" used to occupy the badge slot, which is what taught an
    // anchor fact to read as a conversation state.
    renderInline([baseComment({ anchor: orphanAnchor })]);

    const block = blockFor("c1")!;
    expect(block.querySelector(".review-status-badge")).toBeNull();
    expect(block.textContent).not.toContain("Outdated");
  });

  it("badges a detached comment the agent answered as Addressed", () => {
    renderInline([
      baseComment({ anchor: orphanAnchor, reactions: [agentAddressed] }),
    ]);

    const badge = blockFor("c1")!.querySelector(".review-status-badge");
    expect(badge!.textContent).toBe("Addressed");
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

describe("useReviewHighlights — comment bodies are sanitised", () => {
  // Comment text reaches the document through `innerHTML`. A comment is written
  // by whoever can write the review file — and, once the `oq` button ships, by
  // whatever a served document says — so it is untrusted input at this sink.
  const PAYLOAD = [
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">click</a>',
    "<script>alert(1)</script>",
    '<iframe src="https://e.test"></iframe>',
    "<svg onload=alert(1)></svg>",
    "[link](javascript:alert(1))",
  ].join("\n\n");

  /** Everything that must not survive into the live DOM, from any renderer. */
  const expectInert = (el: HTMLElement) => {
    expect(el.innerHTML).not.toMatch(/\son[a-z]+\s*=/i);
    expect(el.innerHTML.toLowerCase()).not.toContain("javascript:");
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("iframe")).toBeNull();
    expect(el.querySelector("svg")).toBeNull();
    expect(el.querySelector("img")).toBeNull();
  };

  it("renders an anchored comment body inert", () => {
    renderInline([baseComment({ comment: PAYLOAD, anchor: anchorAt(1) })]);
    expectInert(blockFor("c1")!);
  });

  it("renders an outdated comment body inert", () => {
    renderInline([baseComment({ comment: PAYLOAD, anchor: orphanAnchor })]);
    expectInert(blockFor("c1")!);
  });

  it("renders a resolved comment body inert", () => {
    renderInline([
      baseComment({ comment: PAYLOAD, anchor: anchorAt(1), resolved: true }),
    ]);
    expectInert(blockFor("c1")!);
  });

  it("renders a thread reply summary inert", () => {
    renderInline([
      baseComment({
        anchor: anchorAt(1),
        reactions: [{ ...agentAddressed, summary: PAYLOAD }],
      }),
    ]);
    const thread = blockFor("c1")!.querySelector<HTMLElement>(".review-thread");
    expect(thread).not.toBeNull();
    expectInert(thread!);
  });

  it("still renders the markdown a reviewer actually writes", () => {
    renderInline([
      baseComment({
        comment: "**fix** the `parse()` call, see [docs](docs/design/x.md)",
        anchor: anchorAt(1),
      }),
    ]);
    const text = blockFor("c1")!.querySelector<HTMLElement>(
      ".review-inline-comment-text",
    )!;
    expect(text.querySelector("strong")!.textContent).toBe("fix");
    expect(text.querySelector("code")!.textContent).toBe("parse()");
    expect(text.querySelector("a")!.getAttribute("href")).toBe(
      "docs/design/x.md",
    );
  });
});

describe("useReviewHighlights — commentsDrifted", () => {
  // The one signal the header shows about a document changing under a review.
  // Every case here is a content comparison with a definite answer both ways —
  // which is the whole point of deriving it from anchor hashes rather than from a
  // files_changed push, whose arrival cannot distinguish an agent answering from
  // the reviewer's own editor saving.
  const drifted = () => useReviewStore.getState().commentsDrifted;

  beforeEach(() => {
    useReviewStore.setState({ commentsDrifted: false });
  });

  it("is false when every comment's block still holds its original text", () => {
    renderInline([baseComment({ anchor: anchorAt(1) })]);
    expect(drifted()).toBe(false);
  });

  it("is true when the commented block was rewritten in place", () => {
    const comment = baseComment({ anchor: anchorAt(1) });
    container.querySelector('[data-source-line="1"]')!.textContent =
      "First paragraph, rewritten by an agent.";
    renderInline([comment]);
    expect(drifted()).toBe(true);
  });

  it("is true when the commented block is gone entirely", () => {
    renderInline([baseComment({ anchor: orphanAnchor })]);
    expect(drifted()).toBe(true);
  });

  it("is false when the block only moved — the text is intact", () => {
    // The neighbor walk re-anchors identical text a few lines away. The comment
    // is still about what it was about, so this must not read as drift.
    const comment = baseComment({ anchor: anchorAt(5) });
    const block = container.querySelector('[data-source-line="5"]')!;
    block.setAttribute("data-source-line", "7");
    renderInline([comment]);
    expect(drifted()).toBe(false);
  });

  it("ignores drift under a comment the agent already answered", () => {
    // Nothing is waiting on the agent, so stale context is not the reviewer's
    // problem — flagging it would make the signal fire on documents that have
    // simply moved on since a finished thread.
    const comment = baseComment({
      anchor: anchorAt(1),
      reactions: [agentAddressed],
    });
    container.querySelector('[data-source-line="1"]')!.textContent =
      "rewritten";
    renderInline([comment]);
    expect(drifted()).toBe(false);
  });

  it("ignores drift under a resolved comment", () => {
    const comment = baseComment({ anchor: orphanAnchor, resolved: true });
    renderInline([comment]);
    expect(drifted()).toBe(false);
  });

  it("does not claim drift for a legacy comment that has no anchor", () => {
    // With no recorded hash there is nothing to compare: the document may be
    // untouched. Saying "changed" here would be a guess.
    renderInline([baseComment({ anchor: undefined })]);
    expect(drifted()).toBe(false);
  });

  it("clears once the document is edited back to the commented text", () => {
    const comment = baseComment({ anchor: anchorAt(1) });
    const block = container.querySelector('[data-source-line="1"]')!;
    const original = block.textContent!;
    block.textContent = "First paragraph, rewritten by an agent.";

    const { rerender } = renderInline([comment]);
    expect(drifted()).toBe(true);

    // Falsifiable in both directions: restoring the text retracts the claim.
    block.textContent = original;
    rerender({ cs: [comment] });
    expect(drifted()).toBe(false);
  });

  it("is false when there are no comments at all", () => {
    useReviewStore.setState({ commentsDrifted: true });
    renderInline([]);
    expect(drifted()).toBe(false);
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
    expect(bar.textContent).toContain("1 dismissed comment");

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

  it("omits a legacy 'noted' turn and keeps the remaining summaries paired", () => {
    // The fixture's thread is [agent addressed, reviewer noted]. Only the agent
    // turn renders — and it must still carry its OWN summary. The entries are
    // keyed by data-thread-idx precisely so skipping a turn cannot slide every
    // later summary up under the wrong speaker's badge.
    seedResolved();

    const block = blockFor("r1")!;
    const badges = block.querySelectorAll(".review-thread-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("Agent");
    expect(block.textContent).not.toContain("You accepted");

    const entry = block.querySelector(".review-thread-entry")!;
    expect(entry.getAttribute("data-thread-idx")).toBe("0");
    expect(entry.querySelector(".review-thread-text")!.textContent).toBe(
      agentAddressed.summary,
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

describe("useReviewHighlights — only one delete is ever armed", () => {
  const ARMED = "review-inline-comment-delete--armed";

  const deleteBtnFor = (id: string) =>
    container.querySelector<HTMLElement>(
      `[data-review-inline-comment="${id}"] .review-inline-comment-delete`,
    )!;

  it("resets a previously armed button when another one is armed", () => {
    const a = baseComment({ id: "a1", anchor: anchorAt(1) });
    const b = baseComment({ id: "b1", anchor: anchorAt(5) });
    renderInline([a, b]);

    fireEvent.click(deleteBtnFor("a1"));
    expect(deleteBtnFor("a1").classList.contains(ARMED)).toBe(true);

    fireEvent.click(deleteBtnFor("b1"));

    // Two buttons reading "Delete?" at once would imply both are armed; only
    // one is, so clicking the stale-looking one merely re-arms it.
    expect(deleteBtnFor("b1").classList.contains(ARMED)).toBe(true);
    expect(deleteBtnFor("a1").classList.contains(ARMED)).toBe(false);
    expect(deleteBtnFor("a1").textContent).toBe("×");
    expect(actions.onDelete).not.toHaveBeenCalled();
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

describe("useReviewHighlights — a comment card inside a toned section", () => {
  // The card is inserted as a *sibling* between two stamped blocks, and the
  // section's vertical rule is drawn per member with a fixed 2.5rem upward
  // bleed. A card is far taller than that, so a card that does not carry the
  // tone breaks the rule for its own height and the section reads as two.
  // Geometry is unobservable here (jsdom cannot compute a `::before`); what is
  // asserted is the stamping the CSS keys off.
  const TONED_DOC = `
    <h2 data-source-line="1" data-vantage-tone="warning" data-vantage-run="start">Migration path</h2>
    <p data-source-line="3" data-vantage-tone="warning" data-vantage-run="middle">Body of the section.</p>
    <p data-source-line="5" data-vantage-tone="warning" data-vantage-run="end">The last block.</p>
    <p data-source-line="7">An untoned paragraph.</p>
  `;

  beforeEach(() => {
    container.innerHTML = TONED_DOC;
  });

  it("carries the host block's tone onto the card, as a run member", () => {
    renderInline([baseComment({ anchor: anchorAt(3) })]);

    const card = blockFor("c1")!;
    expect(card.getAttribute("data-vantage-tone")).toBe("warning");
    // Always `middle`: a card inserted into a run is never its first or last
    // member, and `middle` is what makes the rule bleed up to meet the block
    // above it.
    expect(card.getAttribute("data-vantage-run")).toBe("middle");
  });

  it("leaves a card after the last member unstamped", () => {
    // Stamping here would hang the section's rule *below* the section — a
    // visible defect, where the gap it would close is only a discontinuity.
    renderInline([baseComment({ anchor: anchorAt(5) })]);

    const card = blockFor("c1")!;
    expect(card.hasAttribute("data-vantage-tone")).toBe(false);
    expect(card.hasAttribute("data-vantage-run")).toBe(false);
  });

  it("leaves a card on an untoned block alone", () => {
    renderInline([baseComment({ anchor: anchorAt(7) })]);

    expect(blockFor("c1")!.hasAttribute("data-vantage-tone")).toBe(false);
  });

  it("carries the tone onto a detached card too, where it has a block", () => {
    // An outdated comment is placed after the nearest surviving block above,
    // which puts it inside the run just the same.
    renderInline([
      baseComment({
        anchor: {
          source_line: 4,
          block_text_hash: "deadbeef",
          selection_offset: 0,
          selection_length: 0,
        },
      }),
    ]);

    const card = blockFor("c1")!;
    expect(card.classList.contains("review-inline-comment--outdated")).toBe(
      true,
    );
    expect(card.getAttribute("data-vantage-tone")).toBe("warning");
    expect(card.getAttribute("data-vantage-run")).toBe("middle");
  });
});

describe("useReviewHighlights — comments on table cells", () => {
  /**
   * Two rows whose cells share their row's line, and a duplicate ("120ms" twice
   * in one column, on different rows) so the hash lookup has to pick between
   * candidates rather than merely find one.
   */
  const TABLE_DOC = `
    <p data-source-line="1">Before the table.</p>
    <table data-source-line="3">
      <thead><tr data-source-line="3">
        <th data-source-line="3">Engine</th><th data-source-line="3">Latency</th>
      </tr></thead>
      <tbody>
        <tr data-source-line="5">
          <td data-source-line="5">whisper.cpp</td><td data-source-line="5">120ms</td>
        </tr>
        <tr data-source-line="6">
          <td data-source-line="6">faster-whisper</td><td data-source-line="6">120ms</td>
        </tr>
      </tbody>
    </table>
    <p data-source-line="8">After the table.</p>
  `;

  /** The anchor a click on the cell holding `text` would have produced. */
  const cellAnchor = (text: string): CommentAnchor => {
    const cell = Array.from(
      container.querySelectorAll<HTMLElement>("td, th"),
    ).find((c) => c.textContent === text)!;
    return {
      source_line: Number.parseInt(cell.getAttribute("data-source-line")!, 10),
      block_text_hash: hashBlockText(blockVisibleText(cell)),
      selection_offset: 0,
      selection_length: 0,
    };
  };

  const cellFor = (text: string) =>
    Array.from(container.querySelectorAll<HTMLElement>("td, th")).find(
      (c) => c.textContent === text,
    )!;

  beforeEach(() => {
    container.innerHTML = TABLE_DOC;
  });

  it("highlights the cell the comment was written on, and no other", () => {
    renderInline([baseComment({ anchor: cellAnchor("whisper.cpp") })]);

    expect(
      cellFor("whisper.cpp").classList.contains("review-highlight-block"),
    ).toBe(true);
    expect(
      cellFor("faster-whisper").classList.contains("review-highlight-block"),
    ).toBe(false);
    expect(
      container
        .querySelector("table")!
        .classList.contains("review-highlight-block"),
    ).toBe(false);
  });

  it("picks the right cell when a whole row shares one source line", () => {
    // Both cells of row 5 are indexed under line 5. Document order alone would
    // hand back the last of them for either comment.
    renderInline([baseComment({ anchor: cellAnchor("120ms") })]);

    expect(cellFor("120ms").classList.contains("review-highlight-block")).toBe(
      true,
    );
    expect(
      cellFor("whisper.cpp").classList.contains("review-highlight-block"),
    ).toBe(false);
  });

  it("places the card after the table, not between two cells", () => {
    // A `<div>` inserted as a sibling of a `<td>` is hoisted out of the table by
    // HTML parsing rules — the card lands above the table, detached from the row
    // it answers, and the table's layout shifts under it.
    renderInline([baseComment({ anchor: cellAnchor("whisper.cpp") })]);

    const card = blockFor("c1")!;
    expect(card.parentElement).toBe(container);
    expect(card.previousElementSibling!.tagName).toBe("TABLE");
    expect(card.closest("table")).toBeNull();
  });

  it("does not claim drift for a comment on an untouched cell", () => {
    renderInline([baseComment({ anchor: cellAnchor("120ms") })]);

    expect(useReviewStore.getState().commentsDrifted).toBe(false);
  });

  it("drifts the one comment whose cell was rewritten, and only that one", () => {
    // The gain over anchoring a table comment to the whole table: an edit to one
    // cell used to change the table's hash, and so every comment on the table.
    // Which cell of the row carries the faint tint is deliberately not asserted
    // — with the commented text gone there is nothing left to tell one cell of a
    // row from another, and `blockAtLine` says so.
    const comments = [
      baseComment({ id: "c1", anchor: cellAnchor("whisper.cpp") }),
      baseComment({ id: "c2", anchor: cellAnchor("faster-whisper") }),
    ];
    const { rerender } = renderInline(comments);
    cellFor("whisper.cpp").textContent = "whisper.cpp (metal)";
    rerender({ cs: [...comments] });

    expect(useReviewStore.getState().commentsDrifted).toBe(true);
    expect(
      cellFor("faster-whisper").classList.contains("review-highlight-block"),
    ).toBe(true);
    expect(
      cellFor("faster-whisper").classList.contains(
        "review-highlight-block-divergent",
      ),
    ).toBe(false);
    // Both cards are still outside the table.
    expect(blockFor("c1")!.closest("table")).toBeNull();
    expect(blockFor("c2")!.closest("table")).toBeNull();
  });

  it("still anchors a comment on the table as a whole", () => {
    // What a click between cells, or on an empty one, produces.
    const table = container.querySelector<HTMLElement>("table")!;
    renderInline([
      baseComment({
        anchor: {
          source_line: 3,
          block_text_hash: hashBlockText(blockVisibleText(table)),
          selection_offset: 0,
          selection_length: 0,
        },
      }),
    ]);

    expect(table.classList.contains("review-highlight-block")).toBe(true);
    expect(blockFor("c1")!.previousElementSibling).toBe(table);
  });
});
