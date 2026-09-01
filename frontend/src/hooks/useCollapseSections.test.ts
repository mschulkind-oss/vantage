/**
 * The collapse toggle pass, and the reveal every navigation path depends on.
 *
 * jsdom cannot see whether anything is hidden — `@media` is never evaluated and
 * the stylesheet is not loaded — so what is asserted here is the *contract the
 * CSS reads*: the readiness marker, the collapsed attribute per group, and the
 * ARIA a `<summary>` would have given us for free. The geometry, the rotation
 * and the print reveal were measured in Chrome and are guarded as text in
 * `../lib/directiveTheme.test.ts`.
 */

import { renderHook, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { COLLAPSE_LABEL, useCollapseSections } from "./useCollapseSections";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "./useReviewHighlights";
import {
  isGroupExpanded,
  revealCollapsedBlock,
  setGroupCollapsed,
} from "../lib/collapseSections";
import { blockVisibleText, hashBlockText } from "../lib/reviewAnchor";
import type { ReviewComment } from "../types";

/**
 * Verbatim from the real chain — `renderMarkdown` over a document with a closed
 * `##`, a closed `###` inside it, and an untouched `##` after. The `<h3>` is the
 * case the design is shaped around: a hidden member of group 1 *and* the toggle
 * for group 2.
 */
const DOC_HTML = `
<h2 data-source-line="3" data-vantage-collapse-toggle="1" id="closed-section">Closed section</h2>
<p data-source-line="5" data-vantage-collapsed="true" data-vantage-collapse-group="1">First body paragraph.</p>
<ul data-source-line="7" data-vantage-collapsed="true" data-vantage-collapse-group="1">
<li data-source-line="7">a list item</li>
<li data-source-line="8">another</li>
</ul>
<h3 data-source-line="12" data-vantage-collapsed="true" data-vantage-collapse-group="1" data-vantage-collapse-toggle="2" id="nested-closed">Nested closed</h3>
<p data-source-line="14" data-vantage-collapsed="true" data-vantage-collapse-group="2">Nested body paragraph.</p>
<h2 data-source-line="16" id="open-section">Open section</h2>
<p data-source-line="18">Always visible.</p>
`;

let container: HTMLDivElement;

const caretFor = (group: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-vantage-collapse-caret="${group}"]`,
  );

const blockAt = (line: number) =>
  container.querySelector<HTMLElement>(`[data-source-line="${line}"]`)!;

const collapsedAt = (line: number) =>
  blockAt(line).getAttribute("data-vantage-collapsed");

/** The pass alone, as MarkdownViewer calls it. */
const renderPass = (content: string | null = "doc content") => {
  const ref = { current: container };
  return renderHook(
    ({ c }: { c: string | null }) => useCollapseSections(ref, c),
    {
      initialProps: { c: content },
    },
  );
};

beforeEach(() => {
  container = document.createElement("div");
  container.innerHTML = DOC_HTML;
  document.body.appendChild(container);
});

describe("useCollapseSections — the readiness gate (A3)", () => {
  it("marks the container only after the controls exist", () => {
    // Before the pass, nothing: this is the state every renderer without the JS
    // is permanently in, and in it the hiding CSS matches nothing at all.
    expect(container.hasAttribute("data-vantage-collapse-ready")).toBe(false);

    renderPass();

    expect(container.getAttribute("data-vantage-collapse-ready")).toBe("true");
    // The marker cannot precede the control: by the time it is readable, the
    // caret that reveals the group is already in the DOM.
    expect(caretFor("1")).not.toBeNull();
  });

  it("marks nothing for a document with no collapsed section", () => {
    container.innerHTML = `<p data-source-line="1">Plain.</p>`;
    renderPass();

    expect(container.hasAttribute("data-vantage-collapse-ready")).toBe(false);
  });

  it("withdraws the marker along with the controls on unmount", () => {
    const view = renderPass();
    view.unmount();

    expect(container.hasAttribute("data-vantage-collapse-ready")).toBe(false);
    expect(
      container.querySelectorAll("[data-vantage-collapse-caret]"),
    ).toHaveLength(0);
    // The plugin's own attributes are not ours to sweep: the document reads the
    // same with the JS gone as it did before the JS arrived.
    expect(collapsedAt(5)).toBe("true");
  });

  it("keeps the marker once every section has been opened", () => {
    // Keyed on having attached a control, not on finding a hidden block: with the
    // marker withdrawn, the next click would collapse a section that then refused
    // to hide.
    renderPass();
    fireEvent.click(caretFor("1")!);
    fireEvent.click(caretFor("2")!);

    expect(
      container.querySelector('[data-vantage-collapsed="true"]'),
    ).toBeNull();
    expect(container.getAttribute("data-vantage-collapse-ready")).toBe("true");
  });
});

describe("useCollapseSections — the control", () => {
  it("injects one caret per toggle, as a button with hand-written ARIA", () => {
    renderPass();

    const caret = caretFor("1")!;
    expect(caret.tagName).toBe("BUTTON");
    expect(caret.type).toBe("button");
    expect(caret.getAttribute("aria-expanded")).toBe("false");
    expect(caret.getAttribute("aria-label")).toBe(COLLAPSE_LABEL);
    // Every member, by id: a `<summary>` would have implied the relationship, a
    // flat run of siblings has to state it.
    expect(caret.getAttribute("aria-controls")?.split(" ")).toEqual([
      "vantage-collapse-1-0",
      "vantage-collapse-1-1",
      "nested-closed",
    ]);
    expect(caretFor("2")!.getAttribute("aria-controls")).toBe(
      "vantage-collapse-2-0",
    );
  });

  it("lives inside the heading, ahead of its `#` anchor", () => {
    renderPass();

    expect(caretFor("1")!.parentElement).toBe(blockAt(3));
    expect(blockAt(3).firstElementChild).toBe(caretFor("1"));
  });

  it("carries no text, so the heading's hash is the same with and without it", () => {
    // The glyph is CSS `content`. If it were the button's text, every review
    // anchor on a collapsible heading would drift the moment the JS ran — and
    // `REVIEW_UI_SELECTOR` lists the caret as a second defence.
    const before = hashBlockText(blockVisibleText(blockAt(3)));
    renderPass();

    expect(caretFor("1")!.textContent).toBe("");
    expect(hashBlockText(blockVisibleText(blockAt(3)))).toBe(before);
  });

  it("mints an id only where there is none, and takes it back on teardown", () => {
    const view = renderPass();

    expect(blockAt(5).id).toBe("vantage-collapse-1-0");
    // The heading keeps the slug in-document links point at.
    expect(blockAt(12).id).toBe("nested-closed");

    view.unmount();
    expect(blockAt(5).hasAttribute("id")).toBe(false);
    expect(blockAt(12).id).toBe("nested-closed");
  });

  it("does not duplicate its output across re-runs of the pass", () => {
    const view = renderPass();
    view.rerender({ c: "second render" });
    view.rerender({ c: "third render" });

    expect(
      container.querySelectorAll("[data-vantage-collapse-caret]"),
    ).toHaveLength(2);
  });

  it("skips a toggle whose group has no members", () => {
    container.innerHTML = `<h2 data-vantage-collapse-toggle="7">Lonely</h2>`;
    renderPass();

    expect(
      container.querySelectorAll("[data-vantage-collapse-caret]"),
    ).toHaveLength(0);
  });

  it("ignores a group id that is not a number", () => {
    // The sanitiser already refuses one; this is the second gate, because the
    // value is interpolated into a selector.
    container.innerHTML = `
      <h2 data-vantage-collapse-toggle='1"], p'>Forged</h2>
      <p data-vantage-collapsed="true" data-vantage-collapse-group="1">Body.</p>`;
    renderPass();

    expect(
      container.querySelectorAll("[data-vantage-collapse-caret]"),
    ).toHaveLength(0);
  });
});

describe("useCollapseSections — flipping a group", () => {
  it("opens and closes every member of its own group only", () => {
    renderPass();

    fireEvent.click(caretFor("1")!);
    expect(collapsedAt(5)).toBe("false");
    expect(collapsedAt(7)).toBe("false");
    expect(collapsedAt(12)).toBe("false");
    // The nested section stays as the reader left it: its heading is now visible
    // with its own caret still closed.
    expect(collapsedAt(14)).toBe("true");
    expect(caretFor("1")!.getAttribute("aria-expanded")).toBe("true");
    expect(caretFor("2")!.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(caretFor("1")!);
    expect(collapsedAt(5)).toBe("true");
    expect(caretFor("1")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes a nested group with the section that contains it", () => {
    // Otherwise the inner blocks stay on screen after the heading that explains
    // them is hidden — a nested `###` is a member of the outer group and the
    // toggle of its own, which is exactly why the two attributes differ.
    renderPass();
    fireEvent.click(caretFor("1")!);
    fireEvent.click(caretFor("2")!);
    expect(collapsedAt(14)).toBe("false");

    fireEvent.click(caretFor("1")!);

    expect(collapsedAt(14)).toBe("true");
    expect(caretFor("2")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves an untouched section alone whatever happens", () => {
    renderPass();
    fireEvent.click(caretFor("1")!);
    fireEvent.click(caretFor("1")!);

    for (const line of [16, 18]) {
      expect(blockAt(line).hasAttribute("data-vantage-collapsed")).toBe(false);
    }
  });

  it("keeps the group id so the same control can close what it opened", () => {
    renderPass();
    fireEvent.click(caretFor("1")!);

    expect(blockAt(5).getAttribute("data-vantage-collapse-group")).toBe("1");
    expect(isGroupExpanded(container, "1")).toBe(true);
  });

  it("re-reads the state rather than remembering it", () => {
    // Something other than the caret may have opened the section — a line anchor,
    // the review highlighter — so the click reads the DOM instead of toggling a
    // variable that would then be inverted.
    renderPass();
    setGroupCollapsed(container, "1", false);
    expect(caretFor("1")!.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(caretFor("1")!);

    expect(collapsedAt(5)).toBe("true");
  });
});

describe("revealCollapsedBlock — what keeps an anchor from landing on nothing", () => {
  it("opens the section around a block, and every section around that", () => {
    renderPass();

    // The deepest case: a block in group 2, whose toggle is itself a hidden
    // member of group 1. Opening only group 2 would leave the paragraph visible
    // under a heading that is not.
    expect(revealCollapsedBlock(blockAt(14))).toBe(true);

    expect(collapsedAt(14)).toBe("false");
    expect(collapsedAt(12)).toBe("false");
    expect(collapsedAt(5)).toBe("false");
    expect(caretFor("1")!.getAttribute("aria-expanded")).toBe("true");
    expect(caretFor("2")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("works from a descendant of a collapsed block, not just the block", () => {
    // A `#L8` anchor resolves the `<li>`; the collapsed element is the `<ul>`
    // around it.
    renderPass();

    expect(revealCollapsedBlock(blockAt(8))).toBe(true);
    expect(collapsedAt(7)).toBe("false");
  });

  it("reports nothing to do for a block that is already visible", () => {
    renderPass();

    expect(revealCollapsedBlock(blockAt(18))).toBe(false);
    expect(revealCollapsedBlock(null)).toBe(false);
  });

  it("does nothing without the readiness marker, because nothing is hidden", () => {
    // No pass, no marker, no hiding rule — so there is no section to open and
    // no container to resolve a group against.
    expect(revealCollapsedBlock(blockAt(14))).toBe(false);
    expect(collapsedAt(14)).toBe("true");
  });
});

describe("the review highlighter opens a section it has a comment in", () => {
  const anchoredComment = (line: number): ReviewComment => ({
    id: `comment-${line}`,
    comment: "Why is this here?",
    created_at: "2026-01-01T00:00:00Z",
    anchor: {
      source_line: line,
      block_text_hash: hashBlockText(blockVisibleText(blockAt(line))),
      selection_offset: 0,
      selection_length: 0,
    },
  });

  const actions: InlineReviewActions = {
    onDelete: () => {},
    onDismiss: () => {},
    onReopen: () => {},
    onEdit: () => {},
    onReply: () => {},
    onCopy: () => {},
  };

  /** Both passes over one container, in MarkdownViewer's call order. */
  const renderBoth = (comments: ReviewComment[]) => {
    const ref = { current: container };
    return renderHook(() => {
      useCollapseSections(ref, "doc content");
      useReviewHighlights(ref, comments, "doc content", actions);
    });
  };

  it("forces the section open so the card is not stranded", () => {
    // The comment card is inserted as a sibling of its block and carries no
    // collapsed attribute of its own, so a closed section would show a comment
    // about text that is not rendered — and every jump to it would land on a
    // zero-height box.
    const comment = anchoredComment(14);
    renderBoth([comment]);

    expect(collapsedAt(14)).toBe("false");
    expect(collapsedAt(12)).toBe("false");
    expect(
      container.querySelector(`[data-review-inline-comment="${comment.id}"]`),
    ).not.toBeNull();
  });

  it("reads the comment as anchored, not drifted", () => {
    // The hash is taken from a detached clone in both states, so whether the
    // block was hidden when the highlighter ran cannot change it.
    const comment = anchoredComment(5);
    renderBoth([comment]);

    expect(blockAt(5).classList.contains("review-highlight-block")).toBe(true);
    expect(
      blockAt(5).classList.contains("review-highlight-block-divergent"),
    ).toBe(false);
  });

  it("leaves a section with no comment in it closed", () => {
    renderBoth([anchoredComment(18)]);

    expect(collapsedAt(5)).toBe("true");
    expect(collapsedAt(14)).toBe("true");
  });
});
