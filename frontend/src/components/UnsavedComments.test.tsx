import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsavedComments } from "./UnsavedComments";
import { CommentBox, resetBoxesForTest } from "../lib/commentAutosave";

afterEach(() => {
  resetBoxesForTest();
  vi.useRealTimers();
});

/** A closed box whose save fails until `up()` is called. */
function failingBox(text: string) {
  let down = true;
  const update = vi.fn(() =>
    down ? Promise.reject(new Error("down")) : Promise.resolve(),
  );
  const box = new CommentBox(
    {
      kind: "edit",
      target: { base: "/api", path: "docs/a.md" },
      commentId: "c1",
      label: "Edited comment",
    },
    { update },
    { text: "before", created: true },
  );
  box.open();
  box.input(text);
  box.close();
  return { box, update, up: () => (down = false) };
}

describe("the app shell's comments not saved", () => {
  it("is nothing while everything is saved", () => {
    const { container } = render(<UnsavedComments />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts a comment whose save failed, and reopens it holding its text", async () => {
    vi.useFakeTimers();
    render(<UnsavedComments />);
    const { box, up } = failingBox("after");
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("1 comment not saved, retrying")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("docs/a.md", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const area = screen.getByDisplayValue<HTMLTextAreaElement>("after");
    expect(box.isOpen).toBe(true);
    fireEvent.change(area, { target: { value: "after, reworded" } });

    up();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(box.getState().status).toBe("saved");
    // Still drawn, being typed in, though it no longer needs reporting.
    expect(screen.getByDisplayValue("after, reworded")).toBe(area);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("says a comment was deleted under its box, apart from retries, and offers its text", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<UnsavedComments />);
    const post = vi.fn(() => Promise.resolve());
    const box = new CommentBox(
      {
        kind: "edit",
        target: { base: "/api", path: "docs/a.md" },
        commentId: "c1",
        label: "Edited comment",
      },
      {
        update: () =>
          Promise.reject(
            Object.assign(new Error("HTTP 404"), { response: { status: 404 } }),
          ),
        asNew: () => ({
          draft: { id: "n1", comment: "", created_at: 1, reactions: [] },
          ops: { create: post, update: post },
        }),
      },
      { text: "before", created: true },
    );
    box.open();
    box.input("orphaned words");
    box.close();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("1 comment deleted, your text kept")).toBeTruthy();
    expect(screen.queryByText(/not saved, retrying/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("This comment was deleted")).toBeTruthy();
    // The tab still asks while the text is neither copied nor posted.
    const asked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asked);
    expect(asked.defaultPrevented).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Post as a new comment" }),
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(post).toHaveBeenCalledWith("orphaned words");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("lets the tab go once a deleted comment's text is copied", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<UnsavedComments />);
    const box = new CommentBox(
      {
        kind: "edit",
        target: { base: "/api", path: "docs/a.md" },
        commentId: "c1",
        label: "Edited comment",
      },
      {
        update: () =>
          Promise.reject(
            Object.assign(new Error("HTTP 404"), { response: { status: 404 } }),
          ),
      },
      { text: "before", created: true },
    );
    box.open();
    box.input("copy me");
    box.close();
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    // No anchor to post to, from this box: only Copy text.
    expect(
      screen.queryByRole("button", { name: "Post as a new comment" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(writeText).toHaveBeenCalledWith("copy me");
    const asked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asked);
    expect(asked.defaultPrevented).toBe(false);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("asks before the tab goes while any text is unsaved", () => {
    render(<UnsavedComments />);
    const box = new CommentBox(
      {
        kind: "comment",
        target: { base: "/api", path: "a.md" },
        commentId: "c9",
        label: "New comment",
      },
      { create: () => new Promise(() => {}), update: async () => {} },
    );
    box.open();
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    box.input("inside the pause");
    const asked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asked);
    expect(asked.defaultPrevented).toBe(true);
  });
});
