import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { StarredSection } from "./StarredSection";
import { useStarredStore } from "../stores/useStarredStore";
import { useRepoStore } from "../stores/useRepoStore";
import type { StarredEntry } from "../types";

const entry = (over: Partial<StarredEntry> = {}): StarredEntry => ({
  repo: "",
  path: "docs/a.md",
  is_dir: false,
  starred_at: "2026-09-20T12:00:00Z",
  source: "user" as const,
  ...over,
});

const renderSection = () =>
  render(
    <BrowserRouter>
      <StarredSection />
    </BrowserRouter>,
  );

describe("StarredSection", () => {
  beforeEach(() => {
    useStarredStore.setState({ entries: [], loaded: true });
    useRepoStore.setState({ currentPath: null, currentRepo: null });
  });

  afterEach(() => {
    delete window.__VANTAGE_STATIC__;
  });

  // The whole section goes away rather than showing an empty heading.
  it("renders nothing when there are no bookmarks", () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing in a static export", () => {
    window.__VANTAGE_STATIC__ = true;
    useStarredStore.setState({ entries: [entry()] });

    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a bookmark under a Starred heading", () => {
    useStarredStore.setState({ entries: [entry()] });

    renderSection();

    expect(screen.getByText("Starred")).toBeInTheDocument();
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("docs/")).toBeInTheDocument();
  });

  it("links to the path in single-repo mode", () => {
    useStarredStore.setState({ entries: [entry()] });

    renderSection();

    expect(screen.getByRole("link")).toHaveAttribute("href", "/docs/a.md");
  });

  // In daemon mode one list spans repos, so each row's link must come from its
  // own entry rather than from whichever repo happens to be open.
  it("links through the entry's own repo, not the selected one", () => {
    useRepoStore.setState({ currentRepo: "alpha", isMultiRepo: true });
    useStarredStore.setState({
      entries: [entry({ repo: "beta", path: "b.md" })],
    });

    renderSection();

    expect(screen.getByRole("link")).toHaveAttribute("href", "/beta/b.md");
    useRepoStore.setState({ currentRepo: null, isMultiRepo: false });
  });

  it("marks the open bookmark as current", () => {
    useRepoStore.setState({ currentPath: "docs/a.md", currentRepo: null });
    useStarredStore.setState({ entries: [entry(), entry({ path: "b.md" })] });

    renderSection();

    const [open, other] = screen.getAllByRole("link");
    expect(open.className).toContain("bg-blue-50");
    expect(other.className).not.toContain("bg-blue-50");
  });

  // A bookmark whose target was deleted still lists normally; the warning is
  // the viewer's job, on open.
  it("shows every bookmark without checking whether it still exists", () => {
    useStarredStore.setState({
      entries: [entry({ path: "gone.md" }), entry({ path: "here.md" })],
    });

    renderSection();

    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("uses a folder icon for a directory bookmark", () => {
    useStarredStore.setState({
      entries: [entry({ path: "docs", is_dir: true })],
    });

    const { container } = renderSection();

    expect(container.querySelector(".lucide-folder")).toBeTruthy();
    expect(container.querySelector(".lucide-file")).toBeFalsy();
  });

  it("uses a file icon otherwise", () => {
    useStarredStore.setState({ entries: [entry()] });

    const { container } = renderSection();

    expect(container.querySelector(".lucide-file")).toBeTruthy();
    expect(container.querySelector(".lucide-folder")).toBeFalsy();
  });

  // A promoted row is in the list and is not the reader's. It reads as an ordinary
  // row on purpose — the section is a list of documents to open — but it says
  // where it came from, because it is the one row they cannot remove.
  it("marks a row the reader did not star", () => {
    useStarredStore.setState({
      entries: [
        entry({ path: "roadmap.md", source: "repo" }),
        entry({ path: "docs/a.md", source: "user" }),
      ],
      loaded: true,
    });

    renderSection();

    const marks = screen.getAllByTestId("starred-promoted");
    expect(marks).toHaveLength(1);
    expect(
      screen.getByTitle(
        "roadmap.md — Promoted by this project's .vantage.toml",
      ),
    ).toBeTruthy();
    // The reader's own row is untouched.
    expect(screen.getByTitle("docs/a.md")).toBeTruthy();
  });

  it("names the reader's own config when that is what promoted it", () => {
    useStarredStore.setState({
      entries: [entry({ path: "roadmap.md", source: "user-config" })],
      loaded: true,
    });

    renderSection();

    expect(
      screen.getByTitle("roadmap.md — Promoted by your Vantage config"),
    ).toBeTruthy();
  });

  // Promoted rows must not be grouped separately: the sidebar reads by repository,
  // and a block of its own would put one project's documents in two places.
  it("leaves promoted rows in the server's order", () => {
    useStarredStore.setState({
      entries: [
        entry({ path: "a.md", source: "user" }),
        entry({ path: "b.md", source: "repo" }),
        entry({ path: "c.md", source: "user" }),
      ],
      loaded: true,
    });

    renderSection();

    const names = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("title")?.split(" — ")[0]);
    expect(names).toEqual(["a.md", "b.md", "c.md"]);
  });
});
