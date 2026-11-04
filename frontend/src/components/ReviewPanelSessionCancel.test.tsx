/**
 * The review panel's edit box holds the same editing session as the popover
 * (`lib/commentSession.ts`), so Escape asks Restore / Keep editing there too
 * instead of keeping the typed text.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewPanel } from "./ReviewPanel";
import { useReviewStore } from "../stores/useReviewStore";
import { useRepoStore } from "../stores/useRepoStore";
import { installReviewServer } from "../test/reviewServer";
import { resetBoxesForTest } from "../lib/commentAutosave";
import { resetSessionsForTest } from "../lib/commentSession";
import type { ReviewComment } from "../types";

vi.mock("axios");

const existing: ReviewComment = {
  id: "c1",
  selected_text: "the text",
  fallback_text: "the text",
  comment: "opened text",
  created_at: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetBoxesForTest();
  resetSessionsForTest();
  useReviewStore.setState({
    filePath: "doc.md",
    lastContent: "x",
    comments: [existing],
  });
  useRepoStore.setState({ currentRepo: null, isMultiRepo: false });
});
afterEach(() => {
  vi.useRealTimers();
  resetBoxesForTest();
  resetSessionsForTest();
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

describe("ReviewPanel edit box: Escape undoes the session", () => {
  it("asks, then restores the opened text without deleting", async () => {
    const server = installReviewServer([existing]);
    render(<ReviewPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Edit comment"));
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "typed over it" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(server.comments[0].comment).toBe("typed over it");

    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByText("Restore what you opened?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await flush();
    expect(server.comments[0].comment).toBe("opened text");
    expect(vi.mocked(axios.delete)).not.toHaveBeenCalled();
  });

  it("Keep editing leaves the box open with its text", async () => {
    const server = installReviewServer([existing]);
    render(<ReviewPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Edit comment"));
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "changed" } });
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByDisplayValue("changed")).toBeTruthy();
    expect(server.sessionCalls.map((c) => c.split(" ")[0])).toEqual([
      "begin-comment-session",
    ]);
  });

  it("an unchanged box closes and finishes without asking", async () => {
    const server = installReviewServer([existing]);
    render(<ReviewPanel isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Edit comment"));
    await flush();
    fireEvent.keyDown(screen.getByDisplayValue("opened text"), {
      key: "Escape",
    });
    await flush();
    expect(screen.queryByText("Restore what you opened?")).toBeNull();
    expect(screen.queryByDisplayValue("opened text")).toBeNull();
    expect(server.sessionCalls.map((c) => c.split(" ")[0])).toEqual([
      "begin-comment-session",
      "finish-comment-session",
    ]);
  });
});
