import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWebSocket } from "./useWebSocket";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { useReviewStore } from "../stores/useReviewStore";
import { CommentBox } from "../lib/commentAutosave";
import { useStarredStore } from "../stores/useStarredStore";
import { useFilePickerStore } from "../stores/useFilePickerStore";
import { useAllRecentsStore } from "../stores/useAllRecentsStore";
import { usePlanningStore } from "../stores/usePlanningStore";
import { useDegradedStore } from "../stores/useDegradedStore";
import { useConnectionStore } from "../stores/useConnectionStore";

vi.mock("../stores/useRepoStore");
vi.mock("../stores/useGitStore");

describe("useWebSocket", () => {
  let mockWebSocket: {
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: Event) => void) | null;
    close: ReturnType<typeof vi.fn>;
  };
  const mockLoadFile = vi.fn();
  const mockRefreshExpandedTree = vi.fn();
  const mockFetchStatus = vi.fn();
  const mockViewDirectory = vi.fn();
  const mockExpandToPath = vi.fn();
  const mockForgetExpandedDirs = vi.fn();
  const mockFetchRecentFiles = vi.fn();
  const mockMarkPathsChanged = vi.fn();
  const mockRefreshRepos = vi.fn();
  // The review store is NOT module-mocked — we swap the real store's
  // loadReview action so we observe the real call the hook makes.
  const mockLoadReview = vi.fn();
  let realLoadReview: ReturnType<typeof useReviewStore.getState>["loadReview"];
  // Same treatment for the starred store: swap the real action rather than
  // module-mocking, so this observes the call the hook actually makes.
  const mockLoadStarred = vi.fn();
  // And for the file pickers' lists.
  const mockPickerRefresh = vi.fn();
  let realPickerRefresh: ReturnType<
    typeof useFilePickerStore.getState
  >["refresh"];
  // And for the all-projects recents modal's list.
  const mockAllRecentsRefresh = vi.fn();
  let realAllRecentsRefresh: ReturnType<
    typeof useAllRecentsStore.getState
  >["refresh"];
  let realLoadStarred: ReturnType<
    typeof useStarredStore.getState
  >["loadStarred"];
  // And for the planning index, whose three socket calls are the whole of its
  // freshness (docs/reference/planning-index.md §8.3).
  const mockNoteFilesChanged = vi.fn();
  const mockNoteReviewChanged = vi.fn();
  const mockNoteReconnect = vi.fn();
  let realPlanning: Pick<
    ReturnType<typeof usePlanningStore.getState>,
    "noteFilesChanged" | "noteReviewChanged" | "noteReconnect"
  >;
  // And for the degradation banner's list, which every connect refetches. Left
  // real, that was a request to a server jsdom does not have, failing after
  // the case that opened the socket had ended and logging into a later one —
  // or, after the file's last case, into a worker already closing its channel
  // to the runner, which fails the run (EnvironmentTeardownError).
  const mockDegradedLoad = vi.fn();
  let realDegradedLoad: ReturnType<typeof useDegradedStore.getState>["load"];

  // A viewer at rest: the document it was sent to has landed, so the requested
  // path and the current one agree. useWebSocket.navigation.test.ts covers the
  // window where they do not.
  const makeRepoStoreState = (overrides: Record<string, unknown> = {}) => ({
    currentPath: "test.md",
    requestedPath: "test.md",
    loadFile: mockLoadFile,
    refreshExpandedTree: mockRefreshExpandedTree,
    viewDirectory: mockViewDirectory,
    expandToPath: mockExpandToPath,
    forgetExpandedDirs: mockForgetExpandedDirs,
    markPathsChanged: mockMarkPathsChanged,
    refreshRepos: mockRefreshRepos,
    fileTree: [],
    currentDirectory: null,
    reposLoaded: true,
    isMultiRepo: false,
    currentRepo: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    realLoadReview = useReviewStore.getState().loadReview;
    useReviewStore.setState({ loadReview: mockLoadReview });

    realLoadStarred = useStarredStore.getState().loadStarred;
    useStarredStore.setState({ loadStarred: mockLoadStarred });

    realPickerRefresh = useFilePickerStore.getState().refresh;
    useFilePickerStore.setState({ refresh: mockPickerRefresh });

    realAllRecentsRefresh = useAllRecentsStore.getState().refresh;
    useAllRecentsStore.setState({ refresh: mockAllRecentsRefresh });

    const planning = usePlanningStore.getState();
    realPlanning = {
      noteFilesChanged: planning.noteFilesChanged,
      noteReviewChanged: planning.noteReviewChanged,
      noteReconnect: planning.noteReconnect,
    };
    usePlanningStore.setState({
      noteFilesChanged: mockNoteFilesChanged,
      noteReviewChanged: mockNoteReviewChanged,
      noteReconnect: mockNoteReconnect,
    });

    realDegradedLoad = useDegradedStore.getState().load;
    useDegradedStore.setState({ load: mockDegradedLoad });

    // Mock Stores - support both destructuring and selector patterns
    const repoState = makeRepoStoreState();
    const mockUseRepoStore = (
      selector?: (state: typeof repoState) => unknown,
    ) => {
      if (typeof selector === "function") return selector(repoState);
      return repoState;
    };
    mockUseRepoStore.getState = () => repoState;
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockUseRepoStore,
    );
    // Also attach getState to the mock function itself
    (useRepoStore as unknown as { getState: () => typeof repoState }).getState =
      () => repoState;
    const gitState = {
      fetchStatus: mockFetchStatus,
      fetchRecentFiles: mockFetchRecentFiles,
    };
    (useGitStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector?: (state: typeof gitState) => unknown) => {
        if (typeof selector === "function") return selector(gitState);
        return gitState;
      },
    );

    // Mock WebSocket
    mockWebSocket = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: vi.fn(),
    };
    global.WebSocket = vi.fn(function () {
      return mockWebSocket;
    }) as unknown as typeof WebSocket;
  });

  afterEach(() => {
    useReviewStore.setState({ loadReview: realLoadReview });
    useStarredStore.setState({ loadStarred: realLoadStarred });
    useFilePickerStore.setState({ refresh: realPickerRefresh });
    useAllRecentsStore.setState({ refresh: realAllRecentsRefresh });
    usePlanningStore.setState(realPlanning);
    useDegradedStore.setState({ load: realDegradedLoad });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("connects to websocket on mount", () => {
    renderHook(() => useWebSocket());
    expect(global.WebSocket).toHaveBeenCalled();
  });

  it("handles files_changed message for current file after debounce", () => {
    renderHook(() => useWebSocket());

    const message = { type: "files_changed", paths: ["test.md"] };
    act(() => {
      mockWebSocket.onmessage!({
        data: JSON.stringify(message),
      } as MessageEvent);
    });

    // Before debounce fires, nothing should happen
    expect(mockLoadFile).not.toHaveBeenCalled();

    // After debounce
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockLoadFile).toHaveBeenCalledWith("test.md");
    expect(mockFetchStatus).toHaveBeenCalledWith("test.md");
    expect(mockRefreshExpandedTree).toHaveBeenCalled();
  });

  it("does not reload file when changed file is not the current one", () => {
    const repoState = makeRepoStoreState({
      currentPath: "other.md",
      requestedPath: "other.md",
    });
    const mockStore = (selector?: (state: typeof repoState) => unknown) => {
      if (typeof selector === "function") return selector(repoState);
      return repoState;
    };
    mockStore.getState = () => repoState;
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockStore,
    );
    (useRepoStore as unknown as { getState: () => typeof repoState }).getState =
      () => repoState;

    renderHook(() => useWebSocket());

    const message = { type: "files_changed", paths: ["test.md"] };
    act(() => {
      mockWebSocket.onmessage!({
        data: JSON.stringify(message),
      } as MessageEvent);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockLoadFile).not.toHaveBeenCalled();
    // Still refreshes tree
    expect(mockRefreshExpandedTree).toHaveBeenCalled();
  });

  // An open file picker has to follow the watcher like everything else on
  // screen: a file created while the picker is up is exactly the file the
  // reader opened it to find.
  it("refreshes an open file picker with the batch", () => {
    renderHook(() => useWebSocket());

    act(() => {
      mockWebSocket.onmessage!({
        data: JSON.stringify({ type: "files_changed", paths: ["new.md"] }),
      } as MessageEvent);
    });
    expect(mockPickerRefresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Coalesced with the rest of the batch — one refresh, not one per path.
    expect(mockPickerRefresh).toHaveBeenCalledTimes(1);
    // The all-projects recents modal follows the same batch (its refresh is a
    // no-op while it is closed).
    expect(mockAllRecentsRefresh).toHaveBeenCalledTimes(1);
  });

  // The picker refresh sits above the repo guards on purpose: the repo-picker
  // screen is where the global picker is opened, and the endpoints behind it are
  // repo-agnostic.
  it("refreshes the picker even with no repository selected", () => {
    const repoState = makeRepoStoreState({
      isMultiRepo: true,
      currentRepo: null,
    });
    const mockStore = (selector?: (state: typeof repoState) => unknown) => {
      if (typeof selector === "function") return selector(repoState);
      return repoState;
    };
    mockStore.getState = () => repoState;
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockStore,
    );
    (useRepoStore as unknown as { getState: () => typeof repoState }).getState =
      () => repoState;

    renderHook(() => useWebSocket());

    act(() => {
      mockWebSocket.onmessage!({
        data: JSON.stringify({ type: "files_changed", paths: ["new.md"] }),
      } as MessageEvent);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockPickerRefresh).toHaveBeenCalled();
    // `Shift+R` works from the repo-picker screen too.
    expect(mockAllRecentsRefresh).toHaveBeenCalled();
    // …while the repo-scoped work the guards protect is still skipped.
    expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
  });

  it("batches multiple rapid messages into one refresh", () => {
    renderHook(() => useWebSocket());

    // Simulate rapid-fire messages
    act(() => {
      mockWebSocket.onmessage!({
        data: JSON.stringify({ type: "files_changed", paths: ["a.md"] }),
      } as MessageEvent);
      mockWebSocket.onmessage!({
        data: JSON.stringify({ type: "files_changed", paths: ["b.md"] }),
      } as MessageEvent);
      mockWebSocket.onmessage!({
        data: JSON.stringify({ type: "files_changed", paths: ["c.md"] }),
      } as MessageEvent);
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Only ONE tree refresh despite 3 messages
    expect(mockRefreshExpandedTree).toHaveBeenCalledTimes(1);
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useWebSocket());
    unmount();
    expect(mockWebSocket.close).toHaveBeenCalled();
  });

  // Going from a document to the planning page unmounts one page's socket and
  // mounts the next one's. The browser fires the closed socket's close event a
  // moment after close(), and a handler still attached then read it as the
  // backend going away: the Disconnected banner flashed until the next page's
  // socket opened.
  it("does not report a disconnect when a page closes its own socket", () => {
    useConnectionStore.setState({ connected: false, disconnectedAt: null });
    const { unmount } = renderHook(() => useWebSocket());
    act(() => {
      mockWebSocket.onopen!(new Event("open"));
    });
    expect(useConnectionStore.getState().connected).toBe(true);
    const closing = mockWebSocket.onclose;
    unmount();
    expect(mockWebSocket.close).toHaveBeenCalled();
    // What the browser does next, with whatever handler is left attached.
    act(() => {
      mockWebSocket.onclose?.(new Event("close"));
    });
    expect(useConnectionStore.getState()).toMatchObject({
      connected: true,
      disconnectedAt: null,
    });
    // The handler it had is the one a dropped connection still runs.
    expect(closing).not.toBeNull();
  });

  it("stores server version from hello message without reloading", () => {
    renderHook(() => useWebSocket());

    // First hello just stores the version — no reload
    act(() => {
      mockWebSocket.onmessage!({
        data: JSON.stringify({ type: "hello", version: "v1" }),
      } as MessageEvent);
    });

    // No error thrown means it handled it gracefully
    // (we can't easily test window.location.reload without more mocking)
  });

  it("refreshes everything on reconnect", () => {
    renderHook(() => useWebSocket());

    // Simulate connection open
    act(() => {
      mockWebSocket.onopen?.(new Event("open"));
    });

    // onopen triggers a full refresh
    expect(mockRefreshExpandedTree).toHaveBeenCalled();
    expect(mockFetchRecentFiles).toHaveBeenCalled();
  });

  // A genuine reconnect: the mount's first connection is not one, and must not
  // reload anything (see the next test).
  const reconnect = () => {
    act(() => {
      mockWebSocket.onopen?.(new Event("open"));
    });
    act(() => {
      mockWebSocket.onclose?.(new Event("close"));
    });
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    mockLoadFile.mockClear();
    act(() => {
      mockWebSocket.onopen?.(new Event("open"));
    });
  };

  // The route loads the document a new mount shows. currentPath still names
  // the document the previous page showed, so reloading it on the first
  // connection superseded the route's load, and the new URL kept showing the
  // old document (g p from a document, then a card's document name).
  it("does not reload the previous document on a mount's first connection", () => {
    renderHook(() => useWebSocket());

    act(() => {
      mockWebSocket.onopen?.(new Event("open"));
    });

    expect(mockLoadFile).not.toHaveBeenCalled();
    expect(mockFetchStatus).not.toHaveBeenCalled();
    expect(mockLoadReview).not.toHaveBeenCalled();
    expect(mockViewDirectory).not.toHaveBeenCalled();
  });

  it("reloads the document on a genuine reconnect", () => {
    renderHook(() => useWebSocket());
    reconnect();
    expect(mockLoadFile).toHaveBeenCalledWith("test.md");
  });

  it("reloads review data on reconnect for a markdown file", () => {
    renderHook(() => useWebSocket());

    reconnect();

    // Agent reactions written during the outage arrived as file-change events
    // we never received. Re-fetching the review keeps the client from PUTting
    // a stale comments array back and erasing them.
    expect(mockLoadReview).toHaveBeenCalledWith("test.md");
  });

  it("does not reload review data on reconnect for a non-markdown path", () => {
    const repoState = makeRepoStoreState({
      currentPath: "docs",
      requestedPath: "docs",
    });
    const mockStore = (selector?: (state: typeof repoState) => unknown) => {
      if (typeof selector === "function") return selector(repoState);
      return repoState;
    };
    mockStore.getState = () => repoState;
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockStore,
    );
    (useRepoStore as unknown as { getState: () => typeof repoState }).getState =
      () => repoState;

    renderHook(() => useWebSocket());

    reconnect();

    // The directory branch ran...
    expect(mockViewDirectory).toHaveBeenCalledWith("docs");
    // ...and the review reload belongs only to the markdown branch
    expect(mockLoadReview).not.toHaveBeenCalled();
  });

  it("skips refresh on reconnect when repos not yet loaded", () => {
    // Override getState to return reposLoaded: false
    const unloadedState = makeRepoStoreState({ reposLoaded: false });
    (
      useRepoStore as unknown as { getState: () => typeof unloadedState }
    ).getState = () => unloadedState;

    renderHook(() => useWebSocket());

    act(() => {
      mockWebSocket.onopen?.(new Event("open"));
    });

    // Should NOT call refresh functions before repos are loaded
    expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
    expect(mockFetchRecentFiles).not.toHaveBeenCalled();
  });

  it("schedules reconnect when connection closes", () => {
    renderHook(() => useWebSocket());

    act(() => {
      mockWebSocket.onclose?.(new Event("close"));
    });

    // Should schedule a reconnect after base delay
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    // WebSocket constructor called again (initial + reconnect)
    expect(global.WebSocket).toHaveBeenCalledTimes(2);
  });

  // The daemon serves a repository as soon as it appears under a source dir and
  // stops the moment its directory goes; the picker showing either only after a
  // reload would put the restart back.
  describe("repos_changed", () => {
    it("refetches the repository list and nothing else", () => {
      renderHook(() => useWebSocket());

      act(() => {
        mockWebSocket.onmessage!({
          data: JSON.stringify({
            type: "repos_changed",
            added: [],
            removed: ["beta"],
          }),
        } as MessageEvent);
        vi.advanceTimersByTime(600);
      });

      expect(mockRefreshRepos).toHaveBeenCalledTimes(1);
      // Not a file change: the batch machinery must stay untouched.
      expect(mockLoadFile).not.toHaveBeenCalled();
      expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
    });
  });

  describe("review_changed", () => {
    const installRepoState = (overrides: Record<string, unknown> = {}) => {
      const repoState = makeRepoStoreState(overrides);
      const mockStore = (selector?: (state: typeof repoState) => unknown) => {
        if (typeof selector === "function") return selector(repoState);
        return repoState;
      };
      mockStore.getState = () => repoState;
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        mockStore,
      );
      (
        useRepoStore as unknown as { getState: () => typeof repoState }
      ).getState = () => repoState;
    };

    const send = (msg: Record<string, unknown>) => {
      act(() => {
        mockWebSocket.onmessage!({
          data: JSON.stringify(msg),
        } as MessageEvent);
      });
    };

    it("reloads the review for the document on screen, without a batch", () => {
      renderHook(() => useWebSocket());

      send({ type: "review_changed", repo: "", path: "test.md" });
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // No debounce needed: the server already committed the change, and
      // loadReview's own staleness guards handle racing local writes.
      expect(mockLoadReview).toHaveBeenCalledWith("test.md");
      // The message must not trip the files_changed batch machinery.
      expect(mockLoadFile).not.toHaveBeenCalled();
      expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
    });

    it("ignores a message for a different document", () => {
      renderHook(() => useWebSocket());

      send({ type: "review_changed", repo: "", path: "other.md" });
      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(mockLoadReview).not.toHaveBeenCalled();
    });

    it("ignores a message from another repo in multi-repo mode", () => {
      installRepoState({ isMultiRepo: true, currentRepo: "repo-a" });
      renderHook(() => useWebSocket());

      send({ type: "review_changed", repo: "repo-b", path: "test.md" });

      expect(mockLoadReview).not.toHaveBeenCalled();
    });

    it("reloads when the repo matches in multi-repo mode", () => {
      installRepoState({ isMultiRepo: true, currentRepo: "repo-a" });
      renderHook(() => useWebSocket());

      send({ type: "review_changed", repo: "repo-a", path: "test.md" });

      expect(mockLoadReview).toHaveBeenCalledWith("test.md");
    });

    it("skips the reload before repos are loaded", () => {
      installRepoState({ reposLoaded: false });
      renderHook(() => useWebSocket());

      send({ type: "review_changed", repo: "", path: "test.md" });

      expect(mockLoadReview).not.toHaveBeenCalled();
    });
  });

  // A files_changed push used to arm an "agent working" indicator here, and
  // before that a changelog_ignored push claimed the agent's response had been
  // lost. Both are gone, and nothing replaces them in this hook: a push says a
  // path changed and never says why, so an agent answering, an agent doing
  // unrelated work, and the reviewer's own editor are indistinguishable from
  // here. Whether the document moved out from under the review is now decided by
  // comparing each comment's anchored text against the reloaded content, which
  // is useReviewHighlights' job and is tested there.

  describe("reconnect on visibility change", () => {
    it("force-reconnects after being hidden for more than 30s", () => {
      renderHook(() => useWebSocket());
      const initialCalls = (global.WebSocket as ReturnType<typeof vi.fn>).mock
        .calls.length;

      // Simulate tab hidden
      act(() => {
        vi.setSystemTime(Date.now());
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // Advance time by 31 seconds
      act(() => {
        vi.advanceTimersByTime(31_000);
      });

      // Simulate tab visible again
      act(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // Should have created a new WebSocket (force reconnect)
      expect(global.WebSocket).toHaveBeenCalledTimes(initialCalls + 1);
    });

    it("does not force-reconnect when tab was hidden for less than 30s", () => {
      renderHook(() => useWebSocket());

      // Mark socket as open/healthy
      mockWebSocket.readyState = WebSocket.OPEN;
      const initialCalls = (global.WebSocket as ReturnType<typeof vi.fn>).mock
        .calls.length;

      act(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      act(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // Socket appeared healthy and hidden time < 30s — no extra reconnect
      expect(global.WebSocket).toHaveBeenCalledTimes(initialCalls);
    });
  });

  describe("degraded_changed", () => {
    // A project hitting a limit is announced once; the banner's list is the
    // server's answer to a refetch.
    it("refetches the degradation list, whatever the repo store holds", () => {
      (useRepoStore as unknown as { getState: () => unknown }).getState =
        () => ({ ...makeRepoStoreState({ reposLoaded: false }) });
      renderHook(() => useWebSocket());
      mockDegradedLoad.mockClear();

      act(() => {
        mockWebSocket.onmessage!({
          data: JSON.stringify({ type: "degraded_changed", repo: "big" }),
        } as MessageEvent);
      });
      expect(mockDegradedLoad).toHaveBeenCalledTimes(1);

      mockDegradedLoad.mockClear();
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      expect(mockDegradedLoad).toHaveBeenCalled();
    });
  });

  describe("starred_changed", () => {
    // This push is the whole cross-browser sync: starring in one tab has to
    // reach every other open tab without a reload.
    it("refetches the bookmark list", () => {
      renderHook(() => useWebSocket());

      act(() => {
        mockWebSocket.onmessage!({
          data: JSON.stringify({ type: "starred_changed" }),
        } as MessageEvent);
      });

      expect(mockLoadStarred).toHaveBeenCalled();
    });

    // Unlike review_changed, bookmarks are global and per-invocation, so the
    // refetch must not wait on a repo being loaded or selected.
    it("is not gated on the repo store", () => {
      (useRepoStore as unknown as { getState: () => unknown }).getState =
        () => ({
          ...makeRepoStoreState({
            reposLoaded: false,
            isMultiRepo: true,
            currentRepo: null,
          }),
        });

      renderHook(() => useWebSocket());

      act(() => {
        mockWebSocket.onmessage!({
          data: JSON.stringify({ type: "starred_changed" }),
        } as MessageEvent);
      });

      expect(mockLoadStarred).toHaveBeenCalled();
    });

    // A star added from another browser during an outage is only recoverable
    // on reconnect.
    it("refetches on reconnect", () => {
      renderHook(() => useWebSocket());
      mockLoadStarred.mockClear();

      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });

      expect(mockLoadStarred).toHaveBeenCalled();
    });
  });
  const send = (message: Record<string, unknown>) =>
    act(() => {
      mockWebSocket.onmessage!({
        data: JSON.stringify(message),
      } as MessageEvent);
    });

  describe("the planning index (docs/reference/planning-index.md §8.3)", () => {
    it("hands every files_changed push to the index at once, with its removed directories", () => {
      renderHook(() => useWebSocket());
      send({
        type: "files_changed",
        paths: ["docs/a.md", "other.md"],
        removed_dirs: ["docs/old"],
      });
      // Not debounced: the index sequences its own requests.
      expect(mockNoteFilesChanged).toHaveBeenCalledWith(
        "",
        ["docs/a.md", "other.md"],
        ["docs/old"],
      );
    });

    it("keys a daemon-mode push by the repository it names", () => {
      renderHook(() => useWebSocket());
      send({ type: "files_changed", paths: ["a.md"], repo: "beta" });
      expect(mockNoteFilesChanged).toHaveBeenCalledWith("beta", ["a.md"], []);
    });

    // This push used to refresh nothing else, and the test said so on purpose:
    // the viewer was not meant to read removed_dirs at all, so the watcher named
    // a removed directory's files in `paths` as well. A renamed directory's
    // files have no events to name, though, so a folder renamed under the
    // reader left the tree listing it and the document on screen claiming to
    // exist. Now the push is the viewer's too: see "a directory removed or
    // renamed under the viewer" below for what it does to the document.
    it("hands on a push that names only removed directories, and refreshes the tree and recents with it", () => {
      renderHook(() => useWebSocket());
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(mockNoteFilesChanged).toHaveBeenCalledWith("", [], ["docs/old"]);
      expect(mockRefreshExpandedTree).toHaveBeenCalledTimes(1);
      expect(mockFetchRecentFiles).toHaveBeenCalledTimes(1);
      // test.md was not inside docs/old, so it is left as it is.
      expect(mockLoadFile).not.toHaveBeenCalled();
      expect(mockMarkPathsChanged).not.toHaveBeenCalled();
    });

    it("hands on every review_changed, not only the document on screen", () => {
      renderHook(() => useWebSocket());
      send({ type: "review_changed", path: "elsewhere.md" });
      send({ type: "review_changed", path: "x.md", repo: "beta" });
      expect(mockNoteReviewChanged).toHaveBeenCalledWith("", "elsewhere.md");
      expect(mockNoteReviewChanged).toHaveBeenCalledWith("beta", "x.md");
      expect(mockLoadReview).not.toHaveBeenCalled();
    });

    // Plan Q14. Every page mounts this hook, so a mount's first connection is
    // not a reconnect, and rescanning on it would rescan on every navigation.
    it("does not call a mount's first connection a reconnect", () => {
      renderHook(() => useWebSocket());
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      expect(mockNoteReconnect).not.toHaveBeenCalled();
    });

    it("calls the mount's second connection a reconnect", () => {
      renderHook(() => useWebSocket());
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      act(() => {
        mockWebSocket.onclose!(new Event("close"));
      });
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      expect(mockNoteReconnect).toHaveBeenCalledTimes(1);
    });

    // React's StrictMode, which the dev server runs, mounts every effect twice:
    // it runs the connect effect, cleans it up, and runs it again on the same
    // component, whose refs survive. The second run opens a second socket that
    // is still the mount's first connection, and calling it a reconnect
    // rescanned the planning index on every page the dev server showed.
    it("does not call StrictMode's second connect a reconnect", () => {
      renderHook(() => useWebSocket(), { reactStrictMode: true });
      expect(global.WebSocket).toHaveBeenCalledTimes(2);
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      expect(mockNoteReconnect).not.toHaveBeenCalled();
    });

    it("leaves a ready index unrescanned through StrictMode's double connect", () => {
      // The real noteReconnect this time, over a ready index, so what is
      // asserted is the rescan itself rather than the call that would cause it.
      const rescan = vi.fn();
      const before = usePlanningStore.getState();
      usePlanningStore.setState({
        noteReconnect: realPlanning.noteReconnect,
        rescan,
        byRepo: {
          "": {
            status: "ready",
            index: {} as never,
            version: 1,
            rescanning: false,
            hashes: {},
          },
        },
      });
      try {
        renderHook(() => useWebSocket({ viewer: false }), {
          reactStrictMode: true,
        });
        act(() => {
          mockWebSocket.onopen!(new Event("open"));
        });
        expect(rescan).not.toHaveBeenCalled();

        act(() => {
          mockWebSocket.onclose!(new Event("close"));
        });
        act(() => {
          vi.advanceTimersByTime(1100);
        });
        act(() => {
          mockWebSocket.onopen!(new Event("open"));
        });
        expect(rescan).toHaveBeenCalledWith("");
      } finally {
        usePlanningStore.setState({
          rescan: before.rescan,
          byRepo: before.byRepo,
        });
      }
    });

    it("still calls a genuine reconnect under StrictMode a reconnect", () => {
      renderHook(() => useWebSocket({ viewer: false }), {
        reactStrictMode: true,
      });
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      act(() => {
        mockWebSocket.onclose!(new Event("close"));
      });
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      expect(mockNoteReconnect).toHaveBeenCalledTimes(1);
    });

    it("starts counting again in a new mount", () => {
      const first = renderHook(() => useWebSocket());
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      first.unmount();
      renderHook(() => useWebSocket());
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      expect(mockNoteReconnect).not.toHaveBeenCalled();
    });
  });

  // A renamed directory's files move without an event of their own, so the
  // push names the directory in removed_dirs and the new directory's Markdown in
  // paths (internal/live/watcher.go, filesChangedMessage). What the reader sees
  // of a document inside it is decided here.
  describe("a directory removed or renamed under the viewer", () => {
    const onMoved = vi.fn();
    const viewing = (path: string, overrides: Record<string, unknown> = {}) => {
      const repoState = makeRepoStoreState({
        currentPath: path,
        requestedPath: path,
        ...overrides,
      });
      const mockStore = (selector?: (state: typeof repoState) => unknown) => {
        if (typeof selector === "function") return selector(repoState);
        return repoState;
      };
      mockStore.getState = () => repoState;
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        mockStore,
      );
      (
        useRepoStore as unknown as { getState: () => typeof repoState }
      ).getState = () => repoState;
    };
    const settle = () =>
      act(() => {
        vi.advanceTimersByTime(600);
      });
    /** `settle`, and then whatever the batch's requests had waiting on them. */
    const settled = async () => {
      settle();
      await act(async () => {});
    };
    /** Long enough that no second half of a rename is still awaited. */
    const gone = () =>
      act(() => {
        vi.advanceTimersByTime(2000);
      });
    // The tree as it stood before the batch: the open document's folder is
    // open, so the files beside it are known.
    const tree = [
      {
        name: "docs",
        path: "docs",
        is_dir: true,
        children: [
          {
            name: "old",
            path: "docs/old",
            is_dir: true,
            children: [
              { name: "a.md", path: "docs/old/a.md", is_dir: false },
              { name: "b.md", path: "docs/old/b.md", is_dir: false },
            ],
          },
        ],
      },
    ];

    it("reloads the open document when a directory it was in went", () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket({ onMoved }));
      // Moved out of the served tree: nothing says where it went.
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      settle();
      // Asked for at once, in case it is still there, keeping what is on
      // screen if it is not: the other half of a rename may be on its way.
      expect(mockLoadFile).toHaveBeenCalledTimes(1);
      expect(mockLoadFile).toHaveBeenCalledWith("docs/old/a.md", {
        keepOnFailure: true,
      });
      expect(mockFetchStatus).toHaveBeenCalledWith("docs/old/a.md");
      expect(onMoved).not.toHaveBeenCalled();

      // None came. The reload is what lands the reader on the page that says
      // the document is gone, and loads it again if it comes back.
      gone();
      expect(mockLoadFile).toHaveBeenCalledTimes(2);
      expect(mockLoadFile).toHaveBeenLastCalledWith("docs/old/a.md");
      expect(onMoved).not.toHaveBeenCalled();
    });

    // The watcher's window, or this page's, can close between the two halves
    // of a rename under a steady stream of other changes.
    it("follows a rename whose halves arrive in two batches", async () => {
      viewing("docs/old/a.md", { fileTree: tree });
      renderHook(() => useWebSocket({ onMoved }));
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      await settled();
      expect(onMoved).not.toHaveBeenCalled();

      send({
        type: "files_changed",
        paths: ["docs/new/a.md", "docs/new/b.md"],
      });
      settle();
      expect(onMoved).toHaveBeenCalledWith("docs/old/a.md", "docs/new/a.md");
      // Never told it was gone on the way.
      gone();
      expect(mockLoadFile).not.toHaveBeenCalledWith("docs/old/a.md");
    });

    it("reads the first half's pushes with the second's", async () => {
      // Deleted, the document's removal heard: a file of its name that
      // appears a moment later elsewhere is some other document.
      viewing("gone/x.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        paths: ["gone/x.md"],
        removed_dirs: ["gone"],
      });
      await settled();
      send({ type: "files_changed", paths: ["elsewhere/x.md"] });
      await settled();
      expect(onMoved).not.toHaveBeenCalled();
      // Nor was the not-found page put off by that push.
      gone();
      expect(mockLoadFile).toHaveBeenLastCalledWith("gone/x.md");
    });

    it("waits no longer than the halves of a rename can be apart", async () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      await settled();
      gone();
      await settled();
      send({ type: "files_changed", paths: ["docs/new/a.md"] });
      await settled();
      expect(onMoved).not.toHaveBeenCalled();
    });

    it("follows the document to the renamed directory's new name", () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        paths: ["docs/new/a.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      expect(onMoved).toHaveBeenCalledWith("docs/old/a.md", "docs/new/a.md");
      // Not reloaded where it was, which would paint the not-found page on the
      // way to the document's new address.
      expect(mockLoadFile).not.toHaveBeenCalled();
      // The tree opens the new folder before it refreshes, so the refresh
      // fetches the folder's listing along with the rest.
      expect(mockExpandToPath).toHaveBeenCalledWith("docs/new/a.md");
      expect(mockExpandToPath.mock.invocationCallOrder[0]).toBeLessThan(
        mockRefreshExpandedTree.mock.invocationCallOrder[0],
      );
      expect(mockFetchRecentFiles).toHaveBeenCalledTimes(1);
    });

    it("follows it when the rename arrives as two pushes in one batch", () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      send({ type: "files_changed", paths: ["docs/new/a.md"] });
      settle();
      expect(onMoved).toHaveBeenCalledWith("docs/old/a.md", "docs/new/a.md");
      expect(mockRefreshExpandedTree).toHaveBeenCalledTimes(1);
    });

    // An agent that fixes a document and then files it away: the edit and the
    // rename land in one batch. The edit is heard, so the document is no
    // witness of its own, and its folder's other files, known from the tree,
    // say where it went.
    it("follows a document edited just before its directory was renamed", () => {
      viewing("docs/old/a.md", { fileTree: tree });
      renderHook(() => useWebSocket({ onMoved }));
      send({ type: "files_changed", paths: ["docs/old/a.md"] });
      send({
        type: "files_changed",
        paths: ["docs/new/a.md", "docs/new/b.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      expect(onMoved).toHaveBeenCalledWith("docs/old/a.md", "docs/new/a.md");
      expect(mockLoadFile).not.toHaveBeenCalled();
    });

    // A removed directory's files are pushed by their own removals; a renamed
    // one's never are. So a pushed old path says the document was deleted or
    // rebuilt where it was, and a file of its name elsewhere in the same batch
    // is some other document.
    it("does not take a deleted document for an unrelated one of its name", () => {
      viewing("docs/plans/foo/README.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        paths: ["docs/plans/foo/README.md"],
        removed_dirs: ["docs/plans/foo"],
      });
      send({ type: "files_changed", paths: ["docs/plans/bar/README.md"] });
      settle();
      gone();
      expect(onMoved).not.toHaveBeenCalled();
      expect(mockLoadFile).toHaveBeenLastCalledWith("docs/plans/foo/README.md");
    });

    it("reloads a document rebuilt where it was", () => {
      viewing("out/index.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        paths: ["docs/index.md", "out/index.md"],
        removed_dirs: ["out"],
      });
      // Asked for at once: a rebuild puts it back where it was.
      settle();
      expect(mockLoadFile).toHaveBeenCalledWith("out/index.md", {
        keepOnFailure: true,
      });
      gone();
      expect(onMoved).not.toHaveBeenCalled();
    });

    // The folder more of the directory's files arrived in, as the tree listed
    // them, is where it went.
    it("is not led off by a file of the same name edited elsewhere", () => {
      viewing("docs/old/a.md", { fileTree: tree });
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        paths: ["docs/new/a.md", "docs/new/b.md", "nearby/a.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      expect(onMoved).toHaveBeenCalledWith("docs/old/a.md", "docs/new/a.md");
    });

    it("reloads it rather than guess when two documents could be it", () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        paths: ["one/a.md", "two/a.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      gone();
      expect(onMoved).not.toHaveBeenCalled();
      expect(mockLoadFile).toHaveBeenLastCalledWith("docs/old/a.md");
    });

    it("reloads it when no page is there to follow it", () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket());
      send({
        type: "files_changed",
        paths: ["docs/new/a.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      gone();
      expect(mockLoadFile).toHaveBeenLastCalledWith("docs/old/a.md");
    });

    it("leaves the open document alone when the directory was elsewhere", () => {
      viewing("docs/keep/a.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      settle();
      expect(mockLoadFile).not.toHaveBeenCalled();
      expect(onMoved).not.toHaveBeenCalled();
      expect(mockRefreshExpandedTree).toHaveBeenCalledTimes(1);
    });

    it("reloads a directory view that was inside it", () => {
      viewing("docs/old/sub");
      renderHook(() => useWebSocket({ onMoved }));
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      settle();
      expect(mockViewDirectory).toHaveBeenCalledWith("docs/old/sub", {
        keepOnFailure: true,
      });
      gone();
      expect(mockViewDirectory).toHaveBeenLastCalledWith("docs/old/sub");
      expect(onMoved).not.toHaveBeenCalled();
    });

    // The folder's own listing says which files it held, and where they
    // arrived is where it went.
    it("follows a folder view of the renamed folder to its new name", () => {
      viewing("docs/old", {
        currentDirectory: [
          { name: "a.md", path: "docs/old/a.md", is_dir: false },
          { name: "b.md", path: "docs/old/b.md", is_dir: false },
        ],
      });
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        paths: ["docs/new/a.md", "docs/new/b.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      expect(onMoved).toHaveBeenCalledWith("docs/old", "docs/new");
      expect(mockExpandToPath).toHaveBeenCalledWith("docs/new");
      expect(mockViewDirectory).not.toHaveBeenCalled();
    });

    // Left open, a folder that went was asked for again by every refresh of
    // the tree after it, and each follow added one more.
    it("forgets that the folders that went were open", () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        paths: ["docs/new/a.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      expect(mockForgetExpandedDirs).toHaveBeenCalledWith(["docs/old"], null);
      expect(mockForgetExpandedDirs.mock.invocationCallOrder[0]).toBeLessThan(
        mockRefreshExpandedTree.mock.invocationCallOrder[0],
      );
    });

    it("keeps the folders of a document that stays on screen open", () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket({ onMoved }));
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      settle();
      expect(mockForgetExpandedDirs).toHaveBeenCalledWith(
        ["docs/old"],
        "docs/old/a.md",
      );
    });

    // A popover's words live in the popover, and an inline box's in the box:
    // replacing the document with the page saying it is gone throws them away.
    describe("while the reviewer is writing on it", () => {
      afterEach(() => {
        useReviewStore.setState({
          isReviewMode: false,
          pendingSelection: null,
        });
        document.body.innerHTML = "";
      });

      const selection = {
        anchor: {
          source_line: 1,
          block_text_hash: "x",
          selection_offset: 0,
          selection_length: 0,
        },
        rect: new DOMRect(),
        displayText: "words",
        clamped: false,
      };

      it("keeps a document that went on screen until the new comment's box closes", () => {
        viewing("docs/old/a.md");
        useReviewStore.setState({
          isReviewMode: true,
          pendingSelection: selection,
        });
        renderHook(() => useWebSocket({ onMoved }));
        send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
        settle();
        // Asked for all the same, keeping what is on screen if it is gone.
        expect(mockLoadFile).toHaveBeenCalledTimes(1);
        expect(mockLoadFile).toHaveBeenCalledWith("docs/old/a.md", {
          keepOnFailure: true,
        });

        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockLoadFile).toHaveBeenCalledTimes(1);

        act(() => {
          useReviewStore.setState({ pendingSelection: null });
          vi.advanceTimersByTime(600);
        });
        expect(mockLoadFile).toHaveBeenCalledTimes(2);
        expect(mockLoadFile).toHaveBeenLastCalledWith("docs/old/a.md");
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockLoadFile).toHaveBeenCalledTimes(2);
      });

      it("waits for an open reply or edit box until it closes, empty or not", () => {
        viewing("docs/old/a.md");
        useReviewStore.setState({ isReviewMode: true });
        // An open box, as the document's inline reply box or the panel's
        // holds one (lib/commentAutosave.ts). It saves as it is typed in, so
        // what it holds is not the question: it is drawn on the document.
        const box = new CommentBox(
          {
            kind: "reply",
            target: { base: "/api", path: "docs/old/a.md" },
            commentId: "c1",
            replyId: "r1",
            label: "Reply",
          },
          { create: async () => {}, update: async () => {} },
        );
        box.open();
        renderHook(() => useWebSocket({ onMoved }));
        send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
        settle();
        expect(mockLoadFile).toHaveBeenCalledWith("docs/old/a.md", {
          keepOnFailure: true,
        });

        gone();
        expect(mockLoadFile).toHaveBeenCalledTimes(1);
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockLoadFile).toHaveBeenCalledTimes(1);
        act(() => {
          box.close();
          vi.advanceTimersByTime(600);
        });
        expect(mockLoadFile).toHaveBeenLastCalledWith("docs/old/a.md");
      });

      it("does not wait on an empty box, nor outside review mode", () => {
        viewing("docs/old/a.md");
        useReviewStore.setState({
          isReviewMode: false,
          pendingSelection: selection,
        });
        renderHook(() => useWebSocket({ onMoved }));
        send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
        settle();
        gone();
        expect(mockLoadFile).toHaveBeenLastCalledWith("docs/old/a.md");
      });
    });

    // In daemon mode another repository's `rm -r` reaches this page too, and
    // changes nothing of the repository on screen.
    it("refreshes nothing of the viewer for another repository's removed directories", () => {
      viewing("docs/a.md", { isMultiRepo: true, currentRepo: "alpha" });
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        repo: "beta",
        paths: [],
        removed_dirs: ["build/tmp"],
      });
      settle();
      expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
      expect(mockFetchRecentFiles).not.toHaveBeenCalled();
      expect(mockForgetExpandedDirs).not.toHaveBeenCalled();
      // The all-projects lists span every repository, so they follow it.
      expect(mockPickerRefresh).toHaveBeenCalled();
      expect(mockAllRecentsRefresh).toHaveBeenCalled();
    });

    // In daemon mode every repository's pushes reach every page, and a path
    // means something only in the repository that sent it.
    it("does not follow a rename in another repository", () => {
      viewing("docs/old/a.md", { isMultiRepo: true, currentRepo: "alpha" });
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        repo: "beta",
        paths: ["docs/new/a.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      expect(onMoved).not.toHaveBeenCalled();
      expect(mockLoadFile).not.toHaveBeenCalled();
    });

    it("follows a rename in its own repository", () => {
      viewing("docs/old/a.md", { isMultiRepo: true, currentRepo: "alpha" });
      renderHook(() => useWebSocket({ onMoved }));
      send({
        type: "files_changed",
        repo: "alpha",
        paths: ["docs/new/a.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      expect(onMoved).toHaveBeenCalledWith("docs/old/a.md", "docs/new/a.md");
    });

    it("refreshes none of the viewer on a page that is not the viewer", () => {
      viewing("docs/old/a.md");
      renderHook(() => useWebSocket({ viewer: false, onMoved }));
      send({
        type: "files_changed",
        paths: ["docs/new/a.md"],
        removed_dirs: ["docs/old"],
      });
      settle();
      expect(mockNoteFilesChanged).toHaveBeenCalledWith(
        "",
        ["docs/new/a.md"],
        ["docs/old"],
      );
      expect(onMoved).not.toHaveBeenCalled();
      expect(mockLoadFile).not.toHaveBeenCalled();
      expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
    });
  });

  describe("{ viewer: false }", () => {
    it("keeps the planning index fresh and refreshes none of the viewer", () => {
      renderHook(() => useWebSocket({ viewer: false }));
      send({ type: "files_changed", paths: ["test.md"] });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(mockNoteFilesChanged).toHaveBeenCalledWith("", ["test.md"], []);
      expect(mockPickerRefresh).toHaveBeenCalled();
      expect(mockMarkPathsChanged).not.toHaveBeenCalled();
      expect(mockLoadFile).not.toHaveBeenCalled();
      expect(mockFetchStatus).not.toHaveBeenCalled();
      expect(mockLoadReview).not.toHaveBeenCalled();
      expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
      expect(mockFetchRecentFiles).not.toHaveBeenCalled();
    });

    it("hands on review_changed without reloading a review", () => {
      renderHook(() => useWebSocket({ viewer: false }));
      send({ type: "review_changed", path: "test.md" });
      expect(mockNoteReviewChanged).toHaveBeenCalledWith("", "test.md");
      expect(mockLoadReview).not.toHaveBeenCalled();
    });

    it("refreshes bookmarks and pickers on connect, and not the document", () => {
      renderHook(() => useWebSocket({ viewer: false }));
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      expect(mockLoadStarred).toHaveBeenCalled();
      expect(mockPickerRefresh).toHaveBeenCalled();
      expect(mockLoadFile).not.toHaveBeenCalled();
      expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
      expect(mockFetchRecentFiles).not.toHaveBeenCalled();
    });

    it("still refetches the repository list", () => {
      renderHook(() => useWebSocket({ viewer: false }));
      send({ type: "repos_changed", added: ["x"] });
      expect(mockRefreshRepos).toHaveBeenCalled();
    });

    it("still calls a genuine reconnect a reconnect", () => {
      renderHook(() => useWebSocket({ viewer: false }));
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      act(() => {
        mockWebSocket.onclose!(new Event("close"));
      });
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      act(() => {
        mockWebSocket.onopen!(new Event("open"));
      });
      expect(mockNoteReconnect).toHaveBeenCalledTimes(1);
    });
  });
});
