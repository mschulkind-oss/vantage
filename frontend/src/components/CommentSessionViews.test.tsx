/**
 * The real answer/comment popover with its editing session
 * (`lib/commentSession.ts`) against the in-memory review server
 * (`test/reviewServer.ts`): what Escape and × ask, what they send, and what a
 * restore leaves behind.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewCommentPopover } from "./ReviewCommentPopover";
import { SessionReports } from "./CommentSessionViews";
import { resetBoxesForTest, hasUnsavedText } from "../lib/commentAutosave";
import { resetSessionsForTest } from "../lib/commentSession";
import { editCommentBox, newCommentBox } from "../lib/reviewBoxes";
import { installReviewServer } from "../test/reviewServer";
import { useReviewStore } from "../stores/useReviewStore";
import { replyCoverageLabel } from "../lib/replyCoverage";
import type { ReviewComment } from "../types";

vi.mock("axios");

const target = { base: "/api", path: "doc.md" };
const rect = new DOMRect(0, 0, 10, 10);
const existing: ReviewComment = {
  id: "c1",
  comment: "opened text",
  created_at: 1,
  reactions: [
    {
      id: "r1",
      actor: "agent",
      kind: "addressed",
      summary: "done",
      before_text: "",
      after_text: "",
      timestamp: 2,
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  resetBoxesForTest();
  resetSessionsForTest();
});
afterEach(() => {
  vi.useRealTimers();
  resetBoxesForTest();
  resetSessionsForTest();
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

function openEdit(server: ReturnType<typeof installReviewServer>) {
  const onClose = vi.fn();
  render(
    <>
      <ReviewCommentPopover
        selectedText="quote"
        rect={rect}
        makeBox={() => editCommentBox(target, server.comments[0])}
        onClose={onClose}
      />
      <SessionReports />
    </>,
  );
  return { onClose };
}

describe("Escape on an answer being edited", () => {
  it("asks before restoring a changed answer, restores it, keeps the reply, never deletes", async () => {
    const server = installReviewServer([existing]);
    openEdit(server);
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "typed over it" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(server.comments[0].comment).toBe("typed over it");

    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByText("Restore what you opened?")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Keep editing" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await flush();

    expect(server.comments[0].comment).toBe("opened text");
    expect(server.comments[0].reactions).toHaveLength(1);
    expect(vi.mocked(axios.delete)).not.toHaveBeenCalled();
    expect(server.sessionCalls.map((c) => c.split(" ")[0])).toEqual([
      "begin-comment-session",
      "restore-comment-session",
    ]);
  });

  it("an unchanged answer finishes without a rollback", async () => {
    const server = installReviewServer([existing]);
    const { onClose } = openEdit(server);
    await flush();
    fireEvent.keyDown(screen.getByDisplayValue("opened text"), {
      key: "Escape",
    });
    await flush();
    expect(screen.queryByText("Restore what you opened?")).toBeNull();
    expect(onClose).toHaveBeenCalled();
    expect(server.sessionCalls.map((c) => c.split(" ")[0])).toEqual([
      "begin-comment-session",
      "finish-comment-session",
    ]);
  });

  it("types back to the original spelling after an autosave: still asks", async () => {
    const server = installReviewServer([existing]);
    openEdit(server);
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "changed" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    fireEvent.change(box, { target: { value: "opened text" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByText("Restore what you opened?")).toBeTruthy();
  });

  it("Keep editing leaves the session open and sends nothing more", async () => {
    const server = installReviewServer([existing]);
    openEdit(server);
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "changed" } });
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Restore what you opened?")).toBeNull();
    expect(server.sessionCalls.map((c) => c.split(" ")[0])).toEqual([
      "begin-comment-session",
    ]);
  });
});

describe("Escape on a new answer", () => {
  it("names the replies it will discard, and the server drops the root", async () => {
    const server = installReviewServer([]);
    const draft: ReviewComment = {
      id: "n1",
      comment: "",
      created_at: 1,
      reactions: [],
    };
    render(
      <>
        <ReviewCommentPopover
          selectedText="quote"
          rect={rect}
          makeBox={() => newCommentBox(target, draft)}
          onClose={() => {}}
        />
        <SessionReports />
      </>,
    );
    await flush();
    const box = screen.getByPlaceholderText("Your comment...");
    fireEvent.change(box, { target: { value: "brand new" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(server.comments).toHaveLength(1);
    // The agent replies while the box is still open.
    server.comments[0].reactions = [{ ...existing.reactions![0], id: "r9" }];
    fireEvent.change(box, { target: { value: "brand new!" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));

    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.getByText(/Discard this new answer\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await flush();
    expect(server.comments).toHaveLength(0);
    expect(vi.mocked(axios.delete)).not.toHaveBeenCalled();
  });
});

describe("a restore that cannot finish", () => {
  it("retries with Retry now and Copy, survives the popover going, and holds the page", async () => {
    const server = installReviewServer([existing]);
    openEdit(server);
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "typed" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    server.sessionsDown = true;
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await flush();

    expect(screen.getByText(/Restore failed — retrying in/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy text" })).toBeTruthy();
    expect(hasUnsavedText()).toBe(true);

    server.sessionsDown = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    await flush();
    expect(server.comments[0].comment).toBe("opened text");
    expect(hasUnsavedText()).toBe(false);
  });

  it("a 409 shows theirs, yours and opened, and replaces only through a new session", async () => {
    const server = installReviewServer([existing]);
    openEdit(server);
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "mine" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    // A legacy client writes without a session id.
    await act(async () => {
      await axios.patch(
        "/api/review/comments/c1",
        { comment: "theirs" },
        { params: { path: "doc.md" } },
      );
    });
    vi.mocked(axios.get).mockResolvedValue({
      data: { file_path: "doc.md", comments: structuredClone(server.comments) },
    });
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await flush();

    expect(screen.getByText("Changed outside this box")).toBeTruthy();
    expect(screen.getByText("theirs")).toBeTruthy();
    expect(screen.getByText("mine")).toBeTruthy();
    const replace = screen.getByRole("button", { name: "Replace with mine" });
    expect(replace).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText(/compared/));
    fireEvent.click(replace);
    await flush();
    expect(server.comments[0].comment).toBe("mine");
    const begins = server.sessionCalls.filter((c) =>
      c.startsWith("begin-comment-session"),
    );
    expect(begins).toHaveLength(2);
  });
});

describe("reply wording", () => {
  it("says current / earlier / unknown in plain words and never guesses", () => {
    const c: ReviewComment = {
      ...existing,
      reply_coverage: [
        { reaction_index: 0, covers: "current" },
        { reaction_index: 1, covers: "other" },
      ],
    };
    expect(replyCoverageLabel(c, 0)).toBe("reply to the current wording");
    expect(replyCoverageLabel(c, 1)).toBe("reply to earlier wording");
    expect(replyCoverageLabel(c, 2)).toBe("coverage unknown");
    expect(replyCoverageLabel(existing, 0)).toBe("coverage unknown");
  });
});

describe("the answer box's ownership cue", () => {
  it("says ownership is unknown for a held comment the server could not tie to its question", async () => {
    const unknown: ReviewComment = { ...existing, ownership: "unknown" };
    const server = installReviewServer([unknown]);
    useReviewStore.setState({ comments: [unknown] });
    openEdit(server);
    await flush();
    expect(screen.getByTestId("ownership-cue")).toHaveTextContent(
      "(ownership unknown)",
    );
  });

  it("says nothing for a comment whose ownership is proven", async () => {
    const proven: ReviewComment = { ...existing, ownership: "proven" };
    const server = installReviewServer([proven]);
    useReviewStore.setState({ comments: [proven] });
    openEdit(server);
    await flush();
    expect(screen.queryByTestId("ownership-cue")).toBeNull();
  });
});
