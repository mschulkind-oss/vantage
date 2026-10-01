/**
 * The scan cache (`docs/reference/planning-index.md` §11): each
 * candidate's scan result, kept under the content hash it was scanned from and
 * never used without a matching one, written against a {@link ScanStore}.
 *
 * The policy is all here, so every store is only storage:
 *
 * - **The scanner id and the server id** are the store's owner (§11.2): a
 *   mismatch when it opens clears it, and every read and write checks the
 *   owner again, so results from other code, from a browser with other
 *   Unicode tables, or from another server answering at the same origin are
 *   never read, never sent as `have`, and never written under another's name.
 *   Nothing is read or written until a build has said which server answers
 *   ({@link ScanCache.bind}).
 * - **One write per record**, in transactions of `cacheBatch` records, at most
 *   one of them in flight, overlapped with scanning (§11.3).
 * - **Blocks past `cardChars` are never kept** (§10.4). The page draws a
 *   preview card for such a question, and a request for it in full reads the
 *   file again.
 * - **The first failure turns it off for the tab**, logged once (§11.3). From
 *   then on it holds no stamps, so a build sends no `have`, and the card blocks
 *   of this tab's scans are kept in memory instead, up to `memoryCardChars`,
 *   least recently used first out (§11.4). Every roadmap's blocks are kept
 *   there even with a store, because no roadmap is ever stored.
 *
 * It holds no document text beyond card blocks, and those only in the memory
 * above; everything else is facts.
 */

import type { CardBlock, ScanResult } from "vantage-md/planning";
import { planningLimits } from "./limits";
import type {
  ScanRecord,
  ScanStamp,
  ScanStore,
  StoredCards,
  StoredDocument,
} from "./store";

/**
 * The scanner id's first part: bumped by hand whenever a stored shape
 * changes, so no result of the old shape is ever read as the new one.
 */
export const SCAN_CACHE_SCHEMA = 1;

/**
 * The scanner id (§11.2): the schema, the hash of the source the scan is built
 * from (`virtual:planning-scanner-id`), and the browser's user agent, since
 * the scan's `\p{L}` follows the browser's own Unicode tables.
 */
export function scannerIdOf(sourceHash: string, userAgent: string): string {
  return `${SCAN_CACHE_SCHEMA}:${sourceHash}:${userAgent}`;
}

/** The blocks a result keeps: every one within the card limit. */
export function keptBlocks(blocks: readonly CardBlock[]): CardBlock[] {
  const limit = planningLimits.cardChars;
  return blocks.filter((block) => block.markdown.length <= limit);
}

/** One candidate's scan result as the cache keeps it. */
export function recordOf(
  path: string,
  hash: string,
  result: ScanResult,
): ScanRecord {
  switch (result.kind) {
    case "planning":
      return {
        path,
        hash,
        kind: "planning",
        document: result.document,
        blocks: keptBlocks(result.cards),
      };
    case "unreadable":
      return { path, hash, kind: "unreadable", reason: result.reason };
    case "not-planning":
      return { path, hash, kind: "not-planning" };
  }
}

/** A build's writes: records gathered into batches. */
export interface CacheWriter {
  /**
   * Queue one record. Resolves at once, or, once a batch is full and the one
   * before it is still being written, when that one is done.
   */
  add(record: ScanRecord): Promise<void>;
  /** Write what is queued, and settle when every batch has. */
  close(): Promise<void>;
}

export interface ScanCache {
  /** False from the first failure on, and from the start without a store. */
  readonly enabled: boolean;
  /**
   * Say which server answers at this origin now, by its server id (§11.2), and
   * settle once the store is open for it: cleared first when it held another
   * server's results. Until the first call, and after a call with `null` (the
   * id could not be had), nothing is read or written, as if the cache were
   * off, without turning it off. A change of server also forgets every block
   * held in memory.
   */
  bind(serverId: string | null): Promise<void>;
  /** Every stamp of `repo`; none once the cache is off. */
  stamps(repo: string): Promise<ScanStamp[]>;
  /** Every stored planning document of `repo`, by path. */
  documents(repo: string): Promise<Map<string, StoredDocument>>;
  /** One document's card blocks: from memory, else from the store. */
  cards(repo: string, path: string): Promise<StoredCards | undefined>;
  /**
   * A writer for one build's records. `current` is asked about each record
   * as its batch is handed to the store, not as it is queued, and a record it
   * refuses is dropped: a newer request may have kept its path meanwhile.
   */
  writer(repo: string, current?: (record: ScanRecord) => boolean): CacheWriter;
  /** Write a few records now, in one transaction. */
  write(repo: string, records: readonly ScanRecord[]): Promise<void>;
  /** Hold one document's blocks in memory, and not in the store. */
  remember(repo: string, path: string, hash: string, blocks: CardBlock[]): void;
  /** Delete every stored record of `repo` whose path is not in `keep`. */
  collect(repo: string, keep: ReadonlySet<string>): Promise<void>;
}

const defaultLog = (error: unknown): void => {
  console.warn(
    "[planning] the scan cache is off for this tab, so every build is cold:",
    error,
  );
};

/**
 * The cache over `store`, for results of `scannerId`. With `store` null the
 * cache is off from the start: that is how a context without IndexedDB runs,
 * and never a memory-backed store in its place (§11.4).
 */
export function scanCache(
  store: ScanStore | null,
  scannerId: string,
  log: (error: unknown) => void = defaultLog,
): ScanCache {
  let enabled = store !== null;
  /** The server the store is open for, or opening; `null` for none. */
  let bound: string | null = null;
  /** Settles once the store is open for `bound`. */
  let opened: Promise<void> = Promise.resolve();

  const fail = (error: unknown): void => {
    if (!enabled) return;
    enabled = false;
    log(error);
  };

  /**
   * The store, once it is open for a server and while it works; else `null`.
   * An operation asked for under one server and reached after a change to
   * another is dropped rather than done under the new one.
   */
  const usable = async (): Promise<ScanStore | null> => {
    const server = bound;
    if (store === null || !enabled || server === null) return null;
    await opened;
    return enabled && bound === server ? store : null;
  };

  async function guarded<T>(
    fallback: T,
    op: (store: ScanStore) => Promise<T>,
  ): Promise<T> {
    const open = await usable();
    if (open === null) return fallback;
    try {
      return await op(open);
    } catch (error) {
      fail(error);
      return fallback;
    }
  }

  /* ---- Card blocks in memory ---- */

  interface Remembered extends StoredCards {
    chars: number;
  }
  /** By `repo\npath`, least recently used first. */
  const memory = new Map<string, Remembered>();
  let memoryChars = 0;
  const keyOf = (repo: string, path: string) => `${repo}\n${path}`;

  const forget = (key: string): void => {
    const held = memory.get(key);
    if (held === undefined) return;
    memory.delete(key);
    memoryChars -= held.chars;
  };

  const remember = (
    repo: string,
    path: string,
    hash: string,
    blocks: CardBlock[],
  ): void => {
    const key = keyOf(repo, path);
    forget(key);
    const kept = keptBlocks(blocks);
    const chars = kept.reduce((sum, block) => sum + block.markdown.length, 0);
    const limit = planningLimits.memoryCardChars;
    if (chars > limit) return;
    memory.set(key, { hash, blocks: kept, chars });
    memoryChars += chars;
    for (const [oldest, held] of memory) {
      if (memoryChars <= limit) break;
      memory.delete(oldest);
      memoryChars -= held.chars;
    }
  };

  /** A write that failed keeps its blocks in memory, so none is lost. */
  const write = async (
    repo: string,
    records: readonly ScanRecord[],
  ): Promise<void> => {
    if (records.length === 0) return;
    for (const record of records) forget(keyOf(repo, record.path));
    const written = await guarded(false, async (open) => {
      await open.write(repo, records);
      return true;
    });
    if (written) return;
    for (const { path, hash, blocks } of records) {
      if (blocks !== undefined) remember(repo, path, hash, blocks);
    }
  };

  return {
    get enabled() {
      return enabled;
    },

    bind(serverId) {
      if (store === null || !enabled || serverId === bound) return opened;
      bound = serverId;
      // Nothing one server's scans left here serves another's.
      memory.clear();
      memoryChars = 0;
      if (serverId === null) return opened;
      const owner = { scanner: scannerId, server: serverId };
      // After the open before it, so the two never interleave.
      opened = opened.then(() => store.open(owner)).catch(fail);
      return opened;
    },

    stamps: (repo) => guarded([], (open) => open.stamps(repo)),

    documents: (repo) =>
      guarded(new Map(), async (open) => {
        const rows = await open.documents(repo);
        return new Map(rows.map((row) => [row.path, row]));
      }),

    async cards(repo, path) {
      const key = keyOf(repo, path);
      const held = memory.get(key);
      if (held !== undefined) {
        // Most recently used last.
        memory.delete(key);
        memory.set(key, held);
        return { hash: held.hash, blocks: held.blocks };
      }
      return guarded(undefined, (open) => open.cards(repo, path));
    },

    writer(repo, current = () => true) {
      let batch: ScanRecord[] = [];
      let inFlight: Promise<void> = Promise.resolve();
      const flush = async (): Promise<void> => {
        const records = batch;
        batch = [];
        if (records.length === 0) return;
        await inFlight;
        inFlight = write(repo, records.filter(current));
      };
      return {
        async add(record) {
          batch.push(record);
          if (batch.length >= planningLimits.cacheBatch) await flush();
        },
        async close() {
          await flush();
          await inFlight;
        },
      };
    },

    write,
    remember,

    collect: (repo, keep) =>
      guarded(undefined, (open) => open.collect(repo, keep)),
  };
}
