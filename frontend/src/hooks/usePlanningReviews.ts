/**
 * The review comments of every document the planning page lists
 * (`docs/design/planning-index.md` §6.3).
 *
 * The page shows the comments already filed on each question, and hands every
 * pending one to the agent with Copy answers. It stores nothing of its own:
 * the comments are the ones Vantage already keeps, fetched with the viewer's
 * own `GET /review?path=` once per listed document, and fetched again whenever
 * a `review_changed` push names that document — the planning store counts
 * those pushes in `reviewEpoch`, for every document and not only the one on
 * screen, which is why the page can follow them.
 *
 * Not the review store, which holds one document — the one the viewer is on —
 * and resets itself on every switch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { usePlanningStore } from "../stores/usePlanningStore";
import { isStaticMode } from "../lib/staticMode";
import type { ReviewComment, ReviewData } from "../types";

export interface PlanningReviews {
  /** Each listed document's comments, by path; absent until its first answer. */
  byPath: Readonly<Record<string, readonly ReviewComment[]>>;
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

/**
 * The comments of each document in `paths`, for the repository `repo` (`""`
 * is single-repo mode; `null` fetches nothing until the repo store has said).
 * A static export has no review endpoint, so it fetches nothing there.
 */
export function usePlanningReviews(
  repo: string | null,
  paths: readonly string[],
): PlanningReviews {
  const [byPath, setByPath] = useState<
    Readonly<Record<string, readonly ReviewComment[]>>
  >({});

  // A stable key for the set, so a new array with the same paths re-runs
  // nothing.
  const key = [...new Set(paths)].sort().join("\n");
  const listed = useMemo(() => (key === "" ? [] : key.split("\n")), [key]);

  // Each listed document's epoch, as one string: an effect re-runs on a change
  // to any of them, and only the documents whose own epoch moved are fetched.
  const epochs = usePlanningStore((state) =>
    repo === null
      ? ""
      : listed
          .map((path) => state.reviewEpoch[`${repo}\n${path}`] ?? 0)
          .join("\n"),
  );

  /** Per path, the epoch last fetched for; a path absent here was never asked. */
  const fetchedRef = useRef(new Map<string, number>());
  /** Per path, the number of the latest request or adoption. */
  const seqRef = useRef(new Map<string, number>());
  const repoRef = useRef(repo);

  // A different repository is a different set of documents entirely.
  useEffect(() => {
    if (repoRef.current === repo) return;
    repoRef.current = repo;
    fetchedRef.current = new Map();
    seqRef.current = new Map();
    setByPath({});
  }, [repo]);

  useEffect(() => {
    if (repo === null || isStaticMode()) return;
    const current = epochs === "" ? [] : epochs.split("\n").map(Number);
    listed.forEach((path, i) => {
      const epoch = current[i] ?? 0;
      if (fetchedRef.current.get(path) === epoch) return;
      fetchedRef.current.set(path, epoch);
      const seq = (seqRef.current.get(path) ?? 0) + 1;
      seqRef.current.set(path, seq);
      void (async () => {
        let comments: readonly ReviewComment[];
        try {
          const { data } = await axios.get<ReviewData | null>(
            `${getApiBase(repo)}/review`,
            { params: { path } },
          );
          comments = data?.comments ?? NONE;
        } catch {
          // No review file answers 200 with null, so a failure is a real one.
          // The comments already shown stay; the next push for this document
          // asks again.
          fetchedRef.current.delete(path);
          return;
        }
        if (seqRef.current.get(path) !== seq || repoRef.current !== repo) {
          return;
        }
        setByPath((prev) => ({ ...prev, [path]: comments }));
      })();
    });
  }, [repo, listed, epochs]);

  const adopt = useCallback((path: string, data: ReviewData | null) => {
    seqRef.current.set(path, (seqRef.current.get(path) ?? 0) + 1);
    setByPath((prev) => ({ ...prev, [path]: data?.comments ?? NONE }));
  }, []);

  return { byPath, adopt };
}
