import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StarButton } from "./StarButton";
import { useStarredStore } from "../stores/useStarredStore";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

describe("StarButton", () => {
  beforeEach(() => {
    useStarredStore.setState({ entries: [], loaded: true });
    vi.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ data: { entries: [] } });
    mockedAxios.delete.mockResolvedValue({ data: { entries: [] } });
  });

  afterEach(() => {
    delete window.__VANTAGE_STATIC__;
  });

  it("offers to bookmark an unstarred document", () => {
    render(<StarButton path="docs/a.md" repo={null} isDir={false} />);

    const button = screen.getByRole("button", { name: "Bookmark this" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a starred document as pressed and offers to remove it", () => {
    useStarredStore.setState({
      entries: [
        {
          repo: "",
          path: "docs/a.md",
          is_dir: false,
          starred_at: "2026-09-20T12:00:00Z",
          source: "user" as const,
        },
      ],
    });

    render(<StarButton path="docs/a.md" repo={null} isDir={false} />);

    const button = screen.getByRole("button", { name: "Remove bookmark" });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  // The failure this guards is silent end to end: a promoted row counted as
  // starred renders a filled amber star, whose click sends a DELETE the server
  // answers 404, which the store logs and swallows, leaving the star filled.
  it("does not claim a promoted document is bookmarked", () => {
    useStarredStore.setState({
      entries: [
        {
          repo: "",
          path: "docs/a.md",
          is_dir: false,
          starred_at: "2026-09-20T12:00:00Z",
          source: "repo" as const,
        },
      ],
    });

    render(<StarButton path="docs/a.md" repo={null} isDir={false} />);

    const button = screen.getByRole("button", { name: "Bookmark this" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    // And the click adds rather than removing something that was never theirs.
    fireEvent.click(button);
    expect(mockedAxios.post).toHaveBeenCalled();
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it("stars the open document on click", () => {
    render(<StarButton path="docs/a.md" repo={null} isDir={false} />);

    fireEvent.click(screen.getByRole("button"));

    expect(mockedAxios.post).toHaveBeenCalledWith("/api/starred", {
      repo: "",
      path: "docs/a.md",
      is_dir: false,
    });
  });

  // A null repo is the single-repo sentinel the API expects, not a missing value.
  it("sends the repo name in multi-repo mode", () => {
    render(<StarButton path="a.md" repo="alpha" isDir={false} />);

    fireEvent.click(screen.getByRole("button"));

    expect(mockedAxios.post).toHaveBeenCalledWith("/api/starred", {
      repo: "alpha",
      path: "a.md",
      is_dir: false,
    });
  });

  it("records a directory as one", () => {
    render(<StarButton path="docs" repo={null} isDir={true} />);

    fireEvent.click(screen.getByRole("button"));

    expect(mockedAxios.post).toHaveBeenCalledWith("/api/starred", {
      repo: "",
      path: "docs",
      is_dir: true,
    });
  });

  describe("is hidden when there is nothing to bookmark", () => {
    it("with no open path", () => {
      const { container } = render(
        <StarButton path={null} repo={null} isDir={false} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    // The server rejects "." — bookmarking everything says nothing.
    it("at the repository root", () => {
      const { container } = render(
        <StarButton path="." repo={null} isDir={true} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("in a static export, which has no backend to store it in", () => {
      window.__VANTAGE_STATIC__ = true;
      const { container } = render(
        <StarButton path="docs/a.md" repo={null} isDir={false} />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });
});
