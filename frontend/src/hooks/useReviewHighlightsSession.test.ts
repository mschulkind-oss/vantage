/**
 * Inline document boxes hold the same editing session as the popover: Escape
 * asks Restore / Keep editing (and Discard, naming replies, on a new root)
 * instead of keeping the typed text; Ctrl+Enter and Close keep it.
 */
import { act, fireEvent, renderHook } from "@testing-library/react";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useReviewHighlights,
  type InlineReviewActions,
} from "./useReviewHighlights";
import { blockVisibleText, hashBlockText } from "../lib/reviewAnchor";
import { resetBoxesForTest } from "../lib/commentAutosave";
import { resetSessionsForTest } from "../lib/commentSession";
import { editCommentBox } from "../lib/reviewBoxes";
import { installReviewServer } from "../test/reviewServer";
import type { ReviewComment } from "../types";

vi.mock("axios");

const target = { base: "/api", path: "doc.md" };
let container: HTMLDivElement;

const comment = (): ReviewComment => {
  const p = container.querySelector<HTMLElement>('[data-source-line="1"]')!;
  const text = blockVisibleText(p);
  return {
    id: "c1",
    comment: "opened text",
    fallback_text: "First paragraph",
    created_at: 1,
    anchor: {
      source_line: 1,
      block_hash: hashBlockText(text),
      block_text: text,
    } as ReviewComment["anchor"],
  };
};

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

function open(server: ReturnType<typeof installReviewServer>) {
  const actions: InlineReviewActions = {
    onDelete: vi.fn(),
    onDismiss: vi.fn(),
    onReopen: vi.fn(),
    editBox: (c) => editCommentBox(target, c),
    replyBox: () => null,
    onCopy: vi.fn().mockResolvedValue(true),
  };
  renderHook(() =>
    useReviewHighlights(
      { current: container },
      server.comments,
      "doc content",
      actions,
    ),
  );
  const block = container.querySelector<HTMLElement>(
    '[data-review-inline-comment="c1"]',
  )!;
  fireEvent.click(
    block.querySelector<HTMLElement>(".review-inline-comment-edit")!,
  );
  return block.querySelector<HTMLTextAreaElement>(".review-inline-edit-area")!;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetBoxesForTest();
  resetSessionsForTest();
  container = document.createElement("div");
  container.innerHTML =
    '<p data-source-line="1">First paragraph about anchors.</p>';
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  resetBoxesForTest();
  resetSessionsForTest();
  vi.useRealTimers();
});

const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === name,
  )!;

describe("inline edit box: Escape undoes the session", () => {
  it("asks, then restores the opened text without deleting", async () => {
    const server = installReviewServer([comment()]);
    server.comments = [comment()];
    const area = open(server);
    await flush();
    fireEvent.input(area, { target: { value: "typed over it" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(server.comments[0].comment).toBe("typed over it");

    fireEvent.keyDown(area, { key: "Escape" });
    expect(container.textContent).toContain("Restore what you opened?");
    expect(document.activeElement).toBe(button("Keep editing"));
    button("Restore").click();
    await flush();
    expect(server.comments[0].comment).toBe("opened text");
    expect(vi.mocked(axios.delete)).not.toHaveBeenCalled();
    expect(container.querySelector(".review-inline-edit-area")).toBeNull();
  });

  it("Keep editing leaves the box open", async () => {
    const server = installReviewServer([comment()]);
    const area = open(server);
    await flush();
    fireEvent.input(area, { target: { value: "changed" } });
    fireEvent.keyDown(area, { key: "Escape" });
    button("Keep editing").click();
    expect(container.textContent).not.toContain("Restore what you opened?");
    expect(container.querySelector(".review-inline-edit-area")).toBe(area);
    expect(server.sessionCalls.map((c) => c.split(" ")[0])).toEqual([
      "begin-comment-session",
    ]);
  });

  it("Ctrl+Enter still keeps the text", async () => {
    const server = installReviewServer([comment()]);
    const area = open(server);
    await flush();
    fireEvent.input(area, { target: { value: "kept" } });
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(container.textContent).not.toContain("Restore what you opened?");
    expect(server.comments[0].comment).toBe("kept");
    expect(server.sessionCalls.map((c) => c.split(" ")[0])).toContain(
      "finish-comment-session",
    );
  });
});
