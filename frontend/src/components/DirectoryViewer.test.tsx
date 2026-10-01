import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DirectoryViewer } from "./DirectoryViewer";
import axios from "axios";
import { BrowserRouter } from "react-router-dom";
import { FileNode } from "../types";

// Mock axios
vi.mock("axios");

// Mock MarkdownViewer to simplify test
vi.mock("./MarkdownViewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => (
    <div data-testid="markdown-viewer">{content}</div>
  ),
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

// Components using useNavigate must be wrapped in Router
const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe("DirectoryViewer", () => {
  const mockNodes: FileNode[] = [
    { name: "file1.txt", path: "path/file1.txt", is_dir: false },
    { name: "folder1", path: "path/folder1", is_dir: true },
    {
      name: "README.md",
      path: "path/README.md",
      is_dir: false,
      last_commit: {
        id: "123",
        message: "Update readme",
        date: new Date().toISOString(),
        author: "Test User",
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders file list correctly", () => {
    // Return promise that never resolves for the readme fetch, to just test the list first
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    renderWithRouter(<DirectoryViewer nodes={mockNodes} currentPath="path" />);

    expect(screen.getByText("file1.txt")).toBeInTheDocument();
    expect(screen.getByText("folder1")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("Update readme")).toBeInTheDocument();
  });

  it("fetches and renders README.md content", async () => {
    const readmeContent = "# Readme content";
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { content: readmeContent, path: "path/README.md" },
    });

    renderWithRouter(<DirectoryViewer nodes={mockNodes} currentPath="path" />);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("README.md"),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("markdown-viewer")).toHaveTextContent(
        readmeContent,
      );
    });
  });

  // A fragment on a folder's URL is a heading in the README beneath its
  // listing, as github.com/owner/repo#section is on GitHub — and a static
  // export's bare `#section` arrives as just that, on the root route.
  it("scrolls to the README heading the URL's fragment names, once", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { content: "# Readme", path: "path/README.md" },
    });
    // The README's heading, standing in for the mocked viewer's rendering.
    const heading = document.createElement("h2");
    heading.id = "install";
    heading.scrollIntoView = scrollTo;
    document.body.append(heading);
    window.history.replaceState(null, "", "/path#install");
    try {
      const { rerender } = renderWithRouter(
        <DirectoryViewer nodes={mockNodes} currentPath="path" />,
      );
      await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));

      // A live reload of the README is not a new arrival: the reader stays
      // wherever they have scrolled to since.
      (axios.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { content: "# Readme, edited", path: "path/README.md" },
      });
      rerender(
        <BrowserRouter>
          <DirectoryViewer nodes={[...mockNodes]} currentPath="path" />
        </BrowserRouter>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("markdown-viewer")).toHaveTextContent(
          "edited",
        ),
      );
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      heading.remove();
      window.history.replaceState(null, "", "/");
      vi.unstubAllGlobals();
    }
  });

  it("handles navigation on row click", () => {
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    renderWithRouter(<DirectoryViewer nodes={mockNodes} currentPath="path" />);

    const link = screen.getByText("folder1").closest("a");
    fireEvent.click(link!);

    expect(mockNavigate).toHaveBeenCalledWith("/path/folder1");
  });

  it("does not intercept Ctrl+click (allows new tab)", () => {
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    renderWithRouter(<DirectoryViewer nodes={mockNodes} currentPath="path" />);

    const link = screen.getByText("folder1").closest("a");
    fireEvent.click(link!, { ctrlKey: true });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept Meta/Cmd+click (allows new tab on Mac)", () => {
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    renderWithRouter(<DirectoryViewer nodes={mockNodes} currentPath="path" />);

    const link = screen.getByText("folder1").closest("a");
    fireEvent.click(link!, { metaKey: true });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept middle mouse button click", () => {
    (axios.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    renderWithRouter(<DirectoryViewer nodes={mockNodes} currentPath="path" />);

    const link = screen.getByText("folder1").closest("a");
    fireEvent.click(link!, { button: 1 });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
