/**
 * The ownership map of the planning page (`docs/design/planning-question-state.md`
 * §4, §5): for one reading of the reviews against one scan, which question each
 * comment belongs to, and for the comments that belong to none, why not.
 *
 * It is computed over **every** question of every scanned document — never a
 * filtered or listed subset — so a filter narrows what is shown and never
 * changes who owns a comment. Counts, badges, Copy answers and the unassigned
 * groups all read this one map. It is a pure function of the held scan and the
 * held reviews, memoised on their identity, so a card never rescans.
 *
 * Identity is a directive id that the scan assigns to exactly one question of
 * the document (`PlanningQuestion.id`; a repeated id is assigned to none). A
 * line, a quote or a likeness of words is never identity.
 */
import type { PlanningIndex, PlanningQuestion } from "vantage-md/planning";
import { hasAgentReaction, isPendingForAgent } from "../stores/useReviewStore";
import type { ReviewComment } from "../types";
import type {
  EvidenceByPath,
  ReviewEvidence,
} from "../hooks/usePlanningReviews";

/** Where a comment sits against the scan. */
export type OwnershipKind =
  /** Its id names exactly one question of its document. */
  | "bound"
  /** It carries no question id (a note, a legacy comment, an unproven bind). */
  | "unassigned"
  /** Its id is declared more than once, so it names no single question. */
  | "ambiguous"
  /** Its id is in no directive and nowhere in the document. */
  | "removed"
  /** Its document was not scanned (or the id's fate cannot be read from it). */
  | "unknown"
  /** Its id is in the Decision Ledger's first column and in no directive. */
  | "compacted";

export interface CommentOwnership {
  path: string;
  comment: ReviewComment;
  kind: OwnershipKind;
  /** The question, for `bound`. */
  question?: PlanningQuestion;
  /** Why it is not bound, in plain words; absent for `bound`. */
  reason?: string;
  /**
   * For an unassigned legacy comment: the one question whose unit holds the
   * comment's block, when that block's hash is unique in the whole document
   * and the question's id is unique. The only thing that may be bound
   * automatically (`legacyBindCandidate`); never set for a comment that
   * already names a question.
   */
  candidate?: PlanningQuestion;
  /** The reading the classification rests on, when the map was keyed on one. */
  reading?: ReviewEvidence;
}

export interface OwnershipMap {
  /** Every comment of every scanned-or-held document, by comment id within path. */
  entries: readonly CommentOwnership[];
  /** The pending comments (isPendingForAgent) that are bound, by path. */
  boundPending: ReadonlyMap<string, readonly ReviewComment[]>;
  /** Every comment bound to a question, by `path\nid`. */
  boundBy: ReadonlyMap<string, readonly ReviewComment[]>;
  /**
   * The paths whose reviews and scan are not one reading (no evidence, the
   * document changed while read, or another version than the scan's): their
   * comments are Unknown, and their questions' lifecycle is Unknown.
   */
  unpaired: ReadonlySet<string>;
  /** The comments whose ownership is unresolved, pending ones only. */
  unresolved: Readonly<Record<UnresolvedKind, readonly CommentOwnership[]>>;
}

export type UnresolvedKind =
  "unassigned" | "ambiguous" | "removed" | "unknown" | "compacted";

const UNRESOLVED: readonly UnresolvedKind[] = [
  "unassigned",
  "ambiguous",
  "removed",
  "unknown",
  "compacted",
];

/** Words for a group of unresolved comments. */
export const UNRESOLVED_TITLES: Readonly<Record<UnresolvedKind, string>> = {
  unassigned: "Unassigned",
  ambiguous: "Ambiguous",
  removed: "Removed",
  unknown: "Unknown",
  compacted: "Compacted",
};

/** One comment, placed against its document's scan. */
export function classifyComment(
  path: string,
  comment: ReviewComment,
  document: PlanningIndex["documents"][number] | undefined,
  /** Why the reviews and the scan are not one reading, when they are not. */
  incoherent?: string,
): CommentOwnership {
  const id = comment.question_id;
  if (!id) {
    const candidate =
      document === undefined || incoherent !== undefined
        ? undefined
        : legacyBindCandidate(comment, document);
    return {
      path,
      comment,
      kind: "unassigned",
      reason:
        comment.ownership_reason === "scanner_unavailable"
          ? "the checker is not installed on the server, so ownership is unknown"
          : comment.ownership_reason === "scan_refused"
            ? "the checker refused the scan (too many documents), so ownership is unknown"
            : comment.ownership_reason === "scanner_failed"
              ? "the checker failed on the server, so ownership is unknown"
              : comment.ownership_reason === "scan_raced"
                ? "the document changed while it was checked, so ownership is unknown"
                : "filed without a question id",
      ...(candidate ? { candidate } : {}),
    };
  }
  if (document === undefined) {
    return { path, comment, kind: "unknown", reason: "document not scanned" };
  }
  if (incoherent !== undefined) {
    return { path, comment, kind: "unknown", reason: incoherent };
  }
  const named = document.questions.filter((q) => q.id === id);
  if (named.length === 1) {
    return { path, comment, kind: "bound", question: named[0] };
  }
  if (document.directiveIds.includes(id)) {
    return {
      path,
      comment,
      kind: "ambiguous",
      reason: `id ${id} appears more than once`,
    };
  }
  if (document.ledgerIds.includes(id)) {
    return {
      path,
      comment,
      kind: "compacted",
      reason: `id ${id} is in the Decision Ledger and has no question left`,
    };
  }
  if (document.ids.includes(id)) {
    // Still written in the text, outside any question directive: a ruling
    // recorded elsewhere, which the scan does not parse. Not "removed".
    return {
      path,
      comment,
      kind: "unknown",
      reason: `id ${id} is written in the document but declares no question`,
    };
  }
  return {
    path,
    comment,
    kind: "removed",
    reason: `id ${id} is no longer in the document`,
  };
}

/**
 * The question a legacy comment (no `question_id`) can be bound to without a
 * guess: its anchor's block hash is one block of the whole document (not
 * repeated anywhere), that block lies in exactly one question's unit, and that
 * question's id is unique (`PlanningQuestion.id`, null for a repeated id).
 * Anything else, the usual case after an edit, is undecided and stays
 * Unassigned for a person to attach.
 */
export function legacyBindCandidate(
  comment: ReviewComment,
  document: PlanningIndex["documents"][number],
): PlanningQuestion | undefined {
  const hash = comment.anchor?.block_text_hash;
  if (!hash || !Object.hasOwn(document.blockLines, hash)) return undefined;
  const line = document.blockLines[hash];
  if (line === undefined || line <= 0) return undefined;
  const holding = document.questions.filter(
    (q) => q.unitLine <= line && line <= q.unitEndLine,
  );
  const only = holding.length === 1 ? holding[0] : undefined;
  return only?.id ? only : undefined;
}

/** Why `evidence` and the scan's `hash` are not one reading, or undefined. */
function incoherence(
  evidence: ReviewEvidence | undefined,
  hash: string | undefined,
): string | undefined {
  if (evidence === undefined) return "the reviews carry no reading evidence";
  if (evidence.sample_changed) {
    return "the document changed while its reviews were read";
  }
  if (hash !== undefined && evidence.content_hash !== hash) {
    return "the reviews were read against another version of the document";
  }
  return undefined;
}

/** What keys an ownership map besides the scan and the reviews. */
export interface OwnershipPairing {
  /** The reading each path's reviews came with. */
  evidence: EvidenceByPath;
  /** The content hash of each scanned document (`usePlanningStore` hashes). */
  hashes: Readonly<Record<string, string>>;
}

const memo = new WeakMap<
  object,
  WeakMap<object, WeakMap<object, OwnershipMap>>
>();
const UNPAIRED: object = {};

/**
 * The map for one scan and one set of held reviews. Memoised on the identity
 * of both, so the push-sequence cache that replaces `byPath` on a change is
 * the only thing that recomputes it.
 */
export function ownershipMap(
  index: PlanningIndex,
  byPath: Readonly<Record<string, readonly ReviewComment[]>>,
  pairing?: OwnershipPairing,
): OwnershipMap {
  let byReviews = memo.get(index);
  if (byReviews === undefined) {
    byReviews = new WeakMap();
    memo.set(index, byReviews);
  }
  let inner = byReviews.get(byPath);
  if (inner === undefined) {
    inner = new WeakMap();
    byReviews.set(byPath, inner);
  }
  const keyed = pairing?.evidence ?? UNPAIRED;
  const held = inner.get(keyed);
  if (held !== undefined) return held;
  const documents = new Map(index.documents.map((d) => [d.path, d]));
  const entries: CommentOwnership[] = [];
  const boundPending = new Map<string, ReviewComment[]>();
  const boundBy = new Map<string, ReviewComment[]>();
  const unpaired = new Set<string>();
  const unresolved: Record<UnresolvedKind, CommentOwnership[]> = {
    unassigned: [],
    ambiguous: [],
    removed: [],
    unknown: [],
    compacted: [],
  };
  for (const path of Object.keys(byPath).sort()) {
    const incoherent =
      pairing === undefined
        ? undefined
        : (incoherence(pairing.evidence[path], pairing.hashes[path]) ??
          undefined);
    // A document with no comments and no evidence has no review file: there
    // is nothing to pair with its scan.
    if (
      incoherent !== undefined &&
      !(byPath[path].length === 0 && !pairing?.evidence[path])
    ) {
      unpaired.add(path);
    }
    for (const comment of byPath[path]) {
      const entry = classifyComment(
        path,
        comment,
        documents.get(path),
        incoherent,
      );
      if (pairing?.evidence[path]) entry.reading = pairing.evidence[path];
      entries.push(entry);
      if (entry.kind === "bound" && comment.question_id) {
        const key = `${path}\n${comment.question_id}`;
        const list = boundBy.get(key);
        if (list === undefined) boundBy.set(key, [comment]);
        else list.push(comment);
      }
      if (!isPendingForAgent(comment)) continue;
      if (entry.kind === "bound") {
        const list = boundPending.get(path);
        if (list === undefined) boundPending.set(path, [comment]);
        else list.push(comment);
      } else {
        unresolved[entry.kind].push(entry);
      }
    }
  }
  const built: OwnershipMap = {
    entries,
    boundPending,
    boundBy,
    unpaired,
    unresolved,
  };
  inner.set(keyed, built);
  return built;
}

/** How many pending comments have unresolved ownership, across all groups. */
export function unresolvedCount(map: OwnershipMap): number {
  return UNRESOLVED.reduce((n, k) => n + map.unresolved[k].length, 0);
}

/** A question's factual lifecycle label (§5). */
export type Lifecycle =
  | "Open"
  | "Response saved, waiting for agent"
  | "Agent replied, question still open"
  | "Ruling recorded"
  | "Compacted"
  | "Question removed from document"
  | "Unknown";

/**
 * The label for `question` from its bound comments and the scan. `readable`
 * false (reviews not read, scan limit) is Unknown, never Open. "Compacted" and
 * "Question removed from document" are about ids the scan no longer holds, so
 * `lifecycleFor` says them, not this, which is for a question that is still here.
 */
export function lifecycleOf(
  question: PlanningQuestion,
  bound: readonly ReviewComment[],
  readable = true,
): Lifecycle {
  if (!readable) return "Unknown";
  if (question.state === "answered") return "Ruling recorded";
  if (bound.some(isPendingForAgent)) return "Response saved, waiting for agent";
  if (bound.some((c) => !c.resolved && hasAgentReaction(c))) {
    return "Agent replied, question still open";
  }
  return "Open";
}

/**
 * The pending comments whose ownership is unresolved and that Copy answers
 * does not carry: the ownership map's unresolved groups, less the comments the
 * answers already placed (`placed`: ids of the comments in Copy answers). A
 * comment is therefore in Copy answers or in a group here, never both.
 */
export function unresolvedGroups(
  map: OwnershipMap,
  placed: ReadonlySet<string>,
): Readonly<Record<UnresolvedKind, readonly CommentOwnership[]>> {
  const out = {} as Record<UnresolvedKind, readonly CommentOwnership[]>;
  for (const kind of UNRESOLVED) {
    out[kind] = map.unresolved[kind].filter((e) => !placed.has(e.comment.id));
  }
  return out;
}

/**
 * The text of Copy unassigned requests: each comment with the original quote
 * it was filed on (never rewritten), its document and why it has no question.
 * Separate from Copy answers by design: these are not answers to a question.
 */
export function unassignedRequestsText(
  groups: Readonly<Record<UnresolvedKind, readonly CommentOwnership[]>>,
): string | null {
  const blocks: string[] = [];
  for (const kind of UNRESOLVED) {
    for (const { path, comment, reason } of groups[kind]) {
      const quote = (comment.fallback_text ?? "").trim();
      blocks.push(
        [
          `## ${UNRESOLVED_TITLES[kind]}: ${path}`,
          reason ? `(${reason})` : "",
          quote ? `> ${quote.replace(/\n/g, "\n> ")}` : "",
          `comment_id: ${comment.id}`,
          comment.comment,
        ]
          .filter((l) => l !== "")
          .join("\n"),
      );
    }
  }
  if (blocks.length === 0) return null;
  return `Unassigned requests (not answers to any question):\n\n${blocks.join("\n\n")}`;
}

/**
 * The text a comment filed on `question` quotes as its evidence: the start of
 * the unit as the rendered page reads it (`unitText`, the scanner's), with
 * whitespace collapsed. The server checks it is contained in that same unit.
 */
export function questionQuote(question: PlanningQuestion): string {
  const text = question.unitText.replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, 200).join("");
}

/**
 * The label a card draws for `painted`, read from the **live** scan: the card's
 * id looked up in the document `index` holds now (the same scan `map` was made
 * from), never the question as the card was painted, so a ruling, a removal or
 * a compaction made elsewhere shows at once. `null` for a question with no id,
 * which owns no comments. Unknown, never Open, Removed or Compacted, when the
 * evidence cannot say: the reviews not read or not one reading with the scan,
 * the document absent from the scan, an id declared twice or written outside a
 * directive.
 */
export function lifecycleFor(
  map: OwnershipMap,
  index: PlanningIndex | null,
  painted: PlanningQuestion,
  reviewsRead: boolean,
): Lifecycle | null {
  const id = painted.id;
  if (!id) return null;
  const document = index?.documents.find((d) => d.path === painted.path);
  if (
    !reviewsRead ||
    map.unpaired.has(painted.path) ||
    document === undefined
  ) {
    return "Unknown";
  }
  const named = document.questions.filter((q) => q.id === id);
  if (named.length === 1) {
    return lifecycleOf(
      named[0],
      map.boundBy.get(`${painted.path}\n${id}`) ?? [],
    );
  }
  if (named.length > 1 || document.directiveIds.includes(id)) return "Unknown";
  if (document.ledgerIds.includes(id)) return "Compacted";
  if (document.ids.includes(id)) return "Unknown";
  return "Question removed from document";
}
