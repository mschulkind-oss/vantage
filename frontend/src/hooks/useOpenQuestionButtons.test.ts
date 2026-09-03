import { renderHook, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OQ_ANSWERED_TITLE,
  OQ_DEFAULT_LEANING,
  OQ_LABEL,
  OQ_TAKEN_LABEL,
  OQ_UNDO_LABEL,
  useOpenQuestionButtons,
  type TakeLeaning,
  type UndoLeaning,
} from "./useOpenQuestionButtons";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "./useReviewHighlights";
import {
  NEIGHBOR_RADIUS,
  blockVisibleText,
  hashBlockText,
  stripBlockText,
} from "../lib/reviewAnchor";
import { useReviewStore } from "../stores/useReviewStore";
import type { CommentAnchor, CommentReaction, ReviewComment } from "../types";

/** The leaning on the list-item question, wrapped and collapsed as the plugin
 *  emits it — em dash included, so a test failure names the exact string. */
const LEANING =
  "Back of the queue — the fix might interact with things that merged while it was out.";

/**
 * The measured render of the canonical shapes, verbatim from the real chain
 * (`renderMarkdown` over the design's own examples):
 *
 * - the documented `oq` placement, indented inside a list item, so the stamped
 *   element is the `_Leaning:_` paragraph;
 * - a bare stamped paragraph with no `leaning`;
 * - an ordinary paragraph, which must stay untouched;
 * - a stamped `<pre>` — the plugin does stamp those, and a button inside a code
 *   fence renders as part of the code, so it must yield none;
 * - a stamped `<table>`, for the same reason one step further: a `<button>` child
 *   of `<table>` is not valid HTML, so the parser would hoist it out. Both are
 *   anchorable, so `vantage/orphan` is what tells the author instead;
 * - a stamped multi-paragraph `<blockquote>`, whose `data-source-line` its first
 *   paragraph shares: the case where anchoring on the stamped element itself
 *   would hash the wrong text.
 */
const DOC_HTML = `
<ol data-source-line="3">
<li data-source-line="3">
<p data-source-line="3"><strong>OQ-9: Queue position on re-entry.</strong> Where?</p>
<p data-source-line="7" data-vantage-oq="true" data-vantage-leaning="${LEANING}"><em>Leaning:</em> back of the queue.</p>
</li>
</ol>
<p data-source-line="11" data-vantage-oq="true">Should the retry budget be shared?</p>
<p data-source-line="15">An ordinary paragraph.</p>
<pre data-source-line="19" data-vantage-oq="true"><code>x := 1</code></pre>
<blockquote data-source-line="23" data-vantage-oq="true" data-vantage-leaning="Quote it"><p data-source-line="23">Quoted question?</p><p data-source-line="25">And a second paragraph.</p></blockquote>
<table data-source-line="29" data-vantage-oq="true" data-vantage-leaning="Tabulate it"><tbody><tr data-source-line="29"><td>a</td><td>b</td></tr></tbody></table>
`;

let container: HTMLDivElement;
let onTake: ReturnType<typeof vi.fn> & TakeLeaning;
let onUndo: ReturnType<typeof vi.fn> & UndoLeaning;
let actions: InlineReviewActions;

const blockAt = (line: number) =>
  container.querySelector<HTMLElement>(`p[data-source-line="${line}"]`)!;

const takeButtons = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(".review-oq-take"));

/**
 * The action row the pass inserts *after* the block at `line`, if any.
 *
 * The affordances are a sibling of the question, not a child of it, so every
 * assertion about placement goes through here — and a regression that appends
 * back into the block fails every one of them at once.
 */
const rowAfter = (line: number): HTMLElement | null => {
  const next = blockAt(line).nextElementSibling;
  return next instanceof HTMLElement && next.classList.contains("review-oq-row")
    ? next
    : null;
};

const takeAt = (line: number) =>
  rowAfter(line)?.querySelector<HTMLButtonElement>(".review-oq-take") ?? null;
const chipAt = (line: number) =>
  rowAfter(line)?.querySelector<HTMLElement>(".review-oq-taken") ?? null;
const undoAt = (line: number) =>
  rowAfter(line)?.querySelector<HTMLButtonElement>(".review-oq-undo") ?? null;

/** An agent turn, so a taken leaning reads as a live thread. */
const agentAddressed = (): CommentReaction => ({
  actor: "agent",
  kind: "addressed",
  summary: "Queued it at the back.",
  before_text: "",
  after_text: "",
  timestamp: 1,
});

interface Props {
  cs: ReviewComment[];
  on: boolean;
}

/** The hook alone, as MarkdownViewer calls it. */
const renderOq = (comments: ReviewComment[] = [], enabled = true) => {
  const ref = { current: container };
  return renderHook(
    ({ cs, on }: Props) =>
      useOpenQuestionButtons(ref, cs, on, "doc content", onTake, onUndo),
    { initialProps: { cs: comments, on: enabled } },
  );
};

/** Both passes over one container, in MarkdownViewer's call order. */
const renderBoth = (comments: ReviewComment[] = []) => {
  const ref = { current: container };
  return renderHook(
    ({ cs, on }: Props) => {
      useReviewHighlights(ref, cs, "doc content", actions);
      useOpenQuestionButtons(ref, cs, on, "doc content", onTake, onUndo);
    },
    { initialProps: { cs: comments, on: true } },
  );
};

/** A comment anchored on the block at `line`, as a live click would create it. */
const commentAt = (line: number): ReviewComment => {
  const block = container.querySelector<HTMLElement>(
    `[data-source-line="${line}"]`,
  )!;
  return {
    id: `c${line}`,
    comment: "unrelated, typed by hand",
    fallback_text: stripBlockText(blockVisibleText(block)),
    created_at: 0,
    reactions: [],
    anchor: {
      source_line: line,
      block_text_hash: hashBlockText(blockVisibleText(block)),
      selection_offset: 0,
      selection_length: 0,
    },
  };
};

/** The comment a click produces, as the store would hold it. */
const commentFromClick = (
  overrides: Partial<ReviewComment> = {},
): ReviewComment => {
  const [anchor, comment, fallbackText] = onTake.mock.calls[0] as [
    CommentAnchor,
    string,
    string,
  ];
  return {
    id: "c1",
    anchor,
    comment,
    fallback_text: fallbackText,
    created_at: 0,
    reactions: [],
    ...overrides,
  };
};

beforeEach(() => {
  container = document.createElement("div");
  container.innerHTML = DOC_HTML;
  document.body.appendChild(container);

  onTake = vi.fn() as ReturnType<typeof vi.fn> & TakeLeaning;
  onUndo = vi.fn() as ReturnType<typeof vi.fn> & UndoLeaning;
  actions = {
    onDelete: vi.fn(),
    onDismiss: vi.fn(),
    onReopen: vi.fn(),
    onEdit: vi.fn(),
    onReply: vi.fn(),
    onCopy: vi.fn().mockResolvedValue(true),
  };
  useReviewStore.setState({ comments: [], commentsDrifted: false });
});

afterEach(() => {
  container.remove();
  delete window.__VANTAGE_STATIC__;
});

describe("useOpenQuestionButtons — what renders", () => {
  it("renders one button per answerable oq block, labelled exactly", () => {
    renderOq();

    const buttons = takeButtons();
    expect(buttons).toHaveLength(3);
    for (const btn of buttons) {
      expect(btn.textContent).toBe("Take this leaning");
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.type).toBe("button");
    }
    // One affirmative button and nothing else — no reject, no decline. Three
    // rows and three buttons, so the count is six.
    expect(
      container.querySelectorAll(".review-oq-row .review-oq-take"),
    ).toHaveLength(3);
    expect(container.querySelectorAll(".review-oq-row")).toHaveLength(3);
  });

  it("puts the row after the block review anchors resolve, never inside it", () => {
    renderOq();

    // The stamped paragraph inside the list item, not the <ol> or the <li>.
    expect(takeAt(7)).not.toBeNull();
    // A sibling, not a child. The row is why no injected node can perturb the
    // text a block hash is taken over — and why the control no longer lands
    // after the question's last word.
    expect(blockAt(7).querySelector("[data-vantage-oq-button]")).toBeNull();
    // Still inside the list item, so it stays indented with its question rather
    // than breaking out to the document's left edge.
    expect(rowAfter(7)!.closest("li")).not.toBeNull();

    // A stamped blockquote shares its source line with its first paragraph, and
    // that paragraph is what the highlighter resolves for the line.
    expect(takeAt(23)).not.toBeNull();
    expect(blockAt(23).querySelector("[data-vantage-oq-button]")).toBeNull();
    // Inside the quote, after its first paragraph — which is also what keeps it
    // clear of typography's generated closing quotation mark, drawn as that
    // paragraph's ::after.
    expect(rowAfter(23)!.closest("blockquote")).not.toBeNull();
  });

  it("never renders inside a pre", () => {
    renderOq();

    const pre = container.querySelector("pre")!;
    expect(pre.querySelector("[data-vantage-oq-button]")).toBeNull();
    expect(pre.textContent).toBe("x := 1");
  });

  it("never renders inside a table", () => {
    // `pre` and `table` are the two anchorable tags that cannot host the
    // affordance, and they are the reason `OQ_HOST_TAGS` is a *narrowing* of
    // `VANTAGE_ANCHOR_TARGETS`. The checker reports `vantage/orphan` on both from
    // the same shared list, so this refusal is never silent.
    renderOq();

    const table = container.querySelector("table")!;
    expect(table.querySelector("[data-vantage-oq-button]")).toBeNull();
    expect(table.textContent).toBe("ab");
  });

  it("leaves a block with no directive alone", () => {
    // The DOM-level statement of "the directive parsed": a malformed directive
    // is stamped by nothing, so its block is indistinguishable from prose.
    renderOq();

    expect(rowAfter(15)).toBeNull();
    expect(blockAt(15).textContent).toBe("An ordinary paragraph.");
  });

  it("writes nothing until a human clicks", () => {
    renderOq();

    expect(onTake).not.toHaveBeenCalled();
    expect(useReviewStore.getState().comments).toEqual([]);
  });
});

describe("useOpenQuestionButtons — the three gates", () => {
  it("renders nothing with review mode off, and leaves no trace", () => {
    renderOq([], false);

    expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
    expect(container.innerHTML).not.toContain(OQ_LABEL);
  });

  it("clears its own buttons when review mode is switched off", () => {
    const { rerender } = renderOq([], true);
    expect(takeButtons()).toHaveLength(3);

    rerender({ cs: [], on: false });
    expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
  });

  it("renders nothing in a static export", () => {
    // An exported site runs review mode with every write coerced to a GET of a
    // file that does not exist, so a button here would look live and do nothing.
    window.__VANTAGE_STATIC__ = true;
    renderOq([], true);

    expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
  });

  it("renders nothing for a document with no directives", () => {
    container.innerHTML = `<p data-source-line="1">Just prose.</p>`;
    renderOq();

    expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
  });
});

describe("useOpenQuestionButtons — what a click sends", () => {
  it("builds the whole-block anchor the highlighter will resolve", () => {
    renderOq();
    fireEvent.click(takeAt(7)!);

    expect(onTake).toHaveBeenCalledTimes(1);
    const [anchor] = onTake.mock.calls[0];
    expect(anchor).toEqual({
      source_line: 7,
      block_text_hash: hashBlockText(blockVisibleText(blockAt(7))),
      selection_offset: 0,
      selection_length: 0,
    });
  });

  it("anchors a stamped blockquote on its first paragraph, not on itself", () => {
    renderOq();
    fireEvent.click(takeAt(23)!);

    const [anchor] = onTake.mock.calls[0];
    const quote = container.querySelector<HTMLElement>("blockquote")!;
    expect(anchor.block_text_hash).toBe(
      hashBlockText(blockVisibleText(blockAt(23))),
    );
    // The negative half is the one that catches anchoring on the stamped
    // element: the blockquote's text includes its second paragraph.
    expect(anchor.block_text_hash).not.toBe(
      hashBlockText(blockVisibleText(quote)),
    );
  });

  it("passes the leaning verbatim as the comment body", () => {
    renderOq();
    fireEvent.click(takeAt(7)!);

    expect(onTake.mock.calls[0][1]).toBe(LEANING);
  });

  it("defaults the comment body when the directive carries no leaning", () => {
    renderOq();
    fireEvent.click(takeAt(11)!);

    // The literal, not the constant: a rename must fail here.
    expect(onTake.mock.calls[0][1]).toBe("Take the stated leaning.");
    expect(OQ_DEFAULT_LEANING).toBe("Take the stated leaning.");
  });

  it("ignores a whitespace-only leaning rather than sending an empty body", () => {
    blockAt(11).setAttribute("data-vantage-leaning", "   ");
    renderOq();
    fireEvent.click(takeAt(11)!);

    expect(onTake.mock.calls[0][1]).toBe(OQ_DEFAULT_LEANING);
  });

  it("passes the canonicalized block text as fallback_text, matching the popover", () => {
    renderOq();
    fireEvent.click(takeAt(7)!);

    const fallback = onTake.mock.calls[0][2];
    expect(fallback).toBe(stripBlockText(blockVisibleText(blockAt(7))));
    expect(fallback).toBe("leaning: back of the queue.");
  });

  it("fires once on a double click", () => {
    renderOq();
    const btn = takeAt(7)!;
    fireEvent.click(btn);
    fireEvent.click(btn);

    // addComment mints a fresh id and appends, so a second call is a duplicate
    // comment the agent has to chase.
    expect(onTake).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
  });
});

describe("useOpenQuestionButtons — idempotence", () => {
  it("does not duplicate across re-runs of the pass", () => {
    const { rerender } = renderOq();
    rerender({ cs: [], on: true });
    rerender({ cs: [{ ...commentAt(15), id: "other" }], on: true });
    rerender({ cs: [], on: true });

    expect(takeButtons()).toHaveLength(3);
  });

  it("replaces its own output rather than adding to it", () => {
    // Two passes over one container with no teardown between them. React
    // happens to run every effect cleanup before any effect body, but the
    // remove-then-add cycle is what makes the pass idempotent without relying
    // on that ordering — nothing else in the app removes these nodes.
    renderOq();
    renderOq();

    expect(takeButtons()).toHaveLength(3);
  });

  it("survives the highlighter's teardown", () => {
    // useReviewHighlights removes only its own marks and inline cards, so a
    // store write must not take the OQ buttons with it.
    const { rerender } = renderBoth([commentAt(15)]);
    expect(takeButtons()).toHaveLength(3);

    rerender({ cs: [commentAt(15)], on: true });
    expect(takeButtons()).toHaveLength(3);
  });

  it("replaces the button with a chip once this leaning is taken", () => {
    const { rerender } = renderOq();
    fireEvent.click(takeAt(7)!);
    rerender({ cs: [commentFromClick()], on: true });

    expect(takeAt(7)).toBeNull();
    const chip = chipAt(7)!;
    expect(chip.textContent).toBe(OQ_TAKEN_LABEL);
    expect(chip.textContent).toBe("Leaning taken");
    expect(chip.tagName).not.toBe("BUTTON");
    // The other questions are untouched.
    expect(takeButtons()).toHaveLength(2);
  });

  it("keeps the button when a different comment exists on the same block", () => {
    // D4(b): typing an answer never removes the button, and the button never
    // removes typing.
    const { rerender } = renderOq();
    fireEvent.click(takeAt(7)!);
    rerender({
      cs: [commentFromClick({ comment: "I disagree, actually." })],
      on: true,
    });

    expect(takeAt(7)).not.toBeNull();
    expect(chipAt(7)).toBeNull();
  });

  it("removes everything on unmount", () => {
    const { unmount } = renderOq();
    unmount();

    expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
  });
});

describe("useOpenQuestionButtons — the comment it creates", () => {
  it("renders anchored, not drifted", () => {
    // The whole area in one assertion: the container tie-break, the
    // offset-0/length-0 shape, and the hash-strip selector. Get any of them
    // wrong and the reviewer's own click raises "the document changed under
    // your comments".
    const { rerender } = renderBoth();
    fireEvent.click(takeAt(7)!);
    const created = commentFromClick();
    rerender({ cs: [created], on: true });

    const card = container.querySelector<HTMLElement>(
      `[data-review-inline-comment="c1"]`,
    );
    expect(card).not.toBeNull();
    expect(card!.className).not.toContain("review-inline-comment--outdated");

    expect(blockAt(7).classList.contains("review-highlight-block")).toBe(true);
    expect(
      blockAt(7).classList.contains("review-highlight-block-divergent"),
    ).toBe(false);
    expect(useReviewStore.getState().commentsDrifted).toBe(false);
  });
});

/**
 * The tree a reviewer actually walks after clicking, which is where this
 * feature was thin: the old suite exercised exactly two states — a matching
 * comment exists, or none does — and mentioned `resolved` on one line.
 *
 * The shape is `useReviewStore.test.ts`'s "comment-state predicates over the
 * full thread table": a table of states with written-out expectations, so a
 * broken affordance cannot quietly agree with a broken expectation. Each row
 * is one comment state; the two columns are what the row must show.
 */
describe("useOpenQuestionButtons — the state tree after a take", () => {
  /** Take the leaning on line 7 and return the comment the click produced. */
  const take = () => {
    const h = renderOq();
    fireEvent.click(takeAt(7)!);
    return { ...h, created: commentFromClick() };
  };

  interface Row {
    name: string;
    /** Applied to the comment the click created. */
    patch: Partial<ReviewComment>;
    chip: boolean;
    undo: boolean;
    take: boolean;
  }

  const rows: Row[] = [
    {
      name: "fresh — the take is the whole thread",
      patch: {},
      chip: true,
      undo: true,
      take: false,
    },
    {
      name: "dismissed — resolved is ignored, so the chip stays",
      patch: { resolved: true },
      chip: true,
      undo: true,
      take: false,
    },
    {
      name: "reopened — the same state as fresh again",
      patch: { resolved: false },
      chip: true,
      undo: true,
      take: false,
    },
    {
      name: "answered by the agent — no Undo, because it would take the reply",
      patch: { reactions: [agentAddressed()] },
      chip: true,
      undo: false,
      take: false,
    },
    {
      name: "answered and then dismissed — still no Undo",
      patch: { reactions: [agentAddressed()], resolved: true },
      chip: true,
      undo: false,
      take: false,
    },
    {
      name: "reworded — the body is the take's identity, so it re-arms",
      patch: { comment: "Actually, front of the queue." },
      chip: false,
      undo: false,
      take: true,
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const { rerender, created } = take();
      rerender({ cs: [{ ...created, ...row.patch }], on: true });

      expect(chipAt(7) !== null).toBe(row.chip);
      expect(undoAt(7) !== null).toBe(row.undo);
      expect(takeAt(7) !== null).toBe(row.take);
      // Never both. A chip and a live button on one question is the incoherence
      // the shared NEIGHBOR_RADIUS exists to prevent, and it must not be
      // reachable by any other route either.
      expect([chipAt(7), takeAt(7)].filter(Boolean)).toHaveLength(1);
    });
  }

  it("walks dismiss → reopen → dismiss without ever re-arming", () => {
    const { rerender, created } = take();

    for (const resolved of [true, false, true]) {
      rerender({ cs: [{ ...created, resolved }], on: true });
      expect(chipAt(7)).not.toBeNull();
      expect(takeAt(7)).toBeNull();
    }

    // Only deleting it re-arms — and Undo is what deletes it.
    rerender({ cs: [], on: true });
    expect(takeAt(7)).not.toBeNull();
    expect(chipAt(7)).toBeNull();
  });

  it("leaves the other questions alone through the whole tree", () => {
    const { rerender, created } = take();
    rerender({ cs: [{ ...created, resolved: true }], on: true });

    expect(takeAt(11)).not.toBeNull();
    expect(takeAt(23)).not.toBeNull();
    expect(chipAt(11)).toBeNull();
  });
});

describe("useOpenQuestionButtons — Undo", () => {
  const take = () => {
    const h = renderOq();
    fireEvent.click(takeAt(7)!);
    return { ...h, created: commentFromClick() };
  };

  it("is labelled exactly, and is a real button", () => {
    const { rerender, created } = take();
    rerender({ cs: [created], on: true });

    const undo = undoAt(7)!;
    expect(undo.textContent).toBe(OQ_UNDO_LABEL);
    expect(undo.textContent).toBe("Undo");
    expect(undo.tagName).toBe("BUTTON");
    expect(undo.type).toBe("button");
    // Beside the chip, in the same row: the way out is where the reviewer is
    // looking, not at the top of the document where the dismissed section sits.
    expect(undo.parentElement).toBe(chipAt(7)!.parentElement);
  });

  it("deletes the comment the take created, by id", () => {
    const { rerender, created } = take();
    rerender({ cs: [{ ...created, id: "oq-comment" }], on: true });
    fireEvent.click(undoAt(7)!);

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith("oq-comment");
  });

  it("fires once on a double click", () => {
    const { rerender, created } = take();
    rerender({ cs: [created], on: true });
    const undo = undoAt(7)!;
    fireEvent.click(undo);
    fireEvent.click(undo);

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(undo.disabled).toBe(true);
  });

  it("does not let the click reach the comment popover", () => {
    // The container's own click handler opens the popover. An Undo that also
    // opened it would leave the reviewer typing into a box they did not ask for.
    const { rerender, created } = take();
    rerender({ cs: [created], on: true });
    const seen = vi.fn();
    container.addEventListener("click", seen);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    undoAt(7)!.dispatchEvent(event);

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    container.removeEventListener("click", seen);
  });

  it("explains itself when it is withheld", () => {
    // A chip with no Undo has to say why, or it is the inert dead end again.
    const { rerender, created } = take();
    rerender({
      cs: [{ ...created, reactions: [agentAddressed()] }],
      on: true,
    });

    expect(undoAt(7)).toBeNull();
    expect(chipAt(7)!.title).toBe(OQ_ANSWERED_TITLE);
    expect(chipAt(7)!.title).not.toBe("");
  });

  it("carries no title while it is offered, because the button says it", () => {
    const { rerender, created } = take();
    rerender({ cs: [created], on: true });

    expect(chipAt(7)!.title).toBe("");
    expect(undoAt(7)!.title).not.toBe("");
  });
});

describe("useOpenQuestionButtons — drift, and agreeing with the highlighter", () => {
  const take = () => {
    const h = renderOq();
    fireEvent.click(takeAt(7)!);
    return { ...h, created: commentFromClick() };
  };

  /** Move the question `by` lines without touching its text. */
  const moveBlock = (line: number, by: number) => {
    const block = blockAt(line);
    block.setAttribute("data-source-line", String(line + by));
  };

  it("keeps the chip when the block moves within the neighbour radius", () => {
    // The bug this fixes: the highlighter re-anchors a comment whose block moved
    // by walking ±NEIGHBOR_RADIUS lines, while this pass compared source_line
    // for equality. Insert one line above an `oq` block and the reviewer saw the
    // chip *and* a live button on the same paragraph — one surface saying the
    // comment was attached, the other saying the leaning had never been taken.
    const { rerender, created } = take();
    moveBlock(7, NEIGHBOR_RADIUS);
    rerender({ cs: [created], on: true });

    const moved = container.querySelector<HTMLElement>(
      `p[data-source-line="${7 + NEIGHBOR_RADIUS}"]`,
    )!;
    const row = moved.nextElementSibling as HTMLElement;
    expect(row.querySelector(".review-oq-taken")).not.toBeNull();
    expect(row.querySelector(".review-oq-take")).toBeNull();
  });

  it("re-arms once the block moves beyond the radius", () => {
    // The boundary is stated rather than left to be discovered: past the radius
    // the highlighter calls the comment outdated and renders it detached, so a
    // fresh button is the honest answer on a block nothing is anchored to.
    const { rerender, created } = take();
    moveBlock(7, NEIGHBOR_RADIUS + 1);
    rerender({ cs: [created], on: true });

    const moved = container.querySelector<HTMLElement>(
      `p[data-source-line="${7 + NEIGHBOR_RADIUS + 1}"]`,
    )!;
    const row = moved.nextElementSibling as HTMLElement;
    expect(row.querySelector(".review-oq-take")).not.toBeNull();
    expect(row.querySelector(".review-oq-taken")).toBeNull();
  });

  it("re-arms when the question's own text changes", () => {
    // The hash is the block's identity. Reword the question and the stored
    // anchor describes text that is no longer there, which the highlighter shows
    // as a divergent comment — so the leaning on offer is a different leaning.
    const { rerender, created } = take();
    blockAt(7).textContent = "Leaning: front of the queue, actually.";
    rerender({ cs: [created], on: true });

    expect(takeAt(7)).not.toBeNull();
    expect(chipAt(7)).toBeNull();
  });

  it("keeps two identical leanings on distant blocks independent", () => {
    // Why the line stays a tolerance rather than being dropped: matching on the
    // body and the hash alone would let one take retire the button on an
    // identical question elsewhere in the document.
    container.innerHTML = `
<p data-source-line="7" data-vantage-oq="true" data-vantage-leaning="Same leaning">Identical question?</p>
<p data-source-line="99" data-vantage-oq="true" data-vantage-leaning="Same leaning">Identical question?</p>
`;
    const { rerender } = renderOq();
    expect(takeButtons()).toHaveLength(2);

    fireEvent.click(takeAt(7)!);
    rerender({ cs: [commentFromClick()], on: true });

    expect(chipAt(7)).not.toBeNull();
    expect(takeAt(7)).toBeNull();
    // The far one is a different question, hash-identical though it is.
    expect(takeAt(99)).not.toBeNull();
    expect(chipAt(99)).toBeNull();
  });
});

describe("useOpenQuestionButtons — the row and the tone rule", () => {
  it("joins a toned section's run rather than punching a hole in it", () => {
    // A section's rule is a slice per stamped member bled upward to meet its
    // predecessor. An unstamped row inserted between two members is a gap the
    // bleed cannot span, so the row copies the tone and marks itself `middle` —
    // the same thing insertInlineCommentAfter does with a comment card.
    container.innerHTML = `
<p data-source-line="3" data-vantage-tone="note" data-vantage-run="start">Toned opener.</p>
<p data-source-line="5" data-vantage-oq="true" data-vantage-tone="note" data-vantage-run="middle">A question inside the section?</p>
<p data-source-line="7" data-vantage-tone="note" data-vantage-run="end">Toned closer.</p>
`;
    renderOq();

    const row = rowAfter(5)!;
    expect(row.getAttribute("data-vantage-tone")).toBe("note");
    expect(row.getAttribute("data-vantage-run")).toBe("middle");
  });

  it("claims no tone after the last member of a run", () => {
    // Positive, like the stylesheet's own run selectors: a row after the `end`
    // member sits outside the section, and a stamped row there would draw the
    // rule past the block the section actually finishes on.
    container.innerHTML = `
<p data-source-line="3" data-vantage-tone="note" data-vantage-run="start">Toned opener.</p>
<p data-source-line="5" data-vantage-oq="true" data-vantage-tone="note" data-vantage-run="end">The last question?</p>
`;
    renderOq();

    const row = rowAfter(5)!;
    expect(row.getAttribute("data-vantage-tone")).toBeNull();
    expect(row.getAttribute("data-vantage-run")).toBeNull();
  });

  it("claims no tone on a block with none", () => {
    renderOq();
    expect(rowAfter(7)!.getAttribute("data-vantage-tone")).toBeNull();
  });
});
