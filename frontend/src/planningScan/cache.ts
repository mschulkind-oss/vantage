/**
 * The scan cache (`docs/design/planning-index-at-scale.md` §8): each
 * candidate's scan result, kept under the content hash it was scanned from and
 * never used without a matching one, written against a {@link ScanStore}.
 *
 * The policy is all here, so every store is only storage:
 *
 * - **The scanner id** is checked when the store opens, and a mismatch clears
 *   it (§8.2): results from other code, or from a browser with other Unicode
 *   tables, are never read.
 * - **One write per record**, in transactions of `cacheBatch` records, at most
 *   one of them in flight, overlapped with scanning (§8.3).
 * - **Blocks past `cardChars` are never kept** (§7.4). The page draws a
 *   preview card for such a question, and a request for it in full reads the
 *   file again.
 * - **The first failure turns it off for the tab**, logged once (§8.3). From
 *   then on it holds no stamps, so a build sends no `have`, and the card blocks
 *   of this tab's scans are kept in memory instead, up to `memoryCardChars`,
 *   least recently used first out (§8.4). The roadmap's blocks are kept there
 *   even with a store, because the roadmap is never stored.
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
 * The scanner id (§8.2): the schema, the hash of the source the scan is built
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
  /** Every stamp of `repo`; none once the cache is off. */
  stamps(repo: string): Promise<ScanStamp[]>;
  /** Every stored planning document of `repo`, by path. */
  documents(repo: string): Promise<Map<string, StoredDocument>>;
  /** One document's card blocks: from memory, else from the store. */
  cards(repo: string, path: string): Promise<StoredCards | undefined>;
  /** A writer for one build's records. */
  writer(repo: string): CacheWriter;
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
 * and never a memory-backed store in its place (§8.4).
 */
export function scanCache(
  store: ScanStore | null,
  scannerId: string,
  log: (error: unknown) => void = defaultLog,
): ScanCache {
  let enabled = store !== null;
  let opened: Promise<void> | null = null;

  const fail = (error: unknown): void => {
    if (!enabled) return;
    enabled = false;
    log(error);
  };

  /** The store, once it is open and while it works; else `null`. */
  const usable = async (): Promise<ScanStore | null> => {
    if (store === null || !enabled) return null;
    opened ??= store.open(scannerId).catch(fail);
    await opened;
    return enabled ? store : null;
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

    writer(repo) {
      let batch: ScanRecord[] = [];
      let inFlight: Promise<void> = Promise.resolve();
      const flush = async (): Promise<void> => {
        const records = batch;
        batch = [];
        if (records.length === 0) return;
        await inFlight;
        inFlight = write(repo, records);
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
