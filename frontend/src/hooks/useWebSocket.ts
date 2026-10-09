import { useEffect, useRef, useCallback } from "react";
import { useRepoStore, type LoadOptions } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useReviewStore } from "../stores/useReviewStore";
import { useStarredStore } from "../stores/useStarredStore";
import { useDegradedStore } from "../stores/useDegradedStore";
import { useFilePickerStore } from "../stores/useFilePickerStore";
import { useAllRecentsStore } from "../stores/useAllRecentsStore";
import { usePlanningStore } from "../stores/usePlanningStore";
import { WebSocketMessage } from "../types";
import { isStaticMode } from "../lib/staticMode";
import { filesWithin, isWithin, renamedTo } from "../lib/removedDirs";
import { hasOpenBox } from "../lib/commentAutosave";
import { wsLog, bindLoggerSocket } from "../lib/wsLogger";

// Debounce window: collect all messages within this period, then process once
const DEBOUNCE_MS = 150;
// Maximum time before forced processing, even if messages keep arriving
const MAX_WAIT_MS = 500;
// Reconnection delays
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
// How long a removal of the open document's folder that did not say where it
// went waits for the other half of a rename: longer than the watcher's own
// window (maxWait in internal/live/watcher.go) and this one's together
const RENAME_HALVES_MS = 1500;
// How often a document that went asks whether it may say so yet
const GONE_POLL_MS = 250;

/**
 * The path a refresh reloads: the one the viewer was last sent to, read at the
 * moment of the refresh. Not `currentPath`, which lags a navigation until its
 * response lands — a refresh of it in that window reloads the page being left,
 * and as the newer load it wins, stranding the reader there. See
 * `requestedPath` in useRepoStore.
 */
const viewerPath = () => useRepoStore.getState().requestedPath;

/**
 * The document whose review a refresh reloads: the one on screen, and only once
 * the navigation to it has landed, so `null` while one is loading. The review
 * store follows the page on screen, because `loadReview` switches it to the
 * path it is given, and highlights and open-question buttons read it against
 * the page rendered now. A destination's review loaded early anchored its
 * comments against the page being left, and a button clicked in that window
 * added to the destination's review. ViewerPage loads the review when the
 * document lands, which is also after any push that arrived meanwhile.
 */
const reviewPath = () => {
  const { currentPath, requestedPath } = useRepoStore.getState();
  return currentPath === requestedPath ? currentPath : null;
};

/**
 * Whether the reader is in the middle of writing in review mode: a comment box
 * is open on the document — a new comment's popover, or an edit or reply box
 * inline or in the review panel. A box saves as it is typed in, but it is
 * drawn on the document, so replacing the document with the page saying it is
 * gone would end it under the reader; the reload waits until the box closes
 * (docs/design/planning-to-do-list.md §6.1).
 */
const writingInReview = () => {
  const { isReviewMode, pendingSelection } = useReviewStore.getState();
  return isReviewMode && (pendingSelection !== null || hasOpenBox());
};

/** What the pushes waiting for the next batch named, for one repository. */
interface PendingChange {
  paths: Set<string>;
  removedDirs: Set<string>;
}

export interface UseWebSocketOptions {
  /**
   * Whether this page is the viewer. `false` skips everything that refreshes
   * the viewer's world — the document, its git status and review, the tree and
   * the sidebar's recent files — and keeps the planning index, the bookmarks,
   * the file pickers, the repository list and the version check. The planning
   * page passes it. Default `true`.
   */
  viewer?: boolean;
  /**
   * Where the open document or folder went, when a directory it was in, or
   * is, was renamed and the push shows its new path (`renamedTo` in
   * lib/removedDirs.ts). The page takes the reader there; the tree has already
   * been opened on it. Without this, or when the push does not show where it
   * went, it is reloaded where it was, which shows it is gone. ViewerPage
   * passes it.
   */
  onMoved?: (from: string, to: string) => void;
}

export const useWebSocket = (options: UseWebSocketOptions = {}) => {
  const viewer = options.viewer ?? true;
  // No WebSocket in static mode — there's no backend to connect to
  const staticMode = isStaticMode();

  const socketRef = useRef<WebSocket | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The pushes waiting for the next batch, by the repository that sent them
   * (`""` for the single repository). A path means something only in its own
   * repository, and in daemon mode every repository's pushes reach every page.
   */
  const pendingRef = useRef<Map<string, PendingChange>>(new Map());
  const processingRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverVersionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const hiddenAtRef = useRef<number | null>(null);
  const disconnectedAtRef = useRef<number | null>(null);
  const connectCountRef = useRef(0);
  // Read when a batch runs, which is long after the render that set it: the
  // socket keeps the handlers it was opened with.
  const onMovedRef = useRef(options.onMoved);
  useEffect(() => {
    onMovedRef.current = options.onMoved;
  });
  /**
   * A removal of the open document's folder that did not say where it went,
   * read again with the batches after it until `until` (RENAME_HALVES_MS): the
   * removed directories, what the batch pushed, and the files the viewer knew
   * were in them.
   */
  const unmatchedRef = useRef<{
    path: string;
    dirs: string[];
    paths: string[];
    known: string[];
    until: number;
  } | null>(null);
  /** The wait before a document that went is loaded again to say so. */
  const goneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (goneTimerRef.current) clearInterval(goneTimerRef.current);
    },
    [],
  );

  const {
    loadFile,
    refreshExpandedTree,
    viewDirectory,
    expandToPath,
    forgetExpandedDirs,
  } = useRepoStore();
  const { fetchStatus, fetchRecentFiles } = useGitStore();
  const markPathsChanged = useRepoStore((s) => s.markPathsChanged);

  const processBatch = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.size === 0) {
      // Nothing pending — clean up timers
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = null;
      }
      return;
    }

    if (processingRef.current) {
      // Still processing previous batch — reschedule instead of dropping
      wsLog.log(
        "[ws] processBatch deferred: previous batch still processing, %d repositories pending",
        pending.size,
      );
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(processBatch, DEBOUNCE_MS); // eslint-disable-line react-hooks/immutability -- intentional self-reschedule
      return;
    }

    // Committed to processing — clear timers
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }

    // An open file picker follows the batch, and sits above the repo guards
    // below: its global mode is what the repo-picker screen opens, and that
    // mode's endpoints are repo-agnostic — the same reason the bookmark
    // refresh sits above them in refreshAfterReconnect. A closed picker makes
    // this a no-op, so nothing is fetched for a list nobody is looking at.
    void useFilePickerStore.getState().refresh();
    // The all-projects recents modal, likewise: repo-agnostic, and a no-op
    // while it is closed.
    void useAllRecentsStore.getState().refresh();

    // Everything below refreshes the viewer, which a page that is not the
    // viewer has not got. Its planning index follows each push as it arrives,
    // in handleMessage, rather than here.
    if (!viewer) {
      pendingRef.current = new Map();
      return;
    }

    // Guard: don't fire API calls before the repo store is initialized
    const { reposLoaded, isMultiRepo, currentRepo } = useRepoStore.getState();
    if (!reposLoaded) return;
    if (isMultiRepo && !currentRepo) return;

    pendingRef.current = new Map();
    processingRef.current = true;

    // Every repository's paths, as the viewer has always compared them with
    // the open document's; the removed directories only of the repository on
    // screen, since following one elsewhere would take the reader to a path
    // of another repository's.
    const changedPaths = new Set<string>();
    for (const change of pending.values()) {
      for (const p of change.paths) changedPaths.add(p);
    }
    const here = pending.get(isMultiRepo ? (currentRepo ?? "") : "");
    const removedDirs = here ? [...here.removedDirs] : [];

    wsLog.log(
      "[ws] Processing batch: %d paths changed, %d directories removed",
      changedPaths.size,
      removedDirs.length,
    );

    // Trigger flash animation for changed paths
    if (changedPaths.size > 0) markPathsChanged(changedPaths);

    const path = viewerPath();
    const isDocument = !!path && path.toLowerCase().endsWith(".md");

    // Fire all API calls in parallel rather than sequentially
    const promises: Promise<unknown>[] = [];

    // A document or folder inside a directory that went is taken to where a
    // rename put it, when the pushes show that, and otherwise loaded again,
    // which lands the reader on the page saying it is gone. What the viewer
    // knew was in the directories is read before the tree's refresh below
    // forgets it.
    //
    // The two halves of a rename can reach the viewer in two batches: the
    // watcher's own window can close between them under a steady stream of
    // other changes, and so can this one's. So a removal that did not say
    // where the document went is carried into the batches after it for
    // RENAME_HALVES_MS, with what that batch pushed and what the viewer knew,
    // and read with each of them as one.
    const now = Date.now();
    const unmatched = unmatchedRef.current;
    const carried =
      unmatched && unmatched.path === path && now < unmatched.until
        ? unmatched
        : null;
    unmatchedRef.current = null;
    const goneNow = !!path && removedDirs.some((dir) => isWithin(path, dir));
    const onMoved = onMovedRef.current;
    let movedTo: string | null = null;
    if (path && (goneNow || carried) && onMoved) {
      const dirs = [...new Set([...removedDirs, ...(carried?.dirs ?? [])])];
      const pushed = [...(here?.paths ?? []), ...(carried?.paths ?? [])];
      const { fileTree, currentDirectory } = useRepoStore.getState();
      const known = [
        ...filesWithin([fileTree, currentDirectory], dirs),
        ...(carried?.known ?? []),
      ];
      movedTo = renamedTo(path, dirs, pushed, known);
      if (!movedTo) {
        unmatchedRef.current = {
          path,
          dirs,
          paths: pushed,
          known,
          until: carried?.until ?? now + RENAME_HALVES_MS,
        };
      }
    }
    // Gone from the tree, so the folders inside them are no longer open: left
    // open, each was asked for again by every refresh after this one. Those of
    // a document that stays on screen stay open, to show it again if it comes
    // back.
    if (removedDirs.length > 0) {
      forgetExpandedDirs(removedDirs, movedTo ? null : path);
    }

    if (path && movedTo && onMoved) {
      wsLog.log("[ws] %s was renamed to %s", path, movedTo);
      if (goneTimerRef.current) clearInterval(goneTimerRef.current);
      goneTimerRef.current = null;
      // Where the viewer is sent from now on, before the page's navigation
      // gets there: the review's move answers with a review_changed for the
      // old path, which could otherwise arrive first, find the old path still
      // the page's, and reload a review that is no longer filed there.
      useRepoStore.setState({ requestedPath: movedTo });
      // Before the tree's refresh below, so that refresh fetches the new
      // folder's listing with the rest, open.
      expandToPath(movedTo);
      onMoved(path, movedTo);
    } else if (path && goneNow) {
      // Loaded at once, in case it is still there, as after a rebuild in
      // place, but keeping what is on screen if it is not: the other half of
      // a rename may be on its way. Only once none has come, and the reader is
      // not in the middle of writing a comment on it, which the page saying
      // it is gone would throw away, is it loaded again to say so.
      const keeping: LoadOptions = { keepOnFailure: true };
      promises.push(
        isDocument ? loadFile(path, keeping) : viewDirectory(path, keeping),
      );
      if (isDocument) promises.push(fetchStatus(path));
      const settleAt = unmatchedRef.current?.until ?? now + RENAME_HALVES_MS;
      if (goneTimerRef.current) clearInterval(goneTimerRef.current);
      goneTimerRef.current = setInterval(() => {
        if (Date.now() < settleAt || writingInReview()) return;
        if (goneTimerRef.current) clearInterval(goneTimerRef.current);
        goneTimerRef.current = null;
        if (viewerPath() !== path) return;
        if (isDocument) void loadFile(path);
        else void viewDirectory(path);
      }, GONE_POLL_MS);
    } else if (path && isDocument && changedPaths.has(path)) {
      promises.push(loadFile(path));
      promises.push(fetchStatus(path));
      // Re-fetch review data so server-written state (e.g. anchor-relevant
      // captures after an agent edit) stays fresh without a page reload.
      if (path === reviewPath()) {
        promises.push(useReviewStore.getState().loadReview(path));
      }
    } else if (path && !isDocument) {
      promises.push(viewDirectory(path));
    }

    // A push from another repository that only removed directories changes
    // nothing of this one's.
    if (changedPaths.size > 0 || removedDirs.length > 0) {
      promises.push(refreshExpandedTree());
      promises.push(fetchRecentFiles());
    }

    Promise.all(promises).then(() => {
      processingRef.current = false;
    });
  }, [
    viewer,
    loadFile,
    refreshExpandedTree,
    fetchStatus,
    viewDirectory,
    expandToPath,
    forgetExpandedDirs,
    fetchRecentFiles,
    markPathsChanged,
  ]);

  /**
   * Do a full refresh after connecting (we may have missed changes).
   *
   * `initial` is a mount's first connection. It refreshes the stores but not
   * the document: the route loads that, and `currentPath` still names the
   * document the previous page showed until the route's load lands. Reloading
   * it here superseded the route's load (`loadFile` keeps only its newest
   * request), so the new URL kept showing the old document.
   */
  const refreshAfterReconnect = useCallback(
    (initial: boolean) => {
      // Bookmarks first, above the repo guards: /api/starred is global, so it
      // neither needs a selected repo nor waits for one. A star added from
      // another browser during the outage is only recoverable here.
      void useStarredStore.getState().loadStarred();
      // A limit hit during the outage announced itself to nobody.
      void useDegradedStore.getState().load();
      // Likewise a picker left open across the outage: every change the watcher
      // announced while the socket was down is only recoverable here.
      void useFilePickerStore.getState().refresh();
      void useAllRecentsStore.getState().refresh();
      if (!viewer) return;

      // Guard: don't fire API calls before the repo store is initialized.
      // Before loadRepos() completes, isMultiRepo defaults to false and
      // getApiBase() returns "/api", which 404s in multi-repo setups.
      const { reposLoaded, isMultiRepo, currentRepo } = useRepoStore.getState();
      if (!reposLoaded) return;
      if (isMultiRepo && !currentRepo) return;

      const path = initial ? null : viewerPath();
      wsLog.log("[ws] Refreshing after reconnect (path=%s)", path ?? "(none)");

      if (path) {
        if (path.toLowerCase().endsWith(".md")) {
          loadFile(path);
          fetchStatus(path);
          // Reactions delivered during the outage arrived as review_changed
          // events we never received. Without this reload the client keeps a
          // stale comments array until the next server push or manual refresh.
          if (path === reviewPath()) useReviewStore.getState().loadReview(path);
        } else {
          viewDirectory(path);
        }
      }
      refreshExpandedTree();
      fetchRecentFiles();
    },
    [
      viewer,
      loadFile,
      refreshExpandedTree,
      fetchStatus,
      viewDirectory,
      fetchRecentFiles,
    ],
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const message: WebSocketMessage = JSON.parse(event.data);

      if (message.type === "hello") {
        const version = message.version;
        if (!version) return;
        if (serverVersionRef.current === null) {
          // First connect — just record it
          serverVersionRef.current = version;
          wsLog.log("[ws] Server hello: version=%s", version);
        } else if (serverVersionRef.current !== version) {
          // Server restarted with new code — force reload
          wsLog.log(
            "[ws] Server version changed: %s → %s, reloading page",
            serverVersionRef.current,
            version,
          );
          window.location.reload();
          return;
        } else {
          wsLog.log("[ws] Server hello: version=%s (unchanged)", version);
        }
        return;
      }

      if (message.type === "repos_changed") {
        // The set of served repositories changed: one appeared under a source
        // dir, or one's directory went away. Refetch the list so the project
        // picker follows without a reload — and so the viewer, which keys off
        // that list, either shows its "repository not found" page or loads the
        // document it was on when the repo comes back.
        wsLog.log(
          "[ws] repos_changed: +[%s] -[%s]",
          (message.added ?? []).join(", "),
          (message.removed ?? []).join(", "),
        );
        void useRepoStore.getState().refreshRepos();
        return;
      }

      if (message.type === "starred_changed") {
        // Deliberately ungated: unlike review_changed, the bookmark list is
        // repo-agnostic and per-invocation, so it is refetched whatever the
        // repo store currently holds. The payload is empty by design — the
        // push says "changed" and the list is the server's answer, so two
        // near-simultaneous mutations cannot leave a client holding a list
        // nobody has.
        wsLog.log("[ws] starred_changed");
        void useStarredStore.getState().loadStarred();
        return;
      }

      if (message.type === "degraded_changed") {
        // A project just hit a limit it is too big for. Ungated like
        // starred_changed: the list is global and the banner filters it.
        wsLog.log("[ws] degraded_changed: %s", message.repo ?? "");
        void useDegradedStore.getState().load();
        return;
      }

      if (message.type === "review_changed" && message.path) {
        // Every document's, not only the one on screen: the planning page
        // shows comments from many documents at once. `repo` is sent only in
        // daemon mode, so its absence is the single repository.
        usePlanningStore
          .getState()
          .noteReviewChanged(message.repo ?? "", message.path);
        if (!viewer) return;
        // A review command or an inbox delivery changed this document's
        // review server-side. Reload it when it's the document on screen and
        // its navigation has landed; loadReview's staleness guards discard the
        // response if the reviewer writes or navigates while it's in flight.
        const { reposLoaded, isMultiRepo, currentRepo } =
          useRepoStore.getState();
        if (!reposLoaded) return;
        if (isMultiRepo && (!currentRepo || message.repo !== currentRepo)) {
          return;
        }
        if (message.path === reviewPath()) {
          wsLog.log("[ws] review_changed: %s", message.path);
          useReviewStore.getState().loadReview(message.path);
        }
        return;
      }

      if (message.type === "files_changed") {
        const paths = message.paths ?? [];
        const removedDirs = message.removed_dirs ?? [];
        // Per message, not per batch: the batch below holds bare paths, and a
        // path is only meaningful to the index with the repository it is in.
        // `repo` is sent only in daemon mode, so its absence is the single
        // repository.
        usePlanningStore
          .getState()
          .noteFilesChanged(message.repo ?? "", paths, removedDirs);
        if (paths.length === 0 && removedDirs.length === 0) return;
        wsLog.log(
          "[ws] files_changed: %d paths: %s; removed directories: %s",
          paths.length,
          paths.join(", "),
          removedDirs.join(", ") || "(none)",
        );
        // Note this handler draws no conclusion from why anything changed.
        // Whether the document moved out from under the review is decided by
        // comparing each comment's anchored text against the reloaded content
        // (see useReviewHighlights), which the loadFile below triggers. A push
        // says a path changed and never says why — an agent answering, an agent
        // doing unrelated work, the reviewer's own editor, and a git checkout
        // are indistinguishable here, so nothing is inferred from arrival
        // alone. The one thing read from a push's shape is where a renamed
        // directory put the open document (`renamedTo`), which is a fact about
        // paths, not about anyone's intent.
        const repo = message.repo ?? "";
        let change = pendingRef.current.get(repo);
        if (!change) {
          change = { paths: new Set(), removedDirs: new Set() };
          pendingRef.current.set(repo, change);
        }
        for (const p of paths) change.paths.add(p);
        for (const dir of removedDirs) change.removedDirs.add(dir);

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(processBatch, DEBOUNCE_MS);

        if (!maxWaitTimerRef.current) {
          maxWaitTimerRef.current = setTimeout(processBatch, MAX_WAIT_MS);
        }
      }
    },
    [processBatch, viewer],
  );

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    // Clean up existing socket
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      if (socketRef.current.readyState <= WebSocket.OPEN) {
        socketRef.current.close();
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/api/ws`;
    const connectNum = ++connectCountRef.current;
    wsLog.log("[ws] Connecting (#%d) to %s", connectNum, url);
    const socket = new WebSocket(url);

    socket.onopen = () => {
      const downtime = disconnectedAtRef.current
        ? `${((Date.now() - disconnectedAtRef.current) / 1000).toFixed(1)}s`
        : null;
      disconnectedAtRef.current = null;
      // Bind first so the "Connected" line itself ships, and any
      // entries buffered during the offline window are flushed.
      bindLoggerSocket(socket);
      wsLog.log(
        "[ws] Connected (#%d)%s",
        connectNum,
        downtime ? ` — was disconnected for ${downtime}` : " (initial)",
      );
      reconnectAttemptRef.current = 0;
      useConnectionStore.getState().setConnected(true);
      // Refresh everything since we may have missed changes while disconnected
      refreshAfterReconnect(connectNum === 1);
      // A genuine reconnect only (Plan Q14). Every page mounts this hook, and
      // every mount's first connection is #1, so "reconnect" on #1 would rescan
      // the whole planning index on each navigation. The second and later
      // connections of a mount follow a dropped socket, or the forced
      // reconnect after 30 s hidden, and in both some pushes may be lost.
      if (connectNum > 1) usePlanningStore.getState().noteReconnect();
    };

    socket.onmessage = handleMessage;

    socket.onerror = (error) => {
      wsLog.error("[ws] Error on connection #%d:", connectNum, error);
    };

    socket.onclose = (event: CloseEvent) => {
      disconnectedAtRef.current = Date.now();
      useConnectionStore.getState().setConnected(false);
      bindLoggerSocket(null);
      wsLog.log(
        "[ws] Closed (#%d): code=%d reason=%s wasClean=%s",
        connectNum,
        event.code,
        event.reason || "(none)",
        event.wasClean,
      );
      socketRef.current = null;
      // Schedule a reconnect (defer via ref to avoid circular dependency)
      if (!reconnectTimerRef.current && mountedRef.current) {
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, attempt),
          RECONNECT_MAX_MS,
        );
        reconnectAttemptRef.current = attempt + 1;
        wsLog.log(
          "[ws] Scheduling reconnect in %dms (attempt %d)",
          delay,
          attempt + 1,
        );
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect(); // eslint-disable-line react-hooks/immutability
        }, delay);
      }
    };

    socketRef.current = socket;
  }, [handleMessage, refreshAfterReconnect]);

  // Reconnect immediately on user activity when socket is dead
  useEffect(() => {
    if (staticMode) return;
    const tryImmediateReconnect = () => {
      const state = socketRef.current?.readyState ?? -1;
      const stateNames: Record<number, string> = {
        [-1]: "null",
        [WebSocket.CONNECTING]: "CONNECTING",
        [WebSocket.OPEN]: "OPEN",
        [WebSocket.CLOSING]: "CLOSING",
        [WebSocket.CLOSED]: "CLOSED",
      };
      if (!socketRef.current || socketRef.current.readyState > WebSocket.OPEN) {
        wsLog.log(
          "[ws] Immediate reconnect triggered (readyState=%s)",
          stateNames[state] ?? state,
        );
        // Cancel any pending scheduled reconnect and connect now
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        reconnectAttemptRef.current = 0;
        connect();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        wsLog.log("[ws] Tab hidden");
      } else if (document.visibilityState === "visible") {
        const hiddenMs =
          hiddenAtRef.current !== null
            ? Date.now() - hiddenAtRef.current
            : Infinity;
        hiddenAtRef.current = null;
        const hiddenStr =
          hiddenMs === Infinity
            ? "unknown"
            : hiddenMs < 1000
              ? `${hiddenMs}ms`
              : `${(hiddenMs / 1000).toFixed(1)}s`;
        wsLog.log(
          "[ws] Tab visible (was hidden for %s, readyState=%s)",
          hiddenStr,
          socketRef.current?.readyState ?? "null",
        );
        if (hiddenMs > 30_000) {
          // After 30s+ hidden, force reconnect regardless of readyState —
          // the socket may appear OPEN but the underlying TCP connection is dead.
          wsLog.log(
            "[ws] Force reconnect: tab was hidden for %s (>30s threshold)",
            hiddenStr,
          );
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          reconnectAttemptRef.current = 0;
          connect();
        } else {
          tryImmediateReconnect();
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("mousemove", tryImmediateReconnect, {
      once: true,
      capture: true,
    });
    document.addEventListener("click", tryImmediateReconnect, {
      capture: true,
    });
    document.addEventListener("keydown", tryImmediateReconnect, {
      capture: true,
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("mousemove", tryImmediateReconnect, {
        capture: true,
      });
      document.removeEventListener("click", tryImmediateReconnect, {
        capture: true,
      });
      document.removeEventListener("keydown", tryImmediateReconnect, {
        capture: true,
      });
    };
  }, [connect, staticMode]);

  // Initial connection
  useEffect(() => {
    if (staticMode) return;
    mountedRef.current = true;
    // Connections are counted per run of this effect, not per component. In
    // StrictMode (the dev server) React runs it, cleans it up and runs it
    // again on the same component, whose refs survive, so a count kept across
    // runs made the mount's first real connection #2 — and #2 is what calls
    // the planning index's reconnect, which rescanned it on every page.
    connectCountRef.current = 0;
    connect();

    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      // The page is leaving, not the backend: going from a document to the
      // planning page closes this page's socket and opens the next one's. So
      // the handlers go first, as they do before a reconnect, or the close
      // event the browser fires a moment later would mark the app
      // disconnected and flash the banner until the next socket opened.
      const socket = socketRef.current;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
        socketRef.current = null;
        bindLoggerSocket(null);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- staticMode and connect intentionally excluded (mount once only)
};
