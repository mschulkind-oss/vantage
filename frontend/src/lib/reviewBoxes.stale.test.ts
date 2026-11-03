import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saves: { resolve: (d: unknown) => void }[] = [];
vi.mock("../stores/useReviewStore", () => ({
  newReviewId: () => "new-id",
  saveNewComment: () => new Promise((resolve) => saves.push({ resolve })),
  saveCommentText: () => new Promise((resolve) => saves.push({ resolve })),
  removeComment: () => Promise.resolve(null),
  saveNewReply: () => Promise.resolve(null),
  saveReplyText: () => Promise.resolve(null),
}));

import { resetBoxesForTest } from "./commentAutosave";
import { deleteAnswer } from "./answerDelete";
import { editCommentBox, newCommentBox } from "./reviewBoxes";
import type { ReviewComment } from "../types";

const target = { base: "/api", path: "a.md" };
const comment: ReviewComment = {
  id: "c1",
  reactions: [],
  comment: "old",
  created_at: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  saves.length = 0;
  resetBoxesForTest();
});
afterEach(() => {
  vi.useRealTimers();
  resetBoxesForTest();
});

describe("a box retired by deleteAnswer", () => {
  it("does not report a late create to onSaved", async () => {
    const onSaved = vi.fn();
    const box = newCommentBox(target, { ...comment, comment: "" }, { onSaved });
    box.open();
    box.input("typed");
    box.flush();
    expect(saves).toHaveLength(1);
    deleteAnswer(target, "c1", {
      remove: () => Promise.resolve(null),
      onDone: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    saves[0]!.resolve({ comments: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not report a late edit to onSaved", async () => {
    const onSaved = vi.fn();
    const box = editCommentBox(target, comment, { onSaved });
    box.open();
    box.input("new");
    box.flush();
    expect(saves).toHaveLength(1);
    deleteAnswer(target, "c1", {
      remove: () => Promise.resolve(null),
      onDone: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    saves[0]!.resolve({ comments: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("still reports a save of a live box", async () => {
    const onSaved = vi.fn();
    const box = editCommentBox(target, comment, { onSaved });
    box.open();
    box.input("new");
    box.flush();
    saves[0]!.resolve({ comments: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
