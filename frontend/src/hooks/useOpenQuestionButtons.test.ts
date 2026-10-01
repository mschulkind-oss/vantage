import { createElement, useLayoutEffect } from "react";
import { cleanup, render, renderHook, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarkdownViewer } from "vantage-md/react";
import {
  OQ_ANSWERED_HINT,
  OQ_ANSWERED_LABEL,
  OQ_ANSWERED_TITLE,
  OQ_ANSWER_LABEL,
  OQ_DEFAULT_LEANING,
  OQ_LABEL,
  OQ_TAKEN_DISMISSED_HINT,
  OQ_TAKEN_DISMISSED_LABEL,
  OQ_TAKEN_LABEL,
  OQ_TAKEN_REPLIED_LABEL,
  OQ_UNDO_LABEL,
  commentsOnQuestions,
  documentQuestions,
  leaningComment,
  questionOffer,
  questionUnit,
  questionUnitBlocks,
  useOpenQuestionButtons,
  type AnswerQuestion,
  type TakeLeaning,
  type UndoLeaning,
} from "./useOpenQuestionButtons";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "./useReviewHighlights";
import { collectOutline } from "./useDocumentOutline";
import { renderMarkdown } from "vantage-md";
import {
  NEIGHBOR_RADIUS,
  anchorBlockWithin,
  blockVisibleText,
  buildWholeBlockAnchor,
  hashBlockText,
  stripBlockText,
} from "../lib/reviewAnchor";
import { readRepoFile } from "../test/planning";
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
 *
 * A thematic break separates the root-level blocks, so each question outside
 * the list is the one block its directive stamped: a question outside a list
 * runs over the blocks after its host up to the next break, heading or
 * question (`questionUnitBlocks`), which the tests of that say so themselves.
 */
const DOC_HTML = `
<ol data-source-line="3">
<li data-source-line="3">
<p data-source-line="3"><strong>OQ-9: Queue position on re-entry.</strong> Where?</p>
<p data-source-line="7" data-vantage-oq="true" data-vantage-leaning="${LEANING}"><em>Leaning:</em> back of the queue.</p>
</li>
</ol>
<p data-source-line="11" data-vantage-oq="true">Should the retry budget be shared?</p>
<hr data-source-line="13">
<p data-source-line="15">An ordinary paragraph.</p>
<hr data-source-line="17">
<pre data-source-line="19" data-vantage-oq="true"><code>x := 1</code></pre>
<hr data-source-line="21">
<blockquote data-source-line="23" data-vantage-oq="true" data-vantage-leaning="Quote it"><p data-source-line="23">Quoted question?</p><p data-source-line="25">And a second paragraph.</p></blockquote>
<hr data-source-line="27">
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

/** The row inserted as the next sibling of the block at `line`, if any. */
const rowAfter = (line: number): HTMLElement | null => {
  const next = blockAt(line).nextElementSibling;
  return next instanceof HTMLElement && next.classList.contains("review-oq-row")
    ? next
    : null;
};

/**
 * The row of the question whose host is the block at `line`, if any: at the
 * END of the question's unit — the last child of its list item or quote, or
 * the next sibling of the last block of a question outside a list. Every
 * assertion about a question's controls goes through here, and the placement
 * tests below say where that is in so many words.
 */
const rowAt = (line: number): HTMLElement | null => {
  const host = blockAt(line);
  const question = documentQuestions(container).find((q) => q.block === host);
  if (question === undefined) return null;
  const blocks = questionUnitBlocks(question.stamped, container);
  const last = blocks[blocks.length - 1]!;
  const candidate =
    blocks.length === 1 && last !== host && last.contains(host)
      ? last.lastElementChild
      : last.nextElementSibling;
  return candidate instanceof HTMLElement &&
    candidate.classList.contains("review-oq-row")
    ? candidate
    : null;
};

const takeAt = (line: number) =>
  rowAt(line)?.querySelector<HTMLButtonElement>(".review-oq-take") ?? null;
const chipAt = (line: number) =>
  rowAt(line)?.querySelector<HTMLElement>(".review-oq-taken") ?? null;
const undoAt = (line: number) =>
  rowAt(line)?.querySelector<HTMLButtonElement>(".review-oq-undo") ?? null;
const answeredAt = (line: number) =>
  rowAt(line)?.querySelector<HTMLElement>(".review-oq-answered") ?? null;
const answerAt = (line: number) =>
  rowAt(line)?.querySelector<HTMLButtonElement>(".review-oq-answer") ?? null;

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
  it("renders one button per answerable oq block, labeled exactly", () => {
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

  it("puts the row at the end of the question's unit, never inside its host block", () => {
    renderOq();

    // The stamped paragraph inside the list item, not the <ol> or the <li>,
    // hosts the take; the row is the item's last child, so it stays indented
    // with its question rather than breaking out to the document's left edge.
    expect(takeAt(7)).not.toBeNull();
    const item = blockAt(7).closest("li")!;
    expect(item.lastElementChild).toBe(rowAt(7));
    // Never a child of the host. The row is why no injected node can perturb
    // the text a block hash is taken over — and why the control no longer
    // lands after the question's last word.
    expect(blockAt(7).querySelector("[data-vantage-oq-button]")).toBeNull();

    // A question that is one paragraph gets the row as its next sibling.
    expect(rowAfter(11)).toBe(rowAt(11));

    // A stamped blockquote shares its source line with its first paragraph, and
    // that paragraph is what the highlighter resolves for the line; the quote
    // is the unit, so the row is inside it, after its LAST paragraph — clear of
    // typography's generated closing quotation mark, drawn as a paragraph's
    // ::after, and after everything the question says.
    expect(takeAt(23)).not.toBeNull();
    expect(blockAt(23).querySelector("[data-vantage-oq-button]")).toBeNull();
    const quote = container.querySelector("blockquote")!;
    expect(quote.lastElementChild).toBe(rowAt(23));
    expect(rowAfter(23)).toBeNull();
  });

  it("puts the row after the leaning and the Answer, at the end of a question as the style guide writes it", async () => {
    const { html } = await renderMarkdown(
      [
        "1. 💬 **OQ-9: Where does a job go when it re-enters the queue?**",
        "",
        "   A job that fails its checks leaves the queue.",
        "",
        "   - **A — The back of the queue.**",
        "   - **B — Its old place.**",
        "",
        '   <!-- vantage: question id=OQ-9 leaning="A — the back of the queue." -->',
        "",
        "   _Leaning:_ A.",
        "",
        "   **Answer:**",
        "",
        "   > _(empty — fill in when decided)_",
        "",
        "2. 💬 **OQ-10: The next one.**",
        "",
        "   Context.",
        "",
      ].join("\n"),
    );
    container.innerHTML = html;
    renderOq();

    const item = container.querySelector<HTMLElement>("li")!;
    const row = item.lastElementChild as HTMLElement;
    expect(row.classList.contains("review-oq-row")).toBe(true);
    // After the Answer's quote, not between the leaning and the Answer, where
    // the directive's block is.
    expect(row.previousElementSibling?.tagName).toBe("BLOCKQUOTE");
    expect(row.querySelector(".review-oq-take")).toHaveTextContent(OQ_LABEL);
    // The next question is untouched by it.
    expect(item.nextElementSibling?.querySelector(".review-oq-row")).toBeNull();
  });

  it("runs a question that is a heading to the end of its section, and puts the row there", async () => {
    const { html } = await renderMarkdown(
      [
        '<!-- vantage: question id=OQ-6 leaning="Yes." -->',
        "",
        "### 💬 OQ-6: A question as a heading?",
        "",
        "Its context.",
        "",
        "#### A deeper heading, still the question's",
        "",
        "_Leaning:_ yes.",
        "",
        "### The next section",
        "",
        "Not the question's.",
        "",
      ].join("\n"),
    );
    container.innerHTML = html;
    renderOq();

    const heading = container.querySelector("h3")!;
    expect(heading.querySelector("[data-vantage-oq-button]")).toBeNull();
    const rows = container.querySelectorAll(".review-oq-row");
    expect(rows).toHaveLength(1);
    // After the leaning, the section's last block, and before the next
    // heading of the same level.
    expect(rows[0]!.previousElementSibling).toHaveTextContent("Leaning: yes.");
    expect(rows[0]!.nextElementSibling?.tagName).toBe("H3");
  });

  it("runs a question outside a list over its context, options, leaning and Answer, up to the next question", async () => {
    // The style guide's question, written as paragraphs instead of a list
    // item: the title paragraph is the host, and the question is every block
    // after it up to the next question's host.
    const { html } = await renderMarkdown(
      [
        '<!-- vantage: question id=OQ-1 leaning="A." -->',
        "",
        "💬 **OQ-1: Where does a job go?**",
        "",
        "Its context, in a paragraph of its own.",
        "",
        "- **A — The back.**",
        "- **B — Its old place.**",
        "",
        "_Leaning:_ A.",
        "",
        "**Answer:**",
        "",
        "> _(empty — fill in when decided)_",
        "",
        "<!-- vantage: question id=OQ-2 -->",
        "",
        "💬 **OQ-2: The next one?**",
        "",
        "---",
        "",
        "After a rule, no question's.",
        "",
      ].join("\n"),
    );
    container.innerHTML = html;
    renderOq();

    const [first, second] = documentQuestions(container);
    const blocks = questionUnitBlocks(first!.stamped, container);
    expect(blocks.map((b) => b.tagName)).toEqual([
      "P",
      "P",
      "UL",
      "P",
      "P",
      "BLOCKQUOTE",
    ]);
    // The second question stops at the rule.
    expect(questionUnitBlocks(second!.stamped, container)).toEqual([
      second!.stamped,
    ]);
    const rows = Array.from(container.querySelectorAll(".review-oq-row"));
    expect(rows).toHaveLength(2);
    // After the Answer's quote, not between the title and its context.
    expect(rows[0]!.previousElementSibling).toBe(blocks[5]);
    expect(rows[0]!.nextElementSibling).toBe(second!.stamped);
    expect(rows[1]!.previousElementSibling).toBe(second!.stamped);
    expect(rows[1]!.nextElementSibling?.tagName).toBe("HR");
  });

  it("takes a comment on any block of a question outside a list as its answer", async () => {
    const { html } = await renderMarkdown(
      [
        '<!-- vantage: question id=OQ-1 leaning="A." -->',
        "",
        "💬 **OQ-1: Where does a job go?**",
        "",
        "_Leaning:_ A.",
        "",
        "## Afterword",
        "",
        "Not the question's.",
        "",
      ].join("\n"),
    );
    container.innerHTML = html;
    const leaning = container.querySelectorAll("p")[1]!;
    const afterword = container.querySelectorAll("p")[2]!;
    const on = (block: HTMLElement): ReviewComment => ({
      ...commentAt(Number(block.getAttribute("data-source-line"))),
      id: `c${block.getAttribute("data-source-line")}`,
    });

    const questions = documentQuestions(container);
    const scoped = commentsOnQuestions(container, questions, [
      on(leaning),
      on(afterword),
    ]);
    expect(scoped.get(questions[0]!)?.map((c) => c.id)).toEqual([
      `c${leaning.getAttribute("data-source-line")}`,
    ]);

    renderOq([on(leaning)]);
    const row = container.querySelector(".review-oq-row")!;
    expect(row.previousElementSibling).toBe(leaning);
    expect(row.querySelector(".review-oq-answered")).toHaveTextContent(
      OQ_ANSWERED_LABEL,
    );
    expect(row.querySelector(".review-oq-take")).toBeNull();
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

  it("says the question is answered when a different comment is on the same block", () => {
    // A comment typed on the question is its answer (the user's ruling of
    // 2026-10-01), so the take is no longer on offer. It is not the take's
    // chip, which would offer Undo on words the reviewer typed.
    const { rerender } = renderOq();
    fireEvent.click(takeAt(7)!);
    rerender({
      cs: [commentFromClick({ comment: "I disagree, actually." })],
      on: true,
    });

    expect(takeAt(7)).toBeNull();
    expect(chipAt(7)).toBeNull();
    expect(undoAt(7)).toBeNull();
    expect(answeredAt(7)).toHaveTextContent(OQ_ANSWERED_LABEL);
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
    /** The take's chip, by its label, or `null` for none. */
    chip: string | null;
    undo: boolean;
    take: boolean;
    /** Answer… is offered: the question needs the human again. */
    answer: boolean;
  }

  const rows: Row[] = [
    {
      name: "fresh — the take is the whole thread",
      patch: {},
      chip: OQ_TAKEN_LABEL,
      undo: true,
      take: false,
      answer: false,
    },
    {
      name: "dismissed — no longer the answer, so Answer… is back, and Take is not",
      patch: { resolved: true },
      chip: OQ_TAKEN_DISMISSED_LABEL,
      undo: true,
      take: false,
      answer: true,
    },
    {
      name: "reopened — the same state as fresh again",
      patch: { resolved: false },
      chip: OQ_TAKEN_LABEL,
      undo: true,
      take: false,
      answer: false,
    },
    {
      name: "answered by the agent — no Undo, because it would take the reply",
      patch: { reactions: [agentAddressed()] },
      chip: OQ_TAKEN_REPLIED_LABEL,
      undo: false,
      take: false,
      answer: true,
    },
    {
      name: "answered and then dismissed — still no Undo",
      patch: { reactions: [agentAddressed()], resolved: true },
      chip: OQ_TAKEN_REPLIED_LABEL,
      undo: false,
      take: false,
      answer: true,
    },
    {
      name: "reworded — no longer the take, but still the question's answer",
      patch: { comment: "Actually, front of the queue." },
      chip: null,
      undo: false,
      take: false,
      answer: false,
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const ref = { current: container };
      const onAnswer = vi.fn();
      const { rerender } = renderHook(
        ({ cs, on }: Props) =>
          useOpenQuestionButtons(
            ref,
            cs,
            on,
            "doc content",
            onTake,
            onUndo,
            undefined,
            onAnswer,
          ),
        { initialProps: { cs: [] as ReviewComment[], on: true } },
      );
      fireEvent.click(takeAt(7)!);
      const created = commentFromClick();
      rerender({ cs: [{ ...created, ...row.patch }], on: true });

      expect(chipAt(7)?.textContent ?? null).toBe(row.chip);
      expect(undoAt(7) !== null).toBe(row.undo);
      expect(takeAt(7) !== null).toBe(row.take);
      expect(answerAt(7) !== null).toBe(row.answer);
      // What the row offers is the one rule the card and the counts read.
      expect(
        questionOffer(created.anchor!, created.comment, [
          { ...created, ...row.patch },
        ]).kind,
      ).toBe(row.chip === null ? "answered" : row.answer ? "retake" : "taken");
      // Exactly one. A chip and a live button on one question is the
      // incoherence the shared NEIGHBOR_RADIUS exists to prevent, and it must
      // not be reachable by any other route either.
      expect(
        [chipAt(7), takeAt(7), answeredAt(7)].filter(Boolean),
      ).toHaveLength(1);
    });
  }

  it("walks dismiss → reopen → dismiss without ever re-arming", () => {
    const { rerender, created } = take();

    for (const resolved of [true, false, true]) {
      rerender({ cs: [{ ...created, resolved }], on: true });
      expect(chipAt(7)).not.toBeNull();
      expect(takeAt(7)).toBeNull();
      // Dismissed, the take says so and why; the question needs an answer.
      expect(chipAt(7)!.title).toBe(resolved ? OQ_TAKEN_DISMISSED_HINT : "");
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

  it("is labeled exactly, and is a real button", () => {
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

  it("keeps the chip when the block moves within the neighbor radius", () => {
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

  it("answers the question, but is no longer its take, when the question's own text changes", () => {
    // The hash is the block's identity. Reword the question and the stored
    // anchor describes text that is no longer there, which the highlighter shows
    // as a divergent comment — so the leaning on offer is a different leaning,
    // and the take's chip goes. The comment is still on the question, and
    // still pending, so the question is still answered.
    const { rerender, created } = take();
    blockAt(7).textContent = "Leaning: front of the queue, actually.";
    rerender({ cs: [created], on: true });

    expect(chipAt(7)).toBeNull();
    expect(takeAt(7)).toBeNull();
    expect(answeredAt(7)).not.toBeNull();

    // Once the agent has answered it, the question offers the new leaning.
    rerender({ cs: [{ ...created, reactions: [agentAddressed()] }], on: true });
    expect(takeAt(7)).not.toBeNull();
    expect(answeredAt(7)).toBeNull();
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
    // the same thing insertInlineCommentAfter does with a comment card. The
    // closer is another question, which is where the first one ends.
    container.innerHTML = `
<p data-source-line="3" data-vantage-tone="note" data-vantage-run="start">Toned opener.</p>
<p data-source-line="5" data-vantage-oq="true" data-vantage-tone="note" data-vantage-run="middle">A question inside the section?</p>
<p data-source-line="7" data-vantage-question="true" data-vantage-tone="note" data-vantage-run="end">Another question, closing it?</p>
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

/**
 * The count, which is the only thing that says the affordance exists at all
 * while review mode is off.
 *
 * The reported bug: a document with three `oq` directives carrying leanings
 * rendered as three ordinary paragraphs, because the button is gated on review
 * mode (D4) and nothing else mentioned it. The gate is right; the silence was
 * not.
 */
describe("useOpenQuestionButtons — the answerable count", () => {
  const renderWithCount = (enabled: boolean) => {
    const onCount = vi.fn();
    const ref = { current: container };
    const hook = renderHook(
      ({ on }: { on: boolean }) =>
        useOpenQuestionButtons(
          ref,
          [],
          on,
          "doc content",
          onTake,
          onUndo,
          onCount,
        ),
      { initialProps: { on: enabled } },
    );
    return { ...hook, onCount };
  };

  it("is reported with review mode ON, and equals the button count", () => {
    const { onCount } = renderWithCount(true);
    expect(onCount).toHaveBeenLastCalledWith(3);
    expect(takeButtons()).toHaveLength(3);
  });

  it("is reported with review mode OFF, when no button renders", () => {
    // The whole point. The count is a fact about the document; the button is a
    // fact about the mode.
    const { onCount } = renderWithCount(false);
    expect(onCount).toHaveBeenLastCalledWith(3);
    expect(takeButtons()).toHaveLength(0);
  });

  it("is reported in a static export too", () => {
    // Static mode can never enter review mode, so the button can never appear
    // — but the questions are still in the document, and saying so costs
    // nothing and lies about nothing.
    window.__VANTAGE_STATIC__ = true;
    const { onCount } = renderWithCount(true);
    expect(onCount).toHaveBeenLastCalledWith(3);
    expect(takeButtons()).toHaveLength(0);
  });

  it("counts zero for a document with no directives", () => {
    container.innerHTML = `<p data-source-line="1">Just prose.</p>`;
    const { onCount } = renderWithCount(false);
    expect(onCount).toHaveBeenLastCalledWith(0);
  });

  it("excludes the hosts that cannot carry a button", () => {
    // The fixture stamps a `pre` and a `table` as well, and neither can host
    // the affordance. A count of 5 against 3 buttons would send the reader
    // looking for controls that were never there — which is why the walk is
    // shared rather than reimplemented.
    const { onCount } = renderWithCount(true);
    expect(container.querySelectorAll("[data-vantage-oq]")).toHaveLength(5);
    expect(onCount).toHaveBeenLastCalledWith(3);
  });

  it("agrees with the shared walk the buttons are built from", () => {
    // Belt and braces on the same invariant, stated against the exported
    // helper so a future second caller inherits it.
    renderWithCount(true);
    expect(documentQuestions(container)).toHaveLength(takeButtons().length);
  });
});

describe("documentQuestions — an inline SVG inside the question", () => {
  /**
   * The HTML inside an SVG `desc`, `title` or `foreignObject` used to survive
   * as a descendant of the `svg`, still carrying `data-source-line`. React
   * creates every element under an `svg` in the SVG namespace (only a
   * `foreignObject`'s children leave it), so the inner `p` came out as an SVG
   * element with a lowercase `tagName`. `anchorBlockWithin` picked it — same
   * line as the question, and last in document order — and `OQ_HOST_TAGS` did
   * not recognize it, so the question had no button. The checker, which reads
   * the Markdown, still called the directive fine.
   *
   * It has to go through React to show: parsing the same string with
   * `innerHTML` puts the inner `p` in the HTML namespace and hides the bug.
   */
  it.each([
    ["desc", `<desc><p>Start</p></desc>`],
    ["title", `<title><p>Start</p></title>`],
    [
      "foreignObject",
      `<foreignObject width="9" height="9"><div><span><p>Start</p></span></div></foreignObject>`,
    ],
  ])("still counts a question whose drawing has HTML in a %s", (_, inner) => {
    const content = [
      "<!-- vantage: oq -->",
      "",
      `Where does the flow start? <svg viewBox="0 0 9 9" role="img" aria-label="Flow">${inner}<rect width="9" height="9"/></svg>`,
      "",
    ].join("\n");
    const { container } = render(createElement(MarkdownViewer, { content }));
    try {
      const questions = documentQuestions(container);
      expect(questions).toHaveLength(1);
      expect(questions[0].block.tagName).toBe("P");
      expect(questions[0].block).toBe(questions[0].stamped);
    } finally {
      cleanup();
    }
  });
});

/**
 * Plan Q5 (`docs/reference/planning-index.md` §6.6): review mode offers **Take
 * this leaning** on open questions only. A 🔒 question cannot be answered yet
 * and a ✅ one has been ruled, so neither gets a row — no button, no taken
 * chip, no Undo — and the Review toggle's count follows the buttons. The
 * contents column is not filtered: it still lists every question, in every
 * state, which `TableOfContents.test.tsx` holds it to.
 *
 * Over the gallery's own status page, rendered through the real chain, so the
 * state is read from the markers a document actually writes.
 */
describe("useOpenQuestionButtons — only open questions offer a take (Q5)", () => {
  const renderStatusPage = async () => {
    const source = readRepoFile("docs/gallery/status.md");
    container.innerHTML = (await renderMarkdown(source)).html;
  };

  /** The row of the question whose directive carries `id`, if any. */
  const rowFor = (id: string): HTMLElement | null => {
    const stamped = container.querySelector<HTMLElement>(`#${id}`)!;
    const block = anchorBlockWithin(stamped)!;
    const unit = questionUnit(stamped, container);
    const last =
      unit !== block ? unit.lastElementChild : block.nextElementSibling;
    return last instanceof HTMLElement &&
      last.classList.contains("review-oq-row")
      ? last
      : null;
  };

  it("renders a row for the 💬 question and none for the ✅ or 🔒 one", async () => {
    await renderStatusPage();
    const onCount = vi.fn();
    const ref = { current: container };
    renderHook(() =>
      useOpenQuestionButtons(
        ref,
        [],
        true,
        "doc content",
        onTake,
        onUndo,
        onCount,
      ),
    );

    expect(rowFor("OQ-1")?.querySelector(".review-oq-take")).toHaveTextContent(
      OQ_LABEL,
    );
    expect(rowFor("OQ-2")).toBeNull();
    expect(rowFor("OQ-3")).toBeNull();
    expect(takeButtons()).toHaveLength(1);
    // The Review toggle's count is the buttons', not the column's.
    expect(onCount).toHaveBeenLastCalledWith(1);
    // And the column still lists all three, each in its own state.
    expect(
      collectOutline(container)
        .filter((entry) => entry.kind === "question")
        .map((entry) => [entry.id, entry.status]),
    ).toEqual([
      ["OQ-1", "open"],
      ["OQ-2", "settled"],
      ["OQ-3", "blocked"],
    ]);
  });

  it("counts the same with review mode off", async () => {
    await renderStatusPage();
    const onCount = vi.fn();
    const ref = { current: container };
    renderHook(() =>
      useOpenQuestionButtons(
        ref,
        [],
        false,
        "doc content",
        onTake,
        onUndo,
        onCount,
      ),
    );
    expect(onCount).toHaveBeenLastCalledWith(1);
  });

  it("shows no taken chip and no Undo on an answered question with a take on it", async () => {
    await renderStatusPage();
    const stamped = container.querySelector<HTMLElement>("#OQ-2")!;
    const built = buildWholeBlockAnchor(anchorBlockWithin(stamped)!)!;
    const taken: ReviewComment = {
      id: "t2",
      anchor: built.anchor,
      comment: leaningComment(stamped),
      fallback_text: built.fallbackText,
      created_at: 0,
      reactions: [],
    };
    renderOq([taken]);
    expect(rowFor("OQ-2")).toBeNull();
    expect(container.querySelector(".review-oq-taken")).toBeNull();
    expect(container.querySelector(".review-oq-undo")).toBeNull();
  });

  it("still renders a row for a question with no marker at all", () => {
    // The fixture's questions carry none, and a question with no marker is
    // open (§3.3).
    renderOq();
    expect(takeAt(7)).not.toBeNull();
    expect(takeAt(11)).not.toBeNull();
  });

  it("files the leaning a take would file, or the default without one", () => {
    expect(leaningComment(blockAt(7))).toBe(LEANING);
    expect(leaningComment(blockAt(11))).toBe(OQ_DEFAULT_LEANING);
  });
});

/**
 * `question` declares a question in any state, and its marker alone is the
 * state (`docs/reference/inline-markup.md`): an open one offers the take
 * exactly as an `oq` does, and a 🔒 or ✅ one offers nothing, whichever name
 * declared it. The marker wins over an `oq` too, which `vantage/question-name`
 * reports but a document can carry.
 */
describe("useOpenQuestionButtons — the state decides, never the name", () => {
  const QUESTIONS_HTML = `
<p data-source-line="3" data-vantage-question="true" id="OQ-1">🔒 Blocked, as written.</p>
<p data-source-line="5" data-vantage-question="true" id="OQ-2">💬 Open, under the closed name.</p>
<p data-source-line="7" data-vantage-oq="true" id="OQ-3">🔒 Blocked, under the old name.</p>
<p data-source-line="9" data-vantage-oq="true" id="OQ-4">💬 Open, as written.</p>
`;

  beforeEach(() => {
    container.innerHTML = QUESTIONS_HTML;
  });

  it("renders a row for each open question, under either name, and counts those", () => {
    const onCount = vi.fn();
    const ref = { current: container };
    renderHook(() =>
      useOpenQuestionButtons(
        ref,
        [],
        true,
        "doc content",
        onTake,
        onUndo,
        onCount,
      ),
    );

    expect([3, 5, 7, 9].map((line) => takeAt(line) !== null)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it("is still a question to the shared walk and to the column", () => {
    expect(
      documentQuestions(container).map(({ stamped }) => stamped.id),
    ).toEqual(["OQ-1", "OQ-2", "OQ-3", "OQ-4"]);
    expect(
      collectOutline(container)
        .filter((entry) => entry.kind === "question")
        .map((entry) => [entry.id, entry.status, entry.oneClick]),
    ).toEqual([
      ["OQ-1", "blocked", false],
      ["OQ-2", "open", true],
      ["OQ-3", "blocked", false],
      ["OQ-4", "open", true],
    ]);
  });

  it("is stamped by the real chain where an `oq` would be", async () => {
    const { html } = await renderMarkdown(
      [
        "1. 🔒 **OQ-7: The retry budget.**",
        "",
        "   <!-- vantage: question id=OQ-7 -->",
        "",
        "   Waits on the load test.",
        "",
      ].join("\n"),
    );
    container.innerHTML = html;
    renderOq();

    const [question] = documentQuestions(container);
    expect(question?.stamped.id).toBe("OQ-7");
    expect(question?.block.tagName).toBe("P");
    expect(takeButtons()).toHaveLength(0);
  });
});

/**
 * A comment on a question is its answer (the user's ruling of 2026-10-01): a
 * comment still pending for the agent anywhere in the question's unit — a
 * take, an Answer…, or any comment typed on one of its blocks — and the row
 * says the question is answered instead of offering the take.
 */
describe("useOpenQuestionButtons — a comment on a question is its answer", () => {
  /** An open question as the style guide writes it, nested one inside another. */
  const NESTED_HTML = `
<ol data-source-line="3">
<li data-source-line="3">
<p data-source-line="3">💬 <strong>OQ-1: The outer question.</strong> Context.</p>
<p data-source-line="5" data-vantage-question="true" id="OQ-1" data-vantage-leaning="Outer."><em>Leaning:</em> outer.</p>
<p data-source-line="7"><strong>Answer:</strong></p>
<blockquote data-source-line="9"><p data-source-line="9">(empty)</p></blockquote>
<ol data-source-line="11">
<li data-source-line="11">
<p data-source-line="11">💬 <strong>OQ-2: The nested question.</strong></p>
<p data-source-line="13" data-vantage-question="true" id="OQ-2" data-vantage-leaning="Inner."><em>Leaning:</em> inner.</p>
</li>
</ol>
</li>
</ol>
<p data-source-line="17">A paragraph after both.</p>
`;

  const renderWith = (comments: ReviewComment[], onCount = vi.fn()) => {
    const ref = { current: container };
    renderHook(() =>
      useOpenQuestionButtons(
        ref,
        comments,
        true,
        "doc content",
        onTake,
        onUndo,
        onCount,
      ),
    );
    return onCount;
  };

  beforeEach(() => {
    container.innerHTML = NESTED_HTML;
  });

  it("answers the question a comment on its title is on", () => {
    const onCount = renderWith([commentAt(3)]);

    expect(answeredAt(5)).toHaveTextContent(OQ_ANSWERED_LABEL);
    expect(answeredAt(5)).toHaveAttribute("title", OQ_ANSWERED_HINT);
    expect(takeAt(5)).toBeNull();
    // No Undo: a comment the reviewer typed is not the row's to delete.
    expect(undoAt(5)).toBeNull();
    // The nested question is a question of its own, and still open.
    expect(takeAt(13)).not.toBeNull();
    // The Review toggle counts the takes still on offer.
    expect(onCount).toHaveBeenLastCalledWith(1);
  });

  it("answers it from any block of its unit, the Answer's quote included", () => {
    renderWith([commentAt(9)]);
    expect(answeredAt(5)).not.toBeNull();
    expect(takeAt(13)).not.toBeNull();
  });

  it("gives a comment in a nested question to the nested one, the innermost unit", () => {
    const onCount = renderWith([commentAt(11)]);

    expect(answeredAt(13)).not.toBeNull();
    expect(takeAt(13)).toBeNull();
    // The outer item holds the nested one, and is not answered by it.
    expect(takeAt(5)).not.toBeNull();
    expect(answeredAt(5)).toBeNull();
    expect(onCount).toHaveBeenLastCalledWith(1);
  });

  it("answers nothing with a comment outside every question", () => {
    const onCount = renderWith([commentAt(17)]);
    expect(container.querySelector(".review-oq-answered")).toBeNull();
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it.each([
    ["dismissed", { resolved: true }],
    ["answered by the agent", { reactions: [agentAddressed()] }],
  ])("offers the take again once the comment is %s", (_, patch) => {
    const onCount = renderWith([{ ...commentAt(3), ...patch }]);
    expect(answeredAt(5)).toBeNull();
    expect(takeAt(5)).not.toBeNull();
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it("keeps a take's own chip and Undo when another comment answers it too", () => {
    container.innerHTML = DOC_HTML;
    const h = renderOq();
    fireEvent.click(takeAt(7)!);
    h.rerender({ cs: [commentFromClick(), commentAt(3)], on: true });

    expect(chipAt(7)).toHaveTextContent(OQ_TAKEN_LABEL);
    expect(undoAt(7)).not.toBeNull();
    expect(answeredAt(7)).toBeNull();
  });

  it("is read the same with review mode off, for the count", () => {
    const onCount = vi.fn();
    const ref = { current: container };
    renderHook(() =>
      useOpenQuestionButtons(
        ref,
        [commentAt(3)],
        false,
        "doc content",
        onTake,
        onUndo,
        onCount,
      ),
    );
    expect(onCount).toHaveBeenLastCalledWith(1);
    expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
  });

  it("is the planning card's reading too: one owner per comment", () => {
    const questions = documentQuestions(container);
    const on = commentsOnQuestions(container, questions, [
      commentAt(3),
      commentAt(11),
      commentAt(17),
    ]);
    expect(questions.map((q) => (on.get(q) ?? []).map((c) => c.id))).toEqual([
      ["c3"],
      ["c11"],
    ]);
  });
});

describe("useOpenQuestionButtons — Answer…", () => {
  let onAnswer: ReturnType<typeof vi.fn> & AnswerQuestion;

  const renderAnswer = (comments: ReviewComment[] = []) => {
    const ref = { current: container };
    return renderHook(
      ({ cs }: { cs: ReviewComment[] }) =>
        useOpenQuestionButtons(
          ref,
          cs,
          true,
          "doc content",
          onTake,
          onUndo,
          undefined,
          onAnswer,
        ),
      { initialProps: { cs: comments } },
    );
  };

  beforeEach(() => {
    onAnswer = vi.fn() as ReturnType<typeof vi.fn> & AnswerQuestion;
  });

  it("stands after the take, in the same row, as on the planning card", () => {
    renderAnswer();
    const row = rowAt(7)!;
    const [take, answer] = Array.from(row.children);
    expect(take).toHaveClass("review-oq-take");
    expect(answer).toHaveClass("review-oq-answer");
    expect(answer.tagName).toBe("BUTTON");
    expect(answer).toHaveTextContent(OQ_ANSWER_LABEL);
    expect(answer.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("opens the popover on the take's own anchor and fallback text", () => {
    renderAnswer();
    fireEvent.click(answerAt(7)!);
    fireEvent.click(takeAt(7)!);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    const [anchor, fallback, rect] = onAnswer.mock.calls[0];
    const [takeAnchor, , takeFallback] = onTake.mock.calls[0];
    expect(anchor).toEqual(takeAnchor);
    expect(fallback).toBe(takeFallback);
    expect(typeof rect.top).toBe("number");
  });

  it("does not let the click reach the comment popover", () => {
    renderAnswer();
    const outer = vi.fn();
    container.addEventListener("click", outer);
    fireEvent.click(answerAt(7)!);
    expect(outer).not.toHaveBeenCalled();
  });

  it("goes once the question is answered, or its leaning taken", () => {
    const { rerender } = renderAnswer();
    fireEvent.click(takeAt(7)!);
    rerender({ cs: [commentFromClick()] });
    expect(answerAt(7)).toBeNull();
    rerender({ cs: [commentAt(3)] });
    expect(answerAt(7)).toBeNull();
    expect(answeredAt(7)).not.toBeNull();
  });

  it("is not offered without a way to open the popover", () => {
    renderOq();
    expect(container.querySelector(".review-oq-answer")).toBeNull();
  });
});

describe("useOpenQuestionButtons — the row paints with the document", () => {
  it("is in the DOM before any passive effect, so it is in the first paint", () => {
    // A layout effect runs before the browser paints; a passive one, after. A
    // row added by a passive effect pushed the question's next block down a
    // frame after the document painted: a layout shift on every load in
    // review mode.
    const seen: (Element | null)[] = [];
    const ref = { current: container };
    renderHook(() => {
      useOpenQuestionButtons(ref, [], true, "doc content", onTake, onUndo);
      useLayoutEffect(() => {
        seen.push(container.querySelector(".review-oq-row"));
      });
    });
    expect(seen[0]).not.toBeNull();
  });
});
