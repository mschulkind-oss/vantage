import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import axios from "axios";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ViewerPage } from "./ViewerPage";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { useReviewStore } from "../stores/useReviewStore";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useStarredStore } from "../stores/useStarredStore";
import { useFilePickerStore } from "../stores/useFilePickerStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { BrowserRouter } from "react-router-dom";
import type { CommentReaction, ReviewComment } from "../types";

// Mocks
vi.mock("../stores/useRepoStore");
vi.mock("../stores/useGitStore");
vi.mock("../hooks/useWebSocket");
vi.mock("../components/FileTree", () => ({
  FileTree: () => <div data-testid="file-tree">FileTree</div>,
}));
// The viewer is what reports the answerable-Open-Question count up to the page,
// so the mock has to be able to report one — otherwise every assertion about
// what the Review toggle says is vacuously true at zero.
let mockOpenQuestionCount = 0;
vi.mock("../components/MarkdownViewer", () => ({
  MarkdownViewer: ({
    onOpenQuestionCount,
  }: {
    onOpenQuestionCount?: (count: number) => void;
  }) => {
    onOpenQuestionCount?.(mockOpenQuestionCount);
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
      latestCommit: {
        hexsha: "123",
        message: "test commit",
        author: "me",
        date: new Date().toISOString(),
      },
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
      fetchHistory: vi.fn(),
    });

    (useWebSocket as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => {},
    );
    mockUseParams.mockReturnValue({ "*": "path/to/file.md" });
  });

  const renderPage = () =>
    render(
      <BrowserRouter>
        <ViewerPage />
      </BrowserRouter>,
    );

  it("renders initial layout components", () => {
    renderPage();
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    expect(screen.getByText("Vantage")).toBeInTheDocument();
  });

  // The last breadcrumb segment is the only element in the header that
  // truncates, so a long filename reaches the ellipsis with nowhere else to
  // read it. The title attribute is that somewhere else.
  it("gives the truncated breadcrumb filename a title with the full name", () => {
    const name = "a-very-long-macos-launchd-and-config-paths-design.md";
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...useRepoStore(),
      currentPath: `docs/design/${name}`,
    });
    mockUseParams.mockReturnValue({ "*": `docs/design/${name}` });

    renderPage();

    const leaf = screen.getByText(name);
    expect(leaf).toHaveClass("truncate");
    expect(leaf).toHaveAttribute("title", name);
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
          <ViewerPage />
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
      screen.queryAllByTitle("Copy all comments to clipboard");

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
    //
    // Read through the local alias, not through `useGitStore` itself: the mock
    // is an ordinary function, but calling it under that name inside a named
    // helper trips react-hooks/rules-of-hooks.
    const gitStoreMock = useGitStore as unknown as ReturnType<typeof vi.fn>;
    const asUntracked = () => {
      gitStoreMock.mockReturnValue({ ...gitStoreMock(), latestCommit: null });
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
