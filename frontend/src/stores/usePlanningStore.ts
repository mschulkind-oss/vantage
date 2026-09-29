/**
 * The planning index, one per repository, as the viewer holds it
 * (`docs/design/planning-index.md` §3.4).
 *
 * Built once per repository per page session, on first need, from one batch
 * request, and kept fresh from then on one path at a time as the change push
 * names files. Nothing waits on it: a document renders at once, and its link
 * badges appear when the index is ready.
 *
 * Every derivation lives in `vantage-md/planning` (P4); this file only fetches,
 * sequences and holds. Three rules it owns:
 *
 * - **Per-file refreshes ask the planning endpoint's single-path mode**, never
 *   `/content` (Plan Q15). A path joins the index only when the server answers
 *   `file`, which carries the listing rules, the include and exclude patterns,
 *   the size limit and the UTF-8 test. So there is no matcher here.
 * - **Requests are numbered per repository** (§3.4, "Ordering"). A single-path
 *   answer is discarded when a newer request covering its path has been sent,
 *   and a batch is discarded whole — config, count and refusal included — when
 *   a later rescan has been sent. A single-path answer newer than a batch still
 *   in flight is held and applied on top of that batch when it lands.
 * - **A ready index stays shown while it is rescanned** (`rescanning: true`), so
 *   the planning page never flashes a loading state where it restores its
 *   scroll position (Plan Q14).
 */

import { useEffect } from "react";
import { create } from "zustand";
import axios from "axios";
import {
  applySource,
  buildPlanningIndex,
  findDocument,
  parsePlanningSources,
  parseSourceEntry,
  withoutDirectory,
  type PlanningIndex,
  type PlanningSources,
  type SourceEntry,
} from "vantage-md/planning";
import { useRepoStore } from "./useRepoStore";
import { isStaticMode } from "../lib/staticMode";

export type PlanningLoad =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      index: PlanningIndex;
      /** Bumped on every change to `index`, for passes that re-run on it. */
      version: number;
      /** A rescan is in flight; `index` is the previous one until it lands. */
      rescanning: boolean;
      /** Each planning document's text, by path, for cards and Copy. */
      sources: Readonly<Record<string, string>>;
    }
  | { status: "error"; message: string };

interface PlanningStore {
  /** By repository; `""` is single-repo mode. */
  byRepo: Readonly<Record<string, PlanningLoad>>;
  /** By `${repo}\n${path}`: bumped on each `review_changed` for that document. */
  reviewEpoch: Readonly<Record<string, number>>;
  /**
   * Start the batch for `repo` unless one has already been started. A no-op
   * until the repo store has loaded, and in daemon mode for `""`. In a static
   * export it gives `error` at once, with no request (Plan Q3).
   */
  ensure(repo: string): void;
  /**
   * Scan `repo` again from a fresh batch: Retry, and a `.vantage.toml` push. A
   * ready index stays shown, with `rescanning: true`, until the batch lands.
   */
  rescan(repo: string): void;
  /** A `files_changed` push for `repo`. */
  noteFilesChanged(
    repo: string,
    paths: readonly string[],
    removedDirs: readonly string[],
  ): void;
  /** A `review_changed` push for one document. */
  noteReviewChanged(repo: string, path: string): void;
  /**
   * The push connection came back after dropping, so pushes may have been lost:
   * rescan every ready index. Genuine reconnects only — never a page's first
   * connection (Plan Q14). Does nothing for an idle, loading or failed index.
   */
  noteReconnect(): void;
}

/** One stable value, so a selector falling back to it never re-renders. */
export const PLANNING_IDLE: PlanningLoad = { status: "idle" };

/** The file whose change rescans the whole index (§3.4). */
const CONFIG_FILE = ".vantage.toml";

/** What the planning page shows for a static export (§3.6, Plan Q3). */
export const STATIC_MESSAGE =
  "This is a static export, which has no planning index: it needs the Vantage server.";

/** What it shows when the endpoint answered with something else entirely. */
export const SHAPE_MESSAGE =
  "The server's answer was not a planning index. A static host answers every missing path with its index page.";

const failedMessage = (error: unknown): string =>
  `Could not load the planning index: ${
    error instanceof Error ? error.message : String(error)
  }`;

/** A repository's API base. A private copy per store is house style. */
const getApiBase = (repo: string): string =>
  repo === "" ? "/api" : `/api/r/${encodeURIComponent(repo)}`;

/** Whether a pushed path could be a candidate at all: `.md`, in any case. */
const isMarkdown = (path: string): boolean =>
  path.toLowerCase().endsWith(".md");

/* ------------------------------------------------------------------ *
 * Sequencing
 * ------------------------------------------------------------------ */

/** A directory removed or renamed away, noted when the push named it. */
interface RemovedDir {
  kind: "removed-dir";
  dir: string;
}

/** One change newer than the batch in flight, to replay once it lands. */
interface HeldChange {
  seq: number;
  change: SourceEntry | RemovedDir;
}

/**
 * One repository's request bookkeeping. Module state rather than store state:
 * nothing renders from it, and a write here must not re-render anything.
 */
interface Tracker {
  /** The number of the last request issued, batch or single-path. */
  seq: number;
  /** The number of the latest batch sent; 0 before the first. */
  batch: number;
  /** Whether that batch is still in flight. */
  batchPending: boolean;
  /** Per path, the number of the latest single-path request sent. */
  sent: Map<string, number>;
  /** Directory removals, so a request sent before one cannot undo it. */
  removed: { dir: string; seq: number }[];
  /** Changes newer than the batch in flight, in the order they were numbered. */
  held: HeldChange[];
  /** When the first batch was sent, for the one time-to-ready log line. */
  startedAt: number | null;
}

const trackers = new Map<string, Tracker>();

function trackerFor(repo: string): Tracker {
  let tracker = trackers.get(repo);
  if (tracker === undefined) {
    tracker = {
      seq: 0,
      batch: 0,
      batchPending: false,
      sent: new Map(),
      removed: [],
      held: [],
      startedAt: null,
    };
    trackers.set(repo, tracker);
  }
  return tracker;
}

let version = 0;
let loggedReady = false;

/** Forget every repository's bookkeeping. For tests, beside a state reset. */
export function resetPlanningTrackers(): void {
  trackers.clear();
  loggedReady = false;
}

/* ------------------------------------------------------------------ *
 * Applying changes
 * ------------------------------------------------------------------ */

interface Held {
  index: PlanningIndex;
  sources: Record<string, string>;
}

function applyChange(held: Held, change: SourceEntry | RemovedDir): Held {
  const sources = { ...held.sources };
  if (change.kind === "removed-dir") {
    const prefix = `${change.dir.replace(/\/+$/, "")}/`;
    for (const path of Object.keys(sources)) {
      if (path.startsWith(prefix)) delete sources[path];
    }
    return { index: withoutDirectory(held.index, change.dir), sources };
  }
  const index = applySource(held.index, change);
  if (change.kind === "file" && findDocument(index, change.path)) {
    sources[change.path] = change.content;
  } else {
    delete sources[change.path];
  }
  return { index, sources };
}

/** How long the scan may run before it lets the page paint. */
const SLICE_MS = 8;

const yieldToPage = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The batch's index, scanned off the critical path.
 *
 * `buildPlanningIndex` over the batch minus its files, then each file folded in
 * with `applySource`, which gives the same index. Between documents it yields
 * whenever a slice has run for `SLICE_MS`: a `setTimeout(0)` after every one
 * would cost the browser's 4 ms clamp per candidate, 20 s at the 5,000
 * candidates the default limit allows. No Worker, which would need a second
 * bundle entry for a corpus this size.
 */
async function scanBatch(sources: PlanningSources): Promise<Held> {
  let held: Held = {
    index: buildPlanningIndex({ ...sources, files: [] }),
    sources: {},
  };
  let sliceStart = performance.now();
  for (const file of sources.files) {
    if (performance.now() - sliceStart > SLICE_MS) {
      await yieldToPage();
      sliceStart = performance.now();
    }
    held = applyChange(held, { kind: "file", ...file });
  }
  return held;
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

export const usePlanningStore = create<PlanningStore>((set, get) => {
  const setLoad = (repo: string, load: PlanningLoad) =>
    set((state) => ({ byRepo: { ...state.byRepo, [repo]: load } }));

  const ready = (
    held: Held,
    rescanning: boolean,
  ): Extract<PlanningLoad, { status: "ready" }> => ({
    status: "ready",
    index: held.index,
    version: ++version,
    rescanning,
    sources: held.sources,
  });

  /** Apply one change to the index on screen, if there is one. */
  const applyShown = (repo: string, change: SourceEntry | RemovedDir) => {
    const load = get().byRepo[repo];
    if (load?.status !== "ready") return;
    const next = applyChange(load, change);
    // `applySource` answers a refused index with itself; nothing changed.
    if (next.index === load.index) return;
    setLoad(repo, ready(next, load.rescanning));
  };

  /** Whether a repository can be asked yet (the repo store has loaded). */
  const askable = (repo: string): boolean => {
    const { reposLoaded, isMultiRepo } = useRepoStore.getState();
    if (!reposLoaded) return false;
    return !(isMultiRepo && repo === "");
  };

  const startBatch = (repo: string) => {
    const tracker = trackerFor(repo);
    const seq = ++tracker.seq;
    tracker.batch = seq;
    tracker.batchPending = true;
    tracker.held = [];
    tracker.startedAt ??= performance.now();

    const load = get().byRepo[repo];
    setLoad(
      repo,
      load?.status === "ready"
        ? { ...load, rescanning: true }
        : { status: "loading" },
    );

    const superseded = () => tracker.batch !== seq;
    void (async () => {
      let sources: PlanningSources | null;
      try {
        const response = await axios.get<unknown>(
          `${getApiBase(repo)}/planning/sources`,
        );
        if (superseded()) return;
        sources = parsePlanningSources(response?.data);
      } catch (error) {
        if (superseded()) return;
        tracker.batchPending = false;
        setLoad(repo, { status: "error", message: failedMessage(error) });
        return;
      }
      if (sources === null) {
        tracker.batchPending = false;
        setLoad(repo, { status: "error", message: SHAPE_MESSAGE });
        return;
      }

      let held = await scanBatch(sources);
      if (superseded()) return;

      // Everything noted since the batch was sent is newer than what it read.
      for (const { change } of tracker.held) held = applyChange(held, change);
      tracker.held = [];
      tracker.batchPending = false;
      // A removal the batch already reflects can no longer be undone by an
      // answer to an older request: that answer is older than the batch too.
      tracker.removed = tracker.removed.filter((r) => r.seq > seq);

      setLoad(repo, ready(held, false));

      if (!loggedReady && tracker.startedAt !== null) {
        loggedReady = true;
        console.info(
          "[planning] index ready in %d ms: %d planning documents of %d candidates",
          Math.round(performance.now() - tracker.startedAt),
          held.index.documents.length,
          held.index.candidateCount,
        );
      }
    })();
  };

  /** Ask the single-path mode about one pushed path. */
  const refreshPath = (repo: string, path: string) => {
    const tracker = trackerFor(repo);
    const seq = ++tracker.seq;
    tracker.sent.set(path, seq);

    void (async () => {
      let entry: SourceEntry | null;
      try {
        const response = await axios.get<unknown>(
          `${getApiBase(repo)}/planning/sources?path=${encodeURIComponent(path)}`,
        );
        entry = parseSourceEntry(response?.data);
      } catch {
        // The previous entry stays; the next push for this path asks again.
        return;
      }
      if (entry === null || entry.path !== path) return;
      // A newer request covers this path: a later push for it, or a batch.
      if (tracker.sent.get(path) !== seq || seq < tracker.batch) return;
      const prefix = (dir: string) => `${dir.replace(/\/+$/, "")}/`;
      if (
        tracker.removed.some(
          (r) => r.seq > seq && path.startsWith(prefix(r.dir)),
        )
      ) {
        return;
      }
      if (tracker.batchPending) tracker.held.push({ seq, change: entry });
      applyShown(repo, entry);
    })();
  };

  return {
    byRepo: {},
    reviewEpoch: {},

    ensure: (repo) => {
      if (isStaticMode()) {
        if (get().byRepo[repo]?.status !== "error") {
          setLoad(repo, { status: "error", message: STATIC_MESSAGE });
        }
        return;
      }
      if (!askable(repo)) return;
      const load = get().byRepo[repo];
      if (load !== undefined && load.status !== "idle") return;
      startBatch(repo);
    },

    rescan: (repo) => {
      if (isStaticMode()) {
        setLoad(repo, { status: "error", message: STATIC_MESSAGE });
        return;
      }
      if (!askable(repo)) return;
      startBatch(repo);
    },

    noteFilesChanged: (repo, paths, removedDirs) => {
      const load = get().byRepo[repo];
      if (load === undefined || load.status === "idle") return;
      const tracker = trackerFor(repo);

      if (load.status !== "error") {
        for (const dir of removedDirs) {
          const seq = ++tracker.seq;
          const change: RemovedDir = { kind: "removed-dir", dir };
          tracker.removed.push({ dir, seq });
          if (tracker.batchPending) tracker.held.push({ seq, change });
          applyShown(repo, change);
        }
      }

      // A config change can move every candidate in or out, so it rescans, and
      // the batch it sends covers every other path in the same push.
      if (paths.includes(CONFIG_FILE)) {
        get().rescan(repo);
        return;
      }
      if (load.status === "error") return;
      for (const path of new Set(paths)) {
        if (isMarkdown(path)) refreshPath(repo, path);
      }
    },

    noteReviewChanged: (repo, path) => {
      const key = `${repo}\n${path}`;
      set((state) => ({
        reviewEpoch: {
          ...state.reviewEpoch,
          [key]: (state.reviewEpoch[key] ?? 0) + 1,
        },
      }));
    },

    noteReconnect: () => {
      for (const [repo, load] of Object.entries(get().byRepo)) {
        if (load.status === "ready") get().rescan(repo);
      }
    },
  };
});

/**
 * The repository the viewer is on, as the store keys it: `""` in single-repo
 * mode, the name in daemon mode, and `null` until the repo store says which.
 */
export function usePlanningRepo(): string | null {
  return useRepoStore((state) =>
    !state.reposLoaded ? null : state.isMultiRepo ? state.currentRepo : "",
  );
}

/**
 * The current repository's planning index, started on mount. Re-runs `ensure`
 * when the repository changes, and when the repo store first loads.
 */
export function usePlanningIndex(): PlanningLoad {
  const repo = usePlanningRepo();
  const load = usePlanningStore((state) =>
    repo === null ? PLANNING_IDLE : (state.byRepo[repo] ?? PLANNING_IDLE),
  );
  const ensure = usePlanningStore((state) => state.ensure);
  useEffect(() => {
    if (repo !== null) ensure(repo);
  }, [repo, ensure]);
  return load;
}
