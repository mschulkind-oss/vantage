/**
 * The scan store: the storage interface the scan cache is written against
 * (`docs/design/planning-index-at-scale.md` §8.1; the plan coined the name),
 * and {@link idbScanStore}, its one production implementation.
 *
 * Six operations, and nothing about policy: which results are kept, when a
 * batch is written, what a failure means and what is collected are all the
 * cache's (`cache.ts`). That keeps the in-memory implementation
 * (`memoryStore.ts`), which the unit tests run the cache over, a few dozen
 * lines, and the IndexedDB one thin enough that the Chromium end-to-end tests,
 * which run it over the real database, cover all of it.
 */

import type { CardBlock, PlanningDocument } from "vantage-md/planning";

/** What one candidate scanned as, under the content hash it was scanned from. */
export interface ScanStamp {
  path: string;
  hash: string;
  kind: "planning" | "not-planning" | "unreadable";
  /** Why the scan could not read it: an `unreadable` stamp's only. */
  reason?: string;
}

/**
 * One candidate's scan result as it is kept: its stamp, and for a planning
 * document its facts and its card blocks. Written together, in one
 * transaction, so the three never disagree.
 */
export interface ScanRecord extends ScanStamp {
  document?: PlanningDocument;
  blocks?: CardBlock[];
}

/** A planning document's stored facts, with the hash they were scanned from. */
export interface StoredDocument {
  path: string;
  hash: string;
  document: PlanningDocument;
}

/** A planning document's stored card blocks, with their hash. */
export interface StoredCards {
  hash: string;
  blocks: CardBlock[];
}

/**
 * Whose results a store holds (§8.2): the scanner id of the code that
 * produced them, and the server id of the server they were read from.
 */
export interface ScanOwner {
  scanner: string;
  server: string;
}

/**
 * What every operation rejects with once the store holds another owner's
 * results than the one it was opened for: another tab, running other code or
 * reading another server, opened it since and cleared it (§8.2).
 */
export const TAKEN_OVER =
  "The scan cache was emptied for another scanner or another server";

/**
 * Per-origin storage of scan results, one record per `[repo, path]`. `repo` is
 * `""` in single-repo mode. Every operation may reject; what a rejection means
 * is the caller's.
 *
 * A store is one connection, as a tab holds one, and several may share one
 * database. Every read and write checks, in its own transaction, that the
 * database still holds this connection's owner, and rejects with
 * {@link TAKEN_OVER} if not: a check made only at `open` would let a tab that
 * opened before another cleared the database go on reading the new owner's
 * results as its own, and writing its own under the new owner's name.
 */
export interface ScanStore {
  /**
   * Open the store for results of `owner`. When the database holds another
   * owner's results, every record is cleared first (§8.2). A store opened
   * again is then this owner's: what it does from then on is checked against
   * it.
   */
  open(owner: ScanOwner): Promise<void>;
  /** Every stamp of one repository. */
  stamps(repo: string): Promise<ScanStamp[]>;
  /** Every planning document of one repository. */
  documents(repo: string): Promise<StoredDocument[]>;
  /** One planning document's card blocks. */
  cards(repo: string, path: string): Promise<StoredCards | undefined>;
  /**
   * Replace each record's path in one transaction. A record that is not a
   * planning document removes whatever facts and blocks its path had.
   */
  write(repo: string, records: readonly ScanRecord[]): Promise<void>;
  /** Delete every record of one repository whose path is not in `keep`. */
  collect(repo: string, keep: ReadonlySet<string>): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * IndexedDB
 * ------------------------------------------------------------------ */

/** The database, one per origin (§8.1). */
export const SCAN_DATABASE = "vantage-planning";
const VERSION = 1;

/** `meta` holds the owner's scanner id under this key. */
export const SCANNER_KEY = "scanner";
/** `meta` holds the owner's server id under this key. */
export const SERVER_KEY = "server";

const META = "meta";
const STAMPS = "stamps";
const DOCUMENTS = "documents";
const CARDS = "cards";
const RECORDS = [STAMPS, DOCUMENTS, CARDS];

/**
 * One repository's keys. Keys are `[repo, path]`, and IndexedDB sorts an array
 * after every string, so `[repo, []]` is past every `[repo, path]`.
 */
const repoRange = (repo: string): IDBKeyRange =>
  IDBKeyRange.bound([repo], [repo, []]);

/**
 * Open the database. A build waits on this, so an open another tab blocks is a
 * failure rather than a wait, and a connection that arrives after it is
 * closed.
 */
const connect = (idb: IDBFactory): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(SCAN_DATABASE, VERSION);
    let refused = false;
    req.onupgradeneeded = () => {
      const created = req.result;
      for (const name of [META, ...RECORDS]) {
        if (!created.objectStoreNames.contains(name)) {
          created.createObjectStore(name);
        }
      }
    };
    req.onsuccess = () => {
      if (refused) req.result.close();
      else resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      refused = true;
      reject(new Error("The scan cache is held open by another tab"));
    };
  });

/**
 * Run one transaction over `stores` and `meta`, and settle when it commits or
 * fails: with what `body`'s returned reader reads, once it has committed.
 *
 * `body` issues requests and returns: a transaction commits once a task ends
 * with none pending, so awaiting anything else inside one would end it, and
 * the next request would throw `TransactionInactiveError`. Anything that reads
 * before it writes does so in a request's `onsuccess`, which still runs inside
 * the transaction.
 *
 * With `owner`, `body` runs only once `meta` has been read and still names
 * it; when it names another, the transaction is aborted and the promise
 * rejects with {@link TAKEN_OVER}. Every transaction here takes `meta`, so they
 * run in the order they were made, and a check made in one sees every open
 * made before it and none made after.
 */
function transact<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  stores: string[],
  owner: ScanOwner | null,
  body: (tx: IDBTransaction) => () => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META, ...stores], mode);
    let read: (() => T) | null = null;
    let refused: Error | null = null;
    const failed = () =>
      reject(
        refused ??
          tx.error ??
          new Error("The scan cache's transaction was aborted"),
      );
    tx.oncomplete = () => {
      if (refused !== null || read === null) failed();
      else resolve(read());
    };
    tx.onerror = failed;
    tx.onabort = failed;
    if (owner === null) {
      read = body(tx);
      return;
    }
    const meta = tx.objectStore(META);
    const scanner = meta.get(SCANNER_KEY);
    const server = meta.get(SERVER_KEY);
    // Requests complete in the order they were made: `scanner` is in.
    server.onsuccess = () => {
      if (scanner.result !== owner.scanner || server.result !== owner.server) {
        refused = new Error(TAKEN_OVER);
        tx.abort();
        return;
      }
      read = body(tx);
    };
  });
}

/**
 * Whether `open` failed on a database this code cannot use, rather than on
 * IndexedDB itself: one at a later version, as a newer Vantage leaves it, or
 * one without a store this code needs.
 */
const unusable = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "VersionError" || name === "NotFoundError";
};

/** Delete the database, which another tab's connection may not hold open. */
const deleteDatabase = (idb: IDBFactory): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(SCAN_DATABASE);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("The scan cache is held open by another tab"));
  });

/**
 * The scan store over IndexedDB: `factory`, or the global `indexedDB`, read
 * when the store first connects. A context without one, or whose browser
 * refuses the database, has `open` reject.
 *
 * - **A database it cannot use is made again.** One at a later version, or
 *   one without a store it needs, would refuse every open on every load until
 *   the reader cleared the site's data; it is only a cache, so `open` deletes
 *   it and opens once more, and rejects only if that fails too (§8.3).
 * - **Every operation checks the owner**, in its own transaction, and touches
 *   no record unless `meta` still holds the owner this store was opened for.
 *   Another tab, on other code or reading another server, may have cleared
 *   the database and stamped its own owner since; this tab's results are then
 *   not that owner's, and that owner's are not this tab's, so the operation
 *   rejects with {@link TAKEN_OVER} instead (§8.2, §8.3).
 */
export function idbScanStore(factory?: IDBFactory): ScanStore {
  let db: IDBDatabase | null = null;
  let owner: ScanOwner | null = null;

  /**
   * One checked transaction. The owner is read when the transaction is made,
   * so one made before an `open` for another owner is checked against the
   * owner it was made under, and runs before that open's clearing.
   */
  const owned = <T>(
    mode: IDBTransactionMode,
    stores: string[],
    body: (tx: IDBTransaction) => () => T,
  ): Promise<T> => {
    if (db === null || owner === null) {
      return Promise.reject(new Error("The scan cache is not open"));
    }
    return transact(db, mode, stores, owner, body);
  };

  const readAll = <T>(store: string, repo: string): Promise<T[]> =>
    owned("readonly", [store], (tx) => {
      const rows = tx.objectStore(store).getAll(repoRange(repo));
      return () => rows.result as T[];
    });

  /** The factory, read here, where a throw is a rejection: some contexts throw on the mere access. */
  const factoryOf = (): IDBFactory => {
    const idb = factory ?? globalThis.indexedDB;
    if (idb === undefined) throw new Error("IndexedDB is not available");
    return idb;
  };

  /** Connect, unless connected, and stamp the database for `next`. */
  const openFor = async (next: ScanOwner): Promise<void> => {
    if (db === null) {
      const opened = await connect(factoryOf());
      // Another tab upgrading or deleting the database asks every connection
      // to close; from then on each operation here rejects.
      opened.onversionchange = () => {
        opened.close();
        if (db === opened) db = null;
      };
      db = opened;
    }
    // Made in this same task as the transaction below, so every check made
    // after this one is against `next`, and runs after its clearing.
    owner = next;
    await transact(db, "readwrite", RECORDS, null, (tx) => {
      const meta = tx.objectStore(META);
      const scanner = meta.get(SCANNER_KEY);
      const server = meta.get(SERVER_KEY);
      server.onsuccess = () => {
        if (scanner.result === next.scanner && server.result === next.server) {
          return;
        }
        for (const name of RECORDS) tx.objectStore(name).clear();
        meta.put(next.scanner, SCANNER_KEY);
        meta.put(next.server, SERVER_KEY);
      };
      return () => undefined;
    });
  };

  return {
    async open(next) {
      try {
        await openFor(next);
      } catch (error) {
        if (!unusable(error)) throw error;
        // Its own connection would block the delete.
        db?.close();
        db = null;
        await deleteDatabase(factoryOf());
        await openFor(next);
      }
    },

    stamps: (repo) => readAll<ScanStamp>(STAMPS, repo),

    async documents(repo) {
      const rows = await readAll<{ hash: string; document: PlanningDocument }>(
        DOCUMENTS,
        repo,
      );
      return rows.map(({ hash, document }) => ({
        path: document.path,
        hash,
        document,
      }));
    },

    cards: (repo, path) =>
      owned("readonly", [CARDS], (tx) => {
        const held = tx.objectStore(CARDS).get([repo, path]);
        return () => held.result as StoredCards | undefined;
      }),

    write: (repo, records) =>
      owned("readwrite", RECORDS, (tx) => {
        const stamps = tx.objectStore(STAMPS);
        const documents = tx.objectStore(DOCUMENTS);
        const cards = tx.objectStore(CARDS);
        for (const { document, blocks, ...stamp } of records) {
          const key = [repo, stamp.path];
          stamps.put(stamp, key);
          if (stamp.kind === "planning" && document !== undefined) {
            documents.put({ hash: stamp.hash, document }, key);
            cards.put({ hash: stamp.hash, blocks: blocks ?? [] }, key);
          } else {
            documents.delete(key);
            cards.delete(key);
          }
        }
        return () => undefined;
      }),

    collect: (repo, keep) =>
      owned("readwrite", RECORDS, (tx) => {
        for (const name of RECORDS) {
          const store = tx.objectStore(name);
          const cursor = store.openKeyCursor(repoRange(repo));
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (at === null) return;
            const [, path] = at.primaryKey as [string, string];
            if (!keep.has(path)) store.delete(at.primaryKey);
            at.continue();
          };
        }
        return () => undefined;
      }),
  };
}
