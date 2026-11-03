import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommentBox,
  hasUnsavedText,
  resetBoxesForTest,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  type BoxOps,
} from "./commentAutosave";
import { deleteAnswer, type DeletionState } from "./answerDelete";

const target = { base: "/api", path: "a.md" };

let log: string[];
let removes: { resolve: () => void; reject: (e: unknown) => void }[];
const remove = () => {
  log.push("delete");
  return new Promise<null>((resolve, reject) => {
    removes.push({ resolve: () => resolve(null), reject });
  });
};
const httpError = (status: number) => ({ response: { status } });

beforeEach(() => {
  vi.useFakeTimers();
  log = [];
  removes = [];
  resetBoxesForTest();
});
afterEach(() => {
  vi.useRealTimers();
  resetBoxesForTest();
});

describe("deleteAnswer", () => {
  it("retires the comment's box and waits for its in-flight save before deleting", async () => {
    let finishSave!: () => void;
    const ops: BoxOps = {
      update: () => {
        log.push("update");
        return new Promise<void>((r) => (finishSave = r));
      },
    };
    const box = new CommentBox(
      { kind: "edit", target, commentId: "c1", label: "x" },
      ops,
      { text: "old", created: true, saved: "old" },
    );
    box.open();
    box.input("new");
    box.flush();
    expect(log).toEqual(["update"]);

    const done = vi.fn();
    const deletion = deleteAnswer(target, "c1", { remove, onDone: done });
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["update"]); // delete waits for the save
    expect(deletion.getState().phase).toBe("deleting");

    finishSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["update", "delete"]);
    // The retired box ignores its late success.
    expect(box.getState().saves).toBe(0);

    removes[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(deletion.getState().phase).toBe("done");
  });

  it("counts a 404 as done", async () => {
    const done = vi.fn();
    const d = deleteAnswer(target, "c1", { remove, onDone: done });
    await vi.advanceTimersByTimeAsync(0);
    removes[0]!.reject(httpError(404));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(d.getState().phase).toBe("done");
  });

  it("retries a transient failure on a doubling delay up to the cap", async () => {
    const d = deleteAnswer(target, "c1", { remove, onDone: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    removes[0]!.reject(httpError(503));
    await vi.advanceTimersByTimeAsync(0);
    const s = d.getState() as Extract<DeletionState, { phase: "retrying" }>;
    expect(s.phase).toBe("retrying");
    expect(s.nextAt).toBe(Date.now() + RETRY_FIRST_MS);

    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(removes).toHaveLength(2);
    removes[1]!.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS * 2);
    expect(removes).toHaveLength(3);
    for (let i = 3; i < 12; i++) {
      removes[i - 1]!.reject(new Error("offline"));
      await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    }
    const before = removes.length;
    removes[before - 1]!.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(removes).toHaveLength(before + 1);
  });

  it("stops on a permanent failure and Retry now resumes", async () => {
    const done = vi.fn();
    const d = deleteAnswer(target, "c1", { remove, onDone: done });
    await vi.advanceTimersByTimeAsync(0);
    removes[0]!.reject(httpError(403));
    await vi.advanceTimersByTimeAsync(0);
    expect(d.getState().phase).toBe("failed");
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS * 2);
    expect(removes).toHaveLength(1);

    expect(hasUnsavedText()).toBe(false);
    d.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(removes).toHaveLength(2);
    expect(hasUnsavedText()).toBe(true);
    removes[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("holds the leave guard until it finishes", async () => {
    const d = deleteAnswer(target, "c1", { remove, onDone: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(hasUnsavedText()).toBe(true);
    removes[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.getState().phase).toBe("done");
    expect(hasUnsavedText()).toBe(false);
  });
});
