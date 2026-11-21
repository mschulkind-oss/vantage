/**
 * The last coherent reading of each document the planning page holds
 * (`docs/reference/planning-ownership.md` §5).
 *
 * A reading is coherent when a document's reviews were read against the same
 * version of it as the scan (`readingIncoherence`). Between an edit and the
 * reconcile that follows it, the two disagree. Classifying the comments then
 * would say nothing true, so the page shows the reading it last held whole:
 * that version's scan entry, comments, evidence and hash, in place of the
 * live ones. Cards keep the status they last read and counts keep their last
 * values, and `stale` names the documents shown that way, which is what the
 * card's _· checking_ mark reads.
 *
 * Nothing here decides a layout. It only feeds the ownership map and the
 * card statuses, which are marks and counts.
 */
import type { PlanningIndex } from "vantage-md/planning";
import type {
  EvidenceByPath,
  ReviewEvidence,
  ReviewsByPath,
} from "../hooks/usePlanningReviews";
import { readingIncoherence } from "./questionOwnership";
import type { ReviewComment } from "../types";

type PlanningDocument = PlanningIndex["documents"][number];

/** What the ownership map and the card statuses read. */
export interface Readings {
  index: PlanningIndex | null;
  byPath: ReviewsByPath;
  evidence: EvidenceByPath;
  hashes: Readonly<Record<string, string>>;
  /**
   * The documents whose live reviews and scan are not one reading: shown
   * from the last coherent reading when there is one, and unread otherwise.
   */
  stale: ReadonlySet<string>;
}

interface Held {
  document: PlanningDocument | undefined;
  comments: readonly ReviewComment[];
  evidence: ReviewEvidence;
  hash: string | undefined;
}

const NO_PATHS: ReadonlySet<string> = new Set();

/** One repository's last coherent readings, kept for as long as the page is. */
export class LastCoherent {
  private held = new Map<string, Held>();

  /** The repository whose readings these are; another one starts afresh. */
  readonly repo: string | null;

  constructor(repo: string | null = null) {
    this.repo = repo;
  }

  /**
   * The readings to show for the live `index`, `byPath`, `evidence` and
   * `hashes`. Remembers each coherent one, and replaces each stale one with
   * the last it remembered. Returns the inputs themselves when nothing is
   * stale, so a memo keyed on them still holds.
   */
  take(
    index: PlanningIndex | null,
    byPath: ReviewsByPath,
    evidence: EvidenceByPath,
    hashes: Readonly<Record<string, string>>,
  ): Readings {
    const documents =
      index === null ? null : new Map(index.documents.map((d) => [d.path, d]));
    const stale = new Set<string>();
    const substitute = new Map<string, Held>();
    for (const [path, comments] of Object.entries(byPath)) {
      const read = evidence[path];
      // No comments and no evidence: there is no review file to pair.
      if (read === undefined && comments.length === 0) continue;
      if (readingIncoherence(read, hashes[path]) === undefined) {
        if (read !== undefined) {
          this.held.set(path, {
            document: documents?.get(path),
            comments,
            evidence: read,
            hash: hashes[path],
          });
        }
        continue;
      }
      stale.add(path);
      const last = this.held.get(path);
      if (last !== undefined) substitute.set(path, last);
    }
    if (stale.size === 0) {
      return { index, byPath, evidence, hashes, stale: NO_PATHS };
    }
    if (substitute.size === 0)
      return { index, byPath, evidence, hashes, stale };
    const shownByPath: Record<string, readonly ReviewComment[]> = {
      ...byPath,
    };
    const shownEvidence: Record<string, ReviewEvidence> = { ...evidence };
    const shownHashes: Record<string, string> = { ...hashes };
    for (const [path, last] of substitute) {
      shownByPath[path] = last.comments;
      shownEvidence[path] = last.evidence;
      if (last.hash === undefined) delete shownHashes[path];
      else shownHashes[path] = last.hash;
    }
    const shownIndex =
      index === null
        ? null
        : {
            ...index,
            documents: index.documents.map(
              (d) => substitute.get(d.path)?.document ?? d,
            ),
          };
    return {
      index: shownIndex,
      byPath: shownByPath,
      evidence: shownEvidence,
      hashes: shownHashes,
      stale,
    };
  }
}
