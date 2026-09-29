/**
 * The scan cache's policy over the in-memory scan store
 * (`docs/design/planning-index-at-scale.md` §8): the scanner id, batching,
 * the card limit, and running on without a store once it fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardBlock, PlanningDocument } from "vantage-md/planning";
import { keptBlocks, recordOf, scanCache, scannerIdOf } from "./cache";
import { setPlanningLimitsForTests } from "./limits";
import { memoryScanStore } from "./memoryStore";
import type { ScanRecord, ScanStore } from "./store";

afterEach(() => setPlanningLimitsForTests(null));

const block = (startLine: number, markdown: string): CardBlock => ({
  startLine,
  endLine: startLine,
  markdown,
  lineOffset: startLine - 1,
});

const doc = (path: string): PlanningDocument => ({
  path,
  status: "draft",
  stage: null,
  stageLine: null,
  next: null,
  dependsOn: [],
  headerProblems: [],
  questions: [],
  links: [],
  ids: [],
  directiveIds: [],
});

const planning = (path: string, hash: string, blocks: CardBlock[] = []) =>
  ({ path, hash, kind: "planning", document: doc(path), blocks }) as const;

/** A store whose every call rejects, counting them. */
function brokenStore(): ScanStore & { calls: number } {
  const store = {
    calls: 0,
    open: async () => fail(),
    stamps: async () => fail(),
    documents: async () => fail(),
    cards: async () => fail(),
    write: async () => fail(),
    collect: async () => fail(),
  };
  function fail(): never {
    store.calls += 1;
    throw new Error("quota exceeded");
  }
  return store;
}

describe("the scanner id", () => {
  it("joins the schema, the source hash and the user agent", () => {
    expect(scannerIdOf("abc", "Mozilla/5.0 (X11)")).toBe(
      "1:abc:Mozilla/5.0 (X11)",
    );
  });

  it("clears every record when it changes", async () => {
    const store = memoryScanStore();
    const first = scanCache(store, "id-1");
    await first.write("", [planning("a.md", "h1", [block(3, "x")])]);
    expect(await first.stamps("")).toHaveLength(1);

    const second = scanCache(store, "id-2");
    expect(await second.stamps("")).toEqual([]);
    expect(await second.cards("", "a.md")).toBeUndefined();
    expect((await second.documents("")).size).toBe(0);
  });

  it("keeps every record when it is the same", async () => {
    const store = memoryScanStore();
    await scanCache(store, "id-1").write("", [planning("a.md", "h1")]);
    expect(await scanCache(store, "id-1").stamps("")).toHaveLength(1);
  });
});

describe("records", () => {
  it("keeps a planning document's facts and its blocks within the card limit", () => {
    setPlanningLimitsForTests({ cardChars: 5 });
    const small = block(3, "short");
    const large = block(9, "longer");
    const record = recordOf("a.md", "h", {
      kind: "planning",
      document: doc("a.md"),
      cards: [small, large],
    });
    expect(record).toEqual({
      path: "a.md",
      hash: "h",
      kind: "planning",
      document: doc("a.md"),
      blocks: [small],
    });
    expect(keptBlocks([small, large])).toEqual([small]);
  });

  it("keeps only a stamp for a file that is not a planning document", () => {
    expect(recordOf("a.md", "h", { kind: "not-planning" })).toEqual({
      path: "a.md",
      hash: "h",
      kind: "not-planning",
    });
    expect(
      recordOf("b.md", "h", { kind: "unreadable", reason: "bad" }),
    ).toEqual({ path: "b.md", hash: "h", kind: "unreadable", reason: "bad" });
  });

  it("reads back what it wrote, per repository", async () => {
    const cache = scanCache(memoryScanStore(), "id");
    await cache.write("one", [
      planning("a.md", "h1", [block(3, "x")]),
      { path: "b.md", hash: "h2", kind: "not-planning" },
    ]);
    await cache.write("two", [planning("a.md", "h9")]);

    expect(await cache.stamps("one")).toEqual([
      { path: "a.md", hash: "h1", kind: "planning" },
      { path: "b.md", hash: "h2", kind: "not-planning" },
    ]);
    expect([...(await cache.documents("one")).keys()]).toEqual(["a.md"]);
    expect(await cache.cards("one", "a.md")).toEqual({
      hash: "h1",
      blocks: [block(3, "x")],
    });
    expect(await cache.cards("two", "a.md")).toEqual({
      hash: "h9",
      blocks: [],
    });
  });

  it("drops a document's facts and blocks when its path stops being one", async () => {
    const cache = scanCache(memoryScanStore(), "id");
    await cache.write("", [planning("a.md", "h1", [block(3, "x")])]);
    await cache.write("", [{ path: "a.md", hash: "h2", kind: "not-planning" }]);
    expect((await cache.documents("")).size).toBe(0);
    expect(await cache.cards("", "a.md")).toBeUndefined();
  });

  it("collects every record of one repository outside the kept paths", async () => {
    const cache = scanCache(memoryScanStore(), "id");
    await cache.write("", [planning("a.md", "h"), planning("b.md", "h")]);
    await cache.write("other", [planning("a.md", "h")]);
    await cache.collect("", new Set(["b.md"]));
    expect((await cache.stamps("")).map((s) => s.path)).toEqual(["b.md"]);
    expect(await cache.stamps("other")).toHaveLength(1);
  });
});

describe("a build's writer", () => {
  it("writes batches of cacheBatch records, one write per record", async () => {
    setPlanningLimitsForTests({ cacheBatch: 2 });
    const store = memoryScanStore();
    const writes: number[] = [];
    const counting: ScanStore = {
      ...store,
      write: (repo, records) => {
        writes.push(records.length);
        return store.write(repo, records);
      },
    };
    const cache = scanCache(counting, "id");
    const writer = cache.writer("");
    for (const path of ["a.md", "b.md", "c.md", "d.md", "e.md"]) {
      await writer.add({ path, hash: "h", kind: "not-planning" });
    }
    expect(writes).toEqual([2, 2]);
    await writer.close();
    expect(writes).toEqual([2, 2, 1]);
    expect(await cache.stamps("")).toHaveLength(5);
  });

  it("waits for the batch before it once the next one is full", async () => {
    setPlanningLimitsForTests({ cacheBatch: 1 });
    const store = memoryScanStore();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let writes = 0;
    const slow: ScanStore = {
      ...store,
      write: async (repo, records) => {
        writes += 1;
        if (writes === 1) await held;
        return store.write(repo, records);
      },
    };
    const writer = scanCache(slow, "id").writer("");
    await writer.add({ path: "a.md", hash: "h", kind: "not-planning" });
    let second = false;
    const adding = writer
      .add({ path: "b.md", hash: "h", kind: "not-planning" })
      .then(() => (second = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(second).toBe(false);
    release();
    await adding;
    await writer.close();
    expect(writes).toBe(2);
  });
});

describe("without a store", () => {
  it("is off from the start with none, and holds no stamps", async () => {
    const cache = scanCache(null, "id");
    expect(cache.enabled).toBe(false);
    await cache.write("", [planning("a.md", "h", [block(3, "x")])]);
    expect(await cache.stamps("")).toEqual([]);
    expect((await cache.documents("")).size).toBe(0);
  });

  it("turns off at the first failure, logs it once, and never asks again", async () => {
    const store = brokenStore();
    const log = vi.fn();
    const cache = scanCache(store, "id", log);
    expect(await cache.stamps("")).toEqual([]);
    expect(cache.enabled).toBe(false);
    await cache.write("", [planning("a.md", "h")]);
    await cache.collect("", new Set());
    expect(await cache.stamps("")).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(store.calls).toBe(1);
  });

  it("turns off when a write fails, and keeps that write's blocks in memory", async () => {
    const store = memoryScanStore();
    const log = vi.fn();
    const failing: ScanStore = {
      ...store,
      write: async () => {
        throw new Error("quota exceeded");
      },
    };
    const cache = scanCache(failing, "id", log);
    await cache.write("", [planning("a.md", "h", [block(3, "x")])]);
    expect(cache.enabled).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(await cache.cards("", "a.md")).toEqual({
      hash: "h",
      blocks: [block(3, "x")],
    });
  });

  it("holds blocks in memory up to memoryCardChars, least recently used first out", async () => {
    setPlanningLimitsForTests({ memoryCardChars: 10 });
    const cache = scanCache(null, "id");
    const records: ScanRecord[] = [
      planning("a.md", "h", [block(1, "aaaa")]),
      planning("b.md", "h", [block(1, "bbbb")]),
    ];
    await cache.write("", records);
    // Reading a.md makes b.md the least recently used.
    expect(await cache.cards("", "a.md")).toBeDefined();
    await cache.write("", [planning("c.md", "h", [block(1, "cccc")])]);
    expect(await cache.cards("", "b.md")).toBeUndefined();
    expect(await cache.cards("", "a.md")).toBeDefined();
    expect(await cache.cards("", "c.md")).toBeDefined();
  });

  it("does not hold one document larger than the whole memory", async () => {
    setPlanningLimitsForTests({ memoryCardChars: 3 });
    const cache = scanCache(null, "id");
    cache.remember("", "a.md", "h", [block(1, "aaaa")]);
    expect(await cache.cards("", "a.md")).toBeUndefined();
  });
});

describe("the in-memory store", () => {
  it("copies on every write and read, as IndexedDB does", async () => {
    const store = memoryScanStore();
    await store.open("id");
    const record = planning("a.md", "h", [block(3, "x")]);
    await store.write("", [record]);
    record.blocks[0]!.markdown = "changed after the write";
    const read = await store.cards("", "a.md");
    expect(read?.blocks[0]?.markdown).toBe("x");
    read!.blocks[0]!.markdown = "changed after the read";
    expect((await store.cards("", "a.md"))?.blocks[0]?.markdown).toBe("x");
  });
});
