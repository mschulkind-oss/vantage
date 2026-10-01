import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import axios from "axios";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { ViewerPage } from "./ViewerPage";
import { AppShell } from "../components/AppShell";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { useReviewStore } from "../stores/useReviewStore";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useStarredStore } from "../stores/useStarredStore";
import { useFilePickerStore } from "../stores/useFilePickerStore";
import { useAllRecentsStore } from "../stores/useAllRecentsStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { usePlanningStore } from "../stores/usePlanningStore";
import { planningLimits } from "../planningScan/limits";
import { prefetchPlanningPage } from "../hooks/usePlanningPageInputs";
import { indexOf } from "../test/planning";
import { BrowserRouter } from "react-router-dom";
import type { CommentReaction, ReviewComment } from "../types";

// Mocks
vi.mock("../stores/useRepoStore");
vi.mock("../stores/useGitStore");
vi.mock("../hooks/useWebSocket");
// The toolbar's planning entry asks for the planning page's first page; what
// that request does is usePlanningPageInputs.test.ts's business.
vi.mock("../hooks/usePlanningPageInputs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/usePlanningPageInputs")>()),
  prefetchPlanningPage: vi.fn(),
}));
vi.mock("../components/FileTree", () => ({
  FileTree: () => <div data-testid="file-tree">FileTree</div>,
}));
// The viewer is what reports the answerable-Open-Question count up to the page,
// so the mock has to be able to report one — otherwise every assertion about
// what the Review toggle says is vacuously true at zero.
let mockOpenQuestionCount = 0;
/**
 * Each render of the viewer: the document it drew, and what the planning
 * index was as it did, so the hold's tests can ask what a first paint had.
 */
const mockViewerRenders: { path: string; planning: string | undefined }[] = [];
vi.mock("../components/MarkdownViewer", () => ({
  MarkdownViewer: ({
    currentPath,
    onOpenQuestionCount,
  }: {
    currentPath: string;
    onOpenQuestionCount?: (count: number) => void;
  }) => {
    onOpenQuestionCount?.(mockOpenQuestionCount);
    mockViewerRenders.push({
      path: currentPath,
      planning: usePlanningStore.getState().byRepo[""]?.status,
    });
    return <div data-testid="markdown-viewer">MarkdownViewer</div>;
  },
}));
vi.mock("../components/DirectoryViewer", () => ({
  DirectoryViewer: () => (
    <div data-testid="directory-viewer">DirectoryViewer</div>
  ),
}));
vi.mock("../components/DiffViewer", () => ({
  DiffViewer: () => <div data-testid="diff-viewer">DiffViewer</div>,
}));
// Renders only in review mode and needs ResizeObserver, which jsdom lacks.
vi.mock("../components/ReviewStripe", () => ({
  ReviewStripe: () => <div data-testid="review-stripe">ReviewStripe</div>,
}));

// Mock useNavigate and useParams
const mockNavigate = vi.fn();
const mockUseParams = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockUseParams(),
  };
});

// No request this page makes is ever answered here unless a case answers it.
//
// Every mount asks for the bookmarks, the degradation banner's list and the
// document's review, from stores this file leaves real, and there is no server
// behind jsdom's origin. Sent for real, each one failed a few milliseconds
// later — after the synchronous case that sent it had ended — and logged
// "Failed to load bookmarks" into whichever case was running by then, or, after
// the last one, into nothing: a log still in flight while the worker closed its
// channel to the runner failed the whole run with EnvironmentTeardownError,
// however green every case was. Held pending instead, a request can neither
// land in a later case's store nor log after the file ends, and never reaches
// the guard in src/test/setup.ts that fails a test for sending one. The cases
// that need an answer spy on axios.get and pass the rest through to this.
const unanswered = () => new Promise<never>(() => {});
let realAdapter: typeof axios.defaults.adapter;
beforeAll(() => {
  realAdapter = axios.defaults.adapter;
  axios.defaults.adapter = unanswered;
});
afterAll(() => {
  axios.defaults.adapter = realAdapter;
});

describe("ViewerPage", () => {
  const mockRefreshTree = vi.fn();
  const mockViewDirectory = vi.fn();
  const mockLoadFile = vi.fn();
  const mockFetchStatus = vi.fn();
  const mockFetchDiff = vi.fn();
  const mockExpandToPath = vi.fn();
  const mockLoadPathDirectories = vi.fn();
  const mockLoadRepos = vi.fn();
  const mockSetCurrentRepo = vi.fn();
  const mockFetchHistory = vi.fn();

  /** What git answers for a document with a commit. */
  const COMMITTED = {
    lastCommit: {
      hexsha: "123",
      message: "test commit",
      author: "me",
      date: new Date().toISOString(),
    },
    gitStatus: null,
  };

  // Read through the local alias, not through `useGitStore` itself: the mock
  // is an ordinary function, but calling it under that name inside a named
  // helper trips react-hooks/rules-of-hooks.
  const gitStore = useGitStore as unknown as ReturnType<typeof vi.fn>;
  /** Git's answers for these paths, and none for any other. */
  const gitAnswers = (statusByPath: Record<string, unknown>) => {
    gitStore.mockReturnValue({ ...gitStore(), statusByPath });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenQuestionCount = 0;

    // Zustand stores are module singletons — reset review state so seeded
    // comments don't leak between cases.
    useReviewStore.setState({
      isReviewMode: false,
      filePath: null,
      comments: [],
      commentsDrifted: false,
    });
    // Likewise a picker one case opened: it would still be on screen in the
    // next one, over the header every other assertion is about.
    useFilePickerStore.setState({
      open: null,
      files: [],
      filesRepo: null,
      globalFiles: [],
      globalSource: null,
      loading: false,
    });

    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      fileTree: [],
      fileContent: null,
      currentDirectory: [],
      currentPath: "path/to/file.md",
      error: null,
      refreshTree: mockRefreshTree,
      viewDirectory: mockViewDirectory,
      loadFile: mockLoadFile,
      expandToPath: mockExpandToPath,
      loadPathDirectories: mockLoadPathDirectories,
      repos: [],
      isMultiRepo: false,
      reposLoaded: true,
      currentRepo: null,
      loadRepos: mockLoadRepos,
      setCurrentRepo: mockSetCurrentRepo,
    });

    (useGitStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      // Git has answered for the default document: it has a commit.
      statusByPath: { "path/to/file.md": COMMITTED },
      historyByPath: {},
      fetchStatus: mockFetchStatus,
      diff: null,
      showDiff: false,
      isDiffLoading: false,
      fetchDiff: mockFetchDiff,
      closeDiff: vi.fn(),
      recentFiles: [],
      repoName: null,
      history: [],
      fetchRecentFiles: vi.fn(),
      fetchRepoInfo: vi.fn(),
      fetchHistory: mockFetchHistory,
    });

    (useWebSocket as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => {},
    );
    mockUseParams.mockReturnValue({ "*": "path/to/file.md" });
  });

  const renderPage = () =>
    render(
      <BrowserRouter>
        <AppShell>
          <ViewerPage />
        </AppShell>
      </BrowserRouter>,
    );

  it("renders initial layout components", () => {
    renderPage();
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    expect(screen.getByText("Vantage")).toBeInTheDocument();
  });

  describe("header", () => {
    const openFile = (path: string, currentDirectory: unknown = null) => {
      const repo = useRepoStore as unknown as ReturnType<typeof vi.fn>;
      repo.mockReturnValue({
        ...repo.getMockImplementation()!(),
        currentPath: path,
        currentDirectory,
      });
      gitAnswers({ [path]: COMMITTED });
      mockUseParams.mockReturnValue({ "*": path });
      renderPage();
    };

    // The file name is the last thing in the header to give up room, and
    // when it does, only its stem is elided: the extension says what kind of
    // file it is, and the tooltip is the one place the whole path is readable.
    it("truncates only the file name's stem, with the full path in its tooltip", () => {
      const name = "a-very-long-macos-launchd-and-config-paths-design.md";
      openFile(`docs/design/${name}`);

      const leaf = screen.getByTestId("breadcrumb-name");
      expect(leaf).toHaveTextContent(name);
      expect(leaf).toHaveAttribute("title", `docs/design/${name}`);
      const [whole, stem, ext] = Array.from(leaf.children);
      // Two flex items read as two words ("…-design .md"), so assistive
      // technology gets the name whole, and the halves are drawn only.
      expect(whole).toHaveClass("sr-only");
      expect(whole.textContent).toBe(name);
      expect(stem).toHaveAttribute("aria-hidden", "true");
      expect(ext).toHaveAttribute("aria-hidden", "true");
      expect(stem).toHaveTextContent(
        "a-very-long-macos-launchd-and-config-paths-design",
      );
      expect(stem).toHaveClass("truncate");
      expect(ext).toHaveTextContent(/^\.md$/);
      expect(ext).toHaveClass("shrink-0");
    });

    it("keeps a folder's name whole, dot and all", () => {
      openFile("docs/v1.2", []);
      const leaf = screen.getByTestId("breadcrumb-name");
      expect(leaf.children).toHaveLength(1);
      expect(leaf).toHaveTextContent("v1.2");
    });

    // Collapsing the folders into "…" must not take them out of reach.
    it("keeps the collapsed folders one menu away", () => {
      openFile("docs/design/notes.md");
      fireEvent.click(
        screen.getByRole("button", { name: "Folders: docs/design" }),
      );
      const items = screen.getAllByRole("menuitem");
      expect(items.map((a) => a.getAttribute("href"))).toEqual([
        "/",
        "/docs",
        "/docs/design",
      ]);
    });

    // A root-level file has no folders to collapse, but the `repo` step folds
    // the repository's name in behind a "…" all the same; until that step the
    // stylesheet keeps this "…" hidden (hdr-no-dirs).
    it("offers the repository alone behind a file at the root's …", () => {
      openFile("notes.md");
      const more = screen.getByRole("button", { name: "Folders: root" });
      expect(more.closest(".hdr-dirs-collapsed")).toHaveClass("hdr-no-dirs");
      fireEvent.click(more);
      expect(
        screen.getAllByRole("menuitem").map((a) => a.getAttribute("href")),
      ).toEqual(["/"]);
    });

    // The subject shrinks and then hides before anything else gives way, so
    // the commit button's tooltip is where the whole of it stays readable.
    it("puts the whole commit subject in the commit button's tooltip", () => {
      openFile("docs/design/notes.md");
      const commit = screen.getByTitle(/click to view diff$/);
      expect(commit.getAttribute("title")).toMatch(/^test commit\n/);
    });

    // Icon-only is a visual state: the label leaves the layout, not the
    // accessibility tree, so each button still has the name its label gave it.
    it("names the toolbar buttons by their labels", () => {
      openFile("docs/design/notes.md");
      expect(
        screen.getAllByRole("button", { name: "Raw" }).length,
      ).toBeGreaterThan(0);
      for (const label of screen.getAllByText("Raw")) {
        expect(label).toHaveClass("hdr-label");
      }
    });
  });

  // docs/reference/planning-index.md §6: reached from a toolbar entry as well as
  // with `g p`.
  describe("the planning page's toolbar entry", () => {
    it("navigates to the planning page", () => {
      renderPage();
      const entry = screen.getByRole("link", { name: "Planning" });
      expect(entry).toHaveAttribute("href", "/.vantage/planning");
      fireEvent.click(entry);
      expect(mockNavigate).toHaveBeenCalledWith("/.vantage/planning");
    });

    it("names the current repository in daemon mode", () => {
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useRepoStore(),
        isMultiRepo: true,
        currentRepo: "alpha",
        repos: [{ name: "alpha" }],
      });
      mockUseParams.mockReturnValue({ "*": "alpha/path/to/file.md" });
      renderPage();
      expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute(
        "href",
        "/.vantage/planning/alpha",
      );
    });

    // planning-index.md §6.4: page 1's inputs are asked for on
    // hover or focus of the entry, so the click finds them in hand.
    it("asks for the planning page's first page on hover and on focus", () => {
      renderPage();
      const entry = screen.getByRole("link", { name: "Planning" });
      fireEvent.pointerEnter(entry);
      expect(prefetchPlanningPage).toHaveBeenCalledTimes(1);
      expect(prefetchPlanningPage).toHaveBeenLastCalledWith("");
      fireEvent.focus(entry);
      expect(prefetchPlanningPage).toHaveBeenCalledTimes(2);
      expect(prefetchPlanningPage).toHaveBeenLastCalledWith("");
    });

    // With no repository open in daemon mode there is no sidebar, and so no
    // entry to hover.
    it("asks for the current repository's in daemon mode", () => {
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useRepoStore(),
        isMultiRepo: true,
        currentRepo: "alpha",
        repos: [{ name: "alpha" }],
      });
      mockUseParams.mockReturnValue({ "*": "alpha/path/to/file.md" });
      renderPage();
      fireEvent.focus(screen.getByRole("link", { name: "Planning" }));
      expect(prefetchPlanningPage).toHaveBeenCalledTimes(1);
      expect(prefetchPlanningPage).toHaveBeenCalledWith("alpha");
    });
  });

  // docs/reference/planning-index.md §12: the header's git facts are
  // asked for with the content, and nothing is said before git has answered.
  describe("the header's git facts", () => {
    const repo = () => useRepoStore as unknown as ReturnType<typeof vi.fn>;
    const showing = (path: string) => {
      const state = {
        ...repo()(),
        currentPath: path,
        currentDirectory: null,
        fileContent: { path, content: "# Doc\n", encoding: "utf-8" },
        recentlyChangedPaths: new Set<string>(),
      };
      // Selectors too, since the sidebar's recent list reads through one.
      repo().mockImplementation((select?: (s: typeof state) => unknown) =>
        select ? select(state) : state,
      );
      mockUseParams.mockReturnValue({ "*": path });
    };

    it("asks for a document's status and history with its content", () => {
      // Nothing has arrived: the store still has no content and no path.
      repo().mockReturnValue({
        ...repo()(),
        currentPath: null,
        currentDirectory: null,
      });
      mockUseParams.mockReturnValue({ "*": "docs/next.md" });
      renderPage();
      expect(mockLoadFile).toHaveBeenCalledWith("docs/next.md");
      expect(mockFetchStatus).toHaveBeenCalledWith("docs/next.md");
      expect(mockFetchHistory).toHaveBeenCalledWith("docs/next.md");
    });

    it("asks a directory for its status and no history", () => {
      mockUseParams.mockReturnValue({ "*": "docs/design" });
      renderPage();
      expect(mockViewDirectory).toHaveBeenCalledWith("docs/design");
      expect(mockFetchStatus).toHaveBeenCalledWith("docs/design");
      expect(mockFetchHistory).not.toHaveBeenCalled();
    });

    it("says nothing untracked before git answers, and says it once it has", () => {
      showing("docs/new.md");
      gitAnswers({});
      gitStore.mockReturnValue({
        ...gitStore(),
        recentFiles: [
          {
            path: "docs/new.md",
            date: new Date().toISOString(),
            untracked: true,
          },
        ],
      });
      const { rerender } = renderPage();
      expect(screen.queryByText("Untracked file")).toBeNull();
      expect(screen.queryByTestId("header-time")).toBeNull();
      expect(screen.queryByTitle(/click to view diff$/)).toBeNull();
      // The toolbar's own actions do not wait on git.
      expect(screen.getAllByTitle("View raw markdown").length).toBeGreaterThan(
        0,
      );

      gitAnswers({
        "docs/new.md": { lastCommit: null, gitStatus: "untracked" },
      });
      rerender(
        <BrowserRouter>
          <AppShell>
            <ViewerPage />
          </AppShell>
        </BrowserRouter>,
      );
      expect(screen.getByText("Untracked file")).toBeInTheDocument();
      expect(screen.getByTestId("header-time")).toBeInTheDocument();
    });

    it("shows the document on screen its own commit, whatever else has answered", () => {
      showing("docs/a.md");
      gitAnswers({
        "docs/a.md": {
          ...COMMITTED,
          lastCommit: { ...COMMITTED.lastCommit, message: "On a" },
        },
        "docs/b.md": { lastCommit: null, gitStatus: "untracked" },
      });
      renderPage();
      expect(
        screen.getByTitle(/click to view diff$/).getAttribute("title"),
      ).toMatch(/^On a\n/);
      expect(screen.queryByText("Untracked file")).toBeNull();
    });
  });

  // Added when the content landed, the contents toggle pushed the full-width
  // toggle and the breadcrumb along on every document's first paint.
  describe("the contents toggle", () => {
    const repo = () => useRepoStore as unknown as ReturnType<typeof vi.fn>;
    const route = (path: string, fileContent: unknown = null) => {
      repo().mockReturnValue({
        ...repo()(),
        currentPath: null,
        currentDirectory: null,
        fileContent,
      });
      mockUseParams.mockReturnValue({ "*": path });
    };

    it("is in the header as soon as the route names a document", () => {
      route("docs/next.md");
      renderPage();
      expect(screen.getByLabelText("Show contents")).toBeInTheDocument();
    });

    it("is not offered for a directory, or a document that is binary", () => {
      route("docs");
      const { unmount } = renderPage();
      expect(screen.queryByLabelText("Show contents")).toBeNull();
      unmount();

      repo().mockReturnValue({
        ...repo()(),
        currentPath: "docs/blob.md",
        fileContent: { path: "docs/blob.md", content: "", encoding: "binary" },
      });
      mockUseParams.mockReturnValue({ "*": "docs/blob.md" });
      renderPage();
      expect(screen.queryByLabelText("Show contents")).toBeNull();
    });
  });

  // The hold (docs/reference/planning-index.md §12.3).
  describe("a document's first paint", () => {
    const repo = () => useRepoStore as unknown as ReturnType<typeof vi.fn>;
    /** The store once `path`'s content has landed. */
    const loaded = (path: string) => {
      const state = {
        ...repo()(),
        currentPath: path,
        currentDirectory: null,
        fileContent: { path, content: `# ${path}\n`, encoding: "utf-8" },
        isLoading: false,
        recentlyChangedPaths: new Set<string>(),
      };
      repo().mockImplementation((select?: (s: typeof state) => unknown) =>
        select ? select(state) : state,
      );
      mockUseParams.mockReturnValue({ "*": path });
    };
    const answered = (...paths: string[]) => {
      gitStore.mockReturnValue({
        ...gitStore(),
        statusByPath: Object.fromEntries(paths.map((p) => [p, COMMITTED])),
        historyByPath: Object.fromEntries(paths.map((p) => [p, []])),
      });
    };
    const page = () => (
      <BrowserRouter>
        <AppShell>
          <ViewerPage />
        </AppShell>
      </BrowserRouter>
    );
    const shownName = () =>
      screen.getByTestId("breadcrumb-name").getAttribute("title");

    beforeEach(() => {
      vi.useFakeTimers();
      usePlanningStore.setState({ byRepo: {} });
    });
    afterEach(() => {
      vi.useRealTimers();
      usePlanningStore.setState({ byRepo: {} });
    });

    it("keeps the previous document up until the next one's git facts are in", () => {
      loaded("a.md");
      answered("a.md");
      const { rerender } = render(page());
      expect(shownName()).toBe("a.md");

      loaded("b.md");
      rerender(page());
      expect(shownName()).toBe("a.md");

      answered("a.md", "b.md");
      rerender(page());
      expect(shownName()).toBe("b.md");
    });

    it("keeps it up no longer than the hold's deadline", () => {
      loaded("a.md");
      answered("a.md");
      const { rerender } = render(page());
      loaded("b.md");
      rerender(page());
      expect(shownName()).toBe("a.md");

      act(() => vi.advanceTimersByTime(planningLimits.holdMs));
      expect(shownName()).toBe("b.md");
      // With nothing known about it yet, its header says nothing of git.
      expect(screen.queryByTitle(/click to view diff$/)).toBeNull();
      expect(screen.queryByText("Untracked file")).toBeNull();
    });

    it("waits for a warm build of the planning index, never a cold one", () => {
      loaded("a.md");
      answered("a.md", "b.md", "c.md");
      const { rerender } = render(page());

      act(() => {
        usePlanningStore.setState({
          byRepo: { "": { status: "loading", warm: true, progress: null } },
        });
      });
      loaded("b.md");
      rerender(page());
      expect(shownName()).toBe("a.md");
      act(() => vi.advanceTimersByTime(planningLimits.holdMs));
      expect(shownName()).toBe("b.md");

      act(() => {
        usePlanningStore.setState({
          byRepo: { "": { status: "loading", warm: false, progress: null } },
        });
      });
      loaded("c.md");
      rerender(page());
      expect(shownName()).toBe("c.md");
    });

    // Git usually answers before the scanner has said whether its build is
    // warm. A hold that read that silence as cold ended on git's answer, and
    // a warm index landing a few milliseconds later missed the first paint:
    // on a third of warm reloads the page had no badges and no Referenced by
    // for the whole visit.
    it("waits for a build not yet known to be cold, so a warm index is in the first paint", () => {
      loaded("a.md");
      answered("a.md", "b.md", "c.md");
      const { rerender } = render(page());
      const loading = (warm: boolean | null) =>
        act(() => {
          usePlanningStore.setState({
            byRepo: { "": { status: "loading", warm, progress: null } },
          });
        });

      loading(null);
      loaded("b.md");
      rerender(page());
      // Git has answered, and the scanner has said nothing yet.
      expect(shownName()).toBe("a.md");
      loading(true);
      expect(shownName()).toBe("a.md");
      mockViewerRenders.length = 0;
      act(() => vi.advanceTimersByTime(planningLimits.holdMs / 2));
      act(() => {
        usePlanningStore.setState({
          byRepo: {
            "": {
              status: "ready",
              index: indexOf({}),
              version: 1,
              rescanning: false,
              hashes: {},
            },
          },
        });
      });
      expect(shownName()).toBe("b.md");
      expect(mockViewerRenders.find((r) => r.path === "b.md")).toEqual({
        path: "b.md",
        planning: "ready",
      });

      // A cold build ends the hold the moment the scanner says so.
      loading(null);
      loaded("c.md");
      rerender(page());
      expect(shownName()).toBe("b.md");
      loading(false);
      expect(shownName()).toBe("c.md");
    });

    // L3: a failed status request is no answer about the file. It once read
    // as a file with no commit, so a tracked file's header said "Untracked
    // file" and showed its modification time as if that were all git knew.
    it("says nothing of git when the status request failed, and waits no longer for it", () => {
      loaded("a.md");
      gitStore.mockReturnValue({
        ...gitStore(),
        statusByPath: {
          "a.md": { lastCommit: null, gitStatus: null, failed: true },
        },
        historyByPath: { "a.md": [] },
        recentFiles: [
          {
            path: "a.md",
            date: new Date().toISOString(),
            author_name: "",
            message: "",
            hexsha: "",
          },
        ],
      });
      render(page());
      expect(shownName()).toBe("a.md");
      expect(screen.queryByText("Untracked file")).toBeNull();
      expect(screen.queryByTestId("header-time")).toBeNull();
      expect(screen.queryByTitle(/click to view diff$/)).toBeNull();
    });

    // §12.2: what the first paint lacked is late data, which the header fit
    // draws only where it moves nothing already drawn (lib/headerFit.ts).
    it("marks the header's git items late when git answered after the first paint", () => {
      loaded("a.md");
      answered("a.md");
      const { rerender } = render(page());
      const commitButton = () => screen.getByTitle(/click to view diff$/);
      const historyLink = () =>
        screen.getByTitle("View full history: 1 commit");
      const withHistory = (...paths: string[]) =>
        gitStore.mockReturnValue({
          ...gitStore(),
          statusByPath: Object.fromEntries(paths.map((p) => [p, COMMITTED])),
          historyByPath: Object.fromEntries(
            paths.map((p) => [p, [COMMITTED.lastCommit]]),
          ),
        });
      // In hand when a.md painted: ordinary items.
      withHistory("a.md");
      rerender(page());
      expect(commitButton()).not.toHaveClass("hdr-late");

      // b.md paints at the hold's deadline, with nothing from git.
      loaded("b.md");
      rerender(page());
      act(() => vi.advanceTimersByTime(planningLimits.holdMs));
      expect(shownName()).toBe("b.md");
      withHistory("a.md", "b.md");
      rerender(page());
      expect(commitButton()).toHaveClass("hdr-late");
      expect(historyLink()).toHaveClass("hdr-late");

      // The next document to arrive with its answers is not late at all.
      withHistory("a.md", "b.md", "c.md");
      loaded("c.md");
      rerender(page());
      expect(shownName()).toBe("c.md");
      expect(commitButton()).not.toHaveClass("hdr-late");
      expect(historyLink()).not.toHaveClass("hdr-late");
    });

    it("waits for nothing when everything is in hand", () => {
      loaded("a.md");
      answered("a.md", "b.md");
      const { rerender } = render(page());
      loaded("b.md");
      rerender(page());
      expect(shownName()).toBe("b.md");
    });

    // useWebSocket reports a document whose directory was renamed under it,
    // and the page takes the reader to its new address as if nothing
    // happened: the same document, where they were in it.
    describe("a document whose directory was renamed under it", () => {
      const OLD = "docs/old/a.md";
      const NEW = "docs/new/a.md";
      const socket = useWebSocket as unknown as ReturnType<typeof vi.fn>;
      /** The page's answer to useWebSocket's report of a move. */
      const reportMove = (from: string, to: string) => {
        const options = socket.mock.calls.at(-1)?.[0] as
          { onMoved?: (from: string, to: string) => void } | undefined;
        expect(options?.onMoved).toBeTypeOf("function");
        act(() => options!.onMoved!(from, to));
      };
      // jsdom does no layout and has no element scrollTo, which the page
      // calls to start a newly opened document at its top.
      const scrollTo = vi.fn();
      beforeEach(() => {
        // Read by the review store, which asks the server to move the review,
        // and by the page once a follow's grace period is over.
        (useRepoStore as unknown as { getState: () => unknown }).getState =
          () => ({ currentRepo: null, isMultiRepo: false });
        Object.defineProperty(HTMLElement.prototype, "scrollTo", {
          value: scrollTo,
          configurable: true,
          writable: true,
        });
      });
      afterEach(() => {
        delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
        localStorage.clear();
      });

      it("goes to its new address in place of the old one", () => {
        loaded(OLD);
        answered(OLD);
        render(page());
        reportMove(OLD, NEW);
        // Replaced, not pushed: the old address names nothing now, so Back
        // leads to where the reader was before it.
        expect(mockNavigate).toHaveBeenCalledWith(`/${NEW}`, {
          replace: true,
        });
      });

      it("keeps the reader where they were in it", () => {
        loaded(OLD);
        answered(OLD);
        const { rerender } = render(page());
        scrollTo.mockClear();

        reportMove(OLD, NEW);
        loaded(NEW);
        answered(OLD, NEW);
        rerender(page());
        expect(shownName()).toBe(NEW);
        expect(scrollTo).not.toHaveBeenCalled();

        // Any other document the reader opens after it starts at its top.
        loaded("c.md");
        answered(OLD, NEW, "c.md");
        rerender(page());
        expect(scrollTo).toHaveBeenCalledWith(0, 0);
      });

      it("keeps review mode on for it", () => {
        loaded(OLD);
        answered(OLD);
        useReviewStore.setState({ filePath: OLD, isReviewMode: true });
        render(page());
        reportMove(OLD, NEW);
        expect(localStorage.getItem(`vantage.reviewMode:${NEW}`)).toBe("on");
      });

      // Renamed again before its new address was asked for, the document is
      // not there either, and the next push follows it on. Until then the
      // page keeps what it shows rather than flash the not-found page.
      describe("renamed again before it was asked for", () => {
        const NEWER = "docs/newer/a.md";
        /** What the store says when the grace period ends. */
        const storeSays = (currentPath: string, requestedPath: string) => {
          (useRepoStore as unknown as { getState: () => unknown }).getState =
            () => ({
              currentRepo: null,
              isMultiRepo: false,
              currentPath,
              requestedPath,
            });
        };

        it("asks for its new address keeping the document on screen", () => {
          storeSays(OLD, NEW);
          loaded(OLD);
          answered(OLD);
          const { rerender } = render(page());
          reportMove(OLD, NEW);
          mockUseParams.mockReturnValue({ "*": NEW });
          rerender(page());
          expect(mockLoadFile).toHaveBeenCalledWith(NEW, {
            keepOnFailure: true,
          });
        });

        it("says it is gone once no push has taken it further", () => {
          storeSays(OLD, NEW);
          loaded(OLD);
          answered(OLD);
          const { rerender } = render(page());
          reportMove(OLD, NEW);
          mockUseParams.mockReturnValue({ "*": NEW });
          rerender(page());
          mockLoadFile.mockClear();

          act(() => vi.advanceTimersByTime(1000));
          expect(mockLoadFile).not.toHaveBeenCalled();
          act(() => vi.advanceTimersByTime(600));
          expect(mockLoadFile).toHaveBeenCalledTimes(1);
          expect(mockLoadFile).toHaveBeenCalledWith(NEW);
        });

        it("asks for nothing more once it has landed", () => {
          storeSays(NEW, NEW);
          loaded(OLD);
          answered(OLD);
          render(page());
          reportMove(OLD, NEW);
          mockLoadFile.mockClear();
          act(() => vi.advanceTimersByTime(2000));
          expect(mockLoadFile).not.toHaveBeenCalled();
        });

        it("keeps the reader where they were along the chain", () => {
          storeSays(OLD, NEWER);
          loaded(OLD);
          answered(OLD);
          const { rerender } = render(page());
          scrollTo.mockClear();

          reportMove(OLD, NEW);
          reportMove(NEW, NEWER);
          loaded(NEWER);
          answered(OLD, NEWER);
          rerender(page());
          expect(shownName()).toBe(NEWER);
          expect(scrollTo).not.toHaveBeenCalled();
          expect(mockNavigate).toHaveBeenLastCalledWith(`/${NEWER}`, {
            replace: true,
          });
        });
      });

      // On a phone the sidebar is a panel the reader slid open, and a
      // navigation of theirs closes it. A follow is not one.
      it("leaves the mobile sidebar open", () => {
        const width = window.innerWidth;
        Object.defineProperty(window, "innerWidth", {
          value: 390,
          configurable: true,
        });
        try {
          loaded(OLD);
          answered(OLD);
          const { rerender } = render(page());
          fireEvent.click(screen.getByLabelText("Open sidebar"));
          expect(screen.getByTestId("sidebar")).toHaveClass("translate-x-0");

          reportMove(OLD, NEW);
          loaded(NEW);
          answered(OLD, NEW);
          rerender(page());
          expect(screen.getByTestId("sidebar")).toHaveClass("translate-x-0");

          // Opening another document still closes it.
          loaded("c.md");
          answered(OLD, NEW, "c.md");
          rerender(page());
          expect(screen.getByTestId("sidebar")).toHaveClass(
            "-translate-x-full",
          );
        } finally {
          Object.defineProperty(window, "innerWidth", {
            value: width,
            configurable: true,
          });
        }
      });
    });
  });

  it("loads file when path ends with .md service call", () => {
    renderPage();
    expect(mockLoadFile).toHaveBeenCalledWith("path/to/file.md");
  });

  it("loads directory when path is not .md", () => {
    mockUseParams.mockReturnValue({ "*": "path/to/dir" });
    renderPage();
    expect(mockViewDirectory).toHaveBeenCalledWith("path/to/dir");
  });

  it("renders MarkdownViewer when content is available", () => {
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...useRepoStore(),
      fileContent: "Some content",
      currentPath: "file.md",
    });
    renderPage();
    expect(screen.getByTestId("markdown-viewer")).toBeInTheDocument();
  });

  it("renders DirectoryViewer when currentDirectory is populated", () => {
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...useRepoStore(),
      fileContent: null,
      currentDirectory: [{ name: "file", path: "file", is_dir: false }],
      currentPath: "dir",
    });
    mockUseParams.mockReturnValue({ "*": "dir" });

    renderPage();
    expect(screen.getByTestId("directory-viewer")).toBeInTheDocument();
  });

  it("shows diff viewer when showDiff is true", () => {
    (useGitStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...useGitStore(),
      showDiff: true,
      diff: { lines: [] }, // partial mock
    });
    renderPage();
    expect(screen.getByTestId("diff-viewer")).toBeInTheDocument();
  });

  // The picker used to fetch its list once and keep it for the life of the tab,
  // so a file created after the page loaded could not be found with `t` until a
  // reload — even while the sidebar and the recents modal were already showing
  // it. Every open refetches.
  it("refetches the file list every time the file picker opens", async () => {
    (useRepoStore as unknown as { getState: () => unknown }).getState = () => ({
      currentRepo: null,
      isMultiRepo: false,
      reposLoaded: true,
    });
    // Scoped to the file list on purpose: every other request this page makes
    // has to keep whatever answer it already got, because a wrong-shaped one
    // corrupts a store that is a module singleton shared with the next test.
    const realGet = axios.get.bind(axios);
    const get = vi.spyOn(axios, "get");
    get.mockImplementation(((url: string, config?: never) =>
      url.endsWith("/files")
        ? Promise.resolve({ data: ["docs/one.md"] })
        : realGet(url, config)) as typeof axios.get);

    renderPage();
    const filesCalls = () =>
      get.mock.calls.filter((c) => String(c[0]).endsWith("/files")).length;

    fireEvent.keyDown(document, { key: "t" });
    const input = await screen.findByPlaceholderText("Search files by name...");
    await waitFor(() => expect(filesCalls()).toBe(1));

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(document, { key: "t" });
    await waitFor(() => expect(filesCalls()).toBe(2));

    get.mockRestore();
  });

  // `Shift+R` used to open the fuzzy file picker over the recents, while `r`
  // opened the recents modal; now both open the modal, at two scopes.
  it("opens the recents modal for every project on Shift+R", async () => {
    const realGet = axios.get.bind(axios);
    const get = vi.spyOn(axios, "get");
    get.mockImplementation(((url: string, config?: never) =>
      url.startsWith("/api/recent/all")
        ? Promise.resolve({
            data: [
              {
                repo: "notes",
                path: "docs/plan.md",
                date: new Date().toISOString(),
                author_name: "Ann",
                message: "Plan it",
                hexsha: "abc1234",
              },
            ],
          })
        : realGet(url, config)) as typeof axios.get);

    renderPage();
    fireEvent.keyDown(document, { key: "R", shiftKey: true });

    const row = (await screen.findByText("plan.md")).closest("a");
    expect(row).toHaveAttribute("href", "/notes/docs/plan.md");
    expect(screen.getByText("All projects")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Search all projects' files..."),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("All projects")).not.toBeInTheDocument();
    expect(useAllRecentsStore.getState().active).toBe(false);

    fireEvent.keyDown(document, { key: "r" });
    expect(screen.getByText("Recently Changed")).toBeInTheDocument();
    expect(screen.queryByText("All projects")).not.toBeInTheDocument();

    get.mockRestore();
  });

  it("handles breadcrumb navigation", () => {
    renderPage();
    // Breadcrumbs for path/to/file.md: root > path > to > file.md
    // Click 'path' (index 0)

    const pathCrumb = screen.getByText("path");
    fireEvent.click(pathCrumb);
    expect(mockNavigate).toHaveBeenCalledWith("/path");
  });

  it("displays error message when error state is set", () => {
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      fileTree: [],
      fileContent: null,
      currentDirectory: null,
      currentPath: "nonexistent.md",
      error: "File not found",
      refreshTree: mockRefreshTree,
      viewDirectory: mockViewDirectory,
      loadFile: mockLoadFile,
      expandToPath: mockExpandToPath,
      loadPathDirectories: mockLoadPathDirectories,
      repos: [],
      isMultiRepo: false,
      reposLoaded: true,
      currentRepo: null,
      loadRepos: mockLoadRepos,
      setCurrentRepo: mockSetCurrentRepo,
    });

    renderPage();
    expect(screen.getByText(/File not found/i)).toBeInTheDocument();
  });

  it("displays error when navigating to non-existent file", () => {
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      fileTree: [],
      fileContent: null,
      currentDirectory: null,
      currentPath: "does-not-exist.md",
      error: "Failed to load file content",
      refreshTree: mockRefreshTree,
      viewDirectory: mockViewDirectory,
      loadFile: mockLoadFile,
      expandToPath: mockExpandToPath,
      loadPathDirectories: mockLoadPathDirectories,
      repos: [],
      isMultiRepo: false,
      reposLoaded: true,
      currentRepo: null,
      loadRepos: mockLoadRepos,
      setCurrentRepo: mockSetCurrentRepo,
    });
    mockUseParams.mockReturnValue({ "*": "does-not-exist.md" });

    renderPage();
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
    // Path appears in both breadcrumbs and error display
    expect(
      screen.getAllByText(/does-not-exist.md/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  // A repository the daemon retires (its directory went away) drops out of
  // /api/repos, which reaches this page as a shorter `repos` list. The viewer
  // has to survive that and, more importantly, come back from it.
  describe("a repository that disappears and returns", () => {
    const installRepoStore = (
      overrides: Record<string, unknown> & { repos: { name: string }[] },
    ) => {
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        // Multi-repo mode renders the project picker, which sorts the list.
        sortedRepos: () => overrides.repos,
        repoSortMode: "alphabetical",
        setRepoSortMode: vi.fn(),
        fileTree: [],
        fileContent: null,
        currentDirectory: null,
        currentPath: "beta/b.md",
        error: null,
        refreshTree: mockRefreshTree,
        viewDirectory: mockViewDirectory,
        loadFile: mockLoadFile,
        expandToPath: mockExpandToPath,
        loadPathDirectories: mockLoadPathDirectories,
        isMultiRepo: true,
        reposLoaded: true,
        loadRepos: mockLoadRepos,
        setCurrentRepo: mockSetCurrentRepo,
        ...overrides,
      });
    };

    const rerenderPage = (rerender: (ui: React.ReactElement) => void) =>
      rerender(
        <BrowserRouter>
          <AppShell>
            <ViewerPage />
          </AppShell>
        </BrowserRouter>,
      );

    it("deselects it while it is gone and reloads the document when it is back", () => {
      mockUseParams.mockReturnValue({ "*": "beta/b.md" });
      installRepoStore({ repos: [{ name: "beta" }], currentRepo: "beta" });
      const { rerender } = renderPage();
      expect(mockLoadFile).toHaveBeenCalledWith("b.md");

      // Retired: the push refreshed `repos` and beta is no longer in it.
      installRepoStore({ repos: [], currentRepo: "beta" });
      rerenderPage(rerender);
      // Deselected, so the return goes through setCurrentRepo — which refetches
      // the file tree this branch drops. Left selected, the document would come
      // back under an empty sidebar.
      expect(mockSetCurrentRepo).toHaveBeenCalledWith(null);

      // Back: same URL, same page, no reload anywhere.
      mockSetCurrentRepo.mockClear();
      installRepoStore({ repos: [{ name: "beta" }], currentRepo: null });
      rerenderPage(rerender);
      expect(mockSetCurrentRepo).toHaveBeenCalledWith("beta");
    });

    it("tells the reader the error page is waiting, while the socket is up", () => {
      installRepoStore({
        repos: [],
        currentRepo: null,
        error: "Repository not found: beta",
      });
      useConnectionStore.setState({ connected: true });

      const { rerender } = renderPage();
      expect(screen.getByText(/loads it automatically/i)).toBeInTheDocument();

      // Disconnected, the page cannot promise anything: nothing will tell it
      // the repository came back.
      useConnectionStore.setState({ connected: false, disconnectedAt: 1 });
      rerenderPage(rerender);
      expect(screen.queryByText(/loads it automatically/i)).toBeNull();
      useConnectionStore.setState({ connected: true, disconnectedAt: null });
    });

    // A static export has no socket, and its connection store never leaves
    // its starting `connected: true` — so the promise was made on every
    // not-found page of every export, where nothing ever comes back by itself.
    it("promises nothing in a static export, which has no socket", () => {
      // An export is a single repository, at a route no document has.
      installRepoStore({
        repos: [],
        isMultiRepo: false,
        currentRepo: null,
        currentPath: "other-ways-to-get-nix",
        error: "Failed to load directory",
      });
      useConnectionStore.setState({ connected: true });
      window.__VANTAGE_STATIC__ = true;
      try {
        renderPage();
        expect(
          screen.getByText("Failed to load directory"),
        ).toBeInTheDocument();
        expect(screen.queryByText(/loads it automatically/i)).toBeNull();
      } finally {
        delete window.__VANTAGE_STATIC__;
      }
    });
  });

  describe("review toolbar copy button", () => {
    const agentAddressed: CommentReaction = {
      actor: "agent",
      kind: "addressed",
      summary: "Reworded the paragraph",
      before_text: "",
      after_text: "",
      timestamp: 1,
    };
    const reviewerFollowup: CommentReaction = {
      actor: "reviewer",
      kind: "needs_clarification",
      summary: "Still not right",
      before_text: "",
      after_text: "",
      timestamp: 2,
    };

    const mkComment = (reactions: CommentReaction[]): ReviewComment => ({
      id: "11111111-2222-3333-4444-555555555555",
      anchor: {
        source_line: 1,
        block_text_hash: "hash",
        selection_offset: 0,
        selection_length: 0,
      },
      fallback_text: "some text",
      reactions,
      comment: "please fix",
      created_at: 0,
    });

    const seedReview = (reactions: CommentReaction[]) => {
      useReviewStore.setState({
        isReviewMode: true,
        // Matching the mocked currentPath keeps loadReview from treating this
        // as a file switch and clearing the seeded comments.
        filePath: "path/to/file.md",
        comments: [mkComment(reactions)],
      });
    };

    const copyButtons = () =>
      screen.queryAllByTitle(/^Copy \d+ comments? to clipboard$/);

    // An icon-only button keeps its name for a screen reader, but a sighted
    // reader has only the tooltip, and "Copy all comments" said nothing of
    // how many the label had counted.
    it("counts the comments in the review buttons' tooltips", () => {
      seedReview([]);
      renderPage();
      expect(
        screen.getAllByTitle("Copy 1 comment to clipboard").length,
      ).toBeGreaterThan(0);
      expect(screen.getAllByTitle("Dismiss 1 comment").length).toBeGreaterThan(
        0,
      );
    });

    it("shows Copy when the agent has not responded yet", () => {
      seedReview([]);
      renderPage();
      expect(copyButtons().length).toBeGreaterThan(0);
    });

    it("hides Copy once the agent has addressed the comment", () => {
      seedReview([agentAddressed]);
      renderPage();
      expect(copyButtons()).toHaveLength(0);
    });

    it("shows Copy again after the reviewer replies to an agent response", () => {
      seedReview([agentAddressed, reviewerFollowup]);
      renderPage();
      expect(copyButtons().length).toBeGreaterThan(0);
    });

    it("shows Copy again after the reviewer edits an addressed comment", () => {
      // The agent answered the OLD wording, so the new wording is still owed.
      useReviewStore.setState({
        isReviewMode: true,
        filePath: "path/to/file.md",
        comments: [
          {
            ...mkComment([agentAddressed]),
            comment: "reworded ask",
            edited_at: agentAddressed.timestamp + 10,
          },
        ],
      });
      renderPage();
      expect(copyButtons().length).toBeGreaterThan(0);
    });

    it("keeps the review controls reachable in raw view", () => {
      // Raw view can't host inline highlights, but hiding the whole review
      // toolbar stranded a reviewer holding pending comments with no way to
      // copy them or open the panel.  The page renders a wide and a narrow
      // toolbar, so compare counts rather than presence — asserting only
      // "> 0" passes while one of the two variants is still hidden.
      seedReview([]);
      renderPage();
      const rendered = {
        copy: copyButtons().length,
        panel: screen.getAllByTitle("Manage comments").length,
      };
      expect(rendered.copy).toBeGreaterThan(0);

      fireEvent.click(screen.getAllByTitle("View raw markdown")[0]);
      expect(copyButtons()).toHaveLength(rendered.copy);
      expect(screen.getAllByTitle("Manage comments")).toHaveLength(
        rendered.panel,
      );
    });
  });

  describe("document-changed indicator", () => {
    const indicators = () =>
      screen.queryAllByLabelText(
        "The document changed under comments awaiting a response",
      );

    // The page only renders the bit; whether the document moved out from under
    // the comments is decided by useReviewHighlights against the anchor hashes,
    // and is tested there. Seeding it directly is what keeps this a test of the
    // header and not a second copy of that comparison.
    const seed = (drifted: boolean) => {
      useReviewStore.setState({
        isReviewMode: true,
        filePath: "path/to/file.md",
        comments: [
          {
            id: "11111111-2222-3333-4444-555555555555",
            anchor: { source_line: 1 },
            comment: "please fix",
            reactions: [],
            created_at: 0,
          },
        ] as never,
        commentsDrifted: drifted,
      });
    };

    it("renders when the comments' text has drifted", () => {
      seed(true);
      renderPage();

      expect(indicators().length).toBeGreaterThan(0);
    });

    it("stays hidden while the comments' text still matches", () => {
      seed(false);
      renderPage();

      expect(indicators()).toHaveLength(0);
    });

    it("stays hidden by default", () => {
      renderPage();
      expect(indicators()).toHaveLength(0);
    });
  });

  // The count of answerable Open Questions reaches the reader through the
  // Review toggle's TOOLTIP and nowhere else. It used to also render as a chip
  // beside the label, which read as an unread badge on a toolbar that has no
  // other notification; these pin that it is gone and that the sentence which
  // replaced it is still there.
  describe("the Review toggle's Open Questions count", () => {
    const toggles = () =>
      screen.queryAllByRole("button", { name: /Review/ }) as HTMLElement[];

    // The count comes up from the viewer, and the viewer renders only once the
    // file has content — with the default `fileContent: null` every assertion
    // here would pass at a count of zero without testing anything.
    const withContent = () => {
      const repoStore = useRepoStore as unknown as ReturnType<typeof vi.fn>;
      repoStore.mockReturnValue({
        ...repoStore(),
        fileContent: "# A document with open questions",
      });
    };

    it("names the count in the tooltip while review mode is off", () => {
      mockOpenQuestionCount = 3;
      withContent();
      renderPage();

      expect(
        screen.queryAllByTitle(
          "Enter review mode — 3 open questions here can be answered in one click",
        ).length,
      ).toBeGreaterThan(0);
    });

    it("says one question in the singular", () => {
      mockOpenQuestionCount = 1;
      withContent();
      renderPage();

      expect(
        screen.queryAllByTitle(
          "Enter review mode — 1 open question here can be answered in one click",
        ).length,
      ).toBeGreaterThan(0);
    });

    it("renders no number beside the label", () => {
      mockOpenQuestionCount = 3;
      withContent();
      renderPage();

      const labeled = toggles();
      expect(labeled.length).toBeGreaterThan(0);
      for (const toggle of labeled) {
        expect(toggle.textContent).not.toMatch(/\d/);
      }
    });

    it("says nothing about questions when there are none", () => {
      withContent();
      renderPage();

      expect(
        screen.queryAllByTitle("Enter review mode").length,
      ).toBeGreaterThan(0);
    });
  });

  // A static export ships the same SPA with no backend, and staticMode.ts
  // coerces every /api/* write to a GET of a file `vantage build` never
  // emitted. A Review toggle there is a control that cannot work: the reviewer
  // types an answer, sees it appear, and loses it on reload. D4 says such a
  // control must not render — the precedent is the working-diff button, which
  // is already wrapped in `{!isStaticMode() && …}`. (R7.)
  describe("review toggle in a static export", () => {
    const toggles = () => screen.queryAllByTitle(/^(Enter|Exit) review mode$/);

    afterEach(() => {
      delete window.__VANTAGE_STATIC__;
    });

    // The header has two toolbar variants — one for a file with git history and
    // one for an untracked file — and each carries its own copy of the toggle.
    // Asserting only the tracked case leaves the other half of the hole open.
    const asUntracked = () => {
      gitAnswers({
        "path/to/file.md": { lastCommit: null, gitStatus: "untracked" },
      });
    };

    it("renders the toggle when a backend is present", () => {
      renderPage();
      expect(toggles().length).toBeGreaterThan(0);
    });

    it("renders the toggle for an untracked file when a backend is present", () => {
      asUntracked();
      renderPage();
      expect(toggles().length).toBeGreaterThan(0);
    });

    it("hides the toggle in a static export", () => {
      window.__VANTAGE_STATIC__ = true;
      renderPage();
      expect(toggles()).toHaveLength(0);
    });

    it("hides the toggle for an untracked file in a static export", () => {
      window.__VANTAGE_STATIC__ = true;
      asUntracked();
      renderPage();
      expect(toggles()).toHaveLength(0);
    });
  });

  // A second tab of the same repo is the same reader, and these two preferences
  // are stored per origin — so a toggle in one tab has to land in the other
  // without waiting for a reload. `usePersistentFlag` is what carries that, and
  // its own tests cover the parsing and the event filtering; these cases exist
  // to prove the header is wired to it at all, in both directions.
  describe("reading preferences shared across tabs", () => {
    /** The event the browser raises in *this* tab when another tab writes. */
    const writeFromAnotherTab = (key: string, newValue: string) => {
      localStorage.setItem(key, newValue);
      fireEvent(
        window,
        new StorageEvent("storage", {
          key,
          newValue,
          storageArea: localStorage,
        }),
      );
    };

    beforeEach(() => {
      localStorage.clear();
      // The contents button needs a rendered Markdown document to have any
      // headings to offer — `tocAvailable` is false over a directory.
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useRepoStore(),
        fileContent: "Some content",
        currentPath: "file.md",
      });
    });

    afterEach(() => localStorage.clear());

    it("adopts another tab's contents toggle", () => {
      renderPage();
      expect(screen.getByLabelText("Show contents")).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      writeFromAnotherTab("vantage:tocOpen", "true");

      expect(screen.getByLabelText("Hide contents")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("adopts another tab's width toggle", () => {
      renderPage();
      expect(screen.getByLabelText("Use full width")).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      writeFromAnotherTab("vantage:fullWidth", "true");

      expect(screen.getByLabelText("Use fixed width")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("still writes a toggle made in this tab", () => {
      renderPage();

      fireEvent.click(screen.getByLabelText("Show contents"));
      fireEvent.click(screen.getByLabelText("Use full width"));

      expect(localStorage.getItem("vantage:tocOpen")).toBe("true");
      expect(localStorage.getItem("vantage:fullWidth")).toBe("true");
    });
  });

  it("shows loading state before repos are loaded (prevents flash of wrong UI)", () => {
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      fileTree: [],
      fileContent: null,
      currentDirectory: null,
      currentPath: null,
      error: null,
      refreshTree: mockRefreshTree,
      viewDirectory: mockViewDirectory,
      loadFile: mockLoadFile,
      expandToPath: mockExpandToPath,
      loadPathDirectories: mockLoadPathDirectories,
      repos: [],
      isMultiRepo: false,
      reposLoaded: false, // KEY: repos not loaded yet
      currentRepo: null,
      loadRepos: mockLoadRepos,
      setCurrentRepo: mockSetCurrentRepo,
    });

    renderPage();
    // Should show loading indicator, NOT the sidebar or file tree
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();
  });

  // The star, the sidebar section and the error notice's remove offer each have
  // their own suite. What only this page can prove is that they are wired to
  // the open document at all.
  describe("bookmarks", () => {
    beforeEach(() => {
      useStarredStore.setState({ entries: [], loaded: true });
    });

    it("offers to bookmark the open document", () => {
      renderPage();
      expect(
        screen.getByRole("button", { name: "Bookmark this" }),
      ).toBeInTheDocument();
    });

    it("shows the open document's own bookmark state", () => {
      useStarredStore.setState({
        entries: [
          {
            repo: "",
            path: "path/to/file.md",
            is_dir: false,
            starred_at: "2026-09-20T12:00:00Z",
            source: "user" as const,
          },
        ],
      });

      renderPage();

      expect(
        screen.getByRole("button", { name: "Remove bookmark" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("lists bookmarks in the sidebar", () => {
      useStarredStore.setState({
        entries: [
          {
            repo: "",
            path: "docs/pinned.md",
            is_dir: false,
            starred_at: "2026-09-20T12:00:00Z",
            source: "user" as const,
          },
        ],
      });

      renderPage();

      expect(screen.getByText("Starred")).toBeInTheDocument();
      expect(screen.getByText("pinned.md")).toBeInTheDocument();
    });

    // A bookmark that cannot be opened is the only way to reach the offer, and
    // the sidebar deliberately never flags one, so this is where it surfaces.
    it("offers to remove the bookmark when the document fails to load", () => {
      useConnectionStore.setState({ connected: true });
      useStarredStore.setState({
        entries: [
          {
            repo: "",
            path: "path/to/file.md",
            is_dir: false,
            starred_at: "2026-09-20T12:00:00Z",
            source: "user" as const,
          },
        ],
      });
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useRepoStore(),
        error: "Failed to load file content",
      });

      renderPage();

      const buttons = screen.getAllByRole("button", {
        name: "Remove bookmark",
      });
      expect(buttons.length).toBeGreaterThan(1);
      expect(screen.getByText("Go to Home")).toBeInTheDocument();
    });

    // A daemon that stopped serving a repo clears currentRepo and leaves the
    // whole route in currentPath, so the offer has to come from the URL — this
    // is the one moment a reader wants to drop a bookmark and the store cannot
    // tell you which one it is.
    it("offers to remove a bookmark whose repository is no longer served", () => {
      mockUseParams.mockReturnValue({ "*": "beta/b.md" });
      useConnectionStore.setState({ connected: true });
      useStarredStore.setState({
        entries: [
          {
            repo: "beta",
            path: "b.md",
            is_dir: false,
            starred_at: "2026-09-20T12:00:00Z",
            source: "user" as const,
          },
        ],
      });
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useRepoStore(),
        isMultiRepo: true,
        repos: [{ name: "alpha" }],
        // What the repo-not-found branch leaves behind.
        currentRepo: null,
        currentPath: "beta/b.md",
        error: "Repository not found: beta",
      });

      renderPage();

      expect(
        screen.getByRole("button", { name: "Remove bookmark" }),
      ).toBeInTheDocument();
    });

    it("does not offer to remove a document that is not bookmarked", () => {
      useConnectionStore.setState({ connected: true });
      (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useRepoStore(),
        error: "Failed to load file content",
      });

      renderPage();

      expect(
        screen.queryByRole("button", { name: "Remove bookmark" }),
      ).not.toBeInTheDocument();
    });
  });
});
