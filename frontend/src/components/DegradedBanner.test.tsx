import { act, render, screen, fireEvent } from "@testing-library/react";
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

  // A polite live region inserted already filled is not reliably announced,
  // so the region is there, empty, from the first render, and the items are
  // rendered into it.
  it("keeps an empty live region mounted when nothing is degraded", () => {
    render(<DegradedBanner />);
    const region = screen.getByRole("status", {
      name: "Project too big to serve fully",
    });
    expect(region).toBeEmptyDOMElement();

    act(() => {
      useDegradedStore.setState({ items: [watchLimit] });
    });
    expect(
      screen.getByRole("status", { name: "Project too big to serve fully" }),
    ).toBe(region);
    expect(region).toHaveTextContent("Live reload is off below node_modules");
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
    expect(container.querySelector('[role="status"]')).toBeEmptyDOMElement();
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
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss the live reload warning" }),
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(useDegradedStore.getState().dismissed).toHaveLength(1);
  });

  // Two buttons both called "Dismiss" say nothing about which is which, in a
  // list of a page's buttons; each says what it dismisses, and is described
  // by the sentence beside it.
  it("names each dismiss button after what it dismisses", () => {
    useRepoStore.setState({ isMultiRepo: false, currentRepo: null });
    useDegradedStore.setState({
      items: [watchLimit, walkTimeout],
      load: async () => {},
    });
    render(<DegradedBanner />);
    const live = screen.getByRole("button", {
      name: "Dismiss the live reload warning",
    });
    const recents = screen.getByRole("button", {
      name: "Dismiss the recent files warning",
    });
    expect(live).toHaveAccessibleDescription(watchLimit.message);
    expect(recents).toHaveAccessibleDescription(walkTimeout.message);
  });

  // A dismissed item takes its button with it, which would drop focus to the
  // page's start. Focus goes to the next item's button, and after the last,
  // back to wherever it came into the banner from.
  it("keeps focus somewhere sensible when an item is dismissed", () => {
    useRepoStore.setState({ isMultiRepo: false, currentRepo: null });
    useDegradedStore.setState({
      items: [watchLimit, walkTimeout],
      load: async () => {},
    });
    render(
      <>
        <a href="#last-link">the document's last link</a>
        <DegradedBanner />
      </>,
    );
    const link = screen.getByText("the document's last link");
    link.focus();
    const first = screen.getByRole("button", {
      name: "Dismiss the live reload warning",
    });
    first.focus();
    fireEvent.click(first);
    const second = screen.getByRole("button", {
      name: "Dismiss the recent files warning",
    });
    expect(document.activeElement).toBe(second);
    fireEvent.click(second);
    expect(document.activeElement).toBe(link);
  });

  // Late data never moves painted content: the list arrives after the page
  // has painted, so the banner floats over the pane instead of pushing it
  // down, and says how much of the pane's bottom it covers, so the pane can
  // let its last line scroll clear of it.
  it("floats over the page, and says how much room it covers", () => {
    const spaces: number[] = [];
    const onSpaceChange = (px: number) => spaces.push(px);
    render(<DegradedBanner onSpaceChange={onSpaceChange} />);
    expect(screen.getByTestId("degraded-banner").className).toContain(
      "absolute",
    );
    expect(spaces.at(-1)).toBe(0);

    act(() => {
      useDegradedStore.setState({ items: [watchLimit] });
    });
    expect(spaces.at(-1)).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss the live reload warning" }),
    );
    expect(spaces.at(-1)).toBe(0);
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

  // Two fetches in flight — a push arriving while the page's own fetch is
  // out — must not let the older answer land last.
  it("keeps the newest answer when two fetches race", async () => {
    let answerFirst: (v: { data: Degradation[] }) => void = () => {};
    mockedAxios.get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ data: [] });
    const first = useDegradedStore.getState().load();
    await useDegradedStore.getState().load();
    answerFirst({ data: [watchLimit] });
    await first;
    expect(useDegradedStore.getState().items).toEqual([]);
  });

  it("keeps the list when the server has no such route", async () => {
    useDegradedStore.setState({ items: [watchLimit] });
    mockedAxios.get.mockRejectedValue(new Error("404"));
    await useDegradedStore.getState().load();
    expect(useDegradedStore.getState().items).toEqual([watchLimit]);
  });
});
