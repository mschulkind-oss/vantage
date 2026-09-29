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
 * Per-origin storage of scan results, one record per `[repo, path]`. `repo` is
 * `""` in single-repo mode. Every operation may reject; what a rejection means
 * is the caller's.
 */
export interface ScanStore {
  /**
   * Open the store for results of `scannerId`. When the store holds another
   * scanner's results, every record is cleared first (§8.2).
   */
  open(scannerId: string): Promise<void>;
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

/** `meta` holds the scanner id under this key. */
export const SCANNER_KEY = "scanner";

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

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/**
 * Run `body` in one transaction, and settle when it commits or fails.
 *
 * `body` issues requests and returns: a transaction commits once a task ends
 * with none pending, so awaiting anything else inside one would end it, and
 * the next request would throw `TransactionInactiveError`. Anything that reads
 * before it writes does so in a request's `onsuccess`, which still runs inside
 * the transaction.
 */
function transact(
  db: IDBDatabase,
  stores: string[],
  body: (tx: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error ?? new Error("The scan cache's transaction was aborted"));
    body(tx);
  });
}

/**
 * The scan store over IndexedDB: `factory`, or the global `indexedDB`, read
 * when the store opens. A context without one, or whose browser refuses the
 * database, has `open` reject.
 */
export function idbScanStore(factory?: IDBFactory): ScanStore {
  let db: IDBDatabase | null = null;

  const connection = (): IDBDatabase => {
    if (db === null) throw new Error("The scan cache is not open");
    return db;
  };

  const readAll = <T>(store: string, repo: string): Promise<T[]> =>
    request(
      connection()
        .transaction(store, "readonly")
        .objectStore(store)
        .getAll(repoRange(repo)) as IDBRequest<T[]>,
    );

  return {
    async open(scannerId) {
      // Read here, where a throw is a rejection: some contexts throw on the
      // mere access.
      const idb = factory ?? globalThis.indexedDB;
      if (idb === undefined) throw new Error("IndexedDB is not available");
      const opened = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = idb.open(SCAN_DATABASE, VERSION);
        // A build waits on this, so an open another tab blocks is a failure
        // rather than a wait, and a connection that arrives after it is closed.
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
      // Another tab upgrading the database asks every connection to close.
      opened.onversionchange = () => opened.close();
      db = opened;
      await transact(opened, [META, ...RECORDS], (tx) => {
        const meta = tx.objectStore(META);
        const stored = meta.get(SCANNER_KEY);
        stored.onsuccess = () => {
          if (stored.result === scannerId) return;
          for (const name of RECORDS) tx.objectStore(name).clear();
          meta.put(scannerId, SCANNER_KEY);
        };
      });
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
      request(
        connection()
          .transaction(CARDS, "readonly")
          .objectStore(CARDS)
          .get([repo, path]) as IDBRequest<StoredCards | undefined>,
      ),

    write: (repo, records) =>
      transact(connection(), RECORDS, (tx) => {
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
      }),

    collect: (repo, keep) =>
      transact(connection(), RECORDS, (tx) => {
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
      }),
  };
}
