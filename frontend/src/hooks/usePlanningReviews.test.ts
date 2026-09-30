/**
 * The planning page's review comments (`docs/design/planning-index.md` §6.3,
 * `docs/design/planning-index-at-scale.md` §6.3 and §10.5): many documents
 * in one `POST …/planning/reviews`, kept for the tab, and one document read
 * again with `GET /review` when a `review_changed` push for it bumps the
 * planning store's epoch.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import {
  fetchPlanningReviews,
  planningReviewsOf,
  resetPlanningReviews,
  usePlanningReviews,
} from "./usePlanningReviews";
import { usePlanningStore } from "../stores/usePlanningStore";
import type { ReviewComment, ReviewData } from "../types";

vi.mock("axios");
const mockedGet = vi.mocked(axios.get);
const mockedPost = vi.mocked(axios.post);

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

/** The reviews the server holds, by path; a path absent here has none. */
let stored: Record<string, ReviewData>;

/** Answer each request from `stored`, as the server would. */
function serve(): void {
  mockedPost.mockImplementation(async (url, body) => {
    if (!String(url).endsWith("/planning/reviews")) {
      throw new Error(`unexpected POST ${url}`);
    }
    const { paths } = body as { paths: string[] };
    return {
      data: {
        reviews: paths.flatMap((path) =>
          stored[path] ? [{ path, review: stored[path] }] : [],
        ),
      },
    };
  });
  mockedGet.mockImplementation(async (_url, config) => {
    const path = (config?.params as { path: string }).path;
    return { data: stored[path] ?? null };
  });
}

/** The paths of each reviews request, in order. */
const posted = () =>
  mockedPost.mock.calls.map(([, body]) => (body as { paths: string[] }).paths);

const getsFor = (path: string) =>
  mockedGet.mock.calls.filter(
    ([, config]) => (config?.params as { path: string }).path === path,
  );

const ids = (comments: readonly ReviewComment[] | undefined) =>
  comments?.map((c) => c.id);

beforeEach(() => {
  usePlanningStore.setState({ reviewEpoch: {} });
  resetPlanningReviews();
  mockedGet.mockReset();
  mockedPost.mockReset();
  stored = {};
  serve();
});

afterEach(() => {
  delete window.__VANTAGE_STATIC__;
});

describe("usePlanningReviews", () => {
  it("reads every listed document in one request, and a document with no review as none", async () => {
    stored = { "a.md": review("a.md", comment("c1")) };
    const { result, rerender } = renderHook(
      ({ paths }) => usePlanningReviews("", paths),
      { initialProps: { paths: ["a.md", "b.md", "a.md"] } },
    );
    expect(result.current.known).toBe(false);
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(ids(result.current.byPath["a.md"])).toEqual(["c1"]);
    expect(result.current.byPath["b.md"]).toEqual([]);
    expect(posted()).toEqual([["a.md", "b.md"]]);
    expect(mockedPost).toHaveBeenCalledWith("/api/planning/reviews", {
      paths: ["a.md", "b.md"],
    });
    // A new array holding the same paths asks for nothing more.
    rerender({ paths: ["b.md", "a.md"] });
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("reads a document again when its review changed, with one GET, and only it", async () => {
    stored = { "a.md": review("a.md"), "b.md": review("b.md") };
    const { result } = renderHook(() =>
      usePlanningReviews("", ["a.md", "b.md"]),
    );
    await waitFor(() => expect(result.current.known).toBe(true));

    stored["b.md"] = review("b.md", comment("new"));
    act(() => usePlanningStore.getState().noteReviewChanged("", "b.md"));
    await waitFor(() =>
      expect(ids(result.current.byPath["b.md"])).toEqual(["new"]),
    );
    expect(getsFor("a.md")).toHaveLength(0);
    expect(getsFor("b.md")).toHaveLength(1);
    expect(mockedPost).toHaveBeenCalledTimes(1);

    // Another repository's push for the same path is not this one's.
    act(() => usePlanningStore.getState().noteReviewChanged("beta", "b.md"));
    expect(getsFor("b.md")).toHaveLength(1);
  });

  it("reads under the repository in daemon mode", async () => {
    renderHook(() => usePlanningReviews("alpha", ["a.md"]));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/r/alpha/planning/reviews", {
        paths: ["a.md"],
      }),
    );
  });

  it("asks for nothing until the repository is known, or in a static export", () => {
    renderHook(() => usePlanningReviews(null, ["a.md"]));
    window.__VANTAGE_STATIC__ = true;
    renderHook(() => usePlanningReviews("", ["a.md"]));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("adopts a filed comment's echo at once, and discards an older answer still in flight", async () => {
    let release!: () => void;
    mockedPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              data: { reviews: [{ path: "a.md", review: review("a.md") }] },
            });
        }),
    );
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    expect(mockedPost).toHaveBeenCalledTimes(1);

    act(() => result.current.adopt("a.md", review("a.md", comment("filed"))));
    expect(ids(result.current.byPath["a.md"])).toEqual(["filed"]);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(ids(result.current.byPath["a.md"])).toEqual(["filed"]);
  });

  it("keeps what it showed when a GET fails, and asks again on the next push", async () => {
    stored = { "a.md": review("a.md", comment("c1")) };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.byPath["a.md"]).toHaveLength(1));

    mockedGet.mockRejectedValueOnce(new Error("down"));
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(getsFor("a.md")).toHaveLength(1));
    expect(result.current.byPath["a.md"]).toHaveLength(1);

    stored["a.md"] = review("a.md", comment("c1"), comment("c2"));
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(result.current.byPath["a.md"]).toHaveLength(2));
  });

  it("leaves the counts unknown when the request fails, says it failed, and a push asks again", async () => {
    mockedPost.mockRejectedValueOnce(new Error("down"));
    stored = { "a.md": review("a.md", comment("c1")) };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    expect(result.current.failed).toBe(false);
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.known).toBe(false);

    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.failed).toBe(false);
    expect(posted()).toEqual([["a.md"], ["a.md"]]);
    expect(ids(result.current.byPath["a.md"])).toEqual(["c1"]);
  });

  it("reads again a document whose push landed while it was being read", async () => {
    let release!: () => void;
    mockedPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              data: { reviews: [{ path: "a.md", review: review("a.md") }] },
            });
        }),
    );
    stored = { "a.md": review("a.md", comment("after")) };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    expect(getsFor("a.md")).toHaveLength(0);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(ids(result.current.byPath["a.md"])).toEqual(["after"]),
    );
    expect(getsFor("a.md")).toHaveLength(1);
  });

  it("with readRest off, reads nothing it does not hold, and still follows pushes", async () => {
    stored = { "a.md": review("a.md"), "b.md": review("b.md") };
    await fetchPlanningReviews("", ["a.md"]);
    mockedPost.mockClear();
    const { result } = renderHook(() =>
      usePlanningReviews("", ["a.md", "b.md"], { readRest: false }),
    );
    expect(result.current.byPath["a.md"]).toEqual([]);
    expect(result.current.known).toBe(false);
    stored["a.md"] = review("a.md", comment("new"));
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() =>
      expect(ids(result.current.byPath["a.md"])).toEqual(["new"]),
    );
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("reads again, in one request, what an earlier visit read", async () => {
    stored = { "a.md": review("a.md"), "b.md": review("b.md") };
    await fetchPlanningReviews("", ["a.md", "b.md"]);
    stored["a.md"] = review("a.md", comment("missed"));
    mockedPost.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 2));
    // This visit began after the earlier one's answer.
    const since = performance.now();
    const { result } = renderHook(() =>
      usePlanningReviews("", ["a.md", "b.md"], { since }),
    );
    // The earlier visit's answers are shown at once.
    expect(result.current.known).toBe(true);
    await waitFor(() =>
      expect(ids(result.current.byPath["a.md"])).toEqual(["missed"]),
    );
    expect(posted()).toEqual([["a.md", "b.md"]]);
  });
});

describe("fetchPlanningReviews", () => {
  it("waits for a document already being read rather than asking twice", async () => {
    stored = { "a.md": review("a.md", comment("c1")) };
    const first = fetchPlanningReviews("", ["a.md", "b.md"]);
    const second = fetchPlanningReviews("", ["b.md", "a.md"]);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(ids(planningReviewsOf("")["a.md"])).toEqual(["c1"]);
    // And a document held already is not asked for.
    await fetchPlanningReviews("", ["a.md"]);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it("answers false, and holds nothing, for an answer that is not the reviews shape", async () => {
    mockedPost.mockResolvedValueOnce({ data: "<!doctype html>" });
    await expect(fetchPlanningReviews("", ["a.md"])).resolves.toBe(false);
    expect(planningReviewsOf("")["a.md"]).toBeUndefined();
    mockedPost.mockResolvedValueOnce({
      data: { reviews: [{ path: "a.md", review: { comments: "no" } }] },
    });
    await expect(fetchPlanningReviews("", ["a.md"])).resolves.toBe(false);
  });

  it("keeps repositories apart", async () => {
    stored = { "a.md": review("a.md", comment("c1")) };
    await fetchPlanningReviews("alpha", ["a.md"]);
    expect(planningReviewsOf("alpha")["a.md"]).toHaveLength(1);
    expect(planningReviewsOf("beta")["a.md"]).toBeUndefined();
  });
});
