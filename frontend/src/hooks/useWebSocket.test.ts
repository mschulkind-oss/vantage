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
