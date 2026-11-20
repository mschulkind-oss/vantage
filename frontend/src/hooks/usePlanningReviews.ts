/**
 * The review comments of the documents the planning page lists
 * (`docs/reference/planning-index.md` §6.6, §6.7 and §9.3).
 *
 * The page shows the comments already filed on each question, and hands every
 * pending one to the agent with Copy answers. It stores nothing of its own:
 * the comments are the ones Vantage already keeps, read many documents at a
 * time with `POST …/planning/reviews`, whose answer holds each document's
 * review exactly as `GET /review?path=` returns it. A visit makes at most two
 * of those requests: its page inputs ask for the documents of the pages it
 * shows, and once they have painted, one more asks for every other listed
 * document (`usePlanningPageInputs.ts`). A `review_changed` push still fetches
 * its one document again with a single-path `POST …/planning/reviews` (which, unlike
 * `GET /review`, carries the reading the pair is keyed on), and so does a push of
 * the document itself, whose edit leaves its held reviews paired with the version
 * before it: the planning store counts both in `reviewEpoch`, for every document
 * and not only the one on screen, which is why the page can follow them.
 *
 * What was read is kept by repository for the tab, outside any component, so
 * a page returned to, or prefetched from the viewer, renders its comments in
 * the same commit as its cards. Each visit reads every listed document again
 * once, in its second request, which heals a push the socket missed.
 *
 * Not the review store, which holds one document — the one the viewer is on —
 * and resets itself on every switch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { create } from "zustand";
import { usePlanningStore } from "../stores/usePlanningStore";
import { isStaticMode } from "../lib/staticMode";
import type { ReviewComment, ReviewData } from "../types";

/** Comments by path, for one repository. */
export type ReviewsByPath = Readonly<Record<string, readonly ReviewComment[]>>;

/**
 * What a `planning/reviews` entry says its reading was made against
 * (`docs/design/planning-question-state.md` §4): the server boot, the
 * document's generation and content hash, the review's mutation revision, and
 * whether the document changed while the batch was read (`sample_changed`:
 * the pair is then not coherent).
 */
export interface ReviewEvidence {
  boot_id: string;
  document_generation: number;
  content_hash: string;
  mutation_revision: number;
  sample_changed: boolean;
}

/** Evidence by path, for one repository. */
export type EvidenceByPath = Readonly<Record<string, ReviewEvidence>>;

export interface PlanningReviews {
  /** Each listed document's comments, by path; absent until its first answer. */
  byPath: ReviewsByPath;
  /**
   * The evidence each held answer came with, by path. Absent for a path whose
   * answer carried none, which reads as an unknown pairing.
   */
  evidence: EvidenceByPath;
  /** Every listed document has an answer, so every count is exact. */
  known: boolean;
  /**
   * The last request for the listed documents failed, and some still have no
   * answer, so the counts stay unknown until something asks again: a push, or
   * a comment filed here.
   */
  failed: boolean;
  /**
   * Take the review the server just returned for `path` — a filed comment's
   * echo — so the page shows it without waiting for the push. Any request for
   * `path` still in flight is older than this and is discarded.
   */
  adopt(path: string, data: ReviewData | null): void;
}

/** A repository's API base, as the planning store keys repositories. */
const getApiBase = (repo: string): string =>
  repo === "" ? "/api" : `/api/r/${encodeURIComponent(repo)}`;

const NONE: readonly ReviewComment[] = [];
const EMPTY: ReviewsByPath = {};
const EMPTY_EVIDENCE: EvidenceByPath = {};

/** What renders: every repository's reviews read this tab, by path. */
const useHeldReviews = create<{
  byRepo: Readonly<Record<string, ReviewsByPath>>;
  evidenceByRepo: Readonly<Record<string, EvidenceByPath>>;
}>(() => ({ byRepo: {}, evidenceByRepo: {} }));

/** One repository's request bookkeeping; nothing renders from it. */
interface Book {
  /**
   * Per path, what its held answer was read at: the path's `review_changed`
   * count then, and the time the request was sent.
   */
  read: Map<string, { epoch: number; at: number }>;
  /** Per path, the number of the latest request or adoption. */
  seq: Map<string, number>;
  /** Per path, the request under way for it: true once it has answered. */
  inflight: Map<string, Promise<boolean>>;
}

const books = new Map<string, Book>();

function bookOf(repo: string): Book {
  let book = books.get(repo);
  if (book === undefined) {
    book = { read: new Map(), seq: new Map(), inflight: new Map() };
    books.set(repo, book);
  }
  return book;
}

/** Whether `path` was read by a request sent at or after `since`. */
function readSince(book: Book, path: string, since: number): boolean {
  const read = book.read.get(path);
  return read !== undefined && read.at >= since;
}

const epochOf = (repo: string, path: string): number =>
  usePlanningStore.getState().reviewEpoch[`${repo}\n${path}`] ?? 0;

/**
 * Whether `incoming` is a reading older than `held`: the same server boot
 * (another boot's numbers are never compared) with a lower document
 * generation, or the same generation and a lower mutation revision.
 */
export function isOlderReading(
  incoming: ReviewEvidence,
  held: ReviewEvidence,
): boolean {
  if (incoming.boot_id !== held.boot_id) return false;
  return incoming.document_generation !== held.document_generation
    ? incoming.document_generation < held.document_generation
    : incoming.mutation_revision < held.mutation_revision;
}

const NO_PATHS: ReadonlySet<string> = new Set();

/**
 * Hold `entries` and the `evidence` they were read with. An entry whose
 * evidence is older than the held reading of its path is dropped, so an
 * out-of-order answer never rolls a document back.
 */
function hold(
  repo: string,
  entries: Record<string, readonly ReviewComment[]>,
  evidence: Record<string, ReviewEvidence | null> = {},
  unreviewed: ReadonlySet<string> = NO_PATHS,
) {
  useHeldReviews.setState((state) => {
    const heldEvidence = state.evidenceByRepo[repo] ?? EMPTY_EVIDENCE;
    const taken: Record<string, readonly ReviewComment[]> = {};
    const takenEvidence: Record<string, ReviewEvidence> = { ...heldEvidence };
    for (const [path, comments] of Object.entries(entries)) {
      const incoming = evidence[path];
      const before = heldEvidence[path];
      if (incoming && before && isOlderReading(incoming, before)) continue;
      // An answer that names no reading cannot show it is newer than the held one.
      // A good answer that leaves the path out says the server has no review
      // for it now (deleted), which is news, not a missing reading.
      if (!incoming && before && !unreviewed.has(path)) continue;
      taken[path] = comments;
      if (incoming) takenEvidence[path] = incoming;
      else delete takenEvidence[path];
    }
    return {
      byRepo: {
        ...state.byRepo,
        [repo]: { ...(state.byRepo[repo] ?? EMPTY), ...taken },
      },
      evidenceByRepo: { ...state.evidenceByRepo, [repo]: takenEvidence },
    };
  });
}

/** Forget every repository's reviews. For tests. */
export function resetPlanningReviews(): void {
  books.clear();
  resetRetries();
  useHeldReviews.setState({ byRepo: {}, evidenceByRepo: {} });
}

/** The reviews held for `repo` now, by path. */
export function planningReviewsOf(repo: string): ReviewsByPath {
  return useHeldReviews.getState().byRepo[repo] ?? EMPTY;
}

function evidenceIn(value: unknown): ReviewEvidence | null {
  const e = value as Partial<ReviewEvidence> | null | undefined;
  return typeof e?.boot_id === "string" &&
    typeof e.document_generation === "number" &&
    typeof e.content_hash === "string" &&
    typeof e.mutation_revision === "number" &&
    typeof e.sample_changed === "boolean"
    ? (e as ReviewEvidence)
    : null;
}

/** The sent paths a good answer left out: the server has no review for them. */
function unreviewedIn(
  sent: readonly { path: string }[],
  answered: ReadonlyMap<string, unknown>,
): ReadonlySet<string> {
  return new Set(sent.map((s) => s.path).filter((p) => !answered.has(p)));
}

interface AnsweredReview {
  review: ReviewData;
  evidence: ReviewEvidence | null;
}

/** Whether `data` is the reviews answer's shape: `{reviews: [{path, review}]}`. */
function reviewsIn(data: unknown): Map<string, AnsweredReview> | null {
  const reviews = (data as { reviews?: unknown } | null)?.reviews;
  if (!Array.isArray(reviews)) return null;
  const out = new Map<string, AnsweredReview>();
  for (const entry of reviews) {
    const { path, review, evidence } = (entry ?? {}) as {
      path?: unknown;
      review?: { comments?: unknown } | null;
      evidence?: unknown;
    };
    if (typeof path !== "string" || !Array.isArray(review?.comments)) {
      return null;
    }
    out.set(path, {
      review: review as ReviewData,
      evidence: evidenceIn(evidence),
    });
  }
  return out;
}

/**
 * Read the reviews of `paths` in `repo` with one `POST …/planning/reviews`:
 * every path not held, or held from a request sent before `since` (a
 * `performance.now()` time), and not already being read. A path already being
 * read is waited for rather than asked twice.
 *
 * Resolves `true` once every path has an answer, and `false` when a request
 * failed; what was held before stays held. Nothing is asked in a static
 * export, which has no review endpoint.
 */
export function fetchPlanningReviews(
  repo: string,
  paths: readonly string[],
  since = Number.NEGATIVE_INFINITY,
): Promise<boolean> {
  if (isStaticMode()) return Promise.resolve(false);
  const book = bookOf(repo);
  const waiting: Promise<boolean>[] = [];
  const asked: string[] = [];
  for (const path of new Set(paths)) {
    const underway = book.inflight.get(path);
    if (underway !== undefined) waiting.push(underway);
    else if (!readSince(book, path, since)) asked.push(path);
  }
  if (asked.length > 0) {
    const at = performance.now();
    const sent = asked.map((path) => {
      const seq = (book.seq.get(path) ?? 0) + 1;
      book.seq.set(path, seq);
      return { path, seq, epoch: epochOf(repo, path) };
    });
    // Off the books before its answer is held, so a push that landed while
    // it was out is read again by the render the answer causes.
    const settle = () => {
      for (const path of asked) {
        if (book.inflight.get(path) === request) book.inflight.delete(path);
      }
    };
    const request: Promise<boolean> = (async () => {
      let answered: Map<string, AnsweredReview> | null;
      try {
        const { data } = await axios.post<unknown>(
          `${getApiBase(repo)}/planning/reviews`,
          { paths: asked },
        );
        answered = reviewsIn(data);
      } catch {
        answered = null;
      }
      settle();
      // A failure is a real one: a path with no review is left out of a good
      // answer, not failed. It is read again by the retry.
      if (answered === null) {
        noteFailure(repo, asked);
        return false;
      }
      noteSuccess(repo, asked);
      const entries: Record<string, readonly ReviewComment[]> = {};
      const evidence: Record<string, ReviewEvidence | null> = {};
      for (const { path, seq, epoch } of sent) {
        if (book.seq.get(path) !== seq) continue;
        entries[path] = answered.get(path)?.review.comments ?? NONE;
        evidence[path] = answered.get(path)?.evidence ?? null;
        book.read.set(path, { epoch, at });
      }
      hold(repo, entries, evidence, unreviewedIn(sent, answered));
      return true;
    })();
    for (const path of asked) book.inflight.set(path, request);
    waiting.push(request);
  }
  return Promise.all(waiting).then((all) => all.every(Boolean));
}

/** What the last Reload from server did, for one repository. */
export interface ReloadStatus {
  /** `Date.now()` of the last answered reload, or null. */
  lastSuccessAt: number | null;
  /** `Date.now()` of the last reload whose request failed, or null. */
  lastFailureAt: number | null;
  /** The last answered reload saw a document change while it was read. */
  sampleChanged: boolean;
  running: boolean;
}

const NO_RELOAD: ReloadStatus = {
  lastSuccessAt: null,
  lastFailureAt: null,
  sampleChanged: false,
  running: false,
};

/** Reload status by repository; renders the header's Unknown pill. */
export const useReloadStatus = create<{
  byRepo: Readonly<Record<string, ReloadStatus>>;
}>(() => ({ byRepo: {} }));

const noteReload = (repo: string, change: Partial<ReloadStatus>) =>
  useReloadStatus.setState((state) => ({
    byRepo: {
      ...state.byRepo,
      [repo]: { ...(state.byRepo[repo] ?? NO_RELOAD), ...change },
    },
  }));

/** The reload status of `repo` (`null` for none yet asked). */
export const useReloadStatusOf = (repo: string | null): ReloadStatus =>
  useReloadStatus((state) =>
    repo === null ? NO_RELOAD : (state.byRepo[repo] ?? NO_RELOAD),
  );

/** A failed reconcile's first retry, after 1 s; it doubles from there. */
export const RECONCILE_RETRY_MIN_MS = 1000;
/** The longest wait between retries, as a comment box's save waits. */
export const RECONCILE_RETRY_MAX_MS = 30_000;
/** How long reads may fail before the page says it is offline (§4.6). */
export const OFFLINE_AFTER_MS = 30_000;

/**
 * Page freshness, as far as reading reviews goes, for one repository
 * (`docs/design/planning-page-freshness.md` §4.1): whether its reads are
 * failing, since when, and whether they have failed long enough that the
 * page says it is offline.
 */
export interface Freshness {
  /** `Date.now()` of the first failed read not since followed by a good one. */
  failingSince: number | null;
  /** Reads have failed for `OFFLINE_AFTER_MS`: the header says so, once. */
  offline: boolean;
}

const CURRENT: Freshness = { failingSince: null, offline: false };

/** Freshness by repository; renders the header's offline line. */
export const usePlanningFreshness = create<{
  byRepo: Readonly<Record<string, Freshness>>;
}>(() => ({ byRepo: {} }));

/** The freshness of `repo` now. */
export const freshnessOf = (repo: string): Freshness =>
  usePlanningFreshness.getState().byRepo[repo] ?? CURRENT;

/** The freshness of `repo` (`null`: none asked, so current). */
export const useFreshnessOf = (repo: string | null): Freshness =>
  usePlanningFreshness((state) =>
    repo === null ? CURRENT : (state.byRepo[repo] ?? CURRENT),
  );

const setFreshness = (repo: string, freshness: Freshness) =>
  usePlanningFreshness.setState((state) => ({
    byRepo: { ...state.byRepo, [repo]: freshness },
  }));

/** One repository's retry: what waits to be read again, and when. */
interface Retry {
  paths: Set<string>;
  delay: number;
  timer: ReturnType<typeof setTimeout> | null;
  offlineTimer: ReturnType<typeof setTimeout> | null;
}

const retries = new Map<string, Retry>();

function retryOf(repo: string): Retry {
  let retry = retries.get(repo);
  if (retry === undefined) {
    retry = {
      paths: new Set(),
      delay: RECONCILE_RETRY_MIN_MS,
      timer: null,
      offlineTimer: null,
    };
    retries.set(repo, retry);
  }
  return retry;
}

/** Read `paths` of `repo` again once the retry's wait is up. */
function retryLater(repo: string, paths: Iterable<string>): void {
  const retry = retryOf(repo);
  for (const path of paths) retry.paths.add(path);
  if (retry.timer !== null || retry.paths.size === 0) return;
  const delay = retry.delay;
  retry.delay = Math.min(delay * 2, RECONCILE_RETRY_MAX_MS);
  retry.timer = setTimeout(() => {
    retry.timer = null;
    void retryPlanningReviews(repo);
  }, delay);
}

/** A read of `paths` failed: retry them, and start the offline deadline. */
function noteFailure(repo: string, paths: Iterable<string>): void {
  if (freshnessOf(repo).failingSince === null) {
    const since = Date.now();
    setFreshness(repo, { failingSince: since, offline: false });
    const retry = retryOf(repo);
    if (retry.offlineTimer !== null) clearTimeout(retry.offlineTimer);
    retry.offlineTimer = setTimeout(() => {
      retry.offlineTimer = null;
      if (freshnessOf(repo).failingSince === since) {
        setFreshness(repo, { failingSince: since, offline: true });
      }
    }, OFFLINE_AFTER_MS);
  }
  retryLater(repo, paths);
}

/**
 * A read of `read` was answered: the page is not offline, and those paths no
 * longer wait. What still waits for a retry goes now, since the server is
 * answering again.
 */
function noteSuccess(repo: string, read: Iterable<string>): void {
  if (freshnessOf(repo).failingSince !== null) setFreshness(repo, CURRENT);
  const retry = retries.get(repo);
  if (retry === undefined) return;
  for (const path of read) retry.paths.delete(path);
  if (retry.offlineTimer !== null) clearTimeout(retry.offlineTimer);
  retry.offlineTimer = null;
  retry.delay = RECONCILE_RETRY_MIN_MS;
  if (retry.timer !== null) {
    clearTimeout(retry.timer);
    retry.timer = null;
    if (retry.paths.size > 0) void retryPlanningReviews(repo);
  }
}

/** Stop every retry and forget every repository's freshness. For tests. */
function resetRetries(): void {
  for (const retry of retries.values()) {
    if (retry.timer !== null) clearTimeout(retry.timer);
    if (retry.offlineTimer !== null) clearTimeout(retry.offlineTimer);
  }
  retries.clear();
  usePlanningFreshness.setState({ byRepo: {} });
}

/**
 * Retry now: read at once every path a failed read left waiting for `repo`.
 * Resolves as `reconcilePlanningReviews` does; `"adopted"` when nothing waits.
 */
export function retryPlanningReviews(
  repo: string,
): Promise<"adopted" | "changed" | "failed"> {
  return reconcilePlanningReviews(repo, []);
}

/**
 * Reconcile (`docs/design/planning-page-freshness.md` §4.4): read every path's
 * review in one request regardless of what is held (requests in flight are
 * discarded), together with every path a failed read left waiting, adopt the
 * answer through `hold`, which refuses an older document generation of the
 * same boot, and ask for a rescan. An answer from another boot id discards
 * everything held for the repository first, and rescans without the cache.
 *
 * A failed request is retried after 1 s, doubling to 30 s, indefinitely, and
 * 30 s of failure calls the page offline (`useFreshnessOf`); the first good
 * answer clears it. A path read while its document changed is read again
 * after the same wait. Never touches an edit buffer or a painted body: what
 * it changes is marks and counts, never a layout.
 */
export async function reconcilePlanningReviews(
  repo: string,
  paths: readonly string[],
): Promise<"adopted" | "changed" | "failed"> {
  if (isStaticMode()) return "failed";
  const book = bookOf(repo);
  const retry = retries.get(repo);
  const waiting = retry === undefined ? [] : [...retry.paths];
  if (retry !== undefined) {
    retry.paths.clear();
    if (retry.timer !== null) clearTimeout(retry.timer);
    retry.timer = null;
  }
  const listed = [...new Set([...paths, ...waiting])].sort();
  if (listed.length === 0) return "adopted";
  noteReload(repo, { running: true });
  const sent = listed.map((path) => {
    const seq = (book.seq.get(path) ?? 0) + 1;
    book.seq.set(path, seq);
    return { path, seq, epoch: epochOf(repo, path) };
  });
  const at = performance.now();
  let answered: Map<string, AnsweredReview> | null;
  try {
    const { data } = await axios.post<unknown>(
      `${getApiBase(repo)}/planning/reviews`,
      { paths: listed },
    );
    answered = reviewsIn(data);
  } catch {
    answered = null;
  }
  if (answered === null) {
    noteReload(repo, { lastFailureAt: Date.now(), running: false });
    noteFailure(repo, listed);
    return "failed";
  }
  const heldEvidence = useHeldReviews.getState().evidenceByRepo[repo] ?? {};
  const bootChanged = [...answered.values()].some(({ evidence }) =>
    Object.values(heldEvidence).some(
      (held) => evidence !== null && evidence.boot_id !== held.boot_id,
    ),
  );
  if (bootChanged) {
    book.read.clear();
    useHeldReviews.setState((state) => ({
      byRepo: { ...state.byRepo, [repo]: EMPTY },
      evidenceByRepo: { ...state.evidenceByRepo, [repo]: EMPTY_EVIDENCE },
    }));
  }
  const entries: Record<string, readonly ReviewComment[]> = {};
  const evidence: Record<string, ReviewEvidence | null> = {};
  for (const { path, seq, epoch } of sent) {
    if (book.seq.get(path) !== seq) continue;
    entries[path] = answered.get(path)?.review.comments ?? NONE;
    evidence[path] = answered.get(path)?.evidence ?? null;
    book.read.set(path, { epoch, at });
  }
  hold(repo, entries, evidence, unreviewedIn(sent, answered));
  const changed = Object.entries(evidence)
    .filter(([, e]) => e?.sample_changed)
    .map(([path]) => path);
  noteReload(repo, {
    lastSuccessAt: Date.now(),
    sampleChanged: changed.length > 0,
    running: false,
  });
  // The retry's wait starts again from 1 s only once every read is coherent:
  // a document that keeps changing while it is read backs off as a failure does.
  if (changed.length === 0) noteSuccess(repo, listed);
  else {
    if (freshnessOf(repo).failingSince !== null) setFreshness(repo, CURRENT);
    retryLater(repo, changed);
  }
  usePlanningStore.getState().rescan(repo, { bypassCache: bootChanged });
  return changed.length > 0 ? "changed" : "adopted";
}

/** Read one path's review again, as a `review_changed` push asks. */
function refetchOne(repo: string, path: string): void {
  const book = bookOf(repo);
  const seq = (book.seq.get(path) ?? 0) + 1;
  book.seq.set(path, seq);
  const epoch = epochOf(repo, path);
  const at = performance.now();
  const settle = () => {
    if (book.inflight.get(path) === request) book.inflight.delete(path);
  };
  const request: Promise<boolean> = (async () => {
    let answered: AnsweredReview | undefined;
    try {
      const { data } = await axios.post<unknown>(
        `${getApiBase(repo)}/planning/reviews`,
        { paths: [path] },
      );
      const all = reviewsIn(data);
      if (all === null) throw new Error("not a reviews answer");
      answered = all.get(path);
    } catch {
      // A document with no review is left out of a good answer, so a failure
      // is a real one. The comments already shown stay, and the retry reads
      // it again.
      settle();
      noteFailure(repo, [path]);
      return false;
    }
    settle();
    noteSuccess(repo, [path]);
    if (book.seq.get(path) !== seq) return true;
    book.read.set(path, { epoch, at });
    hold(
      repo,
      { [path]: answered?.review.comments ?? NONE },
      { [path]: answered?.evidence ?? null },
      answered ? NO_PATHS : new Set([path]),
    );
    return true;
  })();
  book.inflight.set(path, request);
}

/**
 * The comments of each document in `paths`, for the repository `repo` (`""`
 * is single-repo mode; `null` asks nothing until the repo store has said).
 *
 * A document whose `review_changed` count has moved since it was read is read
 * again with `GET /review`. With `readRest`, every listed document not read
 * since `since` (a `performance.now()` time: the visit's start) is read in one
 * `POST …/planning/reviews`, which is the page's second request of a visit.
 */
export function usePlanningReviews(
  repo: string | null,
  paths: readonly string[],
  options: { readRest?: boolean; since?: number } = {},
): PlanningReviews {
  const { readRest = true, since = Number.NEGATIVE_INFINITY } = options;

  // A stable key for the set, so a new array with the same paths re-runs
  // nothing.
  const key = [...new Set(paths)].sort().join("\n");
  const listed = useMemo(() => (key === "" ? [] : key.split("\n")), [key]);

  const byPath = useHeldReviews((state) =>
    repo === null ? EMPTY : (state.byRepo[repo] ?? EMPTY),
  );
  const evidence = useHeldReviews((state) =>
    repo === null
      ? EMPTY_EVIDENCE
      : (state.evidenceByRepo[repo] ?? EMPTY_EVIDENCE),
  );

  // The listed set, by repository, whose last request failed.
  const [failedFor, setFailedFor] = useState<string | null>(null);

  // Each listed document's epoch, as one string: an effect re-runs on a change
  // to any of them, and only the documents whose own epoch moved are read.
  const epochs = usePlanningStore((state) =>
    repo === null
      ? ""
      : listed
          .map((path) => state.reviewEpoch[`${repo}\n${path}`] ?? 0)
          .join("\n"),
  );

  useEffect(() => {
    if (repo === null || isStaticMode()) return;
    const book = bookOf(repo);
    const current = epochs === "" ? [] : epochs.split("\n").map(Number);
    const unread: string[] = [];
    listed.forEach((path, i) => {
      const read = book.read.get(path);
      if (read === undefined || !readSince(book, path, since)) {
        unread.push(path);
      } else if (read.epoch !== (current[i] ?? 0) && !book.inflight.has(path)) {
        refetchOne(repo, path);
      }
    });
    if (readRest && unread.length > 0) {
      const asked = `${repo}\n${listed.join("\n")}`;
      void fetchPlanningReviews(repo, unread, since).then((ok) =>
        setFailedFor((prev) => (ok ? (prev === asked ? null : prev) : asked)),
      );
    }
    // `byPath` too: a push that lands while its document is being read is
    // read again once that answer is in.
  }, [repo, listed, epochs, readRest, since, byPath]);

  // The push connection came back: pushes may have been lost while it was
  // down, so every listed document is reconciled. Its first connection is
  // not a reconnect, and neither is the count this hook was mounted at.
  const reconnects = usePlanningStore((state) => state.reconnects);
  const seenReconnects = useRef(reconnects);
  useEffect(() => {
    if (seenReconnects.current === reconnects) return;
    seenReconnects.current = reconnects;
    if (repo === null || isStaticMode() || listed.length === 0) return;
    void reconcilePlanningReviews(repo, listed);
  }, [repo, listed, reconnects]);

  const adopt = useCallback(
    (path: string, data: ReviewData | null) => {
      if (repo === null) return;
      const book = bookOf(repo);
      book.seq.set(path, (book.seq.get(path) ?? 0) + 1);
      book.read.set(path, {
        epoch: epochOf(repo, path),
        at: performance.now(),
      });
      // Our own write moved the revision, not the document: keep the held
      // reading's other numbers, and take the revision the echo carries.
      const held = useHeldReviews.getState().evidenceByRepo[repo]?.[path];
      const revision = data?.mutation_revision;
      hold(
        repo,
        { [path]: data?.comments ?? NONE },
        {
          [path]:
            held && typeof revision === "number"
              ? { ...held, mutation_revision: revision }
              : (held ?? null),
        },
      );
      // An echo carries no reading of the document. With none held for this
      // path, ask for one, so its comments are not left unpaired.
      if (held === undefined) refetchOne(repo, path);
    },
    [repo],
  );

  const known = listed.every((path) => byPath[path] !== undefined);
  const failed =
    !known && repo !== null && failedFor === `${repo}\n${listed.join("\n")}`;
  return { byPath, evidence, known, failed, adopt };
}
