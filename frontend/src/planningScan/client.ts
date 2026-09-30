/**
 * The scanner client (`docs/design/planning-index-at-scale.md` §7): what the
 * planning store and the planning page call to build a repository's index,
 * refresh one path, and fetch card blocks and quoted lines, without holding
 * any document's text on the main thread.
 *
 * Two implementations of one interface over one core (`core.ts`):
 *
 * - **the worker client**, which posts to the scan worker, created once per
 *   tab at boot. If it dies (an `error` or `messageerror` event), every build
 *   it had fails with *The planning scan stopped*, every refresh in flight
 *   answers `null`, and the next request starts a new worker (§7.1). One that
 *   fails before its `hello`, whose code never loaded, could not be created,
 *   and the tab moves to the inline client. When a cold build asks for
 *   helpers, it makes them and hands each one end of a channel whose other
 *   end goes to the scan worker, so their data never passes through this
 *   thread; it ends them with the build (§7.5);
 * - **the inline client**, which runs the core on the main thread, sliced at
 *   `sliceMs` so the page can paint. It serves the unit tests, which have no
 *   `Worker`, and a browser where the worker cannot be created or its code
 *   cannot be loaded. It is not a fallback for a worker that crashed: a crash
 *   on some file would crash the page the same way (§7.6).
 *
 * The client makes no ordering decision (§5.4): it hands every answer to its
 * caller, and the planning store's request numbering decides which one wins.
 */

import type { PlanningConfig, ScannedEntry } from "vantage-md/planning";
import { scanCache, scannerIdOf } from "./cache";
import {
  scannerCore,
  timeoutYield,
  type BuildEvent,
  type CardAnswer,
  type CardWant,
  type HelperStart,
  type QuoteWant,
  type Quotes,
  type WorkerReply,
  type WorkerRequest,
} from "./core";
import { idbScanStore, type ScanStore } from "./store";

export type { BuildEvent, CardAnswer, CardWant, QuoteWant, Quotes };

export interface ScannerClient {
  /**
   * Build `repo`'s index. `on` hears `started`, `header`, `documents`,
   * `progress`, then `ready` or `failed`; nothing after either, and nothing
   * once the build is cancelled or superseded by a later build of the same
   * repository.
   */
  build(
    request: { repo: string; seq: number; bypassCache: boolean },
    on: (event: BuildEvent) => void,
  ): void;
  cancel(repo: string, seq: number): void;
  /**
   * One path's scanned entry, as the planning index applies it, with no card
   * text in it; `null` when it could not be had. `config` is the config of the
   * index the answer is for, which a worker that has seen no header of the
   * repository scans under: one made after another died (§7.1).
   */
  refresh(request: {
    repo: string;
    seq: number;
    path: string;
    config?: PlanningConfig | null;
  }): Promise<ScannedEntry | null>;
  /**
   * Card blocks, one answer per card asked for, in order. `full` asks for
   * blocks past `cardChars` too, which are otherwise answered `preview`.
   */
  cards(
    repo: string,
    want: CardWant[],
    options?: { full?: boolean },
  ): Promise<CardAnswer[]>;
  /** The asked lines of each file, and nothing else of its text. */
  quotes(repo: string, want: QuoteWant[]): Promise<Quotes>;
}

/** What a build of a worker that died says (§7.1). */
export const STOPPED_MESSAGE = "The planning scan stopped";

/** A repository's API base, the planning store's shape. */
const apiBaseOf = (repo: string): string =>
  repo === "" ? "/api" : `/api/r/${encodeURIComponent(repo)}`;

/* ------------------------------------------------------------------ *
 * The worker client
 * ------------------------------------------------------------------ */

/**
 * The little of a `Worker` the client uses, so a test can stand in for it:
 * the scan worker, which takes requests, or a helper, which takes its start.
 */
export interface WorkerLike {
  postMessage(
    message: WorkerRequest | HelperStart,
    transfer?: Transferable[],
  ): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
}

interface Pending {
  settle(reply: WorkerReply): void;
  stop(): void;
  /** Ask `client` instead, and settle as it answers. */
  move(client: ScannerClient): void;
}

/** A build a repository is waiting on. */
interface Build {
  seq: number;
  bypassCache: boolean;
  on: (event: BuildEvent) => void;
  /** The helpers made for it, which end with it (§7.5). */
  helpers: WorkerLike[];
  /** How many helpers' ports the scan worker has been sent for it. */
  lent: number;
}

/** Whether a worker's message is its `hello`: its code has loaded. */
const isHello = (event: Event): boolean =>
  (event as MessageEvent<WorkerReply | null>).data?.type === "hello";

/**
 * The client over the scan worker. `spawn` makes a worker; the first is made
 * at once, so it starts beside the app's first requests, and another only
 * after one dies. `spawnHelper` makes a worker to be a helper: by default one
 * from the scan worker's own chunk, which a {@link HelperStart} message makes
 * a helper, so a helper runs exactly the scan worker's code.
 *
 * `unavailable` makes the client to use instead once a scan worker fails
 * before its `hello`: its code never loaded, so no worker can be created here
 * (§7.1). What was sent to that worker is asked of it instead, and so is
 * everything after. Without it, such a failure is a death like any other.
 */
export function workerScannerClient(
  spawn: () => WorkerLike,
  spawnHelper: () => WorkerLike = spawnScanWorker,
  unavailable?: () => ScannerClient,
): ScannerClient {
  let worker: WorkerLike | null = null;
  /** Whether `worker` has said `hello`. */
  let loaded = false;
  /** The client asked instead, once a scan worker failed to load. */
  let instead: ScannerClient | null = null;
  let nextId = 0;
  const builds = new Map<string, Build>();
  const pending = new Map<number, Pending>();
  /**
   * The config of the last header each repository's builds sent. A refresh
   * or card request carries it, so a scan worker started after one died idle,
   * which has seen no header, scans under the repository's config (§7.1).
   */
  const configs = new Map<string, PlanningConfig>();

  const endHelpers = (build: Build): void => {
    for (const helper of build.helpers.splice(0)) helper.terminate();
  };

  /** A build this client hears nothing more of: its helpers end now. */
  const over = (repo: string, build: Build): void => {
    if (builds.get(repo) === build) builds.delete(repo);
    endHelpers(build);
  };

  const died = (dead: WorkerLike): void => {
    worker = null;
    dead.terminate();
    const stopped = [...builds.values()];
    const waiting = [...pending.values()];
    builds.clear();
    pending.clear();
    for (const build of stopped) {
      endHelpers(build);
      build.on({ type: "failed", message: STOPPED_MESSAGE, shape: false });
    }
    for (const request of waiting) request.stop();
  };

  /**
   * A scan worker that failed before its `hello` could not be created (§7.1):
   * from now on the tab asks `unavailable`'s client, starting with every
   * build and request that worker had.
   */
  const neverLoaded = (dead: WorkerLike, make: () => ScannerClient): void => {
    worker = null;
    dead.terminate();
    const client = make();
    instead = client;
    const moved = [...builds];
    const waiting = [...pending.values()];
    builds.clear();
    pending.clear();
    for (const [repo, build] of moved) {
      endHelpers(build);
      const { seq, bypassCache, on } = build;
      client.build({ repo, seq, bypassCache }, on);
    }
    for (const request of waiting) request.move(client);
  };

  const lost = (dead: WorkerLike): void => {
    if (worker !== dead) return;
    if (!loaded && unavailable !== undefined) neverLoaded(dead, unavailable);
    else died(dead);
  };

  /**
   * A helper that dies takes its build with it, as the scan worker's own
   * death would (§7.1): the build fails, and the scan worker drops it.
   */
  const helperDied = (repo: string, build: Build): void => {
    if (builds.get(repo) !== build) return;
    over(repo, build);
    try {
      worker?.postMessage({ type: "cancel", repo, seq: build.seq });
    } catch {
      // A scan worker that cannot take a message is dying too.
    }
    build.on({ type: "failed", message: STOPPED_MESSAGE, shape: false });
  };

  /**
   * A helper that failed before its `hello` never loaded, so it will scan
   * nothing (§7.5): the build goes on without it, and the scan worker reads
   * again what it had handed it.
   */
  const helperNeverLoaded = (
    repo: string,
    build: Build,
    helper: WorkerLike,
    at: number,
  ): void => {
    const held = build.helpers.indexOf(helper);
    if (held === -1) return;
    build.helpers.splice(held, 1);
    helper.terminate();
    if (builds.get(repo) !== build) return;
    try {
      worker?.postMessage({ type: "helper-lost", repo, seq: build.seq, at });
    } catch {
      // A scan worker that cannot take a message is dying too.
    }
  };

  /**
   * Make the helpers a build asked for, and hand the scan worker one end of
   * a channel to each (§7.5). A build that is over gets none; where no more
   * workers can be made, it goes on with those it has.
   */
  const lend = (repo: string, seq: number, count: number): void => {
    const build = builds.get(repo);
    const scan = worker;
    if (build?.seq !== seq || scan === null) return;
    const ports: MessagePort[] = [];
    for (let made = 0; made < count; made++) {
      let helper: WorkerLike;
      try {
        helper = spawnHelper();
      } catch {
        break;
      }
      const channel = new MessageChannel();
      try {
        helper.postMessage({ type: "helper", port: channel.port1 }, [
          channel.port1,
        ]);
      } catch {
        helper.terminate();
        break;
      }
      // Its place among the build's ports, which names it to the scan worker.
      const at = build.lent + ports.length;
      let helperLoaded = false;
      const gone = (): void => {
        if (helperLoaded) helperDied(repo, build);
        else helperNeverLoaded(repo, build, helper, at);
      };
      helper.addEventListener("message", (event) => {
        if (isHello(event)) helperLoaded = true;
      });
      helper.addEventListener("error", gone);
      helper.addEventListener("messageerror", gone);
      build.helpers.push(helper);
      ports.push(channel.port2);
    }
    if (ports.length === 0) return;
    try {
      scan.postMessage({ type: "helpers", repo, seq, ports }, ports);
      build.lent += ports.length;
    } catch {
      endHelpers(build);
    }
  };

  const receive = (from: WorkerLike, reply: WorkerReply): void => {
    if (reply.type === "hello") {
      if (from === worker) loaded = true;
      return;
    }
    if (reply.type === "build") {
      const { event } = reply;
      if (event.type === "header") configs.set(reply.repo, event.config);
      const build = builds.get(reply.repo);
      if (build?.seq !== reply.seq) return;
      if (event.type === "ready" || event.type === "failed") {
        over(reply.repo, build);
      }
      build.on(event);
      return;
    }
    if (reply.type === "helpers") {
      lend(reply.repo, reply.seq, reply.count);
      return;
    }
    const request = pending.get(reply.id);
    if (request === undefined) return;
    pending.delete(reply.id);
    request.settle(reply);
  };

  const current = (): WorkerLike => {
    if (worker !== null) return worker;
    const spawned = spawn();
    spawned.addEventListener("message", (event) =>
      receive(spawned, (event as MessageEvent<WorkerReply>).data),
    );
    spawned.addEventListener("error", () => lost(spawned));
    spawned.addEventListener("messageerror", () => lost(spawned));
    worker = spawned;
    loaded = false;
    return spawned;
  };

  /**
   * Post a request that has an answer, and settle as `read` says; or, once
   * the worker turns out never to have loaded, as `elsewhere` answers.
   */
  function ask<T>(
    request: (id: number) => WorkerRequest,
    read: (reply: WorkerReply) => T,
    stopped: () => T,
    elsewhere: (client: ScannerClient) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      const settle = (answer: () => T) => {
        try {
          resolve(answer());
        } catch (error) {
          reject(error);
        }
      };
      pending.set(id, {
        settle: (reply) => settle(() => read(reply)),
        stop: () => settle(stopped),
        move: (client) => elsewhere(client).then(resolve, reject),
      });
      try {
        current().postMessage(request(id));
      } catch {
        pending.delete(id);
        settle(stopped);
      }
    });
  }

  const refused = (reply: WorkerReply): never => {
    throw new Error(
      reply.type === "refused"
        ? reply.message
        : "The planning scan answered out of turn",
    );
  };
  const stop = (): never => {
    throw new Error(STOPPED_MESSAGE);
  };

  // Started at once, beside the app's first requests (§7.1).
  current();

  return {
    build(request, on) {
      if (instead !== null) {
        instead.build(request, on);
        return;
      }
      const { repo, seq, bypassCache } = request;
      // The scan worker supersedes an earlier build of the repository.
      const earlier = builds.get(repo);
      if (earlier !== undefined) endHelpers(earlier);
      builds.set(repo, { seq, bypassCache, on, helpers: [], lent: 0 });
      try {
        current().postMessage({
          type: "build",
          repo,
          apiBase: apiBaseOf(repo),
          seq,
          bypassCache,
        });
      } catch {
        builds.delete(repo);
        queueMicrotask(() =>
          on({ type: "failed", message: STOPPED_MESSAGE, shape: false }),
        );
      }
    },

    cancel(repo, seq) {
      if (instead !== null) {
        instead.cancel(repo, seq);
        return;
      }
      const build = builds.get(repo);
      if (build?.seq === seq) over(repo, build);
      try {
        worker?.postMessage({ type: "cancel", repo, seq });
      } catch {
        // A worker that cannot take a message has nothing left to cancel.
      }
    },

    refresh: (request) => {
      if (instead !== null) return instead.refresh(request);
      const { repo, seq, path, config = null } = request;
      return ask(
        (id) => ({
          type: "refresh",
          id,
          repo,
          apiBase: apiBaseOf(repo),
          seq,
          path,
          // The index's config, as the store holds it, else the last header's.
          config: config ?? configs.get(repo),
        }),
        (reply) => (reply.type === "scanned" ? reply.entry : null),
        () => null,
        (client) => client.refresh(request),
      );
    },

    cards: (repo, want, options) => {
      if (instead !== null) return instead.cards(repo, want, options);
      return ask(
        (id) => ({
          type: "cards",
          id,
          repo,
          apiBase: apiBaseOf(repo),
          want,
          full: options?.full ?? false,
          config: configs.get(repo),
        }),
        (reply) => (reply.type === "cards" ? reply.answers : refused(reply)),
        stop,
        (client) => client.cards(repo, want, options),
      );
    },

    quotes: (repo, want) => {
      if (instead !== null) return instead.quotes(repo, want);
      return ask(
        (id) => ({ type: "quotes", id, repo, apiBase: apiBaseOf(repo), want }),
        (reply) => (reply.type === "quotes" ? reply.quotes : refused(reply)),
        stop,
        (client) => client.quotes(repo, want),
      );
    },
  };
}

/* ------------------------------------------------------------------ *
 * The inline client
 * ------------------------------------------------------------------ */

export interface InlineScannerOptions {
  /** The scan store, or `null` for none: a context with no scanner id. */
  store: ScanStore | null;
  scannerId: string;
  /** Defaults to the global `fetch`, looked up at each call. */
  fetch?: typeof fetch;
  /** Where the cache's one failure is logged. */
  log?: (error: unknown) => void;
}

export interface InlineScannerClient extends ScannerClient {
  /** Settles once the work a build leaves behind, its collection, is done. */
  idle(): Promise<void>;
}

/** The client over the core itself, on this thread, sliced at `sliceMs`. */
export function inlineScannerClient(
  options: InlineScannerOptions,
): InlineScannerClient {
  const core = scannerCore({
    cache: scanCache(options.store, options.scannerId, options.log),
    fetch: options.fetch,
    yieldNow: timeoutYield,
  });
  return {
    build({ repo, seq, bypassCache }, on) {
      void core.build({ repo, apiBase: apiBaseOf(repo), seq, bypassCache }, on);
    },
    cancel: (repo, seq) => core.cancel(repo, seq),
    refresh: ({ repo, seq, path, config = null }) =>
      core.refresh({ repo, apiBase: apiBaseOf(repo), seq, path, config }),
    cards: (repo, want, cardOptions) =>
      core.cards({
        repo,
        apiBase: apiBaseOf(repo),
        want,
        full: cardOptions?.full ?? false,
      }),
    quotes: (repo, want) =>
      core.quotes({ repo, apiBase: apiBaseOf(repo), want }),
    idle: () => core.idle(),
  };
}

/* ------------------------------------------------------------------ *
 * The one instance
 * ------------------------------------------------------------------ */

let started: ScannerClient | null = null;
let forTests: ScannerClient | null = null;

/**
 * A new worker of the scan worker's chunk: the scan worker, or a helper once
 * it is sent a {@link HelperStart}. Vite finds a worker's entry only from this
 * expression, written literally, and bundles it as a chunk of its own.
 */
function spawnScanWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * The worker client, or `null` where no worker can be made at all. `inline`
 * makes the client it moves to when the worker's code fails to load: a
 * network error, a chunk the server no longer has, a content security policy
 * that lets the worker be made and not fetch it, or a browser without module
 * workers.
 */
function workerClient(inline: () => ScannerClient): ScannerClient | null {
  if (typeof Worker === "undefined") return null;
  let first: Worker | null;
  try {
    first = spawnScanWorker();
  } catch {
    // Refused outright (a content security policy, say): the inline client.
    return null;
  }
  return workerScannerClient(
    () => {
      const spawned = first ?? spawnScanWorker();
      first = null;
      return spawned;
    },
    spawnScanWorker,
    inline,
  );
}

/**
 * Make the tab's scanner client, once: the worker client, or the inline one
 * where no worker can be made or its code cannot be loaded. `sourceHash` is the scanner id's source half,
 * which only the inline client needs, since the worker reads its own; without
 * it the inline client runs with no scan cache, because a result is never
 * trusted without a scanner id.
 *
 * `main.tsx` calls this at boot, unless the page is a static export.
 */
export function startPlanningScanner(
  sourceHash: string | null = null,
): ScannerClient {
  const inline = (): ScannerClient =>
    inlineScannerClient({
      store: sourceHash === null ? null : idbScanStore(),
      scannerId:
        sourceHash === null ? "" : scannerIdOf(sourceHash, navigator.userAgent),
    });
  started ??= workerClient(inline) ?? inline();
  return started;
}

/** The tab's scanner client, started if boot has not started it. */
export function planningScanner(): ScannerClient {
  return forTests ?? startPlanningScanner();
}

/** Stand a client in for the tab's, or, with `null`, stop doing so. */
export function setPlanningScannerForTests(client: ScannerClient | null): void {
  forTests = client;
}
