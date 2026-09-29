import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { useWebSocket } from "./useWebSocket";
import { useRepoStore } from "../stores/useRepoStore";

// A live-reload refresh must never be a navigation back.
//
// Unlike useWebSocket.test.ts, nothing here mocks a store: the bug lives
// between the socket's refresh and the repo store's load guard, so both have to
// be the real ones. Only the network and the socket are faked.
//
// What went wrong: the viewer sets `currentPath` when a load *lands*, and the
// socket refreshed `currentPath`. So a push that arrived while a click on
// page1.md was still loading refreshed the directory the reader was leaving —
// and because that refresh was the newer load, the store kept it and dropped
// page1.md's response. The URL said /page1.md, the viewer showed the directory,
// and nothing ever loaded the document. The e2e suite hit it whenever any spec
// wrote a fixture during another spec's click from the root directory:
// navigation.spec and ui_behavior's "Markdown styling is applied" both failed
// on it, stuck on the root listing after clicking page1.md.

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const PAGE = "page1.md";
const PAGE_CONTENT = { path: PAGE, content: "# Page 1", encoding: "utf-8" };

describe("a live-reload refresh during a navigation", () => {
  let socket: {
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: Event) => void) | null;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
  };
  let landPage: () => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Every request answers at once except the document being navigated to,
    // which answers when the test says so: that window is the navigation in
    // flight.
    let pageResponse: Promise<{ data: unknown }> | null = null;
    mockedAxios.get.mockImplementation((url: string) => {
      if (url === `/api/content?path=${PAGE}`) {
        pageResponse ??= new Promise((resolve) => {
          landPage = () => resolve({ data: PAGE_CONTENT });
        });
        return pageResponse;
      }
      return Promise.resolve({ data: url.includes("/tree?") ? [] : {} });
    });

    useRepoStore.setState({
      currentPath: null,
      currentRepo: null,
      isMultiRepo: false,
      reposLoaded: true,
      fileTree: [],
      fileContent: null,
      currentDirectory: null,
      isLoading: false,
      error: null,
      expandedDirs: {},
    });
    // The reader is on the repository's root directory.
    await useRepoStore.getState().viewDirectory(".");
    expect(useRepoStore.getState().currentPath).toBe(".");

    socket = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: vi.fn(),
      readyState: 0,
    };
    global.WebSocket = vi.fn(function () {
      return socket;
    }) as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Lets every settled request's continuation run. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  const expectOnPage = () => {
    const state = useRepoStore.getState();
    expect(state.currentPath).toBe(PAGE);
    expect(state.fileContent).toEqual(PAGE_CONTENT);
    expect(state.currentDirectory).toBeNull();
  };

  it("a push about another file leaves the navigation to land", async () => {
    renderHook(() => useWebSocket());

    // The click on page1.md: the load starts, and its response is not back.
    const navigation = useRepoStore.getState().loadFile(PAGE);

    // Another file changes meanwhile, and the batch is processed.
    await act(async () => {
      socket.onmessage!({
        data: JSON.stringify({
          type: "files_changed",
          paths: ["livereload/watched.md"],
        }),
      } as MessageEvent);
      vi.advanceTimersByTime(600);
      await settle();
    });

    await act(async () => {
      landPage();
      await navigation;
      await settle();
    });

    expectOnPage();
  });

  it("a reconnect leaves the navigation to land", async () => {
    renderHook(() => useWebSocket());
    // The mount's first connection, which leaves the document to the route
    // and so refreshes none, and then the socket drops.
    await act(async () => {
      socket.onopen!(new Event("open"));
      socket.onclose!(new Event("close"));
      await settle();
    });

    const navigation = useRepoStore.getState().loadFile(PAGE);

    // The socket reconnects meanwhile, which refreshes the viewer in case a
    // push was missed.
    await act(async () => {
      vi.advanceTimersByTime(1100);
      socket.onopen!(new Event("open"));
      await settle();
    });

    await act(async () => {
      landPage();
      await navigation;
      await settle();
    });

    expectOnPage();
  });

  it("a push about the destination still reloads it", async () => {
    renderHook(() => useWebSocket());

    const navigation = useRepoStore.getState().loadFile(PAGE);

    await act(async () => {
      socket.onmessage!({
        data: JSON.stringify({ type: "files_changed", paths: [PAGE] }),
      } as MessageEvent);
      vi.advanceTimersByTime(600);
      await settle();
    });

    // The document changed after its load was sent, so the refresh asks for
    // it again rather than trusting the response already on its way.
    const contentRequests = mockedAxios.get.mock.calls.filter(
      ([url]) => url === `/api/content?path=${PAGE}`,
    );
    expect(contentRequests).toHaveLength(2);

    await act(async () => {
      landPage();
      await navigation;
      await settle();
    });

    expectOnPage();
  });
});
