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
 * its one document again with `GET /review`: the planning store counts those
 * pushes in `reviewEpoch`, for every document and not only the one on screen,
 * which is why the page can follow them.
 *
 * What was read is kept by repository for the tab, outside any component, so
 * a page returned to, or prefetched from the viewer, renders its comments in
 * the same commit as its cards. Each visit reads every listed document again
 * once, in its second request, which heals a push the socket missed.
 *
 * Not the review store, which holds one document — the one the viewer is on —
 * and resets itself on every switch.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { create } from "zustand";
import { usePlanningStore } from "../stores/usePlanningStore";
import { isStaticMode } from "../lib/staticMode";
import type { ReviewComment, ReviewData } from "../types";

/** Comments by path, for one repository. */
export type ReviewsByPath = Readonly<Record<string, readonly ReviewComment[]>>;

export interface PlanningReviews {
  /** Each listed document's comments, by path; absent until its first answer. */
  byPath: ReviewsByPath;
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

/** What renders: every repository's reviews read this tab, by path. */
const useHeldReviews = create<{
  byRepo: Readonly<Record<string, ReviewsByPath>>;
}>(() => ({ byRepo: {} }));

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

function hold(repo: string, entries: Record<string, readonly ReviewComment[]>) {
  useHeldReviews.setState((state) => ({
    byRepo: {
      ...state.byRepo,
      [repo]: { ...(state.byRepo[repo] ?? EMPTY), ...entries },
    },
  }));
}

/** Forget every repository's reviews. For tests. */
export function resetPlanningReviews(): void {
  books.clear();
  useHeldReviews.setState({ byRepo: {} });
}

/** The reviews held for `repo` now, by path. */
export function planningReviewsOf(repo: string): ReviewsByPath {
  return useHeldReviews.getState().byRepo[repo] ?? EMPTY;
}

/** Whether `data` is the reviews answer's shape: `{reviews: [{path, review}]}`. */
function reviewsIn(data: unknown): Map<string, ReviewData> | null {
  const reviews = (data as { reviews?: unknown } | null)?.reviews;
  if (!Array.isArray(reviews)) return null;
  const out = new Map<string, ReviewData>();
  for (const entry of reviews) {
    const { path, review } = (entry ?? {}) as {
      path?: unknown;
      review?: { comments?: unknown } | null;
    };
    if (typeof path !== "string" || !Array.isArray(review?.comments)) {
      return null;
    }
    out.set(path, review as ReviewData);
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
      let answered: Map<string, ReviewData> | null;
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
      // answer, not failed. The next push, or the next page, asks again.
      if (answered === null) return false;
      const entries: Record<string, readonly ReviewComment[]> = {};
      for (const { path, seq, epoch } of sent) {
        if (book.seq.get(path) !== seq) continue;
        entries[path] = answered.get(path)?.comments ?? NONE;
        book.read.set(path, { epoch, at });
      }
      hold(repo, entries);
      return true;
    })();
    for (const path of asked) book.inflight.set(path, request);
    waiting.push(request);
  }
  return Promise.all(waiting).then((all) => all.every(Boolean));
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
    let comments: readonly ReviewComment[];
    try {
      const { data } = await axios.get<ReviewData | null>(
        `${getApiBase(repo)}/review`,
        { params: { path } },
      );
      comments = data?.comments ?? NONE;
    } catch {
      // No review file answers 200 with null, so a failure is a real one. The
      // comments already shown stay; the next push for it asks again.
      settle();
      return false;
    }
    settle();
    if (book.seq.get(path) !== seq) return true;
    book.read.set(path, { epoch, at });
    hold(repo, { [path]: comments });
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

  const adopt = useCallback(
    (path: string, data: ReviewData | null) => {
      if (repo === null) return;
      const book = bookOf(repo);
      book.seq.set(path, (book.seq.get(path) ?? 0) + 1);
      book.read.set(path, {
        epoch: epochOf(repo, path),
        at: performance.now(),
      });
      hold(repo, { [path]: data?.comments ?? NONE });
    },
    [repo],
  );

  const known = listed.every((path) => byPath[path] !== undefined);
  const failed =
    !known && repo !== null && failedFor === `${repo}\n${listed.join("\n")}`;
  return { byPath, known, failed, adopt };
}
