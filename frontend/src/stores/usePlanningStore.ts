/**
 * The planning index, one per repository, as the viewer holds it
 * (`docs/reference/planning-index.md` §8).
 *
 * Built once per repository per page session, on first need, by the scanner
 * client, which reads the planning stream and scans in the scan worker; and
 * kept fresh from then on one path at a time as the change push names files.
 * Nothing waits on it: a document renders at once, and its link badges appear
 * when the index is ready.
 *
 * Every derivation lives in `vantage-md/planning` (P4), and every scan in the
 * scan worker; this file only asks, sequences and holds. It holds the facts
 * and one content hash per planning document, never a document's text (S2):
 * the planning page asks the scanner client for card blocks and quoted lines
 * by those hashes. Three rules it owns:
 *
 * - **Per-file refreshes ask the scanner client**, which reads the planning
 *   endpoint's single-path mode, never `/content` (Plan Q15). A path joins the
 *   index only when the server answers `file`, which carries the listing
 *   rules, the include and exclude patterns, the size limit and the UTF-8
 *   test. So there is no matcher here.
 * - **Requests are numbered per repository** (§8.3, "Ordering"). The client makes no ordering decision, so the numbering
 *   stays here, unchanged: a refreshed entry is discarded when a newer request
 *   covering its path has been sent, and a build is discarded whole — config,
 *   count and refusal included — when a later rescan has been sent. An entry
 *   newer than a build still in flight is held and applied on top of that
 *   build when it lands.
 * - **A ready index stays shown while it is rescanned** (`rescanning: true`), so
 *   the planning page never flashes a loading state where it restores its
 *   scroll position (Plan Q14). A build's results are gathered outside the
 *   store and set once, at `ready`, so no subscriber re-renders per chunk.
 */

import { useEffect } from "react";
import { create } from "zustand";
import {
  applyScanned,
  findDocument,
  planningIndexBuilder,
  withoutDirectory,
  type PlanningDocument,
  type PlanningIndex,
  type PlanningIndexBuilder,
  type ScannedEntry,
} from "vantage-md/planning";
import { useRepoStore } from "./useRepoStore";
import { isStaticMode } from "../lib/staticMode";
import { planningScanner, type BuildEvent } from "../planningScan/client";

export type PlanningLoad =
  | { status: "idle" }
  | {
      status: "loading";
      /**
       * Whether the build under way is warm: the scan cache held at least one
       * of this repository's results when it started (§2).
       * `null` until the scanner's `started` says which, and `false` for a
       * cold build. A document's first paint waits briefly for a warm one, and
       * for one not yet known to be cold (§12.3): git's answers often land
       * before `started` does, and a hold that read "not said yet" as cold
       * ended on them and missed a warm index by a few milliseconds.
       */
      warm: boolean | null;
      /**
       * Candidates handled of the header's count, once the header has come:
       * `null` before it (§6.10). As often as the scanner reports it, which is
       * at most every `progressMs`.
       */
      progress: { done: number; total: number } | null;
    }
  | {
      status: "ready";
      index: PlanningIndex;
      /** Bumped on every change to `index`, for passes that re-run on it. */
      version: number;
      /** A rescan is in flight; `index` is the previous one until it lands. */
      rescanning: boolean;
      /**
       * Each planning document's content hash, by path: what a request for
       * its card blocks or quoted lines names, so the scanner client answers
       * from exactly the version this index read (§8.4).
       */
      hashes: Readonly<Record<string, string>>;
    }
  | { status: "error"; message: string };

interface PlanningStore {
  /** By repository; `""` is single-repo mode. */
  byRepo: Readonly<Record<string, PlanningLoad>>;
  /** By `${repo}\n${path}`: bumped on each `review_changed` for that document. */
  reviewEpoch: Readonly<Record<string, number>>;
  /**
   * Start the build for `repo` unless one has already been started. A no-op
   * until the repo store has loaded, and in daemon mode for `""`. In a static
   * export it gives `error` at once, with no request (Plan Q3).
   */
  ensure(repo: string): void;
  /**
   * Build `repo` again: Retry, a `.vantage.toml` push, a reconnect. A ready
   * index stays shown, with `rescanning: true`, until the build lands.
   *
   * `bypassCache` is Retry's: the build sends no `have`, so every file is
   * read and scanned again, and every scan-cache entry of the repository is
   * rewritten (§11.3). No setting changes a scan result,
   * so a config push rescans with the cache.
   */
  rescan(repo: string, options?: { bypassCache?: boolean }): void;
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

type Loading = Extract<PlanningLoad, { status: "loading" }>;

/** A first build, before the scanner has said anything about it. */
const LOADING: Loading = {
  status: "loading",
  warm: null,
  progress: null,
};

/** The file whose change rescans the whole index (§8.3). */
const CONFIG_FILE = ".vantage.toml";

/** What the planning page shows for a static export (§15, Plan Q3). */
export const STATIC_MESSAGE =
  "This is a static export, which has no planning index: it needs the Vantage server.";

/** What it shows when the endpoint answered with something else entirely. */
export const SHAPE_MESSAGE =
  "The server's answer was not a planning index. A static host answers every missing path with its index page.";

/** What it shows when a build failed, from the scanner client's reason. */
const failedMessage = (reason: string): string =>
  `Could not load the planning index: ${reason}`;

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

/** One change newer than the build in flight, to replay once it lands. */
interface HeldChange {
  seq: number;
  change: ScannedEntry | RemovedDir;
}

/**
 * One repository's request bookkeeping. Module state rather than store state:
 * nothing renders from it, and a write here must not re-render anything.
 */
interface Tracker {
  /** The number of the last request issued, build or single-path. */
  seq: number;
  /** The number of the latest build sent; 0 before the first. */
  batch: number;
  /** Whether that build is still in flight. */
  batchPending: boolean;
  /** Per path, the number of the latest single-path request sent. */
  sent: Map<string, number>;
  /** Directory removals, so a request sent before one cannot undo it. */
  removed: { dir: string; seq: number }[];
  /** Changes newer than the build in flight, in the order they were numbered. */
  held: HeldChange[];
  /** When the first build was sent, for the one time-to-ready log line. */
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
  hashes: Record<string, string>;
}

function applyChange(held: Held, change: ScannedEntry | RemovedDir): Held {
  const hashes = { ...held.hashes };
  if (change.kind === "removed-dir") {
    const prefix = `${change.dir.replace(/\/+$/, "")}/`;
    for (const path of Object.keys(hashes)) {
      if (path.startsWith(prefix)) delete hashes[path];
    }
    return { index: withoutDirectory(held.index, change.dir), hashes };
  }
  const index = applyScanned(held.index, change);
  if (change.kind === "file" && findDocument(index, change.path)) {
    hashes[change.path] = change.hash;
  } else {
    delete hashes[change.path];
  }
  return { index, hashes };
}

/**
 * A build's results as they arrive, gathered outside the store: the builder
 * the header starts, and each planning document's hash. `planningIndexBuilder`
 * is the one `buildPlanningIndex` runs, so a build here and the checker's walk
 * cannot disagree, and it sorts once, at `finish`.
 */
interface Gathering {
  builder: PlanningIndexBuilder;
  hashes: Record<string, string>;
}

function gather(
  gathering: Gathering,
  event: Extract<BuildEvent, { type: "documents" }>,
): void {
  const { builder, hashes } = gathering;
  for (const { document, hash } of event.docs) {
    const added = builder.addResult(document.path, {
      kind: "planning",
      document,
      cards: [],
    });
    if (added !== null) hashes[document.path] = hash;
  }
  for (const { path, reason } of event.unreadable) {
    builder.addScanned({ kind: "unreadable", path, reason });
  }
  for (const { path, size } of event.skipped) {
    builder.addScanned({ kind: "skipped", path, size });
  }
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
    hashes: held.hashes,
  });

  /** Apply one change to the index on screen, if there is one. */
  const applyShown = (repo: string, change: ScannedEntry | RemovedDir) => {
    const load = get().byRepo[repo];
    if (load?.status !== "ready") return;
    const next = applyChange(load, change);
    // `applyScanned` answers with the index itself when nothing changed: a
    // refused index, or a path that is not a planning document and was not.
    // Only a planning document has a hash, so none moved either.
    if (next.index === load.index) return;
    setLoad(repo, ready(next, load.rescanning));
  };

  /** Whether a repository can be asked yet (the repo store has loaded). */
  const askable = (repo: string): boolean => {
    const { reposLoaded, isMultiRepo } = useRepoStore.getState();
    if (!reposLoaded) return false;
    return !(isMultiRepo && repo === "");
  };

  const startBatch = (repo: string, bypassCache = false) => {
    const tracker = trackerFor(repo);
    const scanner = planningScanner();
    // A build still out is superseded: its answer would be discarded whole,
    // so the scanner stops reading it (§8.2).
    if (tracker.batchPending) scanner.cancel(repo, tracker.batch);
    const seq = ++tracker.seq;
    tracker.batch = seq;
    tracker.batchPending = true;
    tracker.held = [];
    tracker.startedAt ??= performance.now();

    const load = get().byRepo[repo];
    setLoad(
      repo,
      load?.status === "ready" ? { ...load, rescanning: true } : LOADING,
    );

    const superseded = () => tracker.batch !== seq;
    // A client reports nothing after `ready` or `failed`; if one did, it
    // would be about a build the store has already landed or given up on.
    let over = false;
    const fail = (message: string) => {
      over = true;
      tracker.batchPending = false;
      setLoad(repo, { status: "error", message });
    };
    let gathering: Gathering | null = null;
    /**
     * What a first build says of itself while it runs. A rescan says nothing:
     * the index it replaces stays shown, and its subscribers need not hear.
     */
    const loading = (next: Partial<Pick<Loading, "warm" | "progress">>) => {
      const current = get().byRepo[repo];
      if (current?.status !== "loading") return;
      const warm = next.warm ?? current.warm;
      const progress =
        next.progress === undefined ? current.progress : next.progress;
      if (warm === current.warm && progress === current.progress) return;
      setLoad(repo, { status: "loading", warm, progress });
    };

    const finish = (built: Gathering) => {
      over = true;
      let held: Held = { index: built.builder.finish(), hashes: built.hashes };
      // Everything noted since the build was sent is newer than what it read.
      for (const { change } of tracker.held) held = applyChange(held, change);
      tracker.held = [];
      tracker.batchPending = false;
      // A removal the build already reflects can no longer be undone by an
      // answer to an older request: that answer is older than the build too.
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
    };

    scanner.build({ repo, seq, bypassCache }, (event) => {
      if (over || superseded()) return;
      switch (event.type) {
        case "started":
          loading({ warm: event.warm });
          return;
        case "header":
          loading({ progress: { done: 0, total: event.candidateCount } });
          gathering = {
            builder: planningIndexBuilder({
              config: event.config,
              candidateCount: event.candidateCount,
              refused: event.refused,
              skipped: [],
              unreadable: [],
            }),
            hashes: {},
          };
          return;
        case "documents":
          if (gathering !== null) gather(gathering, event);
          return;
        case "ready":
          // A build is ready only after its header; anything else is not
          // the planning stream's shape.
          if (gathering === null) fail(SHAPE_MESSAGE);
          else finish(gathering);
          return;
        case "failed":
          fail(event.shape ? SHAPE_MESSAGE : failedMessage(event.message));
          return;
        case "progress":
          loading({ progress: { done: event.done, total: event.total } });
          return;
      }
    });
  };

  /** Ask the scanner client about one pushed path. */
  const refreshPath = (repo: string, path: string) => {
    const tracker = trackerFor(repo);
    const seq = ++tracker.seq;
    tracker.sent.set(path, seq);

    // What the file is scanned under by a scanner that has seen no header,
    // as one made after the last one died has not (§10.1).
    const load = get().byRepo[repo];
    const config = load?.status === "ready" ? load.index.config : null;

    void (async () => {
      let entry: ScannedEntry | null;
      try {
        entry = await planningScanner().refresh({ repo, seq, path, config });
      } catch {
        entry = null;
      }
      // `null`: it could not be had. The previous entry stays; the next push
      // for this path asks again.
      if (entry === null || entry.path !== path) return;
      // A newer request covers this path: a later push for it, or a build.
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

    rescan: (repo, options) => {
      if (isStaticMode()) {
        setLoad(repo, { status: "error", message: STATIC_MESSAGE });
        return;
      }
      if (!askable(repo)) return;
      startBatch(repo, options?.bypassCache ?? false);
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
      // the build it sends covers every other path in the same push.
      if (paths.includes(CONFIG_FILE)) {
        get().rescan(repo);
        return;
      }
      if (load.status === "error") return;
      // Only a rescan changes a refused index, so one path's answer would be
      // read and discarded; a rescan's build in flight may not be refused,
      // and it takes what is pushed meanwhile.
      if (
        load.status === "ready" &&
        load.index.refused &&
        !tracker.batchPending
      ) {
        return;
      }
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
 * Start the current repository's planning index on mount, for a surface that
 * is one of its first needs (§8.2: a document, the planning page, the file
 * tree). Re-runs `ensure` when the repository changes, and when the repo store
 * first loads. Returns the repository, as `usePlanningRepo` does.
 */
export function useEnsurePlanningIndex(): string | null {
  const repo = usePlanningRepo();
  const ensure = usePlanningStore((state) => state.ensure);
  useEffect(() => {
    if (repo !== null) ensure(repo);
  }, [repo, ensure]);
  return repo;
}

/** The current repository's planning index, started on mount. */
export function usePlanningIndex(): PlanningLoad {
  const repo = useEnsurePlanningIndex();
  return usePlanningStore((state) =>
    repo === null ? PLANNING_IDLE : (state.byRepo[repo] ?? PLANNING_IDLE),
  );
}

/**
 * One planning document of the current repository's ready index, or
 * `undefined`. Starts nothing: a row of the file tree asks this, and hundreds
 * of rows each subscribed to the whole index would all re-render on every
 * change to any document. This re-renders only when its own document does,
 * since the index keeps every other document's object as it was.
 */
export function usePlanningDocument(
  path: string,
): PlanningDocument | undefined {
  const repo = usePlanningRepo();
  return usePlanningStore((state) => {
    const load = repo === null ? undefined : state.byRepo[repo];
    return load?.status === "ready"
      ? findDocument(load.index, path)
      : undefined;
  });
}

/** The stage vocabulary of the current repository's ready index. */
export function usePlanningStages(): PlanningIndex["config"]["stages"] {
  const repo = usePlanningRepo();
  return usePlanningStore((state) => {
    const load = repo === null ? undefined : state.byRepo[repo];
    return load?.status === "ready" ? load.index.config.stages : null;
  });
}
