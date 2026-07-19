import { useEffect, useRef, useCallback } from "react";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useReviewStore } from "../stores/useReviewStore";
import { WebSocketMessage } from "../types";
import { isStaticMode } from "../lib/staticMode";
import { wsLog, bindLoggerSocket } from "../lib/wsLogger";

// Debounce window: collect all messages within this period, then process once
const DEBOUNCE_MS = 150;
// Maximum time before forced processing, even if messages keep arriving
const MAX_WAIT_MS = 500;
// Reconnection delays
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export const useWebSocket = () => {
  // No WebSocket in static mode — there's no backend to connect to
  const staticMode = isStaticMode();

  const socketRef = useRef<WebSocket | null>(null);
  const currentPathRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPathsRef = useRef<Set<string>>(new Set());
  const processingRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverVersionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const hiddenAtRef = useRef<number | null>(null);
  const disconnectedAtRef = useRef<number | null>(null);
  const connectCountRef = useRef(0);

  const { currentPath, loadFile, refreshExpandedTree, viewDirectory } =
    useRepoStore();
  const { fetchStatus, fetchRecentFiles } = useGitStore();
  const markPathsChanged = useRepoStore((s) => s.markPathsChanged);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const processBatch = useCallback(() => {
    const changedPaths = pendingPathsRef.current;
    if (changedPaths.size === 0) {
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
        "[ws] processBatch deferred: previous batch still processing, %d paths pending",
        changedPaths.size,
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

    // Guard: don't fire API calls before the repo store is initialised
    const { reposLoaded, isMultiRepo, currentRepo } = useRepoStore.getState();
    if (!reposLoaded) return;
    if (isMultiRepo && !currentRepo) return;

    pendingPathsRef.current = new Set();
    processingRef.current = true;

    wsLog.log("[ws] Processing batch: %d paths changed", changedPaths.size);

    // Trigger flash animation for changed paths
    markPathsChanged(changedPaths);

    const path = currentPathRef.current;

    // Fire all API calls in parallel rather than sequentially
    const promises: Promise<unknown>[] = [];

    if (path && changedPaths.has(path)) {
      promises.push(loadFile(path));
      promises.push(fetchStatus(path));
      // Re-fetch review data so server-written reactions (from the
      // changelog parser running in the watcher) surface live, without
      // requiring a page reload.
      if (path.toLowerCase().endsWith(".md")) {
        promises.push(useReviewStore.getState().loadReview(path));
      }
    }

    if (path && !path.toLowerCase().endsWith(".md")) {
      promises.push(viewDirectory(path));
    }

    promises.push(refreshExpandedTree());
    promises.push(fetchRecentFiles());

    Promise.all(promises).then(() => {
      processingRef.current = false;
    });
  }, [
    loadFile,
    refreshExpandedTree,
    fetchStatus,
    viewDirectory,
    fetchRecentFiles,
    markPathsChanged,
  ]);

  /** Do a full refresh after reconnecting (we may have missed changes). */
  const refreshAfterReconnect = useCallback(() => {
    // Guard: don't fire API calls before the repo store is initialised.
    // Before loadRepos() completes, isMultiRepo defaults to false and
    // getApiBase() returns "/api", which 404s in multi-repo setups.
    const { reposLoaded, isMultiRepo, currentRepo } = useRepoStore.getState();
    if (!reposLoaded) return;
    if (isMultiRepo && !currentRepo) return;

    const path = currentPathRef.current;
    wsLog.log("[ws] Refreshing after reconnect (path=%s)", path ?? "(none)");

    if (path) {
      if (path.toLowerCase().endsWith(".md")) {
        loadFile(path);
        fetchStatus(path);
        // Reactions the agent wrote during the outage arrived as file-change
        // events we never received. Without this reload the client keeps a
        // stale comments array and the reviewer's next action PUTs it back,
        // erasing every agent response written while we were disconnected.
        useReviewStore.getState().loadReview(path);
      } else {
        viewDirectory(path);
      }
    }
    refreshExpandedTree();
    fetchRecentFiles();
  }, [
    loadFile,
    refreshExpandedTree,
    fetchStatus,
    viewDirectory,
    fetchRecentFiles,
  ]);

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

      if (message.type === "files_changed" && message.paths) {
        wsLog.log(
          "[ws] files_changed: %d paths: %s",
          message.paths.length,
          message.paths.join(", "),
        );
        for (const p of message.paths) {
          pendingPathsRef.current.add(p);
        }

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(processBatch, DEBOUNCE_MS);

        if (!maxWaitTimerRef.current) {
          maxWaitTimerRef.current = setTimeout(processBatch, MAX_WAIT_MS);
        }
      }
    },
    [processBatch],
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
      refreshAfterReconnect();
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
    connect();

    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- staticMode and connect intentionally excluded (mount once only)
};
