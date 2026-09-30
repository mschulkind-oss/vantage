/**
 * The scanner's core (`docs/design/planning-index-at-scale.md` §5, §7): the
 * planning stream read one line at a time, each candidate scanned once and its
 * result kept in the scan cache, and the answers to refreshes, card requests
 * and quote requests. The scan worker runs it behind `worker.ts`, and the
 * inline client runs it on the main thread; both are thin adapters, so this is
 * the one implementation and the one the unit tests drive.
 *
 * It makes no ordering decision (§5.4). It answers each request, and the
 * planning store decides which answer wins. The one exception is that a build
 * supersedes an earlier build of the same repository, which the store would
 * discard whole anyway: it is cancelled rather than read to its end.
 *
 * A cold build can share its scanning with **helpers** (§7.5): extra workers
 * the main thread makes when the scan worker asks, each reached through a
 * channel of its own, which scan the `file` lines they are handed and answer
 * with results only. The scan worker still writes the cache and posts every
 * event itself. Both ends of that channel are here: the pool that hands lines
 * out, and `serveHelper`, which a helper runs.
 *
 * Nothing here imports `virtual:planning-scanner-id`, which resolves only
 * under `vite.config.ts`: the scanner id reaches the cache as an argument.
 */

import {
  DEFAULT_PLANNING_CONFIG,
  parseSourceEntry,
  parseStreamLine,
  scanCandidate,
  type CardBlock,
  type PlanningConfig,
  type PlanningDocument,
  type ScanResult,
  type ScannedEntry,
  type SourceEntry,
  type StreamLine,
} from "vantage-md/planning";
import { recordOf, type CacheWriter, type ScanCache } from "./cache";
import { planningLimits } from "./limits";
import type { StoredDocument } from "./store";

/* ------------------------------------------------------------------ *
 * Requests and answers
 * ------------------------------------------------------------------ */

/**
 * What a build reports, in order: `started`, then `header`, then any number of
 * `documents` and `progress`, then `ready` or `failed`. A cancelled build
 * reports nothing more.
 */
export type BuildEvent =
  /** `warm`: the cache held at least one result for the repository (§3). */
  | { type: "started"; warm: boolean }
  | {
      type: "header";
      config: PlanningConfig;
      candidateCount: number;
      refused: boolean;
    }
  /**
   * The next results, in chunks of at most `chunkEntries` entries and
   * `chunkBytes` of facts. A file that is not a planning document sends
   * nothing.
   */
  | {
      type: "documents";
      docs: { document: PlanningDocument; hash: string }[];
      unreadable: { path: string; reason: string }[];
      skipped: { path: string; size: number }[];
    }
  /** Candidates handled of the header's count, at most every `progressMs`. */
  | { type: "progress"; done: number; total: number }
  /** Every candidate is in: the stream reached its `end`. */
  | { type: "ready" }
  /** `shape`: the answer's first line was not a header. */
  | { type: "failed"; message: string; shape: boolean };

export interface BuildRequest {
  repo: string;
  /** The repository's API base: `/api`, or `/api/r/{repo}` in daemon mode. */
  apiBase: string;
  seq: number;
  /** Send no `have`, so every entry for the repository is scanned and rewritten. */
  bypassCache: boolean;
}

export interface RefreshRequest {
  repo: string;
  apiBase: string;
  seq: number;
  path: string;
}

/** One card block asked for, named by its document's content hash. */
export interface CardWant {
  path: string;
  hash: string;
  startLine: number;
}

/**
 * One answer per card asked for, in the order asked.
 *
 * - a block;
 * - `stale`: the file no longer has that hash, or no block starts at that
 *   line in it, so the page refreshes the path (§10.3);
 * - `preview`: the block is past `cardChars` and was not asked for in full,
 *   so the page draws a preview card (§10.4).
 */
export type CardAnswer =
  | { path: string; block: CardBlock }
  | { path: string; startLine: number; stale: true }
  | { path: string; startLine: number; preview: true };

/** The file lines one pending comment's quote needs, 1-based. */
export interface QuoteWant {
  path: string;
  hash: string;
  lines: number[];
}

/** Per path, per asked line that the file has, the line's text. */
export type Quotes = Record<string, Record<number, string>>;

/* ------------------------------------------------------------------ *
 * The stream reader
 * ------------------------------------------------------------------ */

/**
 * A stream that is not the planning stream's own shape, or is cut short.
 * `shape` says its first line was not a header: a static host answering with
 * its `index.html`, not a broken stream (§12).
 */
export class StreamError extends Error {
  readonly shape: boolean;
  constructor(message: string, shape = false) {
    super(message);
    this.name = "StreamError";
    this.shape = shape;
  }
}

/**
 * Hand each line of `body` to `onLine`, decoded as UTF-8, and read the next
 * chunk only once every line of this one has been handled, so a slow line
 * holds the server back instead of anything buffering (§7.3). What is held is
 * the chunk being handled and the start of the next line.
 *
 * A byte sequence that is not UTF-8 throws. A last line with no newline after
 * it is still a line.
 */
export async function readLines(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => Promise<void> | void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let partial = "";
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const text = done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      // Only the new text is searched, so a long line costs its length once.
      let start = 0;
      let newline = text.indexOf("\n");
      while (newline !== -1) {
        const line = partial + text.slice(start, newline);
        partial = "";
        start = newline + 1;
        await onLine(line);
        newline = text.indexOf("\n", start);
      }
      partial += text.slice(start);
      if (done) break;
    }
    finished = true;
    if (partial !== "") await onLine(partial);
  } finally {
    // A line that failed leaves the rest unread: stop the transfer.
    if (!finished) reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 * Yielding
 * ------------------------------------------------------------------ */

/** A yield that lets the page paint: the inline client's (§7.6). */
export const timeoutYield = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A yield that lets the worker's next message in, with none of a nested
 * timer's 4 ms clamp: the scan worker's, so a refresh sent during a build
 * waits at most one slice (§5.4).
 */
export function messageYield(): () => Promise<void> {
  const channel = new MessageChannel();
  const waiting: (() => void)[] = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  return () =>
    new Promise((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(null);
    });
}

/* ------------------------------------------------------------------ *
 * Helpers (§7.5)
 * ------------------------------------------------------------------ */

/** One file the scan worker hands a helper to scan. */
export interface HelperJob {
  id: number;
  config: PlanningConfig;
  path: string;
  content: string;
}

/** A helper's answer to one job: its scan result, or why it has none. */
export type HelperAnswer =
  { id: number; result: ScanResult } | { id: number; error: string };

/**
 * The little of a `MessagePort` a helper's channel uses: it sends `Send` and
 * receives `Receive`, so a test can stand in for either end.
 */
export interface ChannelPort<Send, Receive> {
  postMessage(message: Send): void;
  onmessage: ((event: MessageEvent<Receive>) => void) | null;
  close(): void;
}

/** The scan worker's end of a helper's channel. */
export type HelperPort = ChannelPort<HelperJob, HelperAnswer>;

/** A helper's own end of its channel. */
export type HelperEnd = ChannelPort<HelperAnswer, HelperJob>;

/**
 * What the main thread sends a worker it has just made, to make it a helper
 * rather than the scan worker. The port is the helper's end of its channel.
 */
export interface HelperStart {
  type: "helper";
  port: HelperEnd;
}

/**
 * Where a build's helpers come from: the scan worker's, which asks the main
 * thread for them (§7.5). The core has none without it, as the inline client
 * has none: a page that cannot make the scan worker cannot make a helper.
 */
export interface HelperSupply {
  /** The cores the machine reports, `navigator.hardwareConcurrency`. */
  cores: number;
  /**
   * Ask for `count` helpers for build `seq` of `repo`. Their ports arrive,
   * when they do, through {@link ScannerCore.attachHelpers}.
   */
  ask(repo: string, seq: number, count: number): void;
}

/**
 * How many helpers a cold build may have on a machine reporting `cores`
 * cores: `maxHelpers`, less what the main thread and the scan worker need,
 * which leaves none on two cores or fewer (§7.5).
 */
export function helpersFor(cores: number): number {
  const { maxHelpers, helperReservedCores } = planningLimits;
  const spare = Math.floor(cores) - helperReservedCores;
  return Number.isFinite(spare) ? Math.max(0, Math.min(maxHelpers, spare)) : 0;
}

/**
 * A helper's work: scan each job that comes in through `port`, and answer it
 * the same way, one at a time. It holds no cache and posts nothing else, so a
 * helper's results reach the store only through the scan worker.
 */
export function serveHelper(port: HelperEnd): void {
  port.onmessage = ({ data }) => {
    let answer: HelperAnswer;
    try {
      answer = {
        id: data.id,
        result: scanCandidate(data.config, data.path, data.content),
      };
    } catch (error) {
      answer = { id: data.id, error: messageOf(error) };
    }
    port.postMessage(answer);
  };
}

/** One `file` line to be scanned. */
interface Job {
  path: string;
  hash: string;
  content: string;
  /**
   * What it counts against a queue: its content's length in characters. That
   * is near enough what a queued line costs in memory, and it is what the
   * other budgets here count.
   */
  size: number;
}

/** A place a job can be scanned: the scan worker itself, or one helper. */
interface Lane {
  /** Characters handed to this lane whose results are not yet taken back. */
  queued: number;
  /** The most it may hold. An empty lane takes a job of any size. */
  cap(): number;
  take(job: Job): void;
}

/** A cold build's scanning, spread over the scan worker and its helpers. */
interface ScanPool {
  /**
   * Hand `job` to a lane, once one has room. While none does, this waits, and
   * so does the stream, which is how the server is held back.
   */
  submit(job: Job): Promise<void>;
  /** Helpers' ports as they arrive. Once the pool is stopped, they are closed. */
  attach(ports: readonly HelperPort[]): void;
  /** Settle once every job handed out has its result taken, or throw the first failure. */
  drain(): Promise<void>;
  /** Throw the first failure, if there has been one. */
  check(): void;
  /** End every helper's channel, and drop whatever comes back. */
  stop(): void;
}

/**
 * The pool of one cold build (§7.5). Each job goes to whichever lane has the
 * fewest characters queued and room for it, a helper before the scan worker
 * on a tie, since the scan worker also reads the stream, writes the cache and
 * posts the events.
 *
 * The scan worker's own lane holds up to `helperThresholdBytes`, and it scans
 * that queue a job at a time, letting the stream be read on between jobs.
 * When a line finds its queue full and no helper yet, what has come in and not
 * been scanned is past the threshold, and `askHelpers` is called, once. Each
 * helper's lane holds up to `helperQueueBytes`.
 *
 * Results are taken one at a time, in the order they come back, and a lane's
 * room is freed only once its result is taken, so what is held never grows
 * past the queues' caps however slow the cache is.
 */
function scanPool(options: {
  config: PlanningConfig;
  took: (job: Job, result: ScanResult) => Promise<void>;
  yieldNow: () => Promise<void>;
  askHelpers: () => void;
}): ScanPool {
  const { config, took, yieldNow, askHelpers } = options;
  let stopped = false;
  let failed: { error: unknown } | null = null;
  let asked = false;
  let taking: Promise<void> = Promise.resolve();
  const waiting: (() => void)[] = [];
  const ends: (() => void)[] = [];

  const over = (): boolean => stopped || failed !== null;
  /** Wake whoever waits on a lane's room or on the pool's end. */
  const notify = (): void => {
    for (const wake of waiting.splice(0)) wake();
  };
  const changed = (): Promise<void> =>
    new Promise((resolve) => waiting.push(resolve));
  const fail = (error: unknown): void => {
    failed ??= { error };
    notify();
  };

  const settle = (lane: Lane, job: Job, result: ScanResult): Promise<void> => {
    taking = taking
      .then(() => (over() ? undefined : took(job, result)))
      .catch(fail)
      .finally(() => {
        lane.queued -= job.size;
        notify();
      });
    return taking;
  };

  /* ---- The scan worker's own lane ---- */

  const own: Job[] = [];
  let scanning = false;
  const self: Lane = {
    queued: 0,
    cap: () => planningLimits.helperThresholdBytes,
    take(job) {
      self.queued += job.size;
      own.push(job);
      void scanOwn();
    },
  };

  async function scanOwn(): Promise<void> {
    if (scanning) return;
    scanning = true;
    try {
      while (own.length > 0 && !over()) {
        // The stream is read on first: that is how a backlog shows, and how
        // the next line can go to a helper instead.
        await yieldNow();
        const job = own.shift();
        if (job === undefined || over()) break;
        let result: ScanResult;
        try {
          result = scanCandidate(config, job.path, job.content);
        } catch (error) {
          fail(error);
          break;
        }
        await settle(self, job, result);
      }
    } finally {
      scanning = false;
      notify();
    }
  }

  /* ---- A helper's lane ---- */

  const helpers: Lane[] = [];

  const helperLane = (port: HelperPort): Lane => {
    let nextId = 0;
    const sent = new Map<number, Job>();
    const lane: Lane = {
      queued: 0,
      cap: () => planningLimits.helperQueueBytes,
      take(job) {
        const id = ++nextId;
        lane.queued += job.size;
        sent.set(id, job);
        try {
          port.postMessage({
            id,
            config,
            path: job.path,
            content: job.content,
          });
        } catch (error) {
          fail(error);
        }
      },
    };
    port.onmessage = ({ data }) => {
      const job = sent.get(data.id);
      if (job === undefined) return;
      sent.delete(data.id);
      if ("error" in data) fail(new Error(data.error));
      else void settle(lane, job, data.result);
    };
    ends.push(() => {
      port.onmessage = null;
      port.close();
    });
    return lane;
  };

  const pick = (size: number): Lane | null => {
    let best: Lane | null = null;
    for (const lane of [...helpers, self]) {
      if (lane.queued > 0 && lane.queued + size > lane.cap()) continue;
      if (best === null || lane.queued < best.queued) best = lane;
    }
    return best;
  };

  return {
    async submit(job) {
      for (;;) {
        if (over()) return;
        const lane = pick(job.size);
        if (lane !== null) {
          lane.take(job);
          return;
        }
        if (!asked) {
          // Only the scan worker's own queue can be full before any helper
          // is asked for, so what it holds and this line pass the threshold.
          asked = true;
          askHelpers();
          continue;
        }
        await changed();
      }
    },

    attach(ports) {
      for (const port of ports) {
        if (over()) port.close();
        else helpers.push(helperLane(port));
      }
      notify();
    },

    async drain() {
      for (;;) {
        if (failed !== null) throw failed.error;
        if (stopped) return;
        if (self.queued === 0 && helpers.every((lane) => lane.queued === 0)) {
          return;
        }
        await changed();
      }
    },

    check() {
      if (failed !== null) throw failed.error;
    },

    stop() {
      if (stopped) return;
      stopped = true;
      for (const end of ends.splice(0)) end();
      notify();
    },
  };
}

/* ------------------------------------------------------------------ *
 * The core
 * ------------------------------------------------------------------ */

export interface ScannerCoreOptions {
  cache: ScanCache;
  /** Defaults to the global `fetch`, looked up at each call. */
  fetch?: typeof fetch;
  /** Let other work in once a slice has run `sliceMs`. */
  yieldNow?: () => Promise<void>;
  now?: () => number;
  /** Where a cold build's helpers come from; none without it. */
  helpers?: HelperSupply;
}

export interface ScannerCore {
  /** Settles once the build has reported `ready` or `failed`, or was cancelled. */
  build(
    request: BuildRequest,
    post: (event: BuildEvent) => void,
  ): Promise<void>;
  cancel(repo: string, seq: number): void;
  /**
   * The ports of the helpers build `seq` of `repo` asked for. A build that is
   * over, or has no use for them, has them closed.
   */
  attachHelpers(repo: string, seq: number, ports: readonly HelperPort[]): void;
  /** The path's scanned entry, with no card blocks in it; `null` when it failed. */
  refresh(request: RefreshRequest): Promise<ScannedEntry | null>;
  cards(request: {
    repo: string;
    apiBase: string;
    want: readonly CardWant[];
    full: boolean;
  }): Promise<CardAnswer[]>;
  quotes(request: {
    repo: string;
    apiBase: string;
    want: readonly QuoteWant[];
  }): Promise<Quotes>;
  /** Settles once the work a build leaves behind, its collection, is done. */
  idle(): Promise<void>;
}

/** What a failed build says when the server answered with an error status. */
const statusMessage = (status: number): string =>
  `Request failed with status code ${status}`;

const NOT_A_HEADER = "The answer's first line was not a planning header";

/** Thrown between lines once a build is cancelled; never reported. */
const CANCELLED = new Error("cancelled");

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A scan result with its card blocks left out: what the main thread gets. */
const withoutCards = (result: ScanResult): ScanResult =>
  result.kind === "planning"
    ? { kind: "planning", document: result.document, cards: [] }
    : result;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface Run {
  seq: number;
  controller: AbortController;
  cancelled: boolean;
  /** Settles with the header's config, or `null` if the build ends without one. */
  header: Deferred<PlanningConfig | null>;
  /** A cold build's scanning pool, from its header on; `null` without helpers. */
  pool: ScanPool | null;
}

export function scannerCore(options: ScannerCoreOptions): ScannerCore {
  const { cache, helpers } = options;
  const fetchNow: typeof fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const yieldNow = options.yieldNow ?? timeoutYield;
  const now = options.now ?? (() => performance.now());

  /** The build in flight per repository. */
  const runs = new Map<string, Run>();
  /** The config of the last header per repository. */
  const configs = new Map<string, PlanningConfig>();
  let background: Promise<void> = Promise.resolve();

  /**
   * The config a file of `repo` is scanned under now: the in-flight build's,
   * once its header arrives, else the last header's. Whether a file is the
   * roadmap is part of its scan, so a refresh sent during a rescan waits for
   * the rescan's header, as it once waited for its batch.
   */
  const configFor = async (repo: string): Promise<PlanningConfig | null> => {
    let run = runs.get(repo);
    while (run !== undefined) {
      const config = await run.header.promise;
      if (config !== null) return config;
      // Ended without a header: a build that superseded it may still have one.
      const next = runs.get(repo);
      run = next === run ? undefined : next;
    }
    return configs.get(repo) ?? null;
  };

  const fetchEntry = async (
    apiBase: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SourceEntry> => {
    const response = await fetchNow(
      `${apiBase}/planning/sources?path=${encodeURIComponent(path)}`,
      { signal },
    );
    if (!response.ok) throw new Error(statusMessage(response.status));
    const entry = parseSourceEntry(await response.json());
    if (entry === null || entry.path !== path) {
      throw new Error("The server's answer for one path was not an entry");
    }
    if (entry.kind === "file" && entry.hash === undefined) {
      throw new Error("The server's answer for one path had no content hash");
    }
    return entry;
  };

  /**
   * Keep one scanned file: a record in the store, or, for the roadmap, which
   * is never stored because the stream never answers `same` for it (§8.1),
   * its blocks in memory.
   */
  const keepScanned = async (
    repo: string,
    config: PlanningConfig,
    path: string,
    hash: string,
    result: ScanResult,
    writer?: CacheWriter,
  ): Promise<void> => {
    if (path === config.roadmap) {
      if (result.kind === "planning") {
        cache.remember(repo, path, hash, result.cards);
      }
      return;
    }
    const record = recordOf(path, hash, result);
    if (writer === undefined) await cache.write(repo, [record]);
    else await writer.add(record);
  };

  /* ---- Build ---- */

  async function runBuild(
    run: Run,
    request: BuildRequest,
    send: (event: BuildEvent) => void,
  ): Promise<void> {
    const { repo, apiBase, bypassCache } = request;
    const stamps = bypassCache ? [] : await cache.stamps(repo);
    if (run.cancelled) return;
    const warm = stamps.length > 0;
    send({ type: "started", warm });

    const stampOf = new Map(stamps.map((stamp) => [stamp.path, stamp]));
    // Read beside the stream, and awaited at the first `same` that needs it.
    const stored: Promise<Map<string, StoredDocument>> = warm
      ? cache.documents(repo)
      : Promise.resolve(new Map());
    // `fromEntries` defines each path as its own key, `__proto__` included.
    const have = Object.fromEntries(stamps.map((s) => [s.path, s.hash]));
    const response = await fetchNow(`${apiBase}/planning/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(warm ? { have } : {}),
      signal: run.controller.signal,
    });
    if (!response.ok) throw new Error(statusMessage(response.status));
    if (response.body === null) throw new StreamError(NOT_A_HEADER, true);

    // Assigned inside the line handler, so held in an object: the compiler
    // does not follow assignments made in a callback.
    const seen: {
      header: Extract<StreamLine, { kind: "header" }> | null;
      ended: boolean;
    } = { header: null, ended: false };
    let done = 0;
    let lastProgress = now();
    let sliceStart = now();
    const keep = new Set<string>();
    const writer = cache.writer(repo);
    const chunk = chunker(send);

    /** One more candidate handled, and progress if it is due. */
    const counted = (): void => {
      done += 1;
      if (now() - lastProgress >= planningLimits.progressMs) {
        lastProgress = now();
        send({
          type: "progress",
          done,
          total: seen.header?.candidateCount ?? 0,
        });
      }
    };

    /** One scanned file, from this thread or a helper: kept, sent, counted. */
    const took = async (
      config: PlanningConfig,
      path: string,
      hash: string,
      result: ScanResult,
    ): Promise<void> => {
      await keepScanned(repo, config, path, hash, result, writer);
      if (path !== config.roadmap) keep.add(path);
      chunk.result(path, hash, result);
      counted();
    };

    const takeEntry = async (
      config: PlanningConfig,
      entry: SourceEntry,
    ): Promise<void> => {
      switch (entry.kind) {
        case "file": {
          const { path, content } = entry;
          const hash = entry.hash ?? "";
          if (run.pool !== null) {
            await run.pool.submit({
              path,
              hash,
              content,
              size: content.length,
            });
          } else {
            await took(
              config,
              path,
              hash,
              scanCandidate(config, path, content),
            );
          }
          return;
        }
        case "skipped":
          chunk.skipped({ path: entry.path, size: entry.size });
          counted();
          return;
        case "unreadable":
          chunk.unreadable({ path: entry.path, reason: entry.reason });
          counted();
          return;
        case "absent":
          // Gone since the listing; the watcher reports its removal.
          counted();
          return;
      }
    };

    /**
     * A file the server says is unchanged. Its stored result is used when it
     * is there under that hash; if another tab collected it meanwhile, or the
     * server named a hash this build never sent, it is read again (§5.2).
     */
    const takeSame = async (
      config: PlanningConfig,
      path: string,
      hash: string,
    ): Promise<void> => {
      const stamp = stampOf.get(path);
      if (stamp?.hash === hash) {
        if (stamp.kind === "not-planning") {
          keep.add(path);
          counted();
          return;
        }
        if (stamp.kind === "unreadable") {
          keep.add(path);
          chunk.unreadable({ path, reason: stamp.reason ?? "" });
          counted();
          return;
        }
        const doc = (await stored).get(path);
        if (doc?.hash === hash) {
          keep.add(path);
          chunk.document(doc.document, hash);
          counted();
          return;
        }
      }
      await takeEntry(
        config,
        await fetchEntry(apiBase, path, run.controller.signal),
      );
    };

    await readLines(response.body, async (text) => {
      if (run.cancelled) throw CANCELLED;
      run.pool?.check();
      if (seen.ended) {
        throw new StreamError("The planning stream went on past its end");
      }
      let line: StreamLine | null;
      try {
        line = parseStreamLine(JSON.parse(text));
      } catch {
        line = null;
      }
      const { header } = seen;
      if (header === null) {
        if (line?.kind !== "header") throw new StreamError(NOT_A_HEADER, true);
        seen.header = line;
        configs.set(repo, line.config);
        run.header.resolve(line.config);
        const { config, candidateCount, refused } = line;
        // Helpers are for a cold build only (§7.5): a warm one scans little.
        const count = helpers === undefined ? 0 : helpersFor(helpers.cores);
        if (!warm && !refused && count > 0) {
          run.pool = scanPool({
            config,
            took: (job, result) => took(config, job.path, job.hash, result),
            yieldNow,
            askHelpers: () => helpers?.ask(repo, run.seq, count),
          });
        }
        send({ type: "header", config, candidateCount, refused });
        return;
      }
      if (line === null) {
        throw new StreamError(
          "The planning stream held a line that is not one of its own",
        );
      }
      const { config } = header;
      switch (line.kind) {
        case "header":
          throw new StreamError("The planning stream sent a second header");
        case "end":
          if (line.candidates !== header.candidateCount) {
            throw new StreamError(
              "The planning stream's end does not match its header",
            );
          }
          seen.ended = true;
          return;
        case "same":
          await takeSame(config, line.path, line.hash);
          break;
        case "file":
          await takeEntry(config, line);
          break;
        case "skipped":
        case "unreadable":
          await takeEntry(config, line);
          break;
      }
      // Each kind has counted itself: a file handed to the pool counts once
      // its result is taken.
      if (now() - sliceStart >= planningLimits.sliceMs) {
        await yieldNow();
        sliceStart = now();
      }
    });

    if (seen.header === null) throw new StreamError(NOT_A_HEADER, true);
    if (!seen.ended) {
      throw new StreamError("The planning stream ended before its end line");
    }
    await run.pool?.drain();
    if (run.cancelled) return;
    const { refused } = seen.header;
    chunk.flush();
    await writer.close();
    if (run.cancelled) return;
    send({ type: "ready" });

    // Once idle: what the stream no longer names is gone. A refused stream
    // names nothing, so it collects nothing (§8.3).
    if (!refused) {
      background = background.then(() => cache.collect(repo, keep));
    }
  }

  return {
    async build(request, post) {
      const { repo, seq } = request;
      const earlier = runs.get(repo);
      if (earlier !== undefined) cancelRun(earlier);
      const run: Run = {
        seq,
        controller: new AbortController(),
        cancelled: false,
        header: deferred(),
        pool: null,
      };
      runs.set(repo, run);
      const send = (event: BuildEvent) => {
        if (!run.cancelled) post(event);
      };
      try {
        await runBuild(run, request, send);
      } catch (error) {
        if (!run.cancelled) {
          send({
            type: "failed",
            message: messageOf(error),
            shape: error instanceof StreamError && error.shape,
          });
        }
      } finally {
        // Its helpers end with it, ready, failed or cancelled (§7.5).
        run.pool?.stop();
        run.header.resolve(null);
        if (runs.get(repo) === run) runs.delete(repo);
      }
    },

    cancel(repo, seq) {
      const run = runs.get(repo);
      if (run?.seq === seq) cancelRun(run);
    },

    attachHelpers(repo, seq, ports) {
      const run = runs.get(repo);
      if (run?.seq === seq && run.pool !== null) run.pool.attach(ports);
      else for (const port of ports) port.close();
    },

    async refresh({ repo, apiBase, path }) {
      try {
        const config = await configFor(repo);
        if (config === null) return null;
        const entry = await fetchEntry(apiBase, path);
        if (entry.kind !== "file") return entry;
        const hash = entry.hash ?? "";
        const result = scanCandidate(config, path, entry.content);
        // Written before it is answered, so a card request that follows the
        // answer finds this version.
        await keepScanned(repo, config, path, hash, result);
        return { kind: "file", path, hash, result: withoutCards(result) };
      } catch {
        return null;
      }
    },

    async cards({ repo, apiBase, want, full }) {
      const answers: CardAnswer[] = new Array(want.length);
      // One read, and at most one fetch, per document version asked about.
      const groups = new Map<string, number[]>();
      want.forEach((item, at) => {
        const key = `${item.hash}\n${item.path}`;
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [at]);
        else group.push(at);
      });

      const answerGroup = async (indexes: number[]): Promise<void> => {
        const first = want[indexes[0] ?? 0];
        if (first === undefined) return;
        const { path, hash } = first;
        const stale = (at: number) => {
          answers[at] = {
            path,
            startLine: want[at]?.startLine ?? 0,
            stale: true,
          };
        };

        const held = await cache.cards(repo, path);
        if (held !== undefined && held.hash !== hash) {
          indexes.forEach(stale);
          return;
        }
        const missing: number[] = [];
        for (const at of indexes) {
          const block = held?.blocks.find(
            (b) => b.startLine === want[at]?.startLine,
          );
          if (block === undefined) missing.push(at);
          else answers[at] = { path, block };
        }
        if (missing.length === 0) return;

        // Not held: evicted, collected, never stored because it is past the
        // card limit, or not in this version of the file at all.
        const entry = await fetchEntry(apiBase, path);
        if (entry.kind !== "file" || entry.hash !== hash) {
          missing.forEach(stale);
          return;
        }
        const config = (await configFor(repo)) ?? DEFAULT_PLANNING_CONFIG;
        const result = scanCandidate(config, path, entry.content);
        if (held === undefined) {
          await keepScanned(repo, config, path, hash, result);
        }
        const blocks = result.kind === "planning" ? result.cards : [];
        for (const at of missing) {
          const startLine = want[at]?.startLine ?? 0;
          const block = blocks.find((b) => b.startLine === startLine);
          if (block === undefined) stale(at);
          else if (!full && block.markdown.length > planningLimits.cardChars) {
            answers[at] = { path, startLine, preview: true };
          } else answers[at] = { path, block };
        }
      };

      await Promise.all([...groups.values()].map(answerGroup));
      return answers;
    },

    async quotes({ apiBase, want }) {
      // The text is fetched, its asked lines kept, and the rest dropped: the
      // main thread never holds a document's text (§10.5).
      const picked = await Promise.all(
        want.map(async ({ path, lines }) => {
          const entry = await fetchEntry(apiBase, path);
          if (entry.kind !== "file") return null;
          const text = entry.content.split("\n");
          const out: Record<number, string> = {};
          for (const line of lines) {
            const at = text[line - 1];
            if (line >= 1 && at !== undefined) out[line] = at;
          }
          return [path, out] as const;
        }),
      );
      return Object.fromEntries(picked.filter((entry) => entry !== null));
    },

    idle: () => background,
  };
}

function cancelRun(run: Run): void {
  run.cancelled = true;
  run.controller.abort();
  run.pool?.stop();
}

/**
 * A build's results gathered into `documents` messages of at most
 * `chunkEntries` entries and `chunkBytes` of facts, measured as the length of
 * their JSON. A single entry larger than that travels alone (§5.2).
 */
function chunker(send: (event: BuildEvent) => void) {
  let docs: { document: PlanningDocument; hash: string }[] = [];
  let unreadable: { path: string; reason: string }[] = [];
  let skipped: { path: string; size: number }[] = [];
  let entries = 0;
  let bytes = 0;

  const flush = (): void => {
    if (entries === 0) return;
    send({ type: "documents", docs, unreadable, skipped });
    docs = [];
    unreadable = [];
    skipped = [];
    entries = 0;
    bytes = 0;
  };

  const add = (size: number, push: () => void): void => {
    const { chunkEntries, chunkBytes } = planningLimits;
    if (entries > 0 && bytes + size > chunkBytes) flush();
    push();
    entries += 1;
    bytes += size;
    if (entries >= chunkEntries || bytes >= chunkBytes) flush();
  };

  const document = (document: PlanningDocument, hash: string): void =>
    add(JSON.stringify(document).length, () => docs.push({ document, hash }));
  const unreadableOne = (entry: { path: string; reason: string }): void =>
    add(JSON.stringify(entry).length, () => unreadable.push(entry));
  const skippedOne = (entry: { path: string; size: number }): void =>
    add(JSON.stringify(entry).length, () => skipped.push(entry));

  return {
    document,
    unreadable: unreadableOne,
    skipped: skippedOne,
    /** A scanned file: a document, an unreadable one, or nothing. */
    result(path: string, hash: string, result: ScanResult): void {
      if (result.kind === "planning") document(result.document, hash);
      else if (result.kind === "unreadable") {
        unreadableOne({ path, reason: result.reason });
      }
    },
    flush,
  };
}

/* ------------------------------------------------------------------ *
 * The worker's messages (§7.2)
 * ------------------------------------------------------------------ */

/** What the main thread sends the scan worker. */
export type WorkerRequest =
  | ({ type: "build" } & BuildRequest)
  | { type: "cancel"; repo: string; seq: number }
  | ({ type: "refresh"; id: number } & RefreshRequest)
  | {
      type: "cards";
      id: number;
      repo: string;
      apiBase: string;
      want: CardWant[];
      full: boolean;
    }
  | {
      type: "quotes";
      id: number;
      repo: string;
      apiBase: string;
      want: QuoteWant[];
    };

/** What the scan worker answers. Every one is plain JSON-able data. */
export type WorkerReply =
  | { type: "build"; repo: string; seq: number; event: BuildEvent }
  | { type: "scanned"; id: number; entry: ScannedEntry | null }
  | { type: "cards"; id: number; answers: CardAnswer[] }
  | { type: "quotes"; id: number; quotes: Quotes }
  /** A cards or quotes request that could not be answered. */
  | { type: "refused"; id: number; message: string };

/** The scan worker's `onmessage`, over `core`, answering through `post`. */
export function scanWorkerHandler(
  core: ScannerCore,
  post: (reply: WorkerReply) => void,
): (request: WorkerRequest) => void {
  const refused = (id: number) => (error: unknown) =>
    post({ type: "refused", id, message: messageOf(error) });
  return (request) => {
    switch (request.type) {
      case "build": {
        const { repo, apiBase, seq, bypassCache } = request;
        void core.build({ repo, apiBase, seq, bypassCache }, (event) =>
          post({ type: "build", repo, seq, event }),
        );
        return;
      }
      case "cancel":
        core.cancel(request.repo, request.seq);
        return;
      case "refresh": {
        const { id, repo, apiBase, seq, path } = request;
        void core
          .refresh({ repo, apiBase, seq, path })
          .then((entry) => post({ type: "scanned", id, entry }));
        return;
      }
      case "cards":
        core
          .cards(request)
          .then(
            (answers) => post({ type: "cards", id: request.id, answers }),
            refused(request.id),
          );
        return;
      case "quotes":
        core
          .quotes(request)
          .then(
            (quotes) => post({ type: "quotes", id: request.id, quotes }),
            refused(request.id),
          );
        return;
    }
  };
}
