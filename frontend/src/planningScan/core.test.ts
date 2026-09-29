/**
 * The scanner's core, over the in-memory scan store and a fake server
 * (`docs/design/planning-index-at-scale.md` §5–§8): the stream reader, a build
 * warm and cold, the cache's rules, cards, quotes, refreshes and cancelling.
 *
 * Every limit is proven by configuring it down; no input grows to a default.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseStreamLine,
  planningIndexBuilder,
  type PlanningIndex,
} from "vantage-md/planning";
import { scanCache } from "./cache";
import {
  readLines,
  scannerCore,
  type BuildEvent,
  type BuildRequest,
  type ScannerCore,
} from "./core";
import { setPlanningLimitsForTests } from "./limits";
import { memoryScanStore } from "./memoryStore";
import type { ScanStore } from "./store";
import {
  contentHash,
  indexOf,
  readRepoFile,
  scannedOf,
} from "../test/planning";
import {
  chunkedBody,
  chunkedResponse,
  fakePlanningServer,
  type FakeServerOptions,
} from "../test/planningStream";

afterEach(() => setPlanningLimitsForTests(null));

/* ------------------------------------------------------------------ *
 * A small tree
 * ------------------------------------------------------------------ */

const question = (id: string, title: string) =>
  `1. 💬 **${id}: ${title}**\n\n   <!-- vantage: oq id=${id} -->\n\n   _Leaning:_ the first way, which is the one we know.\n`;

const plan = (title: string, ...questions: string[]) =>
  `---\nstatus: draft\n---\n\n# ${title}\n\n${questions.join("\n")}`;

const CONFIG = { roadmap: "plans/roadmap.md" };

const TREE: Record<string, string> = {
  "broken.md": "---\nstatus: [draft\n---\n",
  "notes.md": "# Just notes\n",
  "plans/a.md": plan("A", question("OQ-A1", "Which way?")),
  "plans/b.md": plan("B", question("OQ-B1", "How soon?")),
  "plans/c.md": plan("C"),
  "plans/roadmap.md": `# Roadmap\n\n- [A](a.md)\n\n${question("OQ-R1", "Next?")}`,
};

const hashOf = (path: string): string => contentHash(TREE[path] ?? "");
const scanned = scannedOf(TREE, CONFIG);
const blocksOf = (path: string) => scanned.blocks[path] ?? [];

/** A memory store that records every path written to it. */
function writeSpy(): { store: ScanStore; written: string[] } {
  const inner = memoryScanStore();
  const written: string[] = [];
  return {
    written,
    store: {
      ...inner,
      write: (repo, records) => {
        written.push(...records.map((record) => record.path));
        return inner.write(repo, records);
      },
    },
  };
}

function setup(
  options: FakeServerOptions = {},
  store: ScanStore | null = memoryScanStore(),
  scannerId = "scanner",
) {
  const serverOptions: FakeServerOptions = { config: CONFIG, ...options };
  const server = fakePlanningServer(TREE, serverOptions);
  const log = vi.fn();
  const core = scannerCore({
    cache: scanCache(store, scannerId, log),
    fetch: server.fetch,
    yieldNow: async () => undefined,
  });
  return { server, serverOptions, core, log };
}

const REQUEST: BuildRequest = {
  repo: "",
  apiBase: "/api",
  seq: 1,
  bypassCache: false,
};

async function build(
  core: ScannerCore,
  request: Partial<BuildRequest> = {},
): Promise<BuildEvent[]> {
  const events: BuildEvent[] = [];
  await core.build({ ...REQUEST, ...request }, (event) => events.push(event));
  return events;
}

const kinds = (events: BuildEvent[]) => events.map((event) => event.type);

/** The index a store would build from these events, as WP-D's will. */
function indexFrom(events: BuildEvent[]): PlanningIndex {
  const header = events.find((event) => event.type === "header");
  if (header?.type !== "header") throw new Error("no header");
  const builder = planningIndexBuilder({
    config: header.config,
    candidateCount: header.candidateCount,
    refused: header.refused,
    skipped: [],
    unreadable: [],
  });
  for (const event of events) {
    if (event.type !== "documents") continue;
    for (const { document } of event.docs) {
      builder.addResult(document.path, {
        kind: "planning",
        document,
        cards: [],
      });
    }
    for (const entry of event.unreadable) {
      builder.addScanned({ kind: "unreadable", ...entry });
    }
    for (const entry of event.skipped) {
      builder.addScanned({ kind: "skipped", ...entry });
    }
  }
  return builder.finish();
}

const documentsOf = (events: BuildEvent[]) =>
  events.flatMap((event) => (event.type === "documents" ? event.docs : []));

/* ------------------------------------------------------------------ *
 * The stream reader
 * ------------------------------------------------------------------ */

describe("the stream reader", () => {
  const read = async (text: string | Uint8Array, chunkBytes: number) => {
    const bytes =
      typeof text === "string" ? new TextEncoder().encode(text) : text;
    const lines: string[] = [];
    await readLines(chunkedBody(bytes, chunkBytes), (line) => {
      lines.push(line);
    });
    return lines;
  };

  it("joins a line split across chunks", async () => {
    expect(await read('{"a":1}\n{"bb":22}\n', 3)).toEqual([
      '{"a":1}',
      '{"bb":22}',
    ]);
  });

  it("decodes a character whose bytes are split across chunks", async () => {
    // Two, three and four bytes: every cut lands inside a character.
    expect(await read("é → 😀\nñ\n", 1)).toEqual(["é → 😀", "ñ"]);
  });

  it("reads a line longer than a chunk", async () => {
    const long = "x".repeat(300);
    expect(await read(`${long}\nshort\n`, 7)).toEqual([long, "short"]);
  });

  it("reads a last line that has no newline after it", async () => {
    expect(await read("one\ntwo", 2)).toEqual(["one", "two"]);
  });

  it("refuses bytes that are not UTF-8", async () => {
    await expect(
      read(new Uint8Array([0x7b, 0xff, 0x7d, 0x0a]), 2),
    ).rejects.toThrow();
  });

  it("reads no further chunk until a line has been handled", async () => {
    let pulls = 0;
    const lines = ["one", "two", "three"].map((line) => `${line}\n`);
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const next = lines[pulls++];
          if (next === undefined) controller.close();
          else controller.enqueue(new TextEncoder().encode(next));
        },
      },
      { highWaterMark: 0 },
    );
    const pullsSeen: number[] = [];
    await readLines(body, async () => {
      pullsSeen.push(pulls);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(pullsSeen).toEqual([1, 2, 3]);
  });
});

/* ------------------------------------------------------------------ *
 * A build
 * ------------------------------------------------------------------ */

describe("a build", () => {
  it("reports started, the header, the documents and ready, and the index they make is the tree's", async () => {
    const { core } = setup();
    const events = await build(core);
    expect(kinds(events)).toEqual(["started", "header", "documents", "ready"]);
    expect(events[0]).toEqual({ type: "started", warm: false });
    expect(events[1]).toMatchObject({
      type: "header",
      candidateCount: 6,
      refused: false,
    });
    expect(indexFrom(events)).toEqual(indexOf(TREE, CONFIG));
  });

  it("names each document by its content hash", async () => {
    const { core } = setup();
    const docs = documentsOf(await build(core));
    expect(docs.map(({ document, hash }) => [document.path, hash])).toEqual(
      ["plans/a.md", "plans/b.md", "plans/c.md", "plans/roadmap.md"].map(
        (path) => [path, hashOf(path)],
      ),
    );
  });

  it("sends documents in chunks of at most chunkEntries entries", async () => {
    setPlanningLimitsForTests({ chunkEntries: 2 });
    const { core } = setup();
    const events = await build(core);
    const chunks = events.filter((event) => event.type === "documents");
    // Four documents and one unreadable file.
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      const size =
        chunk.docs.length + chunk.unreadable.length + chunk.skipped.length;
      expect(size).toBeLessThanOrEqual(2);
    }
    expect(indexFrom(events)).toEqual(indexOf(TREE, CONFIG));
  });

  it("sends a document larger than chunkBytes alone", async () => {
    setPlanningLimitsForTests({ chunkBytes: 1 });
    const { core } = setup();
    const chunks = (await build(core)).filter(
      (event) => event.type === "documents",
    );
    expect(chunks).toHaveLength(5);
    for (const chunk of chunks) {
      expect(
        chunk.docs.length + chunk.unreadable.length + chunk.skipped.length,
      ).toBe(1);
    }
  });

  it("reports skipped and unreadable candidates", async () => {
    const size = (path: string) =>
      new TextEncoder().encode(TREE[path] ?? "").length;
    // Within c.md's size and short of a.md's, so some files are skipped and
    // some are read.
    const maxFileBytes = size("plans/c.md");
    expect(size("plans/a.md")).toBeGreaterThan(maxFileBytes);
    const past = Object.keys(TREE)
      .sort()
      .filter((path) => size(path) > maxFileBytes);
    const { core } = setup({
      config: { ...CONFIG, maxFileBytes },
      unreadable: { "notes.md": "not UTF-8" },
    });
    const index = indexFrom(await build(core));
    expect(index.skipped).toEqual(
      past.map((path) => ({ path, size: size(path) })),
    );
    expect(index.unreadable).toEqual([
      { path: "broken.md", reason: expect.any(String) },
      { path: "notes.md", reason: "not UTF-8" },
    ]);
  });

  it("reports progress at most every progressMs", async () => {
    let clock = 0;
    let step = 0;
    const server = fakePlanningServer(TREE, { config: CONFIG });
    const core = scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: server.fetch,
      yieldNow: async () => undefined,
      now: () => (clock += step),
    });
    // The clock stands still: no progress at all.
    expect(kinds(await build(core))).not.toContain("progress");

    // Each reading of the clock moves it 3 ms, and the reader reads it at
    // least twice per candidate, so a report is due every two or so.
    setPlanningLimitsForTests({ progressMs: 10 });
    step = 3;
    const events = await build(core, { seq: 2 });
    const progress = events.flatMap((event) =>
      event.type === "progress" ? [event] : [],
    );
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.length).toBeLessThan(6);
    for (const event of progress) expect(event.total).toBe(6);
    const done = progress.map((event) => event.done);
    expect(done).toEqual([...done].sort((a, b) => a - b));
  });

  it("lets other work in once a slice has run sliceMs", async () => {
    let clock = 0;
    const yieldNow = vi.fn(async () => undefined);
    const server = fakePlanningServer(TREE, { config: CONFIG });
    const core = scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: server.fetch,
      yieldNow,
      now: () => clock,
    });
    await build(core);
    expect(yieldNow).not.toHaveBeenCalled();

    setPlanningLimitsForTests({ sliceMs: 0 });
    clock = 1;
    await build(core, { seq: 2 });
    // Once after each candidate.
    expect(yieldNow).toHaveBeenCalledTimes(6);
  });

  it("is refused past max-candidates: the header, then ready, and no documents", async () => {
    const { core } = setup({ config: { ...CONFIG, maxCandidates: 2 } });
    const events = await build(core);
    expect(kinds(events)).toEqual(["started", "header", "ready"]);
    expect(events[1]).toMatchObject({ refused: true, candidateCount: 6 });
  });
});

describe("a build that fails", () => {
  const failing = (body: string, init: ResponseInit = {}) =>
    scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: async (_input, init2) =>
        chunkedResponse(body, 5, init2?.signal ?? undefined, init),
      yieldNow: async () => undefined,
    });

  const HEADER = JSON.stringify({
    kind: "header",
    config: {
      roadmap: "roadmap.md",
      include: ["**/*.md"],
      exclude: [],
      max_file_bytes: 1048576,
      max_candidates: 5000,
      stages: null,
    },
    candidate_count: 1,
    refused: false,
  });
  const FILE = JSON.stringify({
    kind: "file",
    path: "a.md",
    hash: contentHash("# A\n"),
    content: "# A\n",
  });
  const END = JSON.stringify({ kind: "end", candidates: 1 });

  const lastOf = async (core: ScannerCore) => (await build(core)).at(-1);

  it("fails when the stream ends without its end line", async () => {
    expect(await lastOf(failing(`${HEADER}\n${FILE}\n`))).toEqual({
      type: "failed",
      message: "The planning stream ended before its end line",
      shape: false,
    });
  });

  it("fails on a line that does not parse", async () => {
    expect(await lastOf(failing(`${HEADER}\n{"kind":"fi\n${END}\n`))).toEqual({
      type: "failed",
      message: "The planning stream held a line that is not one of its own",
      shape: false,
    });
  });

  it("fails on a kind it does not know", async () => {
    const odd = JSON.stringify({ kind: "maybe", path: "a.md" });
    expect(await lastOf(failing(`${HEADER}\n${odd}\n${END}\n`))).toMatchObject({
      type: "failed",
      shape: false,
    });
  });

  it("fails with shape when the first line is not a header", async () => {
    for (const body of [
      "<!doctype html>\n<html></html>\n",
      `${END}\n`,
      `${FILE}\n${END}\n`,
      "",
    ]) {
      const events = await build(failing(body));
      expect(kinds(events)).toEqual(["started", "failed"]);
      expect(events.at(-1)).toMatchObject({ type: "failed", shape: true });
    }
  });

  it("fails on a line after the end", async () => {
    expect(
      await lastOf(failing(`${HEADER}\n${FILE}\n${END}\n${FILE}\n`)),
    ).toMatchObject({ type: "failed", shape: false });
  });

  it("fails when the end's count is not the header's", async () => {
    const wrong = JSON.stringify({ kind: "end", candidates: 2 });
    expect(await lastOf(failing(`${HEADER}\n${FILE}\n${wrong}\n`))).toEqual({
      type: "failed",
      message: "The planning stream's end does not match its header",
      shape: false,
    });
  });

  it("fails with the status when the server answers with an error", async () => {
    expect(await lastOf(failing(`{"detail":"gone"}`, { status: 500 }))).toEqual(
      {
        type: "failed",
        message: "Request failed with status code 500",
        shape: false,
      },
    );
  });

  it("fails when the request itself fails", async () => {
    const core = scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await lastOf(core)).toEqual({
      type: "failed",
      message: "Failed to fetch",
      shape: false,
    });
  });
});

describe("the shared stream lines", () => {
  const GOLDEN = readRepoFile("internal/planning/testdata/stream-lines.ndjson");

  it("parses every line of stream-lines.ndjson", () => {
    const lines = GOLDEN.trimEnd().split("\n");
    const parsed = lines.map((line) => parseStreamLine(JSON.parse(line)));
    expect(parsed.every((line) => line !== null)).toBe(true);
    expect(parsed.map((line) => line?.kind)).toEqual([
      "header",
      "same",
      "unreadable",
      "skipped",
      "file",
      "file",
      "end",
    ]);
  });

  it("builds from them, reading again the file it holds no result for", async () => {
    const asked: string[] = [];
    const core = scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: async (input, init) => {
        const url = new URL(String(input), "http://vantage.test");
        if (url.pathname.endsWith("/planning/stream")) {
          return chunkedResponse(GOLDEN, 16, init?.signal ?? undefined);
        }
        const path = url.searchParams.get("path") ?? "";
        asked.push(path);
        return new Response(JSON.stringify({ kind: "absent", path }));
      },
    });
    const events = await build(core);
    expect(events.at(-1)).toEqual({ type: "ready" });
    // `same` for a file this build sent no hash for.
    expect(asked).toEqual(["AGENTS.md"]);
    const index = indexFrom(events);
    expect(index.documents.map((doc) => doc.path)).toEqual([
      "docs/design/a.md",
      "roadmap.md",
    ]);
    expect(index.unreadable).toEqual([
      { path: "docs/bad.md", reason: "not UTF-8" },
    ]);
    expect(index.skipped).toEqual([{ path: "docs/big.md", size: 100 }]);
  });
});

/* ------------------------------------------------------------------ *
 * The cache
 * ------------------------------------------------------------------ */

describe("a build with the cache", () => {
  it("is cold on an empty cache and warm after one build", async () => {
    const { core } = setup();
    expect((await build(core))[0]).toEqual({ type: "started", warm: false });
    expect((await build(core, { seq: 2 }))[0]).toEqual({
      type: "started",
      warm: true,
    });
  });

  it("sends every hash it holds as have, and only the roadmap comes back as a file", async () => {
    const { core, server } = setup();
    const cold = await build(core);
    const warm = await build(core, { seq: 2 });

    expect(server.haves()[0]).toEqual({});
    expect(server.haves()[1]).toEqual(
      Object.fromEntries(
        Object.keys(TREE)
          .filter((path) => path !== CONFIG.roadmap)
          .map((path) => [path, hashOf(path)]),
      ),
    );
    expect(server.fileLines[0]).toEqual(Object.keys(TREE).sort());
    expect(server.fileLines[1]).toEqual([CONFIG.roadmap]);
    expect(server.pathRequests()).toEqual([]);
    expect(indexFrom(warm)).toEqual(indexFrom(cold));
    expect(indexFrom(warm)).toEqual(indexOf(TREE, CONFIG));
  });

  it("scans again only the file that changed", async () => {
    const { core, server } = setup();
    await build(core);
    server.tree["plans/b.md"] = plan("B again", question("OQ-B1", "How late?"));
    const events = await build(core, { seq: 2 });
    expect(server.fileLines[1]).toEqual(["plans/b.md", CONFIG.roadmap]);
    expect(indexFrom(events)).toEqual(indexOf(server.tree, CONFIG));
  });

  it("reads again a file whose stored facts are gone", async () => {
    const store = memoryScanStore();
    const { core, server } = setup({}, store);
    await build(core);
    // Another tab wrote a.md as something else under the same path.
    await store.write("", [
      { path: "plans/a.md", hash: hashOf("plans/a.md"), kind: "planning" },
    ]);
    const events = await build(core, { seq: 2 });
    expect(server.pathRequests()).toEqual(["plans/a.md"]);
    expect(indexFrom(events)).toEqual(indexOf(TREE, CONFIG));
  });

  it("clears every store when the scanner id changes", async () => {
    const store = memoryScanStore();
    const first = setup({}, store, "scanner-1");
    await build(first.core);
    const second = setup({}, store, "scanner-2");
    const events = await build(second.core);
    expect(events[0]).toEqual({ type: "started", warm: false });
    expect(second.server.haves()).toEqual([{}]);
    expect(second.server.fileLines[0]).toEqual(Object.keys(TREE).sort());
  });

  it("collects the paths the stream no longer names, once the build is done", async () => {
    const store = memoryScanStore();
    const { core, server } = setup({}, store);
    await build(core);
    delete server.tree["plans/b.md"];
    delete server.tree["notes.md"];
    await build(core, { seq: 2 });
    await core.idle();
    expect((await store.stamps("")).map((stamp) => stamp.path)).toEqual([
      "broken.md",
      "plans/a.md",
      "plans/c.md",
    ]);
    expect(await store.cards("", "plans/b.md")).toBeUndefined();
  });

  it("collects nothing when refused", async () => {
    const store = memoryScanStore();
    const { core, serverOptions } = setup({}, store);
    await build(core);
    serverOptions.config = { ...CONFIG, maxCandidates: 2 };
    const events = await build(core, { seq: 2 });
    expect(events[1]).toMatchObject({ refused: true });
    await core.idle();
    expect(await store.stamps("")).toHaveLength(5);
  });

  it("never stores the roadmap", async () => {
    const { store, written } = writeSpy();
    const { core } = setup({}, store);
    await build(core);
    await core.refresh({
      repo: "",
      apiBase: "/api",
      seq: 2,
      path: CONFIG.roadmap,
    });
    expect(written).toHaveLength(5);
    expect(written).not.toContain(CONFIG.roadmap);
  });

  it("keeps each repository's results apart", async () => {
    const store = memoryScanStore();
    const one = setup({ apiBase: "/api/r/one" }, store);
    await build(one.core, { repo: "one", apiBase: "/api/r/one" });
    const two = setup({ apiBase: "/api/r/two" }, store);
    const events = await build(two.core, {
      repo: "two",
      apiBase: "/api/r/two",
    });
    expect(events[0]).toEqual({ type: "started", warm: false });
    expect(await store.stamps("one")).toHaveLength(5);
  });

  it("sends no have when asked to bypass the cache, and rewrites every result", async () => {
    const store = memoryScanStore();
    const { core, server } = setup({}, store);
    await build(core);
    const events = await build(core, { seq: 2, bypassCache: true });
    expect(events[0]).toEqual({ type: "started", warm: false });
    expect(server.haves()[1]).toEqual({});
    expect(server.fileLines[1]).toEqual(Object.keys(TREE).sort());
    expect(indexFrom(events)).toEqual(indexOf(TREE, CONFIG));
  });

  it("runs on without a store that fails, logs it once, and sends no have after", async () => {
    const throwing: ScanStore = {
      open: () => Promise.reject(new Error("storage disabled")),
      stamps: () => Promise.reject(new Error("storage disabled")),
      documents: () => Promise.reject(new Error("storage disabled")),
      cards: () => Promise.reject(new Error("storage disabled")),
      write: () => Promise.reject(new Error("storage disabled")),
      collect: () => Promise.reject(new Error("storage disabled")),
    };
    const { core, server, log } = setup({}, throwing);
    const first = await build(core);
    expect(first.at(-1)).toEqual({ type: "ready" });
    expect(indexFrom(first)).toEqual(indexOf(TREE, CONFIG));

    const second = await build(core, { seq: 2 });
    expect(second[0]).toEqual({ type: "started", warm: false });
    expect(server.haves()).toEqual([{}, {}]);
    expect(indexFrom(second)).toEqual(indexOf(TREE, CONFIG));
    expect(log).toHaveBeenCalledTimes(1);

    // The blocks of this tab's builds are held in memory instead.
    const [card] = await core.cards({
      repo: "",
      apiBase: "/api",
      want: [
        {
          path: "plans/a.md",
          hash: hashOf("plans/a.md"),
          startLine: blocksOf("plans/a.md")[0]?.startLine ?? 0,
        },
      ],
      full: false,
    });
    expect(card).toEqual({
      path: "plans/a.md",
      block: blocksOf("plans/a.md")[0],
    });
    expect(server.pathRequests()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Cards and quotes
 * ------------------------------------------------------------------ */

describe("cards", () => {
  const want = (path: string, hash = hashOf(path)) =>
    blocksOf(path).map((block) => ({
      path,
      hash,
      startLine: block.startLine,
    }));

  const cards = (
    core: ScannerCore,
    items: ReturnType<typeof want>,
    full = false,
  ) => core.cards({ repo: "", apiBase: "/api", want: items, full });

  it("are served from the cache, in the order asked", async () => {
    const { core, server } = setup();
    await build(core);
    const asked = [...want("plans/b.md"), ...want("plans/a.md")];
    expect(await cards(core, asked)).toEqual([
      { path: "plans/b.md", block: blocksOf("plans/b.md")[0] },
      { path: "plans/a.md", block: blocksOf("plans/a.md")[0] },
    ]);
    expect(server.pathRequests()).toEqual([]);
  });

  it("serve the roadmap's from memory, since it is never stored", async () => {
    const { core, server } = setup();
    await build(core);
    expect(await cards(core, want(CONFIG.roadmap))).toEqual([
      { path: CONFIG.roadmap, block: blocksOf(CONFIG.roadmap)[0] },
    ]);
    expect(server.pathRequests()).toEqual([]);
  });

  it("are stale when asked for under another hash", async () => {
    const { core, server } = setup();
    await build(core);
    const [item] = want("plans/a.md", "0".repeat(32));
    expect(await cards(core, item === undefined ? [] : [item])).toEqual([
      { path: "plans/a.md", startLine: item?.startLine, stale: true },
    ]);
    expect(server.pathRequests()).toEqual([]);
  });

  it("are stale when the file changed since, and read it to know", async () => {
    const store = memoryScanStore();
    const { core, server } = setup({}, store);
    await build(core);
    await store.collect("", new Set());
    server.tree["plans/a.md"] = plan("A changed", question("OQ-A1", "Now?"));
    const [answer] = await cards(core, want("plans/a.md"));
    expect(answer).toMatchObject({ path: "plans/a.md", stale: true });
    expect(server.pathRequests()).toEqual(["plans/a.md"]);
  });

  it("read the file on a miss, and keep what they read", async () => {
    const store = memoryScanStore();
    const { core, server } = setup({}, store);
    await build(core);
    await store.collect("", new Set());
    expect(await cards(core, want("plans/a.md"))).toEqual([
      { path: "plans/a.md", block: blocksOf("plans/a.md")[0] },
    ]);
    expect(await cards(core, want("plans/a.md"))).toHaveLength(1);
    expect(server.pathRequests()).toEqual(["plans/a.md"]);
  });

  it("past the card limit are previews, unless asked for in full", async () => {
    setPlanningLimitsForTests({ cardChars: 50 });
    const { core, server } = setup();
    await build(core);
    const [block] = blocksOf("plans/a.md");
    expect(block?.markdown.length).toBeGreaterThan(50);

    expect(await cards(core, want("plans/a.md"))).toEqual([
      { path: "plans/a.md", startLine: block?.startLine, preview: true },
    ]);
    expect(await cards(core, want("plans/a.md"), true)).toEqual([
      { path: "plans/a.md", block },
    ]);
    // Never stored, so each is read from the file.
    expect(server.pathRequests()).toEqual(["plans/a.md", "plans/a.md"]);
  });

  it("reject when the file cannot be read", async () => {
    const store = memoryScanStore();
    const { core, server } = setup({}, store);
    await build(core);
    await store.collect("", new Set());
    server.fetch = async () => new Response("{}", { status: 500 });
    const failing = scannerCore({
      cache: scanCache(store, "scanner"),
      fetch: server.fetch,
    });
    await expect(cards(failing, want("plans/a.md"))).rejects.toThrow(
      "Request failed with status code 500",
    );
  });
});

describe("quotes", () => {
  it("return only the lines asked for, of the files that have them", async () => {
    const { core } = setup();
    const quotes = await core.quotes({
      repo: "",
      apiBase: "/api",
      want: [
        { path: "plans/a.md", hash: hashOf("plans/a.md"), lines: [1, 5, 999] },
        { path: "gone.md", hash: "0".repeat(32), lines: [1] },
      ],
    });
    expect(quotes).toEqual({ "plans/a.md": { 1: "---", 5: "# A" } });
  });
});

/* ------------------------------------------------------------------ *
 * Refresh
 * ------------------------------------------------------------------ */

describe("a refresh", () => {
  const refresh = (core: ScannerCore, path: string) =>
    core.refresh({ repo: "", apiBase: "/api", seq: 9, path });

  it("answers the path's scanned entry, with no card text in it, and keeps its result", async () => {
    const { core, server } = setup();
    await build(core);
    server.tree["plans/a.md"] = plan("A again", question("OQ-A1", "Now?"));
    const fresh = scannedOf(server.tree, CONFIG).entries.find(
      (entry) => entry.path === "plans/a.md",
    );
    const entry = await refresh(core, "plans/a.md");
    expect(entry).toEqual({
      kind: "file",
      path: "plans/a.md",
      hash: fresh?.hash,
      result: {
        kind: "planning",
        document: fresh?.result.kind === "planning" && fresh.result.document,
        cards: [],
      },
    });

    // Its blocks are kept, under the new hash.
    const block =
      fresh?.result.kind === "planning" ? fresh.result.cards[0] : undefined;
    const before = server.pathRequests().length;
    expect(
      await core.cards({
        repo: "",
        apiBase: "/api",
        want: [
          {
            path: "plans/a.md",
            hash: fresh?.hash ?? "",
            startLine: block?.startLine ?? 0,
          },
        ],
        full: false,
      }),
    ).toEqual([{ path: "plans/a.md", block }]);
    expect(server.pathRequests()).toHaveLength(before);
  });

  it("answers a path that is gone as absent", async () => {
    const { core } = setup();
    await build(core);
    expect(await refresh(core, "plans/nope.md")).toEqual({
      kind: "absent",
      path: "plans/nope.md",
    });
  });

  it("answers null when the request fails", async () => {
    const { core, server } = setup();
    await build(core);
    const failing = scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: async (input, init) =>
        String(input).includes("?path=")
          ? new Response("{}", { status: 500 })
          : server.fetch(input, init),
    });
    await build(failing);
    expect(await refresh(failing, "plans/a.md")).toBeNull();
  });

  it("answers null before any build has said which file is the roadmap", async () => {
    const { core } = setup();
    expect(await refresh(core, "plans/a.md")).toBeNull();
  });

  it("scans under the header of the build in flight", async () => {
    const server = fakePlanningServer(TREE, { config: CONFIG });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const core = scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: async (input, init) => {
        if (String(input).endsWith("/planning/stream")) await gate;
        return server.fetch(input, init);
      },
    });
    const building = build(core);
    let settled = false;
    const refreshing = refresh(core, CONFIG.roadmap).then((entry) => {
      settled = true;
      return entry;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    // The roadmap has no frontmatter: only the header's config makes it one.
    expect((await refreshing)?.kind).toBe("file");
    const entry = await refreshing;
    expect(entry?.kind === "file" && entry.result.kind).toBe("planning");
    await building;
  });
});

/* ------------------------------------------------------------------ *
 * Cancel
 * ------------------------------------------------------------------ */

describe("a cancelled build", () => {
  it("posts nothing more and aborts its fetch", async () => {
    const { core, server } = setup({ chunkBytes: 32 });
    const events: BuildEvent[] = [];
    await core.build(REQUEST, (event) => {
      events.push(event);
      if (event.type === "header") core.cancel("", 1);
    });
    expect(kinds(events)).toEqual(["started", "header"]);
    expect(server.requests[0]?.signal?.aborted).toBe(true);
  });

  it("stops between lines, even with the rest of the body already read", async () => {
    const { store, written } = writeSpy();
    // One chunk: the abort cannot stop what has already arrived.
    const { core } = setup({}, store);
    const events: BuildEvent[] = [];
    await core.build(REQUEST, (event) => {
      events.push(event);
      if (event.type === "header") core.cancel("", 1);
    });
    expect(kinds(events)).toEqual(["started", "header"]);
    expect(written).toEqual([]);
  });

  it("ignores a cancel for another build", async () => {
    const { core } = setup();
    const events: BuildEvent[] = [];
    await core.build(REQUEST, (event) => {
      events.push(event);
      if (event.type === "header") core.cancel("", 2);
    });
    expect(events.at(-1)).toEqual({ type: "ready" });
  });

  it("is what a later build of the same repository makes of an earlier one", async () => {
    const { core, server } = setup({ chunkBytes: 32 });
    const first: BuildEvent[] = [];
    let second: Promise<BuildEvent[]> | null = null;
    await core.build(REQUEST, (event) => {
      first.push(event);
      if (event.type === "header") second = build(core, { seq: 2 });
    });
    expect(kinds(first)).toEqual(["started", "header"]);
    expect(server.requests[0]?.signal?.aborted).toBe(true);
    const later = await (second as Promise<BuildEvent[]> | null);
    expect(later?.at(-1)).toEqual({ type: "ready" });
    expect(indexFrom(later ?? [])).toEqual(indexOf(TREE, CONFIG));
  });
});
