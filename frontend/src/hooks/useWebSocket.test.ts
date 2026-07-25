import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWebSocket } from "./useWebSocket";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { useReviewStore } from "../stores/useReviewStore";

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
  // The review store is NOT module-mocked — we swap the real store's
  // loadReview action so we observe the real call the hook makes.
  const mockLoadReview = vi.fn();
  let realLoadReview: ReturnType<typeof useReviewStore.getState>["loadReview"];

  const makeRepoStoreState = (overrides: Record<string, unknown> = {}) => ({
    currentPath: "test.md",
    loadFile: mockLoadFile,
    refreshExpandedTree: mockRefreshExpandedTree,
    viewDirectory: mockViewDirectory,
    markPathsChanged: mockMarkPathsChanged,
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
    const repoState = makeRepoStoreState({ currentPath: "other.md" });
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

  it("reloads review data on reconnect for a markdown file", () => {
    renderHook(() => useWebSocket());

    act(() => {
      mockWebSocket.onopen?.(new Event("open"));
    });

    // Agent reactions written during the outage arrived as file-change events
    // we never received. Re-fetching the review keeps the client from PUTting
    // a stale comments array back and erasing them.
    expect(mockLoadReview).toHaveBeenCalledWith("test.md");
  });

  it("does not reload review data on reconnect for a non-markdown path", () => {
    const repoState = makeRepoStoreState({ currentPath: "docs" });
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
      mockWebSocket.onopen?.(new Event("open"));
    });

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

  describe("agent activity", () => {
    // The indicator is derived, not pushed: a reviewed document changing on disk
    // while a comment still awaits a response means an agent is working in it.
    // (This replaced a changelog_ignored push whose claim — "the response was
    // lost" — the server had no way to establish.)
    const send = (msg: Record<string, unknown>) => {
      act(() => {
        mockWebSocket.onmessage!({
          data: JSON.stringify(msg),
        } as MessageEvent);
      });
    };

    const pendingComment = {
      id: "c1a2b3c4deadbeef",
      anchor: { source_line: 1 },
      comment: "tighten this",
      reactions: [],
    };

    beforeEach(() => {
      useReviewStore.setState({ agentActivity: null, comments: [] });
    });

    it("notes activity when the open document changes with comments pending", () => {
      useReviewStore.setState({ comments: [pendingComment] as never });
      renderHook(() => useWebSocket());

      send({ type: "files_changed", paths: ["test.md"] });

      expect(useReviewStore.getState().agentActivity).toEqual({
        path: "test.md",
      });
    });

    it("stays quiet when nothing is awaiting a response", () => {
      // An answered comment is not pending, so a save is just a save — the
      // reviewer's own edit must not read as an agent working.
      useReviewStore.setState({
        comments: [
          {
            ...pendingComment,
            reactions: [
              {
                actor: "agent",
                kind: "addressed",
                summary: "done",
                timestamp: 1,
              },
            ],
          },
        ] as never,
      });
      renderHook(() => useWebSocket());

      send({ type: "files_changed", paths: ["test.md"] });

      expect(useReviewStore.getState().agentActivity).toBeNull();
    });

    it("ignores changes to documents other than the open one", () => {
      useReviewStore.setState({ comments: [pendingComment] as never });
      renderHook(() => useWebSocket());

      send({ type: "files_changed", paths: ["elsewhere.md"] });

      expect(useReviewStore.getState().agentActivity).toBeNull();
    });

    it("clears on review_changed — the delivery ends the agent's turn", () => {
      useReviewStore.setState({
        comments: [pendingComment] as never,
        agentActivity: { path: "test.md" },
      });
      renderHook(() => useWebSocket());

      send({ type: "review_changed", repo: "", path: "test.md" });

      expect(useReviewStore.getState().agentActivity).toBeNull();
    });
  });

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
});
