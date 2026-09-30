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
  scanCandidate,
  type PlanningIndex,
} from "vantage-md/planning";
import { scanCache } from "./cache";
import {
  helpersFor,
  readLines,
  scannerCore,
  serveHelper,
  timeoutYield,
  type BuildEvent,
  type BuildRequest,
  type HelperAnswer,
  type HelperJob,
  type HelperPort,
  type HelperSupply,
  type ScannerCore,
} from "./core";
import { setPlanningLimitsForTests } from "./limits";
import { memoryScanDatabase, memoryScanStore } from "./memoryStore";
import type { ScanStore } from "./store";
import {
  contentHash,
  indexOf,
  planningConfig,
  readRepoFile,
  scannedOf,
} from "../test/planning";
import {
  chunkedBody,
  chunkedResponse,
  fakePlanningServer,
  type FakeServer,
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
        if (url.pathname.endsWith("/planning/server-id")) {
          return new Response(JSON.stringify({ server_id: "golden" }));
        }
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

  /*
   * The scan cache is per origin, and a different server may answer at the
   * same origin: another repository started on the same port, or a local
   * tunnel port pointed at another machine. What one server's files were
   * named and what they hashed to is never sent to the other (§8.2).
   */
  const SECRET: Record<string, string> = {
    "hr/layoffs-2026.md": "# Who goes\n",
    "secret/acquisition-target-acme.md": plan(
      "Acme",
      question("OQ-S1", "When?"),
    ),
  };
  const OTHER: Record<string, string> = { "docs/b.md": "# B\n" };

  it("sends a server that answers after another none of the other's paths or hashes", async () => {
    const database = memoryScanDatabase();
    const earlier = memoryScanStore(database);
    const a = fakePlanningServer(SECRET, { config: CONFIG, serverId: "a" });
    const first = scannerCore({
      cache: scanCache(earlier, "scanner"),
      fetch: a.fetch,
      yieldNow: async () => undefined,
    });
    await build(first);
    expect(await earlier.stamps("")).toHaveLength(2);

    // A tab of the same code, at the same origin, now served by another.
    const store = memoryScanStore(database);
    const b = fakePlanningServer(OTHER, { config: CONFIG, serverId: "b" });
    const second = scannerCore({
      cache: scanCache(store, "scanner"),
      fetch: b.fetch,
      yieldNow: async () => undefined,
    });
    const events = await build(second);
    expect(events[0]).toEqual({ type: "started", warm: false });
    expect(b.haves()).toEqual([{}]);
    expect(indexFrom(events)).toEqual(indexOf(OTHER, CONFIG));
    // And the first server's results are gone from the store.
    expect((await store.stamps("")).map((stamp) => stamp.path)).toEqual([
      "docs/b.md",
    ]);
    expect(
      await store.cards("", "secret/acquisition-target-acme.md"),
    ).toBeUndefined();
  });

  it("asks which server answers on every build, so a tab left open across a change sends the new one nothing", async () => {
    const a = fakePlanningServer(SECRET, { config: CONFIG, serverId: "a" });
    const b = fakePlanningServer(OTHER, { config: CONFIG, serverId: "b" });
    let answering = a;
    const core = scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: (input, init) => answering.fetch(input, init),
      yieldNow: async () => undefined,
    });
    await build(core);
    expect(a.haves()).toEqual([{}]);

    // The reconnect's rescan reaches the other server.
    answering = b;
    const events = await build(core, { seq: 2 });
    expect(events[0]).toEqual({ type: "started", warm: false });
    expect(b.haves()).toEqual([{}]);
    // A refresh after it is kept as the new server's.
    expect(
      await core.refresh({ ...REQUEST, seq: 3, path: "docs/b.md" }),
    ).toMatchObject({ kind: "file", path: "docs/b.md" });

    // Its next build is warm with its own results only.
    await build(core, { seq: 4 });
    expect(b.haves()[1]).toEqual({
      "docs/b.md": contentHash(OTHER["docs/b.md"] ?? ""),
    });
    expect(a.serverIdRequests + b.serverIdRequests).toBe(3);
  });

  it("builds cold, and keeps nothing, when the server id cannot be had", async () => {
    const { core, server, log } = setup({ serverId: null });
    const events = await build(core);
    expect(events[0]).toEqual({ type: "started", warm: false });
    expect(indexFrom(events)).toEqual(indexOf(TREE, CONFIG));
    expect(log).not.toHaveBeenCalled();

    // Nothing was written blind: once the id is had, the build is still cold.
    server.serverId = "fake-server";
    expect((await build(core, { seq: 2 }))[0]).toEqual({
      type: "started",
      warm: false,
    });
    expect((await build(core, { seq: 3 }))[0]).toEqual({
      type: "started",
      warm: true,
    });
    expect(server.haves().slice(0, 2)).toEqual([{}, {}]);
  });

  it("does not ask for the server id without a store", async () => {
    const { core, server } = setup({}, null);
    expect((await build(core)).at(-1)).toEqual({ type: "ready" });
    expect(server.serverIdRequests).toBe(0);
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

  it("keep nothing they read once a refresh has kept a newer version meanwhile", async () => {
    const store = memoryScanStore();
    const server = fakePlanningServer(TREE, { config: CONFIG });
    let hold: Promise<void> | null = null;
    const core = scannerCore({
      cache: scanCache(store, "scanner"),
      fetch: async (input, init) => {
        const response = await server.fetch(input, init);
        // The card request's answer, read before the file changed, is slow.
        const held = hold;
        hold = null;
        if (held !== null) await held;
        return response;
      },
      yieldNow: async () => undefined,
    });
    await build(core);
    await store.collect("", new Set());
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    const carding = cards(core, want("plans/a.md"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.pathRequests()).toEqual(["plans/a.md"]);

    const changed = plan("A changed", question("OQ-A1", "Now?"));
    server.tree["plans/a.md"] = changed;
    await core.refresh({
      repo: "",
      apiBase: "/api",
      seq: 2,
      path: "plans/a.md",
    });
    release();
    // The version asked for is answered, and the newer one stays kept.
    expect(await carding).toEqual([
      { path: "plans/a.md", block: blocksOf("plans/a.md")[0] },
    ]);
    const stamps = await store.stamps("");
    expect(stamps.find((stamp) => stamp.path === "plans/a.md")?.hash).toBe(
      contentHash(changed),
    );
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

  it("read a file under the config they carry while no build of this core has said", async () => {
    // A scan worker started after the last one died idle: no header, and the
    // roadmap's blocks, which lived in the dead one's memory, are gone.
    const { store, written } = writeSpy();
    const { core, server } = setup({}, store);
    const answers = await core.cards({
      repo: "",
      apiBase: "/api",
      want: want(CONFIG.roadmap),
      full: false,
      config: planningConfig(CONFIG),
    });
    expect(answers).toEqual([
      { path: CONFIG.roadmap, block: blocksOf(CONFIG.roadmap)[0] },
    ]);
    expect(server.pathRequests()).toEqual([CONFIG.roadmap]);
    // Scanned as the roadmap: kept in memory, never stored.
    expect(written).toEqual([]);
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

  it("scans under the config it carries while no build of this core has said", async () => {
    // A scan worker started after the last one died idle has seen no header.
    const { store, written } = writeSpy();
    const { core } = setup({}, store);
    const config = planningConfig(CONFIG);
    const roadmap = await core.refresh({
      repo: "",
      apiBase: "/api",
      seq: 9,
      path: CONFIG.roadmap,
      config,
    });
    expect(roadmap).toMatchObject({ kind: "file", path: CONFIG.roadmap });
    // The roadmap has no frontmatter: only the config makes it one.
    expect(roadmap?.kind === "file" && roadmap.result.kind).toBe("planning");
    const entry = await core.refresh({
      repo: "",
      apiBase: "/api",
      seq: 10,
      path: "plans/a.md",
      config,
    });
    expect(entry).toMatchObject({ kind: "file", path: "plans/a.md" });
    // No build of this core has said which server answers, so nothing is
    // written (§8.2).
    expect(written).toEqual([]);
  });

  it("scans under its core's own header over the config it carries", async () => {
    const { store, written } = writeSpy();
    const { core } = setup({}, store);
    await build(core);
    written.length = 0;
    await core.refresh({
      repo: "",
      apiBase: "/api",
      seq: 9,
      path: CONFIG.roadmap,
      config: planningConfig({ roadmap: "elsewhere.md" }),
    });
    expect(written).toEqual([]);
  });

  it("scans under the config it is sent when it has seen no header, as a worker made after one died has not (§7.1)", async () => {
    const { core, server } = setup();
    const entry = await core.refresh({
      repo: "",
      apiBase: "/api",
      seq: 2,
      path: CONFIG.roadmap,
      config: planningConfig(CONFIG),
    });
    // The roadmap has no frontmatter: only the config makes it one.
    expect(entry?.kind === "file" && entry.result.kind).toBe("planning");
    expect(server.pathRequests()).toEqual([CONFIG.roadmap]);
  });

  it("scans under a header it has seen over the config it is sent", async () => {
    const { core } = setup();
    await build(core);
    const entry = await core.refresh({
      repo: "",
      apiBase: "/api",
      seq: 2,
      path: CONFIG.roadmap,
      config: planningConfig(),
    });
    expect(entry?.kind === "file" && entry.result.kind).toBe("planning");
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

describe("a refresh made during a build (§5.4)", () => {
  /**
   * A cold build that yields after every candidate, with a push for a.md
   * made at its first yield and that push's answer back at its third. Each
   * cache write takes a task, as an IndexedDB transaction does. The log holds
   * each candidate handled, as progress reports it, around the refresh's
   * steps.
   */
  async function pushDuringBuild(helpers?: HelperSupply): Promise<string[]> {
    setPlanningLimitsForTests({ sliceMs: 0, progressMs: 0 });
    const log: string[] = [];
    const server = fakePlanningServer(TREE, { config: CONFIG });
    const inner = memoryScanStore();
    const store: ScanStore = {
      ...inner,
      write: async (repo, records) => {
        await timeoutYield();
        return inner.write(repo, records);
      },
    };
    let release!: () => void;
    const back = new Promise<void>((resolve) => (release = resolve));
    let yields = 0;
    let refreshing: Promise<unknown> = Promise.resolve();
    const core: ScannerCore = scannerCore({
      cache: scanCache(store, "scanner"),
      fetch: async (input, init) => {
        const response = await server.fetch(input, init);
        if (String(input).includes("?path=")) {
          await back;
          log.push("answer back");
        }
        return response;
      },
      yieldNow: async () => {
        yields += 1;
        if (yields === 1) {
          log.push("push");
          refreshing = core
            .refresh({ repo: "", apiBase: "/api", seq: 2, path: "plans/a.md" })
            .then((entry) => log.push(`refreshed ${entry?.kind}`));
        }
        if (yields === 3) release();
        await timeoutYield();
      },
      helpers,
    });
    await core.build(REQUEST, (event) => {
      if (event.type === "progress") log.push(`handled ${event.done}`);
    });
    await refreshing;
    return log;
  }

  const expectLetFinish = (log: string[]) => {
    const back = log.indexOf("answer back");
    expect(back).toBeGreaterThan(-1);
    // Nothing more is scanned between its answer and its end.
    expect(log[back + 1]).toBe("refreshed file");
    // And the build went on while its request was out.
    expect(
      log.slice(log.indexOf("push"), back).some((e) => e.startsWith("handled")),
    ).toBe(true);
    expect(log.filter((e) => e.startsWith("handled"))).toHaveLength(6);
  };

  it("is let finish once its answer is back, before the build scans its next file", async () => {
    expectLetFinish(await pushDuringBuild());
  });

  it("is let finish before the scan worker's own queue scans on, in a build with helpers", async () => {
    // Helpers asked for and never come: every file is scanned on this thread.
    expectLetFinish(await pushDuringBuild({ cores: 4, ask: () => undefined }));
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

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

describe("a helper", () => {
  it("answers each file with the scan's own result, and a scan that throws with its message", async () => {
    const channel = new MessageChannel();
    serveHelper(channel.port1);
    const answers: HelperAnswer[] = [];
    const answered = new Promise<void>((resolve) => {
      channel.port2.onmessage = ({ data }: MessageEvent<HelperAnswer>) => {
        answers.push(data);
        if (answers.length === 2) resolve();
      };
    });
    const config = planningConfig(CONFIG);
    const content = TREE["plans/a.md"] ?? "";
    channel.port2.postMessage({ id: 1, config, path: "plans/a.md", content });
    // A config the scan cannot read: it throws, and the helper says why.
    channel.port2.postMessage({ id: 2, config: null, path: "b.md", content });
    await answered;
    channel.port1.close();

    expect(answers[0]).toEqual({
      id: 1,
      result: scanCandidate(config, "plans/a.md", content),
    });
    expect(answers[1]).toEqual({ id: 2, error: expect.any(String) });
  });
});

describe("helpers, for a cold build", () => {
  // TREE with a paragraph more in each file, so its six files pass a
  // threshold and a queue configured down to 1 KiB.
  const PROSE = `${"These words are here for their length alone, and say nothing. ".repeat(6)}\n`;
  const HTREE: Record<string, string> = Object.fromEntries(
    Object.entries(TREE).map(([path, text]) => [path, `${text}\n${PROSE}`]),
  );
  const STORED = Object.keys(HTREE)
    .filter((path) => path !== CONFIG.roadmap)
    .sort();

  const LIMITS = {
    helperThresholdBytes: 1024,
    helperQueueBytes: 1024,
    maxHelpers: 2,
    helperReservedCores: 2,
  };

  interface Helper {
    /** The paths the scan worker sent it, in order. */
    sent: string[];
    /** Whether the scan worker's end of its channel was closed. */
    ended: boolean;
  }

  const channels: MessageChannel[] = [];
  afterEach(() => {
    for (const channel of channels.splice(0)) {
      channel.port1.close();
      channel.port2.close();
    }
  });

  /** The scan worker's end of a channel, noting what it sends and its close. */
  const recording = (port: MessagePort, helper: Helper): HelperPort => ({
    postMessage(job) {
      helper.sent.push(job.path);
      port.postMessage(job);
    },
    get onmessage() {
      return port.onmessage;
    },
    set onmessage(listener) {
      port.onmessage = listener;
    },
    close() {
      helper.ended = true;
      port.close();
    },
  });

  /**
   * A core whose helpers are real channels to the real helper handler, made
   * and attached as soon as they are asked for, as the main thread would.
   */
  function helperRig(
    options: {
      cores?: number;
      limits?: Parameters<typeof setPlanningLimitsForTests>[0];
      /**
       * A helper's end of its channel, served; the real handler by default.
       * `at` is its place among the build's helpers.
       */
      serve?: (port: MessagePort, at: number) => void;
      /** Stands in for the server's `fetch`. */
      fetch?: (server: FakeServer) => typeof fetch;
      /** Called once the helpers are attached. */
      attached?: (core: ScannerCore) => void;
    } = {},
  ) {
    setPlanningLimitsForTests({ ...LIMITS, ...options.limits });
    const { store, written } = writeSpy();
    const server = fakePlanningServer(HTREE, { config: CONFIG });
    const asked: { repo: string; seq: number; count: number }[] = [];
    const helpers: Helper[] = [];
    const core: ScannerCore = scannerCore({
      cache: scanCache(store, "scanner"),
      fetch: options.fetch?.(server) ?? server.fetch,
      // A task, as the worker's is: the stream is read on while the scan
      // worker's own queue waits.
      yieldNow: timeoutYield,
      helpers: {
        cores: options.cores ?? 4,
        ask(repo, seq, count) {
          asked.push({ repo, seq, count });
          const ports = Array.from({ length: count }, () => {
            const channel = new MessageChannel();
            channels.push(channel);
            (options.serve ?? serveHelper)(channel.port1, helpers.length);
            const helper: Helper = { sent: [], ended: false };
            helpers.push(helper);
            return recording(channel.port2, helper);
          });
          core.attachHelpers(repo, seq, ports);
          options.attached?.(core);
        },
      },
    });
    return { core, server, asked, helpers, written };
  }

  const hashesOf = (events: BuildEvent[]) =>
    documentsOf(events)
      .map(({ document, hash }) => [document.path, hash])
      .sort(([a = ""], [b = ""]) => (a < b ? -1 : 1));

  it("spreads its files over the helpers, with the same results, each written once, and ends them at ready", async () => {
    const rig = helperRig({ limits: { progressMs: 0 } });
    const events = await build(rig.core);
    expect(events.at(-1)).toEqual({ type: "ready" });
    expect(rig.asked).toEqual([{ repo: "", seq: 1, count: 2 }]);

    // Each helper had files, the scan worker scanned some itself, and no
    // file went to two threads.
    const sent = rig.helpers.flatMap((helper) => helper.sent);
    for (const helper of rig.helpers) {
      expect(helper.sent.length).toBeGreaterThan(0);
    }
    expect(sent.length).toBeLessThan(6);
    expect(new Set(sent).size).toBe(sent.length);

    // The index a build on one thread makes, named by the same hashes.
    expect(indexFrom(events)).toEqual(indexOf(HTREE, CONFIG));
    expect(hashesOf(events)).toEqual(
      ["plans/a.md", "plans/b.md", "plans/c.md", CONFIG.roadmap].map((path) => [
        path,
        contentHash(HTREE[path] ?? ""),
      ]),
    );
    // Every candidate counted once.
    expect(events.filter((event) => event.type === "progress").at(-1)).toEqual({
      type: "progress",
      done: 6,
      total: 6,
    });

    // The scan worker alone wrote the cache: each result once, never the
    // roadmap.
    expect([...rig.written].sort()).toEqual(STORED);
    expect(rig.helpers.map((helper) => helper.ended)).toEqual([true, true]);

    // And what it wrote makes the next build warm.
    const warm = await build(rig.core, { seq: 2 });
    expect(warm[0]).toEqual({ type: "started", warm: true });
    expect(rig.server.fileLines[1]).toEqual([CONFIG.roadmap]);
  });

  it("hands a file larger than any queue to an empty one", async () => {
    // Every file is past every cap, so each lane takes one at a time.
    const rig = helperRig({
      limits: { helperThresholdBytes: 100, helperQueueBytes: 100 },
    });
    const events = await build(rig.core);
    expect(events.at(-1)).toEqual({ type: "ready" });
    expect(rig.asked).toHaveLength(1);
    expect(indexFrom(events)).toEqual(indexOf(HTREE, CONFIG));
  });

  it("asks for none in a warm build, however much has changed", async () => {
    const rig = helperRig();
    await build(rig.core);
    for (const path of Object.keys(rig.server.tree)) {
      rig.server.tree[path] += "\nChanged since.\n";
    }
    const warm = await build(rig.core, { seq: 2 });
    expect(warm[0]).toEqual({ type: "started", warm: true });
    expect(rig.server.fileLines[1]).toHaveLength(6);
    expect(rig.asked).toHaveLength(1);
    expect(indexFrom(warm)).toEqual(indexOf(rig.server.tree, CONFIG));
  });

  it("asks for them in a build that bypasses the cache, which is cold", async () => {
    const rig = helperRig();
    await build(rig.core);
    const again = await build(rig.core, { seq: 2, bypassCache: true });
    expect(again.at(-1)).toEqual({ type: "ready" });
    expect(rig.asked.map((ask) => ask.seq)).toEqual([1, 2]);
    expect(indexFrom(again)).toEqual(indexOf(HTREE, CONFIG));
  });

  it.each([
    [1, 0],
    [2, 0],
    [3, 1],
    [4, 2],
    [5, 3],
    [64, 3],
    [Number.NaN, 0],
  ])("allows a machine of %d cores %d helpers", (cores, count) => {
    expect(helpersFor(cores)).toBe(count);
  });

  it("asks for as many as the cores leave, and none on two cores", async () => {
    const three = helperRig({ cores: 3 });
    expect((await build(three.core)).at(-1)).toEqual({ type: "ready" });
    expect(three.asked).toEqual([{ repo: "", seq: 1, count: 1 }]);

    const two = helperRig({ cores: 2 });
    const events = await build(two.core);
    expect(two.asked).toEqual([]);
    expect(indexFrom(events)).toEqual(indexOf(HTREE, CONFIG));
  });

  it("ends them when the build fails", async () => {
    // The stream is cut before its end line.
    const rig = helperRig({
      fetch: (server) => async (input, init) => {
        const response = await server.fetch(input, init);
        if (!String(input).endsWith("/planning/stream")) return response;
        const text = (await response.text()).replace(/[^\n]*\n$/, "");
        return chunkedResponse(text, text.length, init?.signal ?? undefined);
      },
    });
    const events = await build(rig.core);
    expect(events.at(-1)).toEqual({
      type: "failed",
      message: "The planning stream ended before its end line",
      shape: false,
    });
    expect(rig.asked).toHaveLength(1);
    expect(rig.helpers.map((helper) => helper.ended)).toEqual([true, true]);
  });

  it("reads again, by path, what a helper that never loaded was handed, and goes on without it", async () => {
    // The first helper's code never loads: it takes what it is sent and
    // answers none of it, so the build waits on it until it is lost.
    let sentWhenLost = -1;
    const rig = helperRig({
      limits: { progressMs: 0 },
      serve: (port, at) => {
        if (at !== 0) {
          serveHelper(port);
          return;
        }
        port.onmessage = () =>
          setTimeout(() => {
            if (sentWhenLost !== -1) return;
            sentWhenLost = rig.helpers[0]?.sent.length ?? 0;
            rig.core.helperLost("", 1, 0);
          });
      },
    });
    const events = await build(rig.core);
    expect(events.at(-1)).toEqual({ type: "ready" });

    const lost = rig.helpers[0]?.sent ?? [];
    expect(lost.length).toBeGreaterThan(0);
    // Each of its lines was fetched again, and nothing else was.
    expect(rig.server.pathRequests().sort()).toEqual([...lost].sort());
    // The index is a one-thread build's, each candidate counted and written
    // once, and the lost helper was sent nothing after it was lost.
    expect(lost).toHaveLength(sentWhenLost);
    expect(indexFrom(events)).toEqual(indexOf(HTREE, CONFIG));
    expect(events.filter((event) => event.type === "progress").at(-1)).toEqual({
      type: "progress",
      done: 6,
      total: 6,
    });
    expect([...rig.written].sort()).toEqual(STORED);
    expect(rig.helpers[0]?.ended).toBe(true);
    expect(rig.helpers[1]?.ended).toBe(true);
  });

  it("ignores a lost helper of another build, or one it never had", async () => {
    const rig = helperRig({
      attached: (core) => {
        core.helperLost("", 2, 0);
        core.helperLost("", 1, 5);
      },
    });
    const events = await build(rig.core);
    expect(events.at(-1)).toEqual({ type: "ready" });
    expect(rig.server.pathRequests()).toEqual([]);
    expect(indexFrom(events)).toEqual(indexOf(HTREE, CONFIG));
  });

  it("fails the build when a helper cannot scan a file, and ends them all", async () => {
    const rig = helperRig({
      serve: (port) => {
        port.onmessage = ({ data }: MessageEvent<HelperJob>) =>
          port.postMessage({ id: data.id, error: "The helper broke" });
      },
    });
    const events = await build(rig.core);
    expect(events.at(-1)).toEqual({
      type: "failed",
      message: "The helper broke",
      shape: false,
    });
    expect(kinds(events)).not.toContain("ready");
    expect(rig.helpers.map((helper) => helper.ended)).toEqual([true, true]);
  });

  it("ends them when the build is cancelled, and posts nothing more", async () => {
    const rig = helperRig({
      attached: (core) => queueMicrotask(() => core.cancel("", 1)),
    });
    const events = await build(rig.core);
    expect(kinds(events)).toEqual(["started", "header"]);
    expect(rig.server.requests[0]?.signal?.aborted).toBe(true);
    expect(rig.helpers.map((helper) => helper.ended)).toEqual([true, true]);
  });

  it("goes on alone when its helpers never come, and closes those that come after", async () => {
    setPlanningLimitsForTests(LIMITS);
    const server = fakePlanningServer(HTREE, { config: CONFIG });
    const asked: number[] = [];
    const core = scannerCore({
      cache: scanCache(memoryScanStore(), "scanner"),
      fetch: server.fetch,
      yieldNow: timeoutYield,
      helpers: { cores: 4, ask: (_repo, seq) => asked.push(seq) },
    });
    const events = await build(core);
    expect(asked).toEqual([1]);
    expect(events.at(-1)).toEqual({ type: "ready" });
    expect(indexFrom(events)).toEqual(indexOf(HTREE, CONFIG));

    let closed = 0;
    const late: HelperPort = {
      onmessage: null,
      postMessage: () => {
        throw new Error("a closed port is sent nothing");
      },
      close: () => (closed += 1),
    };
    core.attachHelpers("", 1, [late]);
    expect(closed).toBe(1);
  });

  /**
   * A core whose stream comes one line per read, whose helpers answer only
   * once let go, and whose own scanning waits for `open`; each helper holds
   * 600 characters, so one file apiece.
   */
  function heldRig(
    options: {
      store?: ScanStore;
      /** The helpers answer at once, and the scan worker's own queue is open. */
      answering?: boolean;
      cacheBatch?: number;
    } = {},
  ) {
    setPlanningLimitsForTests({
      ...LIMITS,
      helperQueueBytes: 600,
      cacheBatch: options.cacheBatch,
    });
    const server = fakePlanningServer(HTREE, { config: CONFIG });
    let pulls = 0;
    const oneLineAtATime: typeof fetch = async (input, init) => {
      const response = await server.fetch(input, init);
      if (!String(input).endsWith("/planning/stream")) return response;
      const lines = (await response.text()).split(/(?<=\n)/);
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              const next = lines[pulls++];
              if (next === undefined) controller.close();
              else controller.enqueue(new TextEncoder().encode(next));
            },
          },
          { highWaterMark: 0 },
        ),
      );
    };

    /** A helper that answers only once it is let go. */
    const held = () => {
      const jobs: HelperJob[] = [];
      let answering = options.answering ?? false;
      const answer = (job: HelperJob) =>
        port.onmessage?.(
          new MessageEvent("message", {
            data: {
              id: job.id,
              result: scanCandidate(job.config, job.path, job.content),
            },
          }),
        );
      const port: HelperPort = {
        onmessage: null,
        postMessage(job) {
          if (answering) queueMicrotask(() => answer(job));
          else jobs.push(job);
        },
        close() {
          held.closed = true;
        },
      };
      const held = {
        port,
        jobs,
        closed: false,
        letGo() {
          answering = true;
          for (const job of jobs.splice(0)) answer(job);
        },
        /** Answer what it holds with an error. */
        refuse() {
          for (const job of jobs.splice(0)) {
            port.onmessage?.(
              new MessageEvent("message", {
                data: { id: job.id, error: "The helper broke" },
              }),
            );
          }
        },
      };
      return held;
    };
    const helpers = [held(), held()];
    // The scan worker scans nothing of its own until this opens.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    if (options.answering === true) open();
    const core: ScannerCore = scannerCore({
      cache: scanCache(options.store ?? memoryScanStore(), "scanner"),
      fetch: oneLineAtATime,
      yieldNow: () => gate,
      // The clock stands still: no slice and no progress, only the queues.
      now: () => 0,
      helpers: {
        cores: 4,
        ask: (repo, seq) =>
          core.attachHelpers(
            repo,
            seq,
            helpers.map((helper) => helper.port),
          ),
      },
    });
    return { core, server, helpers, open, pulls: () => pulls };
  }

  const ticks = async () => {
    for (let i = 0; i < 5; i++) await timeoutYield();
  };

  it("reads the stream no further while every queue is full", async () => {
    const { core, helpers, open, pulls } = heldRig();
    const building = build(core);
    await ticks();
    // The header; broken.md and notes.md to the scan worker, near its 1 KiB;
    // plans/a.md and plans/b.md to a helper each; plans/c.md finds no room.
    expect(helpers.map((helper) => helper.jobs.length)).toEqual([1, 1]);
    expect(pulls()).toBe(6);
    await ticks();
    expect(pulls()).toBe(6);

    // Room again: the rest is read, and waits on the scan worker's own queue.
    for (const helper of helpers) helper.letGo();
    await ticks();
    expect(pulls()).toBe(9);
    open();
    const events = await building;
    expect(events.at(-1)).toEqual({ type: "ready" });
    expect(indexFrom(events)).toEqual(indexOf(HTREE, CONFIG));
  });

  it("holds the stream back while the cache is slow to take results", async () => {
    // Every result is its own write, and none of them finishes.
    const inner = memoryScanStore();
    let release!: () => void;
    const writing = new Promise<void>((resolve) => (release = resolve));
    const store: ScanStore = {
      ...inner,
      write: async (repo, records) => {
        await writing;
        return inner.write(repo, records);
      },
    };
    const { core, pulls } = heldRig({ store, answering: true, cacheBatch: 1 });
    const building = build(core);
    await ticks();
    // The first result's write is in flight and the second waits on it, so
    // their lanes still count them: what is held stays within the queues.
    expect(pulls()).toBeLessThan(9);
    release();
    const events = await building;
    expect(events.at(-1)).toEqual({ type: "ready" });
    expect(indexFrom(events)).toEqual(indexOf(HTREE, CONFIG));
    expect(pulls()).toBe(9);
  });

  it("stops reading the stream at a helper's failure", async () => {
    const { core, helpers, pulls } = heldRig();
    const building = build(core);
    await ticks();
    expect(pulls()).toBe(6);
    helpers[0]?.refuse();
    const events = await building;
    expect(events.at(-1)).toEqual({
      type: "failed",
      message: "The helper broke",
      shape: false,
    });
    // The line that was waiting is dropped, and the next is never handled.
    expect(pulls()).toBeLessThanOrEqual(7);
    expect(helpers.map((helper) => helper.closed)).toEqual([true, true]);
  });

  it("lets go of a stream held back by full queues when it is cancelled", async () => {
    const { core, server, helpers, pulls } = heldRig();
    const building = build(core);
    await ticks();
    expect(pulls()).toBe(6);
    // Nothing will make room: neither helper answers, and the scan worker's
    // own queue never opens.
    core.cancel("", 1);
    const events = await building;
    expect(kinds(events)).toEqual(["started", "header"]);
    expect(server.requests[0]?.signal?.aborted).toBe(true);
    expect(helpers.map((helper) => helper.closed)).toEqual([true, true]);
  });
});
