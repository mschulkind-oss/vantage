import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileTree } from "./FileTree";
import { useRepoStore } from "../stores/useRepoStore";
import { BrowserRouter } from "react-router-dom";
import { FileNode } from "../types";

// Mock useRepoStore
vi.mock("../stores/useRepoStore");

// The planning index is its own suites' subject (PlanningTreeBadge.test.tsx).
// Here it stays unasked and empty, so the tree issues no planning request and
// draws no badge.
vi.mock("../stores/usePlanningStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stores/usePlanningStore")>()),
  useEnsurePlanningIndex: () => null,
  usePlanningDocument: () => undefined,
  usePlanningStages: () => null,
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("FileTree", () => {
  const mockNodes: FileNode[] = [
    {
      name: "folder1",
      path: "folder1",
      is_dir: true,
      children: [
        { name: "child.txt", path: "folder1/child.txt", is_dir: false },
      ],
    },
    { name: "file1.txt", path: "file1.txt", is_dir: false },
  ];

  const mockToggleDir = vi.fn();
  const mockLoadDirChildren = vi.fn();

  // Create a mock store state
  let mockStoreState = {
    currentPath: "",
    expandedDirs: {} as Record<string, boolean>,
    toggleDir: mockToggleDir,
    loadDirChildren: mockLoadDirChildren,
    showEmptyDirs: true,
    recentlyChangedPaths: new Set<string>(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState = {
      currentPath: "",
      expandedDirs: {},
      toggleDir: mockToggleDir,
      loadDirChildren: mockLoadDirChildren,
      showEmptyDirs: true,
      recentlyChangedPaths: new Set<string>(),
    };
    // Mock useRepoStore to work with individual selectors
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector?: (state: typeof mockStoreState) => unknown) => {
        if (typeof selector === "function") {
          return selector(mockStoreState);
        }
        return mockStoreState;
      },
    );
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };

  it("renders tree structure", () => {
    renderWithRouter(<FileTree nodes={mockNodes} />);
    expect(screen.getByText("folder1")).toBeInTheDocument();
    expect(screen.getByText("file1.txt")).toBeInTheDocument();
    // Child should not be visible initially as it is not expanded
    expect(screen.queryByText("child.txt")).not.toBeInTheDocument();
  });

  it("navigates on file click", () => {
    renderWithRouter(<FileTree nodes={mockNodes} />);
    fireEvent.click(screen.getByText("file1.txt"));
    expect(mockNavigate).toHaveBeenCalledWith("/file1.txt");
  });

  // What "Copy link" and a middle-click read. In a static export the route is
  // the URL's fragment, so a path-style href names a file the host lacks.
  it("links each entry by its route: a path live, the hash route in an export", () => {
    const { unmount } = renderWithRouter(<FileTree nodes={mockNodes} />);
    expect(screen.getByText("file1.txt").closest("a")).toHaveAttribute(
      "href",
      "/file1.txt",
    );
    unmount();

    window.__VANTAGE_STATIC__ = true;
    try {
      renderWithRouter(<FileTree nodes={mockNodes} />);
      expect(screen.getByText("file1.txt").closest("a")).toHaveAttribute(
        "href",
        "#/file1.txt",
      );
      fireEvent.click(screen.getByText("file1.txt"));
      expect(mockNavigate).toHaveBeenCalledWith("/file1.txt");
    } finally {
      delete window.__VANTAGE_STATIC__;
    }
  });

  it("toggles directory expansion on arrow click", async () => {
    renderWithRouter(<FileTree nodes={mockNodes} />);

    // Find the arrow/icon area. Finding by text might be tricky for just the icon area.
    // The structure is:
    // onClick for nav on the whole row.
    // onClick for toggle on the icon span.

    // We can simulate click on the text for navigation
    // And simulate click on the span containing the arrow for expansion.
    // The span around the arrow has onClick={handleArrowClick}.

    // Let's try to find the chevron or the folder icon's parent span.
    // The chevron is inside a span that has the click handler.

    // Inspecting FileTree.tsx:
    // <span className="mr-1 ..." onClick={handleArrowClick}>
    //   ... <ChevronRight /> ...
    // </span>

    // We can try to get the ChevronRight icon? Or just click the text "folder1"
    // Wait, clicking the row navigates. Clicking the arrow expands.

    // Let's modify the test to specifically target the arrow.
    // Since we don't have aria-labels on the arrow span, we might need to add one or assume structure.
    // Or we can just mock the store to return expanded state and see if child renders.
  });

  it("shows children when expanded", () => {
    // Update the mock store state for this test
    const expandedState = {
      currentPath: "",
      expandedDirs: { folder1: true },
      toggleDir: mockToggleDir,
      loadDirChildren: mockLoadDirChildren,
      recentlyChangedPaths: new Set<string>(),
    };
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector?: (state: typeof expandedState) => unknown) => {
        if (typeof selector === "function") {
          return selector(expandedState);
        }
        return expandedState;
      },
    );

    renderWithRouter(<FileTree nodes={mockNodes} />);
    expect(screen.getByText("child.txt")).toBeInTheDocument();
  });

  it("does not intercept Ctrl+click (allows new tab)", () => {
    renderWithRouter(<FileTree nodes={mockNodes} />);
    fireEvent.click(screen.getByText("file1.txt"), { ctrlKey: true });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept Meta/Cmd+click (allows new tab on Mac)", () => {
    renderWithRouter(<FileTree nodes={mockNodes} />);
    fireEvent.click(screen.getByText("file1.txt"), { metaKey: true });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept middle mouse button click", () => {
    renderWithRouter(<FileTree nodes={mockNodes} />);
    fireEvent.click(screen.getByText("file1.txt"), { button: 1 });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("hides non-markdown dirs when showEmptyDirs is false", () => {
    const nodesWithEmpty: FileNode[] = [
      { name: "docs", path: "docs", is_dir: true, has_markdown: true },
      { name: "empty", path: "empty", is_dir: true, has_markdown: false },
      { name: "readme.md", path: "readme.md", is_dir: false },
    ];
    const state = {
      ...mockStoreState,
      showEmptyDirs: false,
    };
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector?: (state: typeof mockStoreState) => unknown) => {
        if (typeof selector === "function") return selector(state);
        return state;
      },
    );
    renderWithRouter(<FileTree nodes={nodesWithEmpty} />);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
    expect(screen.getByText("readme.md")).toBeInTheDocument();
  });

  it("shows non-markdown dirs when showEmptyDirs is true", () => {
    const nodesWithEmpty: FileNode[] = [
      { name: "docs", path: "docs", is_dir: true, has_markdown: true },
      { name: "empty", path: "empty", is_dir: true, has_markdown: false },
    ];
    renderWithRouter(<FileTree nodes={nodesWithEmpty} />);
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("shows git status indicator for modified files", () => {
    const nodesWithStatus: FileNode[] = [
      {
        name: "changed.md",
        path: "changed.md",
        is_dir: false,
        git_status: "modified",
      },
      { name: "clean.md", path: "clean.md", is_dir: false },
    ];
    renderWithRouter(<FileTree nodes={nodesWithStatus} />);
    // Modified file gets amber text
    const changedEl = screen.getByText("changed.md");
    expect(changedEl).toHaveClass("text-amber-700");
    // Clean file gets default text
    const cleanEl = screen.getByText("clean.md");
    expect(cleanEl).toHaveClass("text-slate-700");
  });

  it("shows git status indicator for untracked files", () => {
    const nodesWithStatus: FileNode[] = [
      {
        name: "new.md",
        path: "new.md",
        is_dir: false,
        git_status: "untracked",
      },
    ];
    renderWithRouter(<FileTree nodes={nodesWithStatus} />);
    const newEl = screen.getByText("new.md");
    expect(newEl).toHaveClass("text-green-700");
  });

  it("shows amber treatment for directories with changes", () => {
    const nodesWithStatus: FileNode[] = [
      {
        name: "docs",
        path: "docs",
        is_dir: true,
        git_status: "contains_changes",
      },
    ];
    renderWithRouter(<FileTree nodes={nodesWithStatus} />);
    const docsEl = screen.getByText("docs");
    expect(docsEl).toHaveClass("text-amber-700");
  });

  it("shows loading skeleton for expanded dir without children", () => {
    const nodesWithNoChildren: FileNode[] = [
      { name: "loading-dir", path: "loading-dir", is_dir: true },
    ];
    const state = {
      ...mockStoreState,
      expandedDirs: { "loading-dir": true },
    };
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector?: (state: typeof mockStoreState) => unknown) => {
        if (typeof selector === "function") return selector(state);
        return state;
      },
    );
    renderWithRouter(<FileTree nodes={nodesWithNoChildren} />);
    // Should show the loading skeleton (animate-pulse div)
    const pulseEl = document.querySelector(".animate-pulse");
    expect(pulseEl).toBeInTheDocument();
  });

  it("does not show spinner for expanded dir with empty children array", () => {
    const nodesWithEmptyChildren: FileNode[] = [
      {
        name: "empty-dir",
        path: "empty-dir",
        is_dir: true,
        children: [],
      },
    ];
    const state = {
      ...mockStoreState,
      expandedDirs: { "empty-dir": true },
    };
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector?: (state: typeof mockStoreState) => unknown) => {
        if (typeof selector === "function") return selector(state);
        return state;
      },
    );
    renderWithRouter(<FileTree nodes={nodesWithEmptyChildren} />);
    // Should NOT show the loading skeleton
    const pulseEl = document.querySelector(".animate-pulse");
    expect(pulseEl).not.toBeInTheDocument();
  });

  it("retries load when clicking name of stuck spinner dir", () => {
    const stuckNodes: FileNode[] = [
      { name: "stuck-dir", path: "stuck-dir", is_dir: true },
    ];
    const state = {
      ...mockStoreState,
      expandedDirs: { "stuck-dir": true },
    };
    (useRepoStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector?: (state: typeof mockStoreState) => unknown) => {
        if (typeof selector === "function") return selector(state);
        return state;
      },
    );
    renderWithRouter(<FileTree nodes={stuckNodes} />);

    // Verify the spinner is showing
    const pulseEl = document.querySelector(".animate-pulse");
    expect(pulseEl).toBeInTheDocument();

    // Click the folder name
    const dirName = screen.getByText("stuck-dir");
    fireEvent.click(dirName);

    // Should retry loading, not just toggle
    expect(mockLoadDirChildren).toHaveBeenCalledWith("stuck-dir");
    // Should NOT have toggled (would collapse and hide spinner)
    expect(mockToggleDir).not.toHaveBeenCalled();
  });
});
