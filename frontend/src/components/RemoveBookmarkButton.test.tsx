import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemoveBookmarkButton } from "./RemoveBookmarkButton";
import { useStarredStore } from "../stores/useStarredStore";
import axios from "axios";
import type { StarredEntry } from "../types";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const entry = (over: Partial<StarredEntry> = {}): StarredEntry => ({
  repo: "",
  path: "docs/a.md",
  is_dir: false,
  starred_at: "2026-09-20T12:00:00Z",
  source: "user" as const,
  ...over,
});

describe("RemoveBookmarkButton", () => {
  beforeEach(() => {
    useStarredStore.setState({ entries: [], loaded: true });
    vi.clearAllMocks();
    mockedAxios.delete.mockResolvedValue({ data: { entries: [] } });
  });

  afterEach(() => {
    delete window.__VANTAGE_STATIC__;
  });

  it("is absent when the failing document is not bookmarked", () => {
    const { container } = render(
      <RemoveBookmarkButton path="docs/a.md" repo={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to remove a bookmarked document", () => {
    useStarredStore.setState({ entries: [entry()] });

    render(<RemoveBookmarkButton path="docs/a.md" repo={null} />);

    expect(
      screen.getByRole("button", { name: "Remove bookmark" }),
    ).toBeInTheDocument();
  });

  // The button selects the entries themselves, not the store's isStarred
  // action: that action is a stable reference, so a component subscribing to it
  // is never re-rendered when the list arrives and the button silently failed
  // to appear on a cold load.
  it("appears once the list arrives, without a re-mount", () => {
    const { container } = render(
      <RemoveBookmarkButton path="docs/a.md" repo={null} />,
    );
    expect(container).toBeEmptyDOMElement();

    act(() => {
      useStarredStore.setState({ entries: [entry()] });
    });

    expect(
      screen.getByRole("button", { name: "Remove bookmark" }),
    ).toBeInTheDocument();
  });

  it("removes the bookmark on click", () => {
    useStarredStore.setState({ entries: [entry()] });

    render(<RemoveBookmarkButton path="docs/a.md" repo={null} />);
    fireEvent.click(screen.getByRole("button"));

    expect(mockedAxios.delete).toHaveBeenCalledWith("/api/starred", {
      params: { repo: "", path: "docs/a.md" },
    });
  });

  it("matches the failing document's own repo", () => {
    useStarredStore.setState({ entries: [entry({ repo: "alpha" })] });

    const { container } = render(
      <RemoveBookmarkButton path="docs/a.md" repo="beta" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is absent with no path", () => {
    useStarredStore.setState({ entries: [entry()] });

    const { container } = render(
      <RemoveBookmarkButton path={null} repo={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is absent in a static export, where nothing can be removed", () => {
    window.__VANTAGE_STATIC__ = true;
    useStarredStore.setState({ entries: [entry()] });

    const { container } = render(
      <RemoveBookmarkButton path="docs/a.md" repo={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
