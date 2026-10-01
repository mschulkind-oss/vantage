/**
 * The scanner's core (`docs/reference/planning-index.md` §8, §10): the
 * planning stream read one line at a time, each candidate scanned once and its
 * result kept in the scan cache, and the answers to refreshes, card requests
 * and quote requests. The scan worker runs it behind `worker.ts`, and the
 * inline client runs it on the main thread; both are thin adapters, so this is
 * the one implementation and the one the unit tests drive.
 *
 * It makes no ordering decision (§8.3). It answers each request, and the
 * planning store decides which answer wins. The one exception is that a build
 * supersedes an earlier build of the same repository, which the store would
 * discard whole anyway: it is cancelled rather than read to its end. What it
 * writes to the cache does follow the store's numbering, so the cache keeps
 * the answer the store keeps (§11.3).
 *
 * A cold build can share its scanning with **helpers** (§10.5): extra workers
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
  isRoadmapPath,
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
  /** `warm`: the cache held at least one result for the repository (§2). */
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
  /**
   * The config of the index the answer is for, which the planning store holds
   * once its index is ready, else the last header the caller relayed for the
   * repository: what the file is scanned under when this core has seen no
   * header of the repository, as a worker made after one died has not
   * (§10.1). A header this core has seen wins over it.
   */
  config?: PlanningConfig | null;
}

/** A card request: see {@link ScannerCore.cards}. */
export interface CardsRequest {
  repo: string;
  apiBase: string;
  want: readonly CardWant[];
  full: boolean;
  /** As a refresh's: the header's config, for a core that has heard none. */
  config?: PlanningConfig;
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
 *   line in it, so the page refreshes the path (§6.5);
 * - `preview`: the block is past `cardChars` and was not asked for in full,
 *   so the page draws a preview card (§6.6).
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
 * its `index.html`, not a broken stream (§15).
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
 * holds the server back instead of anything buffering (§10.3). What is held is
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

/** A yield that lets the page paint: the inline client's (§10.6). */
export const timeoutYield = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A yield that lets the worker's next message in, with none of a nested
 * timer's 4 ms clamp: the scan worker's, so a refresh sent during a build
 * waits at most one slice (§8.3).
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
 * Helpers (§10.5)
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
 * thread for them (§10.5). The core has none without it, as the inline client
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
 * which leaves none on two cores or fewer (§10.5).
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

/**
 * A `file` line as its result is taken back: all of it but its content, which
 * a helper holds once it is handed the line, and the scan worker does not.
 */
interface Handed {
  path: string;
  hash: string;
  /**
   * What it counts against a queue: its content's length in characters. That
   * is near enough what a queued line costs in memory, and it is what the
   * other budgets here count.
   */
  size: number;
}

/** One `file` line to be scanned. */
interface Job extends Handed {
  content: string;
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
  /**
   * The helper attached `at`th, from 0, never loaded, so it will answer
   * nothing: it is handed nothing more, and each line it was handed is read
   * again, by path, since this thread kept none of their content.
   */
  lose(at: number): void;
  /** Settle once every job handed out has its result taken, or throw the first failure. */
  drain(): Promise<void>;
  /** Throw the first failure, if there has been one. */
  check(): void;
  /** End every helper's channel, and drop whatever comes back. */
  stop(): void;
}

/**
 * The pool of one cold build (§10.5). Each job goes to whichever lane has the
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
 * past the queues' caps however slow the cache is. A line handed to a helper
 * is held by that helper alone: the scan worker keeps only what taking its
 * result back needs, so a helper's queue is never held twice (§16). That is
 * also what reads a line again, by path, when its helper turns out never to
 * have loaded (`lose`).
 */
function scanPool(options: {
  config: PlanningConfig;
  took: (job: Handed, result: ScanResult) => Promise<void>;
  /** A lost helper's line, fetched again by path and taken as any entry is. */
  reread: (job: Handed) => Promise<void>;
  yieldNow: () => Promise<void>;
  askHelpers: () => void;
}): ScanPool {
  const { config, took, reread, yieldNow, askHelpers } = options;
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

  const settle = (
    lane: Lane,
    job: Handed,
    result: ScanResult,
  ): Promise<void> => {
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

  interface HelperLane extends Lane {
    /** It never loaded: it is handed nothing more. */
    lost: boolean;
    lose(): void;
  }

  const helpers: HelperLane[] = [];
  /** Lost helpers' lines being read again, not yet handed to a lane. */
  let rereading = 0;
  /**
   * The re-reads, one at a time, so what they hold is one file's content
   * waiting for a lane, as a stream line is (§16).
   */
  let rereads: Promise<void> = Promise.resolve();

  const helperLane = (port: HelperPort): HelperLane => {
    let nextId = 0;
    const sent = new Map<number, Handed>();
    const end = (): void => {
      port.onmessage = null;
      port.close();
    };
    const lane: HelperLane = {
      queued: 0,
      lost: false,
      cap: () => planningLimits.helperQueueBytes,
      take(job) {
        const id = ++nextId;
        lane.queued += job.size;
        // A copy without the content: the job itself would keep it here.
        sent.set(id, { path: job.path, hash: job.hash, size: job.size });
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
      lose() {
        if (lane.lost) return;
        lane.lost = true;
        end();
        const lostJobs = [...sent.values()];
        sent.clear();
        lane.queued = 0;
        for (const job of lostJobs) {
          rereading += 1;
          rereads = rereads
            .then(() => (over() ? undefined : reread(job)))
            .catch(fail)
            .finally(() => {
              rereading -= 1;
              notify();
            });
        }
        notify();
      },
    };
    port.onmessage = ({ data }) => {
      const job = sent.get(data.id);
      if (job === undefined) return;
      sent.delete(data.id);
      if ("error" in data) fail(new Error(data.error));
      else void settle(lane, job, data.result);
    };
    ends.push(end);
    return lane;
  };

  const pick = (size: number): Lane | null => {
    let best: Lane | null = null;
    for (const lane of [...helpers.filter((helper) => !helper.lost), self]) {
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

    lose(at) {
      helpers[at]?.lose();
    },

    async drain() {
      for (;;) {
        if (failed !== null) throw failed.error;
        if (stopped) return;
        if (
          self.queued === 0 &&
          rereading === 0 &&
          helpers.every((lane) => lane.queued === 0)
        ) {
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
  /**
   * The helper at `at` among build `seq`'s ports failed to load: it is handed
   * nothing more, and what it was handed is read again by path (§10.5).
   */
  helperLost(repo: string, seq: number, at: number): void;
  /** The path's scanned entry, with no card blocks in it; `null` when it failed. */
  refresh(request: RefreshRequest): Promise<ScannedEntry | null>;
  cards(request: CardsRequest): Promise<CardAnswer[]>;
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

/**
 * Which request a kept result answers, and so whether it may replace what the
 * cache holds for its path (§11.3):
 *
 * - `build`: a record of build `seq`, queued in its writer;
 * - `refresh`: the answer to refresh `seq`;
 * - `fill`: a card request's read of a file it found nothing kept for. It has
 *   no number of its own, so `seq` is the newest the path had when the
 *   request looked, and it is kept only if nothing newer has been since.
 */
type Keeper =
  | { kind: "build"; seq: number; writer: CacheWriter }
  | { kind: "refresh"; seq: number }
  | { kind: "fill"; seq: number };

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

  /*
   * The request numbers the cache's writes answer (§11.3). The planning store
   * numbers builds and refreshes from one sequence per repository, discards
   * an answer to a request older than the latest build, and lays a refresh
   * newer than a build in flight over that build's index (§8.3). A write is
   * kept only where the store would keep its answer, so the cache ends up
   * holding the version of each file the index on screen holds, whichever
   * answer comes back last.
   */
  /** Per repository, the number of the latest build begun. */
  const floors = new Map<string, number>();
  /** Per repository, per path, the number of the newest refresh kept. */
  const refreshed = new Map<string, Map<string, number>>();

  /** The newest request kept for `path`, as far as this core knows. */
  const newestFor = (repo: string, path: string): number =>
    Math.max(
      floors.get(repo) ?? -Infinity,
      refreshed.get(repo)?.get(path) ?? -Infinity,
    );

  /**
   * Refreshes whose answer has arrived, so that what is left of each is one
   * body read, one scan and one write. A build lets them finish before it
   * scans its next file, so a push made during a build waits for at most one
   * file's scan and its own round trip (§8.3); without that, each of those
   * steps would wait out a scan of its own.
   */
  const ahead = new Set<Promise<unknown>>();
  const letAhead = async (): Promise<void> => {
    while (ahead.size > 0) await Promise.allSettled(ahead);
  };
  /** Let other work in, then let every refresh ahead finish. */
  const pause = async (): Promise<void> => {
    await yieldNow();
    await letAhead();
  };

  /**
   * The config a file of `repo` is scanned under now: the in-flight build's,
   * once its header arrives, else the last header's, else `given`, the one
   * the request carries. Whether a file is a roadmap is part of its scan, and
   * only a header says which files are, so a refresh sent during a rescan
   * waits for the rescan's header, as it once waited for its batch.
   */
  const configFor = async (
    repo: string,
    given?: PlanningConfig | null,
  ): Promise<PlanningConfig | null> => {
    let run = runs.get(repo);
    while (run !== undefined) {
      const config = await run.header.promise;
      if (config !== null) return config;
      // Ended without a header: a build that superseded it may still have one.
      const next = runs.get(repo);
      run = next === run ? undefined : next;
    }
    return configs.get(repo) ?? given ?? null;
  };

  const askEntry = (
    apiBase: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<Response> =>
    fetchNow(`${apiBase}/planning/sources?path=${encodeURIComponent(path)}`, {
      signal,
    });

  const readEntry = async (
    response: Response,
    path: string,
  ): Promise<SourceEntry> => {
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

  const fetchEntry = async (
    apiBase: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SourceEntry> =>
    readEntry(await askEntry(apiBase, path, signal), path);

  /**
   * The server id of the server answering at `apiBase` (§9.5), or `null` when
   * it cannot be had: the build then reads nothing from the cache and writes
   * nothing to it, since a result is never used, or offered as `have`,
   * without knowing which server it came from. A static host's page, or any
   * other answer that is not the id, is `null` too, and the stream that
   * follows fails with its own message.
   */
  const serverIdAt = async (
    apiBase: string,
    signal: AbortSignal,
  ): Promise<string | null> => {
    try {
      const response = await fetchNow(`${apiBase}/planning/server-id`, {
        signal,
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const id =
        typeof body === "object" && body !== null && "server_id" in body
          ? body.server_id
          : undefined;
      return typeof id === "string" && id !== "" ? id : null;
    } catch {
      return null;
    }
  };

  /**
   * Keep one scanned file: a record in the store, or, for a roadmap, which is
   * never stored because the stream never answers `same` for one (§11.1), its
   * blocks in memory. Which files are roadmaps is `isRoadmapPath` of the
   * config, the header's test the server applies too (planning-index.md
   * §4.1). Nothing is kept when a newer request than the one it answers has
   * been kept for its path; a build's record is asked again as its batch is
   * written.
   */
  const keepScanned = async (
    repo: string,
    config: PlanningConfig,
    path: string,
    hash: string,
    result: ScanResult,
    by: Keeper,
  ): Promise<void> => {
    if (newestFor(repo, path) > by.seq) return;
    if (by.kind === "refresh") {
      let paths = refreshed.get(repo);
      if (paths === undefined) {
        paths = new Map();
        refreshed.set(repo, paths);
      }
      paths.set(path, by.seq);
    }
    if (isRoadmapPath(config, path)) {
      if (result.kind === "planning") {
        cache.remember(repo, path, hash, result.cards);
      }
      return;
    }
    const record = recordOf(path, hash, result);
    if (by.kind === "build") await by.writer.add(record);
    else await cache.write(repo, [record]);
  };

  /**
   * What build `seq`'s collection keeps: what its stream named, and every
   * path a newer refresh has kept, such as a file made after the listing.
   * Refreshes no newer are forgotten here, since the build's number now
   * outranks them.
   */
  const keptAfter = (
    repo: string,
    seq: number,
    named: ReadonlySet<string>,
  ): Set<string> => {
    const keep = new Set(named);
    const paths = refreshed.get(repo);
    for (const [path, at] of paths ?? []) {
      if (at > seq) keep.add(path);
      else paths?.delete(path);
    }
    return keep;
  };

  /* ---- Build ---- */

  async function runBuild(
    run: Run,
    request: BuildRequest,
    send: (event: BuildEvent) => void,
  ): Promise<void> {
    const { repo, apiBase, bypassCache } = request;
    // Asked on every build, never remembered: the server at this origin may
    // have changed since the last one, and a `have` built for another server
    // would tell this one every path and hash the other has (§11.2).
    if (cache.enabled) {
      const serverId = await serverIdAt(apiBase, run.controller.signal);
      if (run.cancelled) return;
      await cache.bind(serverId);
    }
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
    const writer = cache.writer(
      repo,
      (record) => newestFor(repo, record.path) <= run.seq,
    );
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
      await keepScanned(repo, config, path, hash, result, {
        kind: "build",
        seq: run.seq,
        writer,
      });
      // A roadmap is never stored, so a build never keeps one: a stored
      // record from before the file became a roadmap is collected.
      if (!isRoadmapPath(config, path)) keep.add(path);
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
     * server named a hash this build never sent, it is read again (§8.2). So
     * is a roadmap, whatever is stored for it: an agreeing server never
     * answers `same` for one, and a stored result is never a roadmap's, so
     * using it would put a plain document where a roadmap belongs (§9.1).
     */
    const takeSame = async (
      config: PlanningConfig,
      path: string,
      hash: string,
    ): Promise<void> => {
      const stamp = isRoadmapPath(config, path) ? undefined : stampOf.get(path);
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
      if (ahead.size > 0) {
        await letAhead();
        if (run.cancelled) throw CANCELLED;
      }
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
        // Helpers are for a cold build only (§10.5): a warm one scans little.
        const count = helpers === undefined ? 0 : helpersFor(helpers.cores);
        if (!warm && !refused && count > 0) {
          run.pool = scanPool({
            config,
            took: (job, result) => took(config, job.path, job.hash, result),
            reread: async (job) =>
              takeEntry(
                config,
                await fetchEntry(apiBase, job.path, run.controller.signal),
              ),
            yieldNow: pause,
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
    // names nothing, so it collects nothing (§11.3).
    if (!refused) {
      background = background.then(() =>
        cache.collect(repo, keptAfter(repo, run.seq, keep)),
      );
    }
  }

  return {
    async build(request, post) {
      const { repo, seq } = request;
      const earlier = runs.get(repo);
      if (earlier !== undefined) cancelRun(earlier);
      // From here on an answer to an older request is one the store discards.
      floors.set(repo, Math.max(floors.get(repo) ?? -Infinity, seq));
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
        // Its helpers end with it, ready, failed or cancelled (§10.5).
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

    helperLost(repo, seq, at) {
      const run = runs.get(repo);
      if (run?.seq === seq) run.pool?.lose(at);
    },

    async refresh({ repo, apiBase, seq, path, config: given }) {
      try {
        const config = await configFor(repo, given);
        if (config === null) return null;
        const response = await askEntry(apiBase, path);
        const rest = (async (): Promise<ScannedEntry> => {
          const entry = await readEntry(response, path);
          if (entry.kind !== "file") return entry;
          const hash = entry.hash ?? "";
          const result = scanCandidate(config, path, entry.content);
          // Written before it is answered, so a card request that follows
          // the answer finds this version.
          await keepScanned(repo, config, path, hash, result, {
            kind: "refresh",
            seq,
          });
          return { kind: "file", path, hash, result: withoutCards(result) };
        })();
        ahead.add(rest);
        try {
          return await rest;
        } finally {
          ahead.delete(rest);
        }
      } catch {
        return null;
      }
    },

    async cards({ repo, apiBase, want, full, config: given }) {
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

        const since = newestFor(repo, path);
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
        const config =
          (await configFor(repo, given)) ?? DEFAULT_PLANNING_CONFIG;
        const result = scanCandidate(config, path, entry.content);
        if (held === undefined) {
          await keepScanned(repo, config, path, hash, result, {
            kind: "fill",
            seq: since,
          });
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
      // main thread never holds a document's text (§6.7).
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
 * their JSON. A single entry larger than that travels alone (§8.2).
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
 * The worker's messages (§10.2)
 * ------------------------------------------------------------------ */

/** What the main thread sends the scan worker. */
export type WorkerRequest =
  | ({ type: "build" } & BuildRequest)
  | { type: "cancel"; repo: string; seq: number }
  /** The helpers a build asked for: one port each, transferred (§10.5). */
  | { type: "helpers"; repo: string; seq: number; ports: HelperPort[] }
  /**
   * The helper whose port was `at`, counted from 0 in the order this build's
   * ports were sent, failed to load: it will answer nothing (§10.5).
   */
  | { type: "helper-lost"; repo: string; seq: number; at: number }
  | ({ type: "refresh"; id: number } & RefreshRequest)
  | ({ type: "cards"; id: number; want: CardWant[] } & CardsRequest)
  | {
      type: "quotes";
      id: number;
      repo: string;
      apiBase: string;
      want: QuoteWant[];
    };

/** What the scan worker answers. Every one is plain JSON-able data. */
export type WorkerReply =
  /**
   * Posted once, as the worker's code finishes loading, by the scan worker
   * and by a helper alike: a worker that fails before it has said this could
   * not be created (§10.1, §10.5).
   */
  | { type: "hello" }
  | { type: "build"; repo: string; seq: number; event: BuildEvent }
  /** Make `count` helpers for this build, and send back their ports. */
  | { type: "helpers"; repo: string; seq: number; count: number }
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
      case "helpers":
        core.attachHelpers(request.repo, request.seq, request.ports);
        return;
      case "helper-lost":
        core.helperLost(request.repo, request.seq, request.at);
        return;
      case "refresh": {
        const { id, repo, apiBase, seq, path, config } = request;
        void core
          .refresh({ repo, apiBase, seq, path, config })
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
