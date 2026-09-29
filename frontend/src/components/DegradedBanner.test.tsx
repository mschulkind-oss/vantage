import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import axios from "axios";
import { DegradedBanner } from "./DegradedBanner";
import { useDegradedStore } from "../stores/useDegradedStore";
import { useRepoStore } from "../stores/useRepoStore";
import type { Degradation } from "../types";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);
const realLoad = useDegradedStore.getState().load;

const watchLimit: Degradation = {
  repo: "big",
  kind: "watch_limit",
  path: "node_modules",
  count: 40,
  message: "Live reload is off below node_modules and 39 more folders.",
};
const walkTimeout: Degradation = {
  repo: "",
  kind: "walk_timeout",
  message: "Recent files may be missing untracked documents.",
};

describe("DegradedBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.get.mockResolvedValue({ data: [] });
    useDegradedStore.setState({ items: [], dismissed: [], load: realLoad });
    useRepoStore.setState({
      reposLoaded: true,
      isMultiRepo: true,
      currentRepo: "big",
    });
  });

  it("renders nothing when nothing is degraded", () => {
    const { container } = render(<DegradedBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("fetches the list when it mounts", () => {
    render(<DegradedBanner />);
    expect(mockedAxios.get).toHaveBeenCalledWith("/api/degraded");
  });

  it("says what is degraded in the open project", () => {
    useDegradedStore.setState({ items: [watchLimit], load: async () => {} });
    render(<DegradedBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Live reload is off below node_modules and 39 more folders.",
    );
  });

  // One project's limits say nothing about another's.
  it("shows only the open project's degradations in multi-repo mode", () => {
    useDegradedStore.setState({
      items: [watchLimit, { ...walkTimeout, repo: "other" }],
      load: async () => {},
    });
    render(<DegradedBanner />);
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Recent files may be missing",
    );

    useRepoStore.setState({ currentRepo: null });
    const { container } = render(<DegradedBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every degradation in single-repo mode", () => {
    useRepoStore.setState({ isMultiRepo: false, currentRepo: null });
    useDegradedStore.setState({ items: [walkTimeout], load: async () => {} });
    render(<DegradedBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Recent files may be missing untracked documents.",
    );
  });

  it("can be dismissed", () => {
    useDegradedStore.setState({ items: [watchLimit], load: async () => {} });
    render(<DegradedBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(useDegradedStore.getState().dismissed).toHaveLength(1);
  });

  // Late data never moves painted content: the list arrives after the page
  // has painted, so the banner floats over it instead of pushing it down.
  it("is fixed to the viewport rather than placed in the page's flow", () => {
    useDegradedStore.setState({ items: [watchLimit], load: async () => {} });
    render(<DegradedBanner />);
    expect(screen.getByTestId("degraded-banner").className).toContain("fixed");
  });
});

describe("useDegradedStore.load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDegradedStore.setState({ items: [], dismissed: [], load: realLoad });
  });

  it("stores what the server reports", async () => {
    mockedAxios.get.mockResolvedValue({ data: [watchLimit] });
    await useDegradedStore.getState().load();
    expect(useDegradedStore.getState().items).toEqual([watchLimit]);
  });

  it("keeps the list when the server has no such route", async () => {
    useDegradedStore.setState({ items: [watchLimit] });
    mockedAxios.get.mockRejectedValue(new Error("404"));
    await useDegradedStore.getState().load();
    expect(useDegradedStore.getState().items).toEqual([watchLimit]);
  });
});
