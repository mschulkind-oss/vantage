import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editCommentBox, newCommentBox, replyBox } from "./reviewBoxes";
import { liveBoxes, resetBoxesForTest, SAVE_PAUSE_MS } from "./commentAutosave";
import { installReviewServer, type ReviewServer } from "../test/reviewServer";
import { newReviewComment, useReviewStore } from "../stores/useReviewStore";
import { useRepoStore } from "../stores/useRepoStore";
import type { ReviewComment } from "../types";

vi.mock("axios");

const target = { base: "/api", path: "doc.md" };
const anchor = {
  source_line: 1,
  block_text_hash: "abc",
  selection_offset: 0,
  selection_length: 0,
};

let server: ReviewServer;

beforeEach(() => {
  vi.useFakeTimers();
  useRepoStore.setState({ currentRepo: null, isMultiRepo: false });
  useReviewStore.setState({ filePath: "doc.md", comments: [] });
  server = installReviewServer([]);
});

afterEach(() => {
  resetBoxesForTest();
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);

/** A comment `v1` filed by a new-comment box, then `v2` typed and closed while the server is down. */
async function filedThenRetrying(): Promise<ReviewComment> {
  const box = newCommentBox(target, newReviewComment(anchor, "", "text"));
  box.open();
  box.input("v1");
  await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
  server.down = true;
  box.input("v2, newer");
  box.close();
  await settle();
  expect(box.getState().status).toBe("retrying");
  return structuredClone(server.comments[0]);
}

describe("a box whose comment was deleted", () => {
  /** An edit box on a comment deleted elsewhere, after its save said so. */
  async function goneEdit(): Promise<ReturnType<typeof editCommentBox>> {
    const comment: ReviewComment = {
      ...newReviewComment(anchor, "before", "the block"),
      id: "c1",
    };
    server.comments = [];
    const box = editCommentBox(target, comment);
    box.open();
    box.input("after it was deleted");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(box.getState().status).toBe("gone");
    return box;
  }

  it("posts its text as a new comment on the same anchor while that block is there", async () => {
    const block = document.createElement("p");
    block.setAttribute("data-block-hash", anchor.block_text_hash);
    document.body.appendChild(block);
    const box = await goneEdit();
    box.postAsNew();
    await settle();
    expect(server.comments).toHaveLength(1);
    expect(server.comments[0]).toMatchObject({
      comment: "after it was deleted",
      anchor,
      fallback_text: "the block",
    });
    block.remove();
  });

  it("posts it on the document as a whole once the block is gone", async () => {
    const box = await goneEdit();
    box.postAsNew();
    await settle();
    expect(server.comments).toHaveLength(1);
    expect(server.comments[0].comment).toBe("after it was deleted");
    expect(server.comments[0].anchor).toBeUndefined();
  });
});

describe("one box writes a comment at a time", () => {
  it("an edit box opened over a newer unsaved text starts from it, not the stale comment", async () => {
    const comment = await filedThenRetrying();
    expect(comment.comment).toBe("v1");

    const edit = editCommentBox(target, comment);
    expect(edit.getState().text).toBe("v2, newer");
    // The new-comment box handed its text over and no longer writes.
    expect(liveBoxes()).toEqual([]);
    edit.open();
    server.down = false;
    edit.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.comments[0].comment).toBe("v2, newer");
  });

  it("reopens an edit box closed with its save still on its way", async () => {
    const comment = await filedThenRetrying();
    server.down = false;
    await vi.advanceTimersByTimeAsync(2000);
    const first = editCommentBox(target, comment);
    first.open();
    server.down = true;
    first.input("v3");
    first.close();
    await settle();
    expect(editCommentBox(target, comment)).toBe(first);
  });

  it("reopens a reply box closed with its reply still on its way, rather than starting a second reply", async () => {
    const comment = await filedThenRetrying();
    const first = replyBox(target, comment);
    first.open();
    first.input("a follow-up");
    first.close();
    await settle();
    const again = replyBox(target, comment);
    expect(again).toBe(first);
    expect(again.getState().text).toBe("a follow-up");
  });
});
