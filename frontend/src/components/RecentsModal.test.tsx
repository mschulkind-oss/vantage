import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecentsModal } from "./RecentsModal";
import { BrowserRouter, MemoryRouter, useLocation } from "react-router-dom";

// Mock stores
const mockUseGitStore = vi.fn();
vi.mock("../stores/useGitStore", () => ({
  useGitStore: (...args: unknown[]) => mockUseGitStore(...args),
}));

vi.mock("../stores/useRepoStore", () => ({
  useRepoStore: vi.fn(() => ({
    isMultiRepo: false,
    currentRepo: null,
  })),
}));

const defaultStoreState = {
  recentFiles: [
    {
      path: "test.md",
      date: new Date().toISOString(),
      message: "Test commit",
      author_name: "Test Author",
      hexsha: "abc123",
      untracked: false,
    },
  ],
  isRecentLoading: false,
  recentFilesError: null,
  fetchRecentFiles: vi.fn(),
};

describe("RecentsModal", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
    mockUseGitStore.mockReturnValue(defaultStoreState);
  });

  it("renders when open", () => {
    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    expect(screen.getByText("Recently Changed")).toBeInTheDocument();
    expect(screen.getByText("test.md")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <BrowserRouter>
        <RecentsModal isOpen={false} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    expect(screen.queryByText("Recently Changed")).not.toBeInTheDocument();
  });

  it("calls onClose when clicking backdrop", () => {
    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    const backdrop =
      screen.getByText("Recently Changed").parentElement?.parentElement
        ?.previousElementSibling;
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(mockOnClose).toHaveBeenCalled();
    }
  });

  it("calls onClose when pressing Escape", async () => {
    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("calls onClose when clicking close button", () => {
    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    const closeButton = screen.getByLabelText("Close");
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking a file link", () => {
    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    const fileLink = screen.getByText("test.md");
    fireEvent.click(fileLink);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("shows full commit message without truncation", () => {
    mockUseGitStore.mockReturnValue({
      ...defaultStoreState,
      recentFiles: [
        {
          path: "docs/design/technical_spec.md",
          date: new Date().toISOString(),
          message:
            "Fix TypeScript error: use onBeforeNavigate instead of onClick for better navigation handling in sidebar components",
          author_name: "Matt Schulkind",
          hexsha: "abc123def456",
          untracked: false,
        },
      ],
    });

    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    // Full message should be visible (not truncated)
    expect(
      screen.getByText(
        "Fix TypeScript error: use onBeforeNavigate instead of onClick for better navigation handling in sidebar components",
      ),
    ).toBeInTheDocument();
  });

  it("always shows parent directory path", () => {
    mockUseGitStore.mockReturnValue({
      ...defaultStoreState,
      recentFiles: [
        {
          path: "docs/design/technical_spec.md",
          date: new Date().toISOString(),
          message: "update",
          author_name: "Author",
          hexsha: "abc123",
          untracked: false,
        },
      ],
    });

    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    expect(screen.getByText("docs/design")).toBeInTheDocument();
  });

  it("shows author name for tracked files", () => {
    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    expect(screen.getByText("Test Author")).toBeInTheDocument();
  });

  it("shows Untracked badge for untracked files", () => {
    mockUseGitStore.mockReturnValue({
      ...defaultStoreState,
      recentFiles: [
        {
          path: "new-file.md",
          date: new Date().toISOString(),
          message: "",
          author_name: "",
          hexsha: "",
          untracked: true,
        },
      ],
    });

    render(
      <BrowserRouter>
        <RecentsModal isOpen={true} onClose={mockOnClose} />
      </BrowserRouter>,
    );

    expect(screen.getByText("Untracked")).toBeInTheDocument();
  });

  describe("keyboard navigation", () => {
    const threeFiles = ["a.md", "docs/b.md", "c.md"].map((path) => ({
      path,
      date: new Date().toISOString(),
      message: "m",
      author_name: "A",
      hexsha: "abc123",
      untracked: false,
    }));

    let location = "";
    const LocationProbe = () => {
      location = useLocation().pathname;
      return null;
    };

    const renderAt = () =>
      render(
        <MemoryRouter initialEntries={["/start"]}>
          <RecentsModal isOpen={true} onClose={mockOnClose} />
          <LocationProbe />
        </MemoryRouter>,
      );

    const selectedRow = () =>
      document.querySelector("[data-recent-item][data-selected]");

    // Keys reach the modal the way they do in a browser: dispatched at the
    // focused element (the body), so they pass `document` on the way down.
    const press = (key: string, init: KeyboardEventInit = {}) =>
      fireEvent.keyDown(document.body, { key, ...init });

    beforeEach(() => {
      mockUseGitStore.mockReturnValue({
        ...defaultStoreState,
        recentFiles: threeFiles,
      });
    });

    it("highlights the first row on open", () => {
      renderAt();
      expect(selectedRow()).toHaveAttribute("href", "/a.md");
    });

    it("moves the highlight with the arrow keys, clamped at both ends", () => {
      renderAt();
      press("ArrowDown");
      expect(selectedRow()).toHaveAttribute("href", "/docs/b.md");
      press("ArrowDown");
      press("ArrowDown");
      expect(selectedRow()).toHaveAttribute("href", "/c.md");
      press("ArrowUp");
      press("ArrowUp");
      press("ArrowUp");
      expect(selectedRow()).toHaveAttribute("href", "/a.md");
    });

    it("moves the highlight to the hovered row", () => {
      renderAt();
      fireEvent.mouseEnter(screen.getByText("c.md").closest("a")!);
      expect(selectedRow()).toHaveAttribute("href", "/c.md");
    });

    it("navigates to the highlighted file on Enter and closes", () => {
      renderAt();
      press("ArrowDown");
      press("Enter");
      expect(location).toBe("/docs/b.md");
      expect(mockOnClose).toHaveBeenCalled();
    });

    it.each([
      ["Alt", { altKey: true }],
      ["Ctrl", { ctrlKey: true }],
      ["Cmd", { metaKey: true }],
    ])("opens the highlighted file in a new tab on %s+Enter", (_, mods) => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      renderAt();
      press("ArrowDown");
      press("Enter", mods);
      expect(open).toHaveBeenCalledWith("/docs/b.md", "_blank", "noopener");
      expect(location).toBe("/start");
      expect(mockOnClose).toHaveBeenCalled();
      open.mockRestore();
    });

    // The global shortcut handler listens on `document` as well; a key the
    // modal owns must not also scroll the page or open another dialog.
    it("keeps its keys from reaching document listeners", () => {
      const outside = vi.fn();
      document.addEventListener("keydown", outside);
      renderAt();
      press("j");
      press("ArrowDown");
      press("Escape");
      document.removeEventListener("keydown", outside);
      expect(outside).not.toHaveBeenCalled();
    });

    it("clamps the highlight when a refresh shortens the list", () => {
      const { rerender } = renderAt();
      press("ArrowDown");
      press("ArrowDown");
      expect(selectedRow()).toHaveAttribute("href", "/c.md");

      mockUseGitStore.mockReturnValue({
        ...defaultStoreState,
        recentFiles: threeFiles.slice(0, 1),
      });
      rerender(
        <MemoryRouter initialEntries={["/start"]}>
          <RecentsModal isOpen={true} onClose={mockOnClose} />
          <LocationProbe />
        </MemoryRouter>,
      );
      expect(selectedRow()).toHaveAttribute("href", "/a.md");
      press("Enter");
      expect(location).toBe("/a.md");
    });
  });
});
