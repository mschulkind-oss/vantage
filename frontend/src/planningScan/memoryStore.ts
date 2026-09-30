/**
 * The scan store in memory: a test double, and nothing else.
 *
 * It is the in-memory implementation the unit tests run the scan cache over,
 * since jsdom has no IndexedDB. It lives beside the interface rather than in
 * `src/test/`, which `tsc --build` does not check, so the compiler holds it to
 * `ScanStore` exactly as it holds the real one. Nothing in either bundle
 * imports it.
 *
 * **Never a fallback.** A tab whose IndexedDB fails runs with no cache at all
 * (`docs/design/planning-index-at-scale.md` §8.4); a memory-backed one would
 * make its rescans warm, which the design does not do.
 *
 * Every write and read is a `structuredClone`, as IndexedDB's are, so a test
 * cannot pass on a reference the real store would have copied.
 *
 * A store is one connection, as in IndexedDB: several stores over one
 * {@link memoryScanDatabase} are several tabs of one origin, and each checks
 * on every read and write that the database still holds the owner it opened
 * it for (`store.ts`).
 */

import {
  TAKEN_OVER,
  type ScanOwner,
  type ScanRecord,
  type ScanStamp,
  type ScanStore,
  type StoredCards,
  type StoredDocument,
} from "./store";

interface Held {
  stamp: ScanStamp;
  document?: StoredDocument;
  cards?: StoredCards;
}

/** One origin's database, which every store made over it shares. */
export interface MemoryScanDatabase {
  /** Whose results it holds; `null` before any store has opened it. */
  owner: ScanOwner | null;
  /** By repository, then by path. */
  repos: Map<string, Map<string, Held>>;
}

export function memoryScanDatabase(): MemoryScanDatabase {
  return { owner: null, repos: new Map() };
}

const sameOwner = (a: ScanOwner | null, b: ScanOwner | null): boolean =>
  a !== null && b !== null && a.scanner === b.scanner && a.server === b.server;

/** A connection to `database`: a fresh one of its own by default. */
export function memoryScanStore(
  database: MemoryScanDatabase = memoryScanDatabase(),
): ScanStore {
  /** The owner this connection was last opened for. */
  let owner: ScanOwner | null = null;
  const { repos } = database;

  /** Reject, as IndexedDB's store does, unless the owner is still this one's. */
  const checked = (): void => {
    if (owner === null) throw new Error("The scan cache is not open");
    if (!sameOwner(database.owner, owner)) throw new Error(TAKEN_OVER);
  };

  const repoOf = (repo: string): Map<string, Held> => {
    let held = repos.get(repo);
    if (held === undefined) {
      held = new Map();
      repos.set(repo, held);
    }
    return held;
  };

  /** In path order, as IndexedDB's key order returns them. */
  const rows = (repo: string): Held[] =>
    [...(repos.get(repo)?.entries() ?? [])]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, held]) => held);

  return {
    async open(next) {
      const copy = { scanner: next.scanner, server: next.server };
      if (!sameOwner(database.owner, copy)) repos.clear();
      database.owner = copy;
      owner = copy;
    },

    async stamps(repo) {
      checked();
      return structuredClone(rows(repo).map((held) => held.stamp));
    },

    async documents(repo) {
      checked();
      return structuredClone(
        rows(repo).flatMap((held) =>
          held.document === undefined ? [] : [held.document],
        ),
      );
    },

    async cards(repo, path) {
      checked();
      return structuredClone(repos.get(repo)?.get(path)?.cards);
    },

    async write(repo, records: readonly ScanRecord[]) {
      checked();
      const held = repoOf(repo);
      for (const record of structuredClone(records)) {
        const { document, blocks, ...stamp } = record;
        const { path, hash } = stamp;
        held.set(
          path,
          stamp.kind === "planning" && document !== undefined
            ? {
                stamp,
                document: { path, hash, document },
                cards: { hash, blocks: blocks ?? [] },
              }
            : { stamp },
        );
      }
    },

    async collect(repo, keep) {
      checked();
      const held = repos.get(repo);
      if (held === undefined) return;
      for (const path of [...held.keys()]) {
        if (!keep.has(path)) held.delete(path);
      }
    },
  };
}
