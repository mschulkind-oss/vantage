import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWebSocket } from "./useWebSocket";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { useReviewStore } from "../stores/useReviewStore";
import { useStarredStore } from "../stores/useStarredStore";
import { useFilePickerStore } from "../stores/useFilePickerStore";
import { useAllRecentsStore } from "../stores/useAllRecentsStore";
import { usePlanningStore } from "../stores/usePlanningStore";
import { useDegradedStore } from "../stores/useDegradedStore";

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
  // freshness (docs/design/planning-index.md §3.4).
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
    markPathsChanged: mockMarkPathsChanged,
    refreshRepos: mockRefreshRepos,
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
  // old document (g p from a document, then Open document on a card).
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

  describe("the planning index (docs/design/planning-index.md §3.4)", () => {
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

    it("hands on a push that names only removed directories, and refreshes nothing else", () => {
      renderHook(() => useWebSocket());
      send({ type: "files_changed", paths: [], removed_dirs: ["docs/old"] });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(mockNoteFilesChanged).toHaveBeenCalledWith("", [], ["docs/old"]);
      expect(mockRefreshExpandedTree).not.toHaveBeenCalled();
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
            sources: {},
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
