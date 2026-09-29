/**
 * The scanner client (`docs/design/planning-index-at-scale.md` §7): the worker
 * client's messages, over a stand-in worker that runs the real core behind
 * the real `onmessage` handler and copies every message as `postMessage`
 * would; the inline client; and the tab's one instance.
 */
import { afterEach, describe, expect, it } from "vitest";
import { scanCache } from "./cache";
import {
  scanWorkerHandler,
  scannerCore,
  type BuildEvent,
  type WorkerReply,
  type WorkerRequest,
} from "./core";
import {
  STOPPED_MESSAGE,
  inlineScannerClient,
  planningScanner,
  setPlanningScannerForTests,
  workerScannerClient,
  type ScannerClient,
  type WorkerLike,
} from "./client";
import { memoryScanStore } from "./memoryStore";
import { contentHash, scannedOf } from "../test/planning";
import { fakePlanningServer, type FakeServer } from "../test/planningStream";

afterEach(() => setPlanningScannerForTests(null));

const DOC =
  "---\nstatus: draft\n---\n\n# A\n\n1. 💬 **OQ-A1: Which way?**\n\n   <!-- vantage: oq id=OQ-A1 -->\n\n   _Leaning:_ this way.\n";
const TREE: Record<string, string> = {
  "a.md": DOC,
  "notes.md": "# Notes\n",
};
const BLOCK = scannedOf(TREE).blocks["a.md"]?.[0];

/** A stand-in worker: the real handler over the real core, a task away. */
interface FakeWorker extends WorkerLike {
  posted: WorkerRequest[];
  terminated: boolean;
  /** Stop answering, as a worker busy on a long scan would. */
  hold: boolean;
  die(): void;
}

function fakeWorker(server: FakeServer): FakeWorker {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  const emit = (type: string, event: Event) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const core = scannerCore({
    cache: scanCache(memoryScanStore(), "scanner"),
    fetch: (input, init) => server.fetch(input, init),
  });
  const worker: FakeWorker = {
    posted: [],
    terminated: false,
    hold: false,
    postMessage(request) {
      worker.posted.push(request);
      const data = structuredClone(request);
      setTimeout(() => {
        if (!worker.terminated && !worker.hold) handle(data);
      }, 0);
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    terminate() {
      worker.terminated = true;
    },
    die() {
      emit("error", new Event("error"));
    },
  };
  const handle = scanWorkerHandler(core, (reply: WorkerReply) => {
    if (worker.terminated) return;
    const data = structuredClone(reply);
    setTimeout(() => emit("message", new MessageEvent("message", { data })));
  });
  return worker;
}

function workerSetup() {
  const server = fakePlanningServer(TREE);
  const workers: FakeWorker[] = [];
  const client = workerScannerClient(() => {
    const worker = fakeWorker(server);
    workers.push(worker);
    return worker;
  });
  return { server, workers, client };
}

/** Build, and settle with every event once `ready` or `failed` arrives. */
function buildAll(
  client: ScannerClient,
  request: { repo: string; seq: number; bypassCache: boolean } = {
    repo: "",
    seq: 1,
    bypassCache: false,
  },
): Promise<BuildEvent[]> {
  return new Promise((resolve) => {
    const events: BuildEvent[] = [];
    client.build(request, (event) => {
      events.push(event);
      if (event.type === "ready" || event.type === "failed") resolve(events);
    });
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the worker client", () => {
  it("starts its worker at once", () => {
    const { workers } = workerSetup();
    expect(workers).toHaveLength(1);
  });

  it("hands a build's events over in order, ending at ready", async () => {
    const { client, workers } = workerSetup();
    const events = await buildAll(client);
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "header",
      "documents",
      "ready",
    ]);
    const [documents] = events.filter((event) => event.type === "documents");
    expect(documents?.type === "documents" && documents.docs).toEqual([
      {
        document: expect.objectContaining({ path: "a.md" }),
        hash: contentHash(DOC),
      },
    ]);
    expect(workers[0]?.posted[0]).toEqual({
      type: "build",
      repo: "",
      apiBase: "/api",
      seq: 1,
      bypassCache: false,
    });
  });

  it("answers a refresh, cards and quotes", async () => {
    const { client } = workerSetup();
    await buildAll(client);
    const entry = await client.refresh({ repo: "", seq: 2, path: "a.md" });
    expect(entry).toMatchObject({ kind: "file", path: "a.md" });
    expect(entry?.kind === "file" && entry.result).toMatchObject({
      kind: "planning",
      cards: [],
    });
    expect(
      await client.cards("", [
        {
          path: "a.md",
          hash: contentHash(DOC),
          startLine: BLOCK?.startLine ?? 0,
        },
      ]),
    ).toEqual([{ path: "a.md", block: BLOCK }]);
    expect(
      await client.quotes("", [
        { path: "a.md", hash: contentHash(DOC), lines: [5] },
      ]),
    ).toEqual({ "a.md": { 5: "# A" } });
  });

  it("answers stale for a card whose file is gone", async () => {
    const { client, server } = workerSetup();
    await buildAll(client);
    server.tree = {};
    await expect(
      client.cards("", [
        { path: "a.md", hash: contentHash(DOC), startLine: 1 },
      ]),
    ).resolves.toEqual([{ path: "a.md", startLine: 1, stale: true }]);
  });

  it("rejects cards and quotes the worker could not answer", async () => {
    const { client, server } = workerSetup();
    server.fetch = async () => new Response("{}", { status: 503 });
    await expect(
      client.cards("", [
        { path: "a.md", hash: contentHash(DOC), startLine: 1 },
      ]),
    ).rejects.toThrow("Request failed with status code 503");
    await expect(
      client.quotes("", [{ path: "a.md", hash: contentHash(DOC), lines: [1] }]),
    ).rejects.toThrow("Request failed with status code 503");
  });

  it("names a daemon repository's API base", async () => {
    const { client, workers } = workerSetup();
    client.build({ repo: "my repo", seq: 1, bypassCache: true }, () => {});
    expect(workers[0]?.posted[0]).toMatchObject({
      apiBase: "/api/r/my%20repo",
      bypassCache: true,
    });
  });

  it("hands nothing more over once a build is cancelled", async () => {
    const { client, workers } = workerSetup();
    const events: BuildEvent[] = [];
    client.build({ repo: "", seq: 1, bypassCache: false }, (event) =>
      events.push(event),
    );
    client.cancel("", 1);
    await tick();
    await tick();
    expect(events).toEqual([]);
    expect(workers[0]?.posted.map((request) => request.type)).toEqual([
      "build",
      "cancel",
    ]);
  });

  it("hands a superseded build's events to nobody", async () => {
    const { client } = workerSetup();
    const first: BuildEvent[] = [];
    client.build({ repo: "", seq: 1, bypassCache: false }, (event) =>
      first.push(event),
    );
    const second = await buildAll(client, {
      repo: "",
      seq: 2,
      bypassCache: false,
    });
    expect(first).toEqual([]);
    expect(second.at(-1)).toEqual({ type: "ready" });
  });

  it("fails what was in flight when the worker dies, and starts another for the next request", async () => {
    const { client, workers } = workerSetup();
    await buildAll(client);
    const dying = workers[0];
    if (dying === undefined) throw new Error("no worker");
    dying.hold = true;
    const building = buildAll(client, { repo: "", seq: 2, bypassCache: false });
    const refreshing = client.refresh({ repo: "", seq: 3, path: "a.md" });
    const carding = client.cards("", [
      { path: "a.md", hash: contentHash(DOC), startLine: 1 },
    ]);
    dying.die();

    expect(await building).toEqual([
      { type: "failed", message: STOPPED_MESSAGE, shape: false },
    ]);
    expect(await refreshing).toBeNull();
    await expect(carding).rejects.toThrow(STOPPED_MESSAGE);
    expect(dying.terminated).toBe(true);

    const retried = await buildAll(client, {
      repo: "",
      seq: 4,
      bypassCache: false,
    });
    expect(workers).toHaveLength(2);
    expect(retried.at(-1)).toEqual({ type: "ready" });
  });

  it("fails a request it cannot post, as a worker that died", async () => {
    const client = workerScannerClient(() => ({
      postMessage: () => {
        throw new Error("DataCloneError");
      },
      addEventListener: () => {},
      terminate: () => {},
    }));
    expect(await buildAll(client)).toEqual([
      { type: "failed", message: STOPPED_MESSAGE, shape: false },
    ]);
    expect(await client.refresh({ repo: "", seq: 2, path: "a.md" })).toBeNull();
  });
});

describe("the inline client", () => {
  it("builds, refreshes and answers cards on this thread", async () => {
    const server = fakePlanningServer(TREE);
    const client = inlineScannerClient({
      store: memoryScanStore(),
      scannerId: "scanner",
      fetch: server.fetch,
    });
    const cold = await buildAll(client);
    expect(cold[0]).toEqual({ type: "started", warm: false });
    const warm = await buildAll(client, {
      repo: "",
      seq: 2,
      bypassCache: false,
    });
    expect(warm[0]).toEqual({ type: "started", warm: true });
    expect(server.fileLines[1]).toEqual([]);
    await client.idle();

    expect(
      await client.cards("", [
        {
          path: "a.md",
          hash: contentHash(DOC),
          startLine: BLOCK?.startLine ?? 0,
        },
      ]),
    ).toEqual([{ path: "a.md", block: BLOCK }]);
    expect(
      await client.refresh({ repo: "", seq: 3, path: "notes.md" }),
    ).toEqual({
      kind: "file",
      path: "notes.md",
      hash: contentHash("# Notes\n"),
      result: { kind: "not-planning" },
    });
  });

  it("asks a daemon repository's API base", async () => {
    const server = fakePlanningServer(TREE, { apiBase: "/api/r/docs" });
    const client = inlineScannerClient({
      store: null,
      scannerId: "",
      fetch: server.fetch,
    });
    const events = await buildAll(client, {
      repo: "docs",
      seq: 1,
      bypassCache: false,
    });
    expect(events.at(-1)).toEqual({ type: "ready" });
    expect(server.requests[0]?.url).toBe("/api/r/docs/planning/stream");
  });
});

describe("the tab's scanner client", () => {
  it("is the one a test stands in", () => {
    const client = inlineScannerClient({ store: null, scannerId: "" });
    setPlanningScannerForTests(client);
    expect(planningScanner()).toBe(client);
  });

  it("is one instance, made on first use where boot made none", () => {
    // jsdom has no Worker, so this is the inline client.
    const first = planningScanner();
    expect(planningScanner()).toBe(first);
  });
});
