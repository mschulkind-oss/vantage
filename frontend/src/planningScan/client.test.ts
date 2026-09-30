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
  serveHelper,
  type BuildEvent,
  type HelperStart,
  type WorkerReply,
  type WorkerRequest,
} from "./core";
import { setPlanningLimitsForTests } from "./limits";
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
import {
  chunkedResponse,
  fakePlanningServer,
  type FakeServer,
} from "../test/planningStream";

afterEach(() => {
  setPlanningScannerForTests(null);
  setPlanningLimitsForTests(null);
});

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

/**
 * A stand-in scan worker. With `cores`, its core has helpers to ask for, as
 * the real worker's does, and asks the client for them.
 */
function fakeWorker(server: FakeServer, cores?: number): FakeWorker {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  const emit = (type: string, event: Event) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const reply = (message: WorkerReply) => {
    if (worker.terminated) return;
    const data = structuredClone(message);
    setTimeout(() => emit("message", new MessageEvent("message", { data })));
  };
  const core = scannerCore({
    cache: scanCache(memoryScanStore(), "scanner"),
    fetch: (input, init) => server.fetch(input, init),
    helpers:
      cores === undefined
        ? undefined
        : {
            cores,
            ask: (repo, seq, count) =>
              reply({ type: "helpers", repo, seq, count }),
          },
  });
  const worker: FakeWorker = {
    posted: [],
    terminated: false,
    hold: false,
    postMessage(request, transfer) {
      if (request.type === "helper") throw new Error("not a helper");
      worker.posted.push(request);
      // Ports move, as postMessage moves them; everything else is copied.
      const data = structuredClone(request, { transfer });
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
  const handle = scanWorkerHandler(core, reply);
  return worker;
}

/** A stand-in helper: the real helper handler on the port it is started with. */
interface FakeHelper extends WorkerLike {
  started: boolean;
  terminated: boolean;
  /** Its paths scanned, in order. */
  scanned: string[];
  die(): void;
}

function fakeHelper(): FakeHelper {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  let port: MessagePort | null = null;
  const helper: FakeHelper = {
    started: false,
    terminated: false,
    scanned: [],
    postMessage(message, transfer) {
      if (message.type !== "helper") throw new Error("not the scan worker");
      const start = structuredClone(message, { transfer }) as HelperStart & {
        port: MessagePort;
      };
      helper.started = true;
      port = start.port;
      serveHelper(port);
      const answer = port.onmessage;
      port.onmessage = (event) => {
        helper.scanned.push((event.data as { path: string }).path);
        answer?.call(port as MessagePort, event);
      };
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    terminate() {
      helper.terminated = true;
      port?.close();
    },
    die() {
      for (const listener of listeners.get("error") ?? []) {
        listener(new Event("error"));
      }
    },
  };
  return helper;
}

function workerSetup(
  options: {
    tree?: Record<string, string>;
    cores?: number;
    /** Called as each helper is made, with its index. */
    onHelper?: (at: number) => void;
  } = {},
) {
  const server = fakePlanningServer(options.tree ?? TREE);
  const workers: FakeWorker[] = [];
  const helpers: FakeHelper[] = [];
  const client = workerScannerClient(
    () => {
      const worker = fakeWorker(server, options.cores);
      workers.push(worker);
      return worker;
    },
    () => {
      const helper = fakeHelper();
      helpers.push(helper);
      options.onHelper?.(helpers.length - 1);
      return helper;
    },
  );
  return { server, workers, helpers, client };
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

describe("the worker client's helpers", () => {
  // Six files of a few hundred characters each, past a threshold and a
  // queue configured down to 1 KiB.
  const PROSE = `${"These words are here for their length alone, and say nothing. ".repeat(6)}\n`;
  const HTREE: Record<string, string> = {
    "a.md": `${DOC}\n${PROSE}`,
    "b.md": `${DOC.replaceAll("OQ-A1", "OQ-B1")}\n${PROSE}`,
    "c.md": `${DOC.replaceAll("OQ-A1", "OQ-C1")}\n${PROSE}`,
    "notes.md": `# Notes\n\n${PROSE}`,
    "other.md": `# Other\n\n${PROSE}`,
    "roadmap.md": `# Roadmap\n\n- [A](a.md)\n\n${PROSE}`,
  };
  const LIMITS = {
    helperThresholdBytes: 1024,
    helperQueueBytes: 1024,
    maxHelpers: 2,
    helperReservedCores: 2,
  };

  /** Each planning document's path and hash, in path order. */
  const documentHashes = (events: BuildEvent[]) =>
    events
      .flatMap((event) => (event.type === "documents" ? event.docs : []))
      .map(({ document, hash }) => [document.path, hash])
      .sort(([a = ""], [b = ""]) => (a < b ? -1 : 1));
  const EXPECTED = scannedOf(HTREE)
    .entries.filter((entry) => entry.result.kind === "planning")
    .map((entry) => [entry.path, entry.hash]);

  it("makes those a cold build asks for, hands the scan worker a port to each, and ends them at ready", async () => {
    setPlanningLimitsForTests(LIMITS);
    const { client, workers, helpers } = workerSetup({ tree: HTREE, cores: 4 });
    const events = await buildAll(client);
    expect(events.at(-1)).toEqual({ type: "ready" });

    expect(helpers).toHaveLength(2);
    expect(helpers.every((helper) => helper.started)).toBe(true);
    const lent = workers[0]?.posted.find(
      (request) => request.type === "helpers",
    );
    expect(lent).toMatchObject({ type: "helpers", repo: "", seq: 1 });
    expect(lent?.type === "helpers" && lent.ports).toHaveLength(2);

    // They scanned some of it, and the documents are the tree's.
    expect(helpers.flatMap((helper) => helper.scanned).length).toBeGreaterThan(
      0,
    );
    expect(documentHashes(events)).toEqual(EXPECTED);
    expect(helpers.map((helper) => helper.terminated)).toEqual([true, true]);
  });

  it("ends them when the build fails", async () => {
    setPlanningLimitsForTests(LIMITS);
    const { client, server, helpers } = workerSetup({ tree: HTREE, cores: 4 });
    const serve = server.fetch;
    // The stream is cut before its end line.
    server.fetch = async (input, init) => {
      const response = await serve(input, init);
      if (!String(input).endsWith("/planning/stream")) return response;
      const text = (await response.text()).replace(/[^\n]*\n$/, "");
      return chunkedResponse(text, text.length, init?.signal ?? undefined);
    };
    const events = await buildAll(client);
    expect(events.at(-1)).toMatchObject({ type: "failed" });
    expect(helpers).toHaveLength(2);
    expect(helpers.map((helper) => helper.terminated)).toEqual([true, true]);
  });

  it("ends them when the build is cancelled", async () => {
    setPlanningLimitsForTests(LIMITS);
    const setup = workerSetup({
      tree: HTREE,
      cores: 4,
      onHelper: (at) => {
        if (at === 1) queueMicrotask(() => setup.client.cancel("", 1));
      },
    });
    const { client, workers, helpers } = setup;
    const events: BuildEvent[] = [];
    client.build({ repo: "", seq: 1, bypassCache: false }, (event) =>
      events.push(event),
    );
    for (let i = 0; i < 20 && helpers.length < 2; i++) await tick();
    await tick();
    expect(helpers.map((helper) => helper.terminated)).toEqual([true, true]);
    expect(workers[0]?.posted.map((request) => request.type)).toContain(
      "cancel",
    );
    await tick();
    expect(events.map((event) => event.type)).not.toContain("ready");
  });

  it("fails the build when one of them dies, ends the rest, and cancels the build in the worker", async () => {
    setPlanningLimitsForTests(LIMITS);
    const setup = workerSetup({
      tree: HTREE,
      cores: 4,
      onHelper: (at) => {
        if (at === 1) queueMicrotask(() => setup.helpers[0]?.die());
      },
    });
    const events = await buildAll(setup.client);
    expect(events.at(-1)).toEqual({
      type: "failed",
      message: STOPPED_MESSAGE,
      shape: false,
    });
    expect(setup.helpers.map((helper) => helper.terminated)).toEqual([
      true,
      true,
    ]);
    expect(setup.workers[0]?.posted.at(-1)).toEqual({
      type: "cancel",
      repo: "",
      seq: 1,
    });
  });

  /** A scan worker the test answers for, by hand. */
  function handWorker() {
    const listeners = new Map<string, ((event: Event) => void)[]>();
    const emit = (type: string, event: Event) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    };
    const worker = {
      posted: [] as (WorkerRequest | HelperStart)[],
      postMessage(message: WorkerRequest | HelperStart) {
        worker.posted.push(message);
      },
      addEventListener(type: string, listener: (event: Event) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      terminate() {},
      reply(data: WorkerReply) {
        emit("message", new MessageEvent("message", { data }));
      },
      die() {
        emit("error", new Event("error"));
      },
    };
    const helpers: FakeHelper[] = [];
    let spawnable = Infinity;
    const client = workerScannerClient(
      () => worker,
      () => {
        if (helpers.length >= spawnable) throw new Error("no more workers");
        const helper = fakeHelper();
        helpers.push(helper);
        return helper;
      },
    );
    const lent = () =>
      worker.posted.flatMap((message) =>
        message.type === "helpers" ? [message.ports.length] : [],
      );
    return {
      worker,
      helpers,
      client,
      lent,
      limit: (count: number) => (spawnable = count),
    };
  }

  it("makes none for a build that is over", () => {
    const { worker, helpers, client } = handWorker();
    client.build({ repo: "", seq: 1, bypassCache: false }, () => {});
    client.cancel("", 1);
    worker.reply({ type: "helpers", repo: "", seq: 1, count: 2 });
    expect(helpers).toEqual([]);
  });

  it("ends an earlier build's when a later one supersedes it, and lends a stale build none", () => {
    const { worker, helpers, client, lent } = handWorker();
    client.build({ repo: "", seq: 1, bypassCache: false }, () => {});
    worker.reply({ type: "helpers", repo: "", seq: 1, count: 2 });
    expect(helpers).toHaveLength(2);
    expect(lent()).toEqual([2]);

    client.build({ repo: "", seq: 2, bypassCache: false }, () => {});
    expect(helpers.map((helper) => helper.terminated)).toEqual([true, true]);
    worker.reply({ type: "helpers", repo: "", seq: 1, count: 2 });
    expect(helpers).toHaveLength(2);
  });

  it("ends every build's when the scan worker dies", () => {
    const { worker, helpers, client } = handWorker();
    const events: BuildEvent[] = [];
    client.build({ repo: "", seq: 1, bypassCache: false }, (event) =>
      events.push(event),
    );
    worker.reply({ type: "helpers", repo: "", seq: 1, count: 2 });
    worker.die();
    expect(helpers.map((helper) => helper.terminated)).toEqual([true, true]);
    expect(events).toEqual([
      { type: "failed", message: STOPPED_MESSAGE, shape: false },
    ]);
  });

  it("lends what it could make when no more workers can be made", () => {
    const { worker, helpers, client, lent, limit } = handWorker();
    limit(1);
    client.build({ repo: "", seq: 1, bypassCache: false }, () => {});
    worker.reply({ type: "helpers", repo: "", seq: 1, count: 3 });
    expect(helpers).toHaveLength(1);
    expect(lent()).toEqual([1]);
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
