import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boxesToReport,
  CommentBox,
  flushAllBoxes,
  hasOpenBox,
  hasUnsavedText,
  liveBoxes,
  resetBoxesForTest,
  retargetBoxes,
  RETRY_MAX_MS,
  SAVE_MAX_WAIT_MS,
  SAVE_PAUSE_MS,
  savedAgo,
  statusText,
  withTypedText,
  type BoxOps,
} from "./commentAutosave";
import type { ReviewComment } from "../types";

/** A request the test answers by hand: `resolve()` or `reject()` it. */
interface Pending {
  what: string;
  resolve: () => void;
  reject: () => void;
  fail: (e: unknown) => void;
}

let sent: Pending[];
const req = (what: string) =>
  new Promise<void>((resolve, reject) => {
    sent.push({
      what,
      resolve,
      reject: () => reject(new Error("down")),
      fail: reject,
    });
  });
const rejectWith = (p: Pending, e: unknown) => p.fail(e);

const ops = (): BoxOps => ({
  create: (t) => req(`create ${t}`),
  update: (t) => req(`update ${t}`),
  remove: () => req("remove"),
});

const draft: ReviewComment = {
  id: "c1",
  comment: "",
  created_at: 1,
  reactions: [],
};

const newBox = (o: BoxOps = ops()) => {
  const box = new CommentBox(
    {
      kind: "comment",
      target: { base: "/api", path: "a.md" },
      commentId: "c1",
      draft,
      label: "New comment",
    },
    o,
  );
  box.open();
  return box;
};

/** Let the promise callbacks run, timers untouched. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
});

afterEach(() => {
  resetBoxesForTest();
  vi.useRealTimers();
});

describe("a comment box's saves", () => {
  it("saves 1,000 ms after the last keystroke", async () => {
    const box = newBox();
    box.input("h");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS - 1);
    box.input("hi");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS - 1);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map((p) => p.what)).toEqual(["create hi"]);
  });

  it("saves 5,000 ms after the first unsaved keystroke if typing never pauses", async () => {
    const box = newBox();
    let text = "";
    for (let t = 0; t < SAVE_MAX_WAIT_MS; t += 200) {
      text += "x";
      box.input(text);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(sent.length).toBe(1);
    expect(sent[0].what).toMatch(/^create x+$/);
  });

  it("creates first, then edits, never an edit before its create landed", async () => {
    const box = newBox();
    box.input("one");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    box.input("one two");
    box.input("one two three");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS * 3);
    // One request in flight: the create, still unanswered.
    expect(sent.map((p) => p.what)).toEqual(["create one"]);
    sent[0].resolve();
    await settle();
    // The typing since went out as one save, with the newest text.
    expect(sent.map((p) => p.what)).toEqual([
      "create one",
      "update one two three",
    ]);
  });

  it("never sends empty text", async () => {
    const box = newBox();
    box.input("   ");
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS * 2);
    box.close();
    await settle();
    expect(sent).toEqual([]);
    expect(liveBoxes()).toEqual([]);
  });

  it("selecting all and retyping stores nothing empty", async () => {
    const box = newBox();
    box.input("first");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    sent[0].resolve();
    await settle();
    box.input("");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(box.getState().empty).toBe(true);
    box.input("second");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(sent.map((p) => p.what)).toEqual(["create first", "update second"]);
  });

  it("deletes the comment it created when closed empty", async () => {
    const box = newBox();
    box.input("oops");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    sent[0].resolve();
    await settle();
    box.input("");
    box.close();
    await settle();
    expect(sent.map((p) => p.what)).toEqual(["create oops", "remove"]);
  });

  it("closing sends what is unsaved at once", async () => {
    const box = newBox();
    box.input("quick");
    box.close();
    await settle();
    expect(sent.map((p) => p.what)).toEqual(["create quick"]);
  });

  it("retries a failed save after 1 s, doubling, up to 30 s, with the newest text", async () => {
    const box = newBox();
    box.input("a");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    const gaps: number[] = [];
    let last = Date.now();
    for (let i = 0; i < 7; i++) {
      sent[sent.length - 1].reject();
      await settle();
      expect(box.getState().status).toBe("retrying");
      const before = sent.length;
      while (sent.length === before) await vi.advanceTimersByTimeAsync(100);
      gaps.push(Date.now() - last);
      last = Date.now();
    }
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(RETRY_MAX_MS).toBe(30000);

    box.input("a, then more");
    sent[sent.length - 1].reject();
    await settle();
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(sent[sent.length - 1].what).toBe("create a, then more");
    sent[sent.length - 1].resolve();
    await settle();
    expect(box.getState().status).toBe("saved");
  });

  it("a box closed with a failing save stays reported until it lands", async () => {
    const box = newBox();
    box.input("kept");
    box.close();
    await settle();
    sent[0].reject();
    await settle();
    expect(boxesToReport()).toEqual([box]);
    expect(hasUnsavedText()).toBe(true);
    expect(hasOpenBox()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    sent[1].resolve();
    await settle();
    expect(boxesToReport()).toEqual([]);
    expect(liveBoxes()).toEqual([]);
  });

  it("a reopened box holds the text it was closed with", async () => {
    const box = newBox();
    box.input("closed with this");
    box.close();
    await settle();
    sent[0].reject();
    await settle();
    box.open();
    expect(box.getState()).toMatchObject({
      open: true,
      text: "closed with this",
    });
  });

  it("flushes every unsaved box at once, as the tab goes", async () => {
    const box = newBox();
    box.input("before unload");
    expect(hasUnsavedText()).toBe(true);
    flushAllBoxes();
    await settle();
    expect(sent.map((p) => p.what)).toEqual(["create before unload"]);
  });

  it("an edit box opens holding saved text and sends nothing until it changes", async () => {
    const box = new CommentBox(
      {
        kind: "edit",
        target: { base: "/api", path: "a.md" },
        commentId: "c1",
        label: "Edited comment",
      },
      ops(),
      { text: "as saved", created: true },
    );
    box.open();
    box.input("as saved");
    box.close();
    await settle();
    expect(sent).toEqual([]);
  });
});

describe("a box whose comment is lost or gone", () => {
  const notFound = () =>
    Object.assign(new Error("HTTP 404"), { response: { status: 404 } });

  it("deletes a comment whose create answer was lost, once closed empty", async () => {
    const box = newBox();
    box.input("landed, unheard");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    // The create landed on the server, but its answer never came back.
    sent[0].reject();
    await settle();
    box.input("");
    box.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.map((p) => p.what)).toEqual([
      "create landed, unheard",
      "remove",
    ]);
    // It had not landed after all: nothing to delete is a delete done.
    rejectWith(sent[1], notFound());
    await settle();
    expect(liveBoxes()).toEqual([]);
    expect(boxesToReport()).toEqual([]);
  });

  it("stops retrying an edit of a deleted comment, and says so", async () => {
    const box = newBox();
    box.input("first");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    sent[0].resolve();
    await settle();
    box.input("first, then more");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    rejectWith(sent[1], notFound());
    await settle();
    expect(box.getState().status).toBe("gone");
    expect(statusText(box.getState(), Date.now())).toBe(
      "This comment was deleted",
    );
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS * 2);
    expect(sent.length).toBe(2);

    // Not a retrying save, but reported, and the tab still asks.
    box.close();
    await settle();
    expect(boxesToReport()).toEqual([box]);
    expect(hasUnsavedText()).toBe(true);
  });

  it("lets the tab go once a deleted comment's text is copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const box = goneBox();
    await settle();
    expect(await box.copyText()).toBe(true);
    expect(writeText).toHaveBeenCalledWith("kept text");
    expect(hasUnsavedText()).toBe(false);
    box.close();
    expect(liveBoxes()).toEqual([]);
  });

  it("posts a deleted comment's text as a new comment, and saves it there", async () => {
    const box = goneBox();
    await settle();
    expect(box.getState().canPost).toBe(true);
    // Posted from the box reopened, so the reader can go on typing there.
    box.open();
    box.postAsNew();
    await settle();
    expect(sent.at(-1)!.what).toBe("create-new kept text");
    expect(box.subject.commentId).toBe("n1");
    sent.at(-1)!.resolve();
    await settle();
    expect(box.getState().status).toBe("saved");
    box.input("kept text, and more");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    expect(sent.at(-1)!.what).toBe("update-new kept text, and more");
    expect(hasUnsavedText()).toBe(true);
    sent.at(-1)!.resolve();
    await settle();
    expect(hasUnsavedText()).toBe(false);
  });

  it("keeps retrying a save that failed for any other reason", async () => {
    const box = newBox();
    box.input("down");
    await vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS);
    rejectWith(
      sent[0],
      Object.assign(new Error("HTTP 500"), { response: { status: 500 } }),
    );
    await settle();
    expect(box.getState().status).toBe("retrying");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.length).toBe(2);
  });

  /** An edit box whose comment is gone, holding "kept text". */
  function goneBox(): CommentBox {
    const box = new CommentBox(
      {
        kind: "edit",
        target: { base: "/api", path: "a.md" },
        commentId: "c1",
        label: "Edited comment",
      },
      {
        update: (t) => req(`update ${t}`),
        asNew: () => ({
          draft: { ...draft, id: "n1" },
          ops: {
            create: (t) => req(`create-new ${t}`),
            update: (t) => req(`update-new ${t}`),
          },
        }),
      },
      { text: "old", created: true },
    );
    box.open();
    box.input("kept text");
    box.close();
    rejectWith(sent.at(-1)!, notFound());
    return box;
  }
});

describe("what a box says", () => {
  const base = {
    text: "x",
    open: true,
    savedAt: 0,
    saves: 1,
    empty: false,
    unsaved: false,
  };
  it("names each state in the design's words", () => {
    expect(statusText({ ...base, status: "saving" }, 0)).toBe("Saving…");
    expect(statusText({ ...base, status: "retrying" }, 0)).toBe(
      "Not saved, retrying",
    );
    expect(statusText({ ...base, status: "saved" }, 59_000)).toBe(
      "Saved just now",
    );
    expect(statusText({ ...base, status: "saved" }, 60_000)).toBe(
      "Saved 1 min ago",
    );
    expect(statusText({ ...base, status: "saved", empty: true }, 0)).toBe(
      "Empty text is not saved",
    );
    expect(statusText({ ...base, status: "idle", savedAt: null }, 0)).toBe("");
    expect(savedAgo(3 * 3_600_000)).toBe("Saved 3 h ago");
  });
});

describe("the text Copy answers copies", () => {
  it("is the text as last typed, and a comment not created yet is included", () => {
    const box = newBox();
    box.input("typed, not saved");
    expect(withTypedText("/api", "a.md", [])).toEqual([
      { ...draft, comment: "typed, not saved" },
    ]);
    expect(withTypedText("/api", "other.md", [])).toEqual([]);
  });

  it("follows a document to its new path", () => {
    const box = newBox();
    retargetBoxes("/api", "a.md", "b.md");
    expect(box.subject.target.path).toBe("b.md");
  });
});
