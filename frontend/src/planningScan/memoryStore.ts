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
 */

import type {
  ScanRecord,
  ScanStamp,
  ScanStore,
  StoredCards,
  StoredDocument,
} from "./store";

interface Held {
  stamp: ScanStamp;
  document?: StoredDocument;
  cards?: StoredCards;
}

export function memoryScanStore(): ScanStore {
  let scanner: string | null = null;
  /** By repository, then by path. */
  const repos = new Map<string, Map<string, Held>>();

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
    async open(scannerId) {
      if (scanner !== scannerId) repos.clear();
      scanner = scannerId;
    },

    stamps: async (repo) =>
      structuredClone(rows(repo).map((held) => held.stamp)),

    documents: async (repo) =>
      structuredClone(
        rows(repo).flatMap((held) =>
          held.document === undefined ? [] : [held.document],
        ),
      ),

    cards: async (repo, path) =>
      structuredClone(repos.get(repo)?.get(path)?.cards),

    async write(repo, records: readonly ScanRecord[]) {
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
      const held = repos.get(repo);
      if (held === undefined) return;
      for (const path of [...held.keys()]) {
        if (!keep.has(path)) held.delete(path);
      }
    },
  };
}
