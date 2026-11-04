import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommentSession,
  resetSessionsForTest,
  sessionsNeedGuard,
  sessionsToReport,
  type SessionAck,
  type SessionApi,
  type SessionReply,
} from "./commentSession";

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

function ack(over: Partial<SessionAck> = {}): SessionReply {
  return {
    session: {
      session_id: "s1",
      comment_id: "c1",
      state: "open",
      root_text_version: "v1",
      baseline: { text: "opened", root_text_version: "v1" },
      ...over,
    },
    review: null,
  };
}

/** A scripted API: each command pops its next scripted result. */
function fakeApi() {
  const calls: string[] = [];
  const script: Record<string, (() => Promise<SessionReply>)[]> = {
    begin: [],
    finish: [],
    restore: [],
  };
  let n = 0;
  const next = (name: string) => {
    const f = script[name].shift();
    return f ? f() : Promise.resolve(ack());
  };
  const api: SessionApi = {
    begin: (id, shown) => {
      calls.push(`begin ${id} ${shown}`);
      return next("begin");
    },
    finish: (id) => {
      calls.push(`finish ${id}`);
      return next("finish");
    },
    restore: (id) => {
      calls.push(`restore ${id}`);
      return next("restore");
    },
    readComment: () =>
      Promise.resolve({
        id: "c1",
        comment: "theirs",
        created_at: 0,
        root_text_version: "v9",
      }),
    writeText: (id, text) => {
      calls.push(`write ${id} ${text}`);
      return Promise.resolve(null);
    },
    newId: () => `s${++n}`,
  };
  return { api, calls, script };
}

const make = (api: SessionApi, over = {}) =>
  new CommentSession({
    api,
    commentId: "c1",
    isNew: false,
    openingText: "opened",
    shownVersion: "v1",
    ...over,
  });

beforeEach(() => {
  vi.useFakeTimers();
  resetSessionsForTest();
});
afterEach(() => vi.useRealTimers());

describe("CommentSession", () => {
  it("sends no write before the begin ack, then writes with the session id", async () => {
    const { api, calls, script } = fakeApi();
    let release!: () => void;
    script.begin.push(
      () =>
        new Promise((r) => {
          release = () => r(ack());
        }),
    );
    const s = make(api);
    s.begin();
    const sent = vi.fn((id: string) => Promise.resolve(id));
    const done = s.write(sent);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).not.toHaveBeenCalled();
    release();
    await expect(done).resolves.toBe("s1");
    expect(s.mutated).toBe(true);
    expect(calls).toEqual(["begin s1 v1"]);
  });

  it("replays the same session id when the begin ack is lost", async () => {
    const { api, calls, script } = fakeApi();
    script.begin.push(() => Promise.reject(new Error("Network Error")));
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.phase).toBe("beginning");
    expect(s.note).toBe("Not saving yet — retrying");
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.phase).toBe("open");
    expect(calls).toEqual(["begin s1 v1", "begin s1 v1"]);
  });

  it("reports a stale begin to the box so typed text is kept apart", async () => {
    const { api, script } = fakeApi();
    script.begin.push(() =>
      Promise.resolve(ack({ stale: true, root_text_version: "v2" })),
    );
    const onAck = vi.fn();
    const s = make(api, { onAck });
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    expect(onAck).toHaveBeenCalledWith(
      expect.objectContaining({ stale: true, root_text_version: "v2" }),
    );
  });

  it("refuses a late autosave after finish as a 404", async () => {
    const { api } = fakeApi();
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    await s.finish();
    expect(s.phase).toBe("closed");
    await expect(s.write(() => Promise.resolve(1))).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it("retries a failed finish until it lands and says Saving… meanwhile", async () => {
    const { api, calls, script } = fakeApi();
    script.finish.push(() => Promise.reject(httpError(503)));
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    const done = s.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.note).toBe("Saving…");
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(calls.filter((c) => c.startsWith("finish"))).toHaveLength(2);
    expect(s.phase).toBe("closed");
  });

  it("retries a restore 1s growing to 30s with no end, and offers Retry now", async () => {
    const { api, calls, script } = fakeApi();
    for (let i = 0; i < 8; i++) {
      script.restore.push(() => Promise.reject(new Error("Network Error")));
    }
    script.restore.push(() => Promise.resolve(ack({ outcome: "restored" })));
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    s.restore("typed");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.phase).toBe("restore-retrying");
    expect(s.retryInMs).toBe(1000);
    expect(sessionsNeedGuard()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000); // 2nd fails -> 2s
    expect(s.retryInMs).toBe(2000);
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16000); // 3..6th
    expect(s.retryInMs).toBe(30000); // capped
    s.retryRestoreNow(); // 7th fails
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30000); // 8th fails
    await vi.advanceTimersByTimeAsync(30000); // 9th lands
    expect(s.phase).toBe("closed");
    expect(s.outcome).toBe("restored");
    expect(calls.filter((c) => c.startsWith("restore"))).toHaveLength(9);
    expect(sessionsNeedGuard()).toBe(false);
  });

  it("keeps restoring after its box is gone: the registry owns it", async () => {
    const { api, script } = fakeApi();
    script.restore.push(() => Promise.reject(new Error("Network Error")));
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    s.restore("typed");
    await vi.advanceTimersByTimeAsync(0);
    // no box, no subscriber: the session is still listed and still retries
    expect(sessionsToReport()).toContain(s);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.phase).toBe("closed");
  });

  it("restore 404 keeps the text and never retries", async () => {
    const { api, calls, script } = fakeApi();
    script.restore.push(() => Promise.reject(httpError(404)));
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    s.restore("typed");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.phase).toBe("gone");
    expect(s.heldText).toBe("typed");
    expect(calls.filter((c) => c.startsWith("restore"))).toHaveLength(1);
  });

  it("restore 409 shows theirs / yours / opened and replaces only on a new session", async () => {
    const { api, calls, script } = fakeApi();
    script.restore.push(() => Promise.reject(httpError(409)));
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    s.restore("mine");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.phase).toBe("conflict");
    expect(s.conflict).toMatchObject({
      theirs: { comment: "theirs" },
      yours: "mine",
      opened: "opened",
    });
    expect(calls.filter((c) => c.startsWith("restore"))).toHaveLength(1);
    const replaced = s.replaceWithMine();
    await vi.advanceTimersByTimeAsync(0);
    await expect(replaced).resolves.toBe(true);
    // new session id, begun on the freshly shown version, then the write
    expect(calls.slice(-3)).toEqual([
      "begin s2 v9",
      "write s2 mine",
      "finish s2",
    ]);
  });

  it("replace with mine writes nothing when the root moved again", async () => {
    const { api, calls, script } = fakeApi();
    script.restore.push(() => Promise.reject(httpError(409)));
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    s.restore("mine");
    await vi.advanceTimersByTimeAsync(0);
    script.begin.push(() => Promise.resolve(ack({ stale: true })));
    const replaced = s.replaceWithMine();
    await vi.advanceTimersByTimeAsync(0);
    await expect(replaced).resolves.toBe(false);
    expect(calls.some((c) => c.startsWith("write"))).toBe(false);
    expect(s.phase).toBe("conflict");
  });

  it("raises the leave guard once typed or mutated, not for an untouched box", async () => {
    const { api } = fakeApi();
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    expect(sessionsNeedGuard()).toBe(false);
    s.noteTyped("opened and more");
    expect(sessionsNeedGuard()).toBe(true);
    s.noteTyped("opened");
    expect(sessionsNeedGuard()).toBe(false);
    expect(s.unchanged).toBe(true);
  });

  it("is not unchanged after a write even if the text is typed back", async () => {
    const { api } = fakeApi();
    const s = make(api);
    s.begin();
    await vi.advanceTimersByTimeAsync(0);
    await s.write(() => Promise.resolve());
    s.noteTyped("opened");
    expect(s.unchanged).toBe(false);
  });
});
