/**
 * The planning page's review comments (`docs/reference/planning-index.md` §6.6,
 * §6.7 and §9.3): many documents
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
  reloadPlanningReviews,
  resetPlanningReviews,
  useReloadStatus,
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

/** The reading the server attaches to each answer; tests move it. */
let reading: { boot_id: string; generation: number; revision: number };
const evidence = (path: string) => ({
  boot_id: reading.boot_id,
  document_generation: reading.generation,
  content_hash: `hash-of-${path}`,
  mutation_revision: reading.revision,
  sample_changed: false,
});

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
          stored[path]
            ? [{ path, review: stored[path], evidence: evidence(path) }]
            : [],
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

/** The requests, after the first, that asked for `path` alone: a push's re-read. */
const rereadsOf = (path: string) =>
  mockedPost.mock.calls.slice(1).filter(([, body]) => {
    const { paths } = body as { paths: string[] };
    return paths.length === 1 && paths[0] === path;
  });

const ids = (comments: readonly ReviewComment[] | undefined) =>
  comments?.map((c) => c.id);

beforeEach(() => {
  usePlanningStore.setState({ reviewEpoch: {} });
  resetPlanningReviews();
  mockedGet.mockReset();
  mockedPost.mockReset();
  stored = {};
  reading = { boot_id: "boot-1", generation: 1, revision: 1 };
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

  it("reads a document again when its review changed, with one single-path request, and only it", async () => {
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
    expect(rereadsOf("a.md")).toHaveLength(0);
    expect(rereadsOf("b.md")).toHaveLength(1);
    expect(mockedPost).toHaveBeenCalledTimes(2);

    // Another repository's push for the same path is not this one's.
    act(() => usePlanningStore.getState().noteReviewChanged("beta", "b.md"));
    expect(rereadsOf("b.md")).toHaveLength(1);
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
    mockedPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              data: { reviews: [{ path: "a.md", review: review("a.md") }] },
            });
        }),
    );
    // What the server holds once the comment is filed, for the read that
    // follows an echo carrying no reading of the document.
    stored = { "a.md": review("a.md", comment("filed")) };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    expect(mockedPost).toHaveBeenCalledTimes(1);

    act(() => result.current.adopt("a.md", review("a.md", comment("filed"))));
    expect(ids(result.current.byPath["a.md"])).toEqual(["filed"]);

    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(ids(result.current.byPath["a.md"])).toEqual(["filed"]);
    // The echo had no reading to keep, so one was asked for.
    await waitFor(() =>
      expect(result.current.evidence["a.md"]?.boot_id).toBe("boot-1"),
    );
  });

  it("keeps what it showed when a re-read fails, and asks again on the next push", async () => {
    stored = { "a.md": review("a.md", comment("c1")) };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.byPath["a.md"]).toHaveLength(1));

    mockedPost.mockRejectedValueOnce(new Error("down"));
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(rereadsOf("a.md")).toHaveLength(1));
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
    expect(rereadsOf("a.md")).toHaveLength(0);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(ids(result.current.byPath["a.md"])).toEqual(["after"]),
    );
    expect(rereadsOf("a.md")).toHaveLength(1);
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
    // Only the push's own single-path re-read; the unheld b.md is not asked.
    expect(posted()).toEqual([["a.md"]]);
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

  it("holds the reading each answer came with, and never rolls a path back to an older one of the same boot", async () => {
    stored = { "a.md": review("a.md", comment("new")) };
    reading = { boot_id: "boot-1", generation: 2, revision: 5 };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.evidence["a.md"]).toMatchObject({
      boot_id: "boot-1",
      document_generation: 2,
      mutation_revision: 5,
      content_hash: "hash-of-a.md",
      sample_changed: false,
    });

    // An answer that arrives later but was read earlier changes nothing.
    stored["a.md"] = review("a.md", comment("old"));
    reading = { boot_id: "boot-1", generation: 2, revision: 4 };
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(rereadsOf("a.md")).toHaveLength(1));
    await act(async () => {});
    expect(ids(result.current.byPath["a.md"])).toEqual(["new"]);
    expect(result.current.evidence["a.md"]?.mutation_revision).toBe(5);

    // Another boot's numbers are never compared: the new boot's answer stands.
    reading = { boot_id: "boot-2", generation: 1, revision: 1 };
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() =>
      expect(ids(result.current.byPath["a.md"])).toEqual(["old"]),
    );
    expect(result.current.evidence["a.md"]?.boot_id).toBe("boot-2");
  });

  it("never lets an answer that carries no reading replace a held one", async () => {
    stored = { "a.md": review("a.md", comment("new")) };
    reading = { boot_id: "boot-1", generation: 2, revision: 5 };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.known).toBe(true));

    // A re-read whose answer names no evidence (an older server).
    mockedPost.mockImplementationOnce(async () => ({
      data: {
        reviews: [{ path: "a.md", review: review("a.md", comment("blind")) }],
      },
    }));
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(rereadsOf("a.md")).toHaveLength(1));
    await act(async () => {});
    expect(ids(result.current.byPath["a.md"])).toEqual(["new"]);
    expect(result.current.evidence["a.md"]?.mutation_revision).toBe(5);
  });

  it("clears the comments of a review the server no longer has, through a push re-read and through Reload", async () => {
    stored = {
      "a.md": review("a.md", comment("c1")),
      "b.md": review("b.md", comment("c2")),
    };
    reading = { boot_id: "boot-1", generation: 2, revision: 5 };
    const { result } = renderHook(() =>
      usePlanningReviews("", ["a.md", "b.md"]),
    );
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(ids(result.current.byPath["a.md"])).toEqual(["c1"]);

    // DELETE /review for a.md: a good answer now leaves the path out.
    delete stored["a.md"];
    act(() => usePlanningStore.getState().noteReviewChanged("", "a.md"));
    await waitFor(() => expect(rereadsOf("a.md")).toHaveLength(1));
    await waitFor(() => expect(ids(result.current.byPath["a.md"])).toEqual([]));
    expect(result.current.evidence["a.md"]).toBeUndefined();

    delete stored["b.md"];
    await act(async () => {
      await reloadPlanningReviews("", ["a.md", "b.md"]);
    });
    expect(ids(result.current.byPath["b.md"])).toEqual([]);
  });

  it("carries the reading through a forced re-read (the reload path), refusing an older generation and taking a new boot", async () => {
    stored = { "a.md": review("a.md", comment("held")) };
    reading = { boot_id: "boot-1", generation: 3, revision: 1 };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.known).toBe(true));

    // An older generation of the same boot, read later, is not adopted.
    stored["a.md"] = review("a.md", comment("older"));
    reading = { boot_id: "boot-1", generation: 2, revision: 9 };
    await act(async () => {
      await fetchPlanningReviews("", ["a.md"], performance.now());
    });
    expect(ids(result.current.byPath["a.md"])).toEqual(["held"]);
    expect(result.current.evidence["a.md"]?.document_generation).toBe(3);

    // A newer generation is, with its reading.
    stored["a.md"] = review("a.md", comment("newer"));
    reading = { boot_id: "boot-1", generation: 4, revision: 1 };
    await act(async () => {
      await fetchPlanningReviews("", ["a.md"], performance.now());
    });
    expect(ids(result.current.byPath["a.md"])).toEqual(["newer"]);
    expect(result.current.evidence["a.md"]?.document_generation).toBe(4);

    // A new boot discards the held reading whatever its numbers.
    stored["a.md"] = review("a.md", comment("rebooted"));
    reading = { boot_id: "boot-2", generation: 1, revision: 1 };
    await act(async () => {
      await fetchPlanningReviews("", ["a.md"], performance.now());
    });
    expect(ids(result.current.byPath["a.md"])).toEqual(["rebooted"]);
    expect(result.current.evidence["a.md"]?.boot_id).toBe("boot-2");
  });

  it("keeps the held reading through an own-write echo, taking only the revision, and asks for one when none is held", async () => {
    stored = { "a.md": review("a.md", comment("one")) };
    reading = { boot_id: "boot-1", generation: 2, revision: 3 };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.known).toBe(true));
    act(() =>
      result.current.adopt("a.md", {
        ...review("a.md", comment("one"), comment("two")),
        mutation_revision: 4,
      }),
    );
    expect(result.current.evidence["a.md"]).toMatchObject({
      boot_id: "boot-1",
      document_generation: 2,
      content_hash: "hash-of-a.md",
      mutation_revision: 4,
    });
  });
});

describe("reloadPlanningReviews (Reload from server)", () => {
  const rescan = vi.fn();
  beforeEach(() => {
    rescan.mockReset();
    usePlanningStore.setState({ rescan });
  });

  it("reads every listed path in one request, even if held, and rescans the scan", async () => {
    stored = { "a.md": review("a.md", comment("old")) };
    const { result } = renderHook(() =>
      usePlanningReviews("", ["a.md", "b.md"]),
    );
    await waitFor(() => expect(result.current.known).toBe(true));
    mockedPost.mockClear();
    stored["a.md"] = review("a.md", comment("new"));
    reading = { boot_id: "boot-1", generation: 2, revision: 2 };
    let outcome: string | undefined;
    await act(async () => {
      outcome = await reloadPlanningReviews("", ["a.md", "b.md"]);
    });
    expect(outcome).toBe("adopted");
    expect(posted()).toEqual([["a.md", "b.md"]]);
    expect(ids(result.current.byPath["a.md"])).toEqual(["new"]);
    expect(rescan).toHaveBeenCalledWith("", { bypassCache: false });
    expect(useReloadStatus.getState().byRepo[""]?.lastSuccessAt).not.toBeNull();
  });

  it("never adopts an older document generation", async () => {
    stored = { "a.md": review("a.md", comment("held")) };
    reading = { boot_id: "boot-1", generation: 5, revision: 1 };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.known).toBe(true));
    stored["a.md"] = review("a.md", comment("older"));
    reading = { boot_id: "boot-1", generation: 4, revision: 9 };
    await act(async () => {
      await reloadPlanningReviews("", ["a.md"]);
    });
    expect(ids(result.current.byPath["a.md"])).toEqual(["held"]);
  });

  it("discards everything held for the repository on a new boot id, and rescans without the cache", async () => {
    stored = {
      "a.md": review("a.md", comment("a")),
      "b.md": review("b.md", comment("b")),
    };
    const { result } = renderHook(() =>
      usePlanningReviews("", ["a.md", "b.md"]),
    );
    await waitFor(() => expect(result.current.known).toBe(true));
    stored = { "a.md": review("a.md", comment("a2")) };
    reading = { boot_id: "boot-2", generation: 1, revision: 1 };
    await act(async () => {
      await reloadPlanningReviews("", ["a.md"]);
    });
    expect(ids(result.current.byPath["a.md"])).toEqual(["a2"]);
    // The unlisted-in-the-answer path kept nothing of the old boot: it is
    // read again, from the new one.
    await waitFor(() => expect(result.current.byPath["b.md"]).toEqual([]));
    expect(result.current.evidence["b.md"]?.boot_id).not.toBe("boot-1");
    expect(rescan).toHaveBeenCalledWith("", { bypassCache: true });
  });

  it("records a changed sample as Unknown and does not ask again by itself", async () => {
    stored = { "a.md": review("a.md", comment("a")) };
    mockedPost.mockImplementation(async (_url, body) => ({
      data: {
        reviews: (body as { paths: string[] }).paths.map((path) => ({
          path,
          review: stored[path],
          evidence: { ...evidence(path), sample_changed: true },
        })),
      },
    }));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await reloadPlanningReviews("", ["a.md"]);
    });
    expect(outcome).toBe("unknown");
    expect(useReloadStatus.getState().byRepo[""]?.sampleChanged).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it("keeps what is held and records the last failure beside the last success", async () => {
    stored = { "a.md": review("a.md", comment("a")) };
    const { result } = renderHook(() => usePlanningReviews("", ["a.md"]));
    await waitFor(() => expect(result.current.known).toBe(true));
    await act(async () => {
      await reloadPlanningReviews("", ["a.md"]);
    });
    mockedPost.mockRejectedValue(new Error("down"));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await reloadPlanningReviews("", ["a.md"]);
    });
    expect(outcome).toBe("failed");
    const status = useReloadStatus.getState().byRepo[""];
    expect(status?.lastSuccessAt).not.toBeNull();
    expect(status?.lastFailureAt).not.toBeNull();
    expect(ids(result.current.byPath["a.md"])).toEqual(["a"]);
    expect(rescan).toHaveBeenCalledTimes(1);
  });
});
