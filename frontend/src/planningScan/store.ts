/**
 * The scan store: the storage interface the scan cache is written against
 * (`docs/design/planning-index-at-scale.md` §8.1; the plan coined the name).
 *
 * Six operations, and nothing about policy: which results are kept, when a
 * batch is written, what a failure means and what is collected are all the
 * cache's (`cache.ts`). That keeps the in-memory implementation
 * (`memoryStore.ts`), which the unit tests run the cache over, a few dozen
 * lines, and an IndexedDB one thin enough that the Chromium end-to-end tests,
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
