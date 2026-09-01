import { renderHook, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OQ_DEFAULT_LEANING,
  OQ_LABEL,
  OQ_TAKEN_LABEL,
  useOpenQuestionButtons,
  type TakeLeaning,
} from "./useOpenQuestionButtons";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "./useReviewHighlights";
import {
  blockVisibleText,
  hashBlockText,
  stripBlockText,
} from "../lib/reviewAnchor";
import { useReviewStore } from "../stores/useReviewStore";
import type { CommentAnchor, ReviewComment } from "../types";

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
`;

let container: HTMLDivElement;
let onTake: ReturnType<typeof vi.fn> & TakeLeaning;
let actions: InlineReviewActions;

const blockAt = (line: number) =>
  container.querySelector<HTMLElement>(`p[data-source-line="${line}"]`)!;

const takeButtons = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(".review-oq-take"));

interface Props {
  cs: ReviewComment[];
  on: boolean;
}

/** The hook alone, as MarkdownViewer calls it. */
const renderOq = (comments: ReviewComment[] = [], enabled = true) => {
  const ref = { current: container };
  return renderHook(
    ({ cs, on }: Props) =>
      useOpenQuestionButtons(ref, cs, on, "doc content", onTake),
    { initialProps: { cs: comments, on: enabled } },
  );
};

/** Both passes over one container, in MarkdownViewer's call order. */
const renderBoth = (comments: ReviewComment[] = []) => {
  const ref = { current: container };
  return renderHook(
    ({ cs, on }: Props) => {
      useReviewHighlights(ref, cs, "doc content", actions);
      useOpenQuestionButtons(ref, cs, on, "doc content", onTake);
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
    // One affirmative button and nothing else — no reject, no decline.
    expect(container.querySelectorAll("[data-vantage-oq-button]")).toHaveLength(
      3,
    );
  });

  it("hangs the button off the block review anchors resolve, not off the container", () => {
    renderOq();

    // The stamped paragraph inside the list item, not the <ol> or the <li>.
    expect(blockAt(7).querySelector(".review-oq-take")).not.toBeNull();
    expect(
      container.querySelector("ol > .review-oq-take, li > .review-oq-take"),
    ).toBeNull();

    // A stamped blockquote shares its source line with its first paragraph, and
    // that paragraph is what the highlighter resolves for the line.
    expect(blockAt(23).querySelector(".review-oq-take")).not.toBeNull();
    expect(container.querySelector("blockquote > .review-oq-take")).toBeNull();
  });

  it("never renders inside a pre", () => {
    renderOq();

    const pre = container.querySelector("pre")!;
    expect(pre.querySelector("[data-vantage-oq-button]")).toBeNull();
    expect(pre.textContent).toBe("x := 1");
  });

  it("leaves a block with no directive alone", () => {
    // The DOM-level statement of "the directive parsed": a malformed directive
    // is stamped by nothing, so its block is indistinguishable from prose.
    renderOq();

    expect(blockAt(15).querySelector("[data-vantage-oq-button]")).toBeNull();
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
    fireEvent.click(blockAt(7).querySelector(".review-oq-take")!);

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
    fireEvent.click(blockAt(23).querySelector(".review-oq-take")!);

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
    fireEvent.click(blockAt(7).querySelector(".review-oq-take")!);

    expect(onTake.mock.calls[0][1]).toBe(LEANING);
  });

  it("defaults the comment body when the directive carries no leaning", () => {
    renderOq();
    fireEvent.click(blockAt(11).querySelector(".review-oq-take")!);

    // The literal, not the constant: a rename must fail here.
    expect(onTake.mock.calls[0][1]).toBe("Take the stated leaning.");
    expect(OQ_DEFAULT_LEANING).toBe("Take the stated leaning.");
  });

  it("ignores a whitespace-only leaning rather than sending an empty body", () => {
    blockAt(11).setAttribute("data-vantage-leaning", "   ");
    renderOq();
    fireEvent.click(blockAt(11).querySelector(".review-oq-take")!);

    expect(onTake.mock.calls[0][1]).toBe(OQ_DEFAULT_LEANING);
  });

  it("passes the canonicalized block text as fallback_text, matching the popover", () => {
    renderOq();
    fireEvent.click(blockAt(7).querySelector(".review-oq-take")!);

    const fallback = onTake.mock.calls[0][2];
    expect(fallback).toBe(stripBlockText(blockVisibleText(blockAt(7))));
    expect(fallback).toBe("leaning: back of the queue.");
  });

  it("fires once on a double click", () => {
    renderOq();
    const btn = blockAt(7).querySelector<HTMLButtonElement>(".review-oq-take")!;
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
    fireEvent.click(blockAt(7).querySelector(".review-oq-take")!);
    rerender({ cs: [commentFromClick()], on: true });

    expect(blockAt(7).querySelector(".review-oq-take")).toBeNull();
    const chip = blockAt(7).querySelector<HTMLElement>(".review-oq-taken")!;
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
    fireEvent.click(blockAt(7).querySelector(".review-oq-take")!);
    rerender({
      cs: [commentFromClick({ comment: "I disagree, actually." })],
      on: true,
    });

    expect(blockAt(7).querySelector(".review-oq-take")).not.toBeNull();
    expect(blockAt(7).querySelector(".review-oq-taken")).toBeNull();
  });

  it("stays retired when the comment is dismissed, and returns when it is deleted", () => {
    const { rerender } = renderOq();
    fireEvent.click(blockAt(7).querySelector(".review-oq-take")!);

    // Dismissing a taken leaning must not re-arm the button, or the reviewer
    // gets a duplicate for a thread they closed.
    rerender({ cs: [commentFromClick({ resolved: true })], on: true });
    expect(blockAt(7).querySelector(".review-oq-taken")).not.toBeNull();
    expect(blockAt(7).querySelector(".review-oq-take")).toBeNull();

    // Deleting it does — the same escape hatch the rest of the review UI offers.
    rerender({ cs: [], on: true });
    expect(blockAt(7).querySelector(".review-oq-take")).not.toBeNull();
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
    fireEvent.click(blockAt(7).querySelector(".review-oq-take")!);
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
