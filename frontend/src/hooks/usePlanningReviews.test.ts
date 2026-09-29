/**
 * The planning page's review comments (`docs/design/planning-index.md` §6.3):
 * one `GET /review?path=` per listed document, fetched again when a
 * `review_changed` push for that document bumps the planning store's epoch.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { usePlanningReviews } from "./usePlanningReviews";
import { usePlanningStore } from "../stores/usePlanningStore";
import type { ReviewComment, ReviewData } from "../types";

vi.mock("axios");
const mockedGet = vi.mocked(axios.get);

const comment = (id: string, text = id): ReviewComment => ({
  id,
  comment: text,
  created_at: 0,
  reactions: [],
});

const review = (path: string, ...comments: ReviewComment[]): ReviewData => ({
  file_path: path,
  comments,
});

/** Answer each GET with the review `answers` holds for its path. */
function serve(answers: Record<string, ReviewData | null>): void {
  mockedGet.mockImplementation(async (_url, config) => {
    const path = (config?.params as { path: string }).path;
    return { data: answers[path] ?? null };
  });
}

const getsFor = (path: string) =>
  mockedGet.mock.calls.filter(
    ([, config]) => (config?.params as { path: string }).path === path,
  );

beforeEach(() => {
  usePlanningStore.setState({ reviewEpoch: {} });
  mockedGet.mockReset();
});

afterEach(() => {
  delete window.__VANTAGE_STATIC__;
});

describe("usePlanningReviews", () => {
  it("asks for each listed document's review once", async () => {
    serve({
      "a.md": review("a.md", comment("c1")),
      "b.md": null,
    });
    const { result, rerender } = renderHook(
      ({ paths }) => usePlanningReviews("", paths),
      { initialProps: { paths: ["a.md", "b.md", "a.md"] } },
    );
    await waitFor(() =>
      expect(result.current.byPath["a.md"]?.map((c) => c.id)).toEqual(["c1"]),
    );
    expect(result.current.byPath["b.md"]).toEqual([]);
    expect(mockedGet).toHaveBeenCalledWith("/api/review", {
      params: { path: "a.md" },
    });
    // A new array holding the same paths asks for nothing more.
    rerender({ paths: ["b.md", "a.md"] });
    expect(getsFor("a.md")).toHaveLength(1);
    expect(getsFor("b.md")).toHaveLength(1);
  });

  it("asks again for a document whose review changed, and only for it", async () => {
    serve({ "a.md": review("a.md"), "b.md": review("b.md") });
    const { result } = renderHook(() =>
      usePlanningReviews("", ["a.md", "b.md"]),
    );
    await waitFor(() => expect(result.current.byPath["b.md"]).toBeDefined());

    serve({ "a.md": review("a.md"), "b.md": review("b.md", comment("new")) });
    act(() => usePlanningStore.getState().noteReviewChanged("", "b.md"));
    await waitFor(() =>
      expect(result.current.byPath["b.md"]?.map((c) => c.id)).toEqual(["new"]),
    );
    expect(getsFor("a.md")).toHaveLength(1);
    expect(getsFor("b.md")).toHaveLength(2);

    // Another repository's push for the same path is not this one's.
    act(() => usePlanningStore.getState().noteReviewChanged("beta", "b.md"));
    expect(getsFor("b.md")).toHaveLength(2);
  });

  it("asks under the repository in daemon mode", async () => {
    serve({ "a.md": review("a.md") });
    renderHook(() => usePlanningReviews("alpha", ["a.md"]));
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/api/r/alpha/review", {
        params: { path: "a.md" },
      }),
    );
  });

  it("asks for nothing until the repository is known, or in a static export", () => {
    renderHook(() => usePlanningReviews(null, ["a.md"]));
    window.__VANTAGE_STATIC__ = true;
    renderHook(() => usePlanningReviews("", ["a.md"]));
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("adopts a filed comment's echo at once, and discards an older answer still in flight", async () => {
    let release!: (value: { data: ReviewData }) => void;
    mockedGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve as typeof release;
        }),
    );
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    expect(mockedGet).toHaveBeenCalledTimes(1);

    act(() => result.current.adopt("a.md", review("a.md", comment("filed"))));
    expect(result.current.byPath["a.md"]?.map((c) => c.id)).toEqual(["filed"]);

    await act(async () => {
      release({ data: review("a.md") });
      await Promise.resolve();
    });
    expect(result.current.byPath["a.md"]?.map((c) => c.id)).toEqual(["filed"]);
  });

  it("keeps what it showed when a request fails, and asks again on the next push", async () => {
    serve({ "a.md": review("a.md", comment("c1")) });
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.byPath["a.md"]).toHaveLength(1));

    mockedGet.mockRejectedValueOnce(new Error("down"));
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(getsFor("a.md")).toHaveLength(2));
    expect(result.current.byPath["a.md"]).toHaveLength(1);

    serve({ "a.md": review("a.md", comment("c1"), comment("c2")) });
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(result.current.byPath["a.md"]).toHaveLength(2));
  });
});
