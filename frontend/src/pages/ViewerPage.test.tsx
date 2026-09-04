import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ViewerPage } from "./ViewerPage";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { useReviewStore } from "../stores/useReviewStore";
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

      const labelled = toggles();
      expect(labelled.length).toBeGreaterThan(0);
      for (const toggle of labelled) {
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
});
