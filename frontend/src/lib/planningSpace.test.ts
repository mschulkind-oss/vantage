/**
 * The page's side of the space id (`docs/reference/planning-index.md` §13.6):
 * reading `space=` from a planning URL, and asking the server which project
 * holds it, once per id for the tab's session.
 */
import { act, renderHook } from "@testing-library/react";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import { useRepoStore } from "../stores/useRepoStore";
import {
  askPlanningSpace,
  projectlessSpace,
  readSpaceRequest,
  resetPlanningSpacesForTests,
  usePlanningSpace,
  usePlanningSpaceHold,
  withoutSpace,
} from "./planningSpace";

vi.mock("axios");

const ID = "q4zmuykxw2a7hbne";

const gets = () => vi.mocked(axios.get).mock.calls.map(([url]) => url);

beforeEach(() => {
  resetPlanningSpacesForTests();
  vi.mocked(axios.get).mockReset();
});

afterEach(() => {
  setPlanningLimitsForTests(null);
  delete window.__VANTAGE_STATIC__;
  useRepoStore.setState({ repos: [], reposLoaded: false, isMultiRepo: false });
});

/** The server's projects, as a `repos_changed` push leaves the store. */
const served = (...names: string[]) =>
  act(() =>
    useRepoStore.setState({
      reposLoaded: true,
      isMultiRepo: true,
      repos: names.map((name) => ({ name, last_activity: null })),
    }),
  );

describe("reading a planning URL's space", () => {
  it("reads the first space= as written, and none for an empty one", () => {
    expect(readSpaceRequest(new URLSearchParams(`filter=x&space=${ID}`))).toBe(
      ID,
    );
    expect(readSpaceRequest(new URLSearchParams("space=a&space=b"))).toBe("a");
    expect(readSpaceRequest(new URLSearchParams("space="))).toBeNull();
    expect(readSpaceRequest(new URLSearchParams("filter=x"))).toBeNull();
  });

  it("drops every space= and keeps the rest in order", () => {
    expect(
      withoutSpace(
        new URLSearchParams(`filter=a+b&space=${ID}&roadmap=r.md&space=x`),
      ).toString(),
    ).toBe("filter=a+b&roadmap=r.md");
  });

  it("finds a project only for the planning route with no project segment and a space id", () => {
    const query = `?filter=is:open&space=${ID}`;
    expect(projectlessSpace("/.vantage/planning", query)).toBe(ID);
    expect(projectlessSpace("/.vantage/planning/", query)).toBe(ID);
    expect(projectlessSpace("/.vantage/planning/alpha", query)).toBeNull();
    expect(projectlessSpace("/.vantage/planningx", query)).toBeNull();
    expect(projectlessSpace("/docs/x.md", query)).toBeNull();
    expect(
      projectlessSpace("/.vantage/planning", "?space=Q4ZMUYKXW2A7HBNE"),
    ).toBeNull();
    expect(projectlessSpace("/.vantage/planning", "?filter=x")).toBeNull();
  });

  it("finds none in a static export, which has no server to ask", () => {
    window.__VANTAGE_STATIC__ = true;
    expect(projectlessSpace("/.vantage/planning", `?space=${ID}`)).toBeNull();
  });
});

describe("asking the server", () => {
  it("sends one request per id, shared while it is out and kept once answered", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { repo: "beta" } });
    const [a, b] = await Promise.all([
      askPlanningSpace(ID),
      askPlanningSpace(ID),
    ]);
    expect(a).toEqual({ kind: "found", repo: "beta" });
    expect(b).toBe(a);
    expect(await askPlanningSpace(ID)).toBe(a);
    expect(gets()).toEqual([`/api/spaces/${ID}`]);
  });

  it("reads the three answers: a project's name, single-project mode's, and none", async () => {
    vi.mocked(axios.get).mockImplementation(async (url) => ({
      data: {
        repo: String(url).endsWith("aaaaaaaaaaaaaaaa")
          ? "beta"
          : String(url).endsWith("bbbbbbbbbbbbbbbb")
            ? ""
            : null,
      },
    }));
    expect(await askPlanningSpace("aaaaaaaaaaaaaaaa")).toEqual({
      kind: "found",
      repo: "beta",
    });
    expect(await askPlanningSpace("bbbbbbbbbbbbbbbb")).toEqual({
      kind: "found",
      repo: "",
    });
    expect(await askPlanningSpace("cccccccccccccccc")).toEqual({
      kind: "none",
    });
  });

  // A checkout copied whole keeps the original's id, so two projects hold
  // it: the answer names both, and opens neither.
  it("reads several projects holding one id, and none for a list it cannot read", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { repo: null, repos: ["alpha", "alpha-copy"] },
    });
    expect(await askPlanningSpace("aaaaaaaaaaaaaaaa")).toEqual({
      kind: "several",
      repos: ["alpha", "alpha-copy"],
    });
    for (const repos of [["alpha"], [], ["alpha", 7], "alpha"]) {
      resetPlanningSpacesForTests();
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { repo: null, repos },
      });
      expect(await askPlanningSpace("aaaaaaaaaaaaaaaa")).toEqual({
        kind: "none",
      });
    }
  });

  it("keeps no answer for a request that failed or a body it cannot read, so the next visit asks again", async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error("offline"));
    expect(await askPlanningSpace(ID)).toEqual({ kind: "failed" });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: "<!doctype html>" });
    expect(await askPlanningSpace(ID)).toEqual({ kind: "failed" });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { repo: 7 } });
    expect(await askPlanningSpace(ID)).toEqual({ kind: "failed" });
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { repo: null } });
    expect(await askPlanningSpace(ID)).toEqual({ kind: "none" });
    expect(gets()).toHaveLength(4);
  });

  it("never sends what is not a space id, which the server refuses", async () => {
    expect(await askPlanningSpace("../../etc/passwd")).toEqual({
      kind: "failed",
    });
    expect(await askPlanningSpace("Q4ZMUYKXW2A7HBNE")).toEqual({
      kind: "failed",
    });
    expect(gets()).toEqual([]);
  });

  it("gives a kept answer in the hook's first render, with no wait", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { repo: "beta" } });
    await askPlanningSpace(ID);
    const { result } = renderHook(() => usePlanningSpace(ID));
    expect(result.current).toEqual({ kind: "found", repo: "beta" });
    expect(gets()).toHaveLength(1);
  });

  it("is null while the answer is on its way, and for no id", async () => {
    let answer!: (value: unknown) => void;
    vi.mocked(axios.get).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }) as never,
    );
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => usePlanningSpace(id),
      { initialProps: { id: ID as string | null } },
    );
    expect(result.current).toBeNull();
    await act(async () => answer({ data: { repo: null } }));
    expect(result.current).toEqual({ kind: "none" });
    rerender({ id: null });
    expect(result.current).toBeNull();
  });
});

// A link opened before the daemon has found its checkout is answered none,
// and the daemon finds it seconds later: the answer must follow, without a
// reload, and a found one must not be asked for again.
describe("an answer that no project holds the id", () => {
  it("is asked again when the server's projects change, painted as it was until the new answer", async () => {
    await served("alpha");
    vi.mocked(axios.get)
      .mockResolvedValueOnce({ data: { repo: null } })
      .mockResolvedValueOnce({ data: { repo: null } })
      .mockResolvedValueOnce({ data: { repo: "epsilon" } });
    const { result } = renderHook(() => usePlanningSpace(ID));
    await act(async () => {});
    expect(result.current).toEqual({ kind: "none" });
    expect(gets()).toHaveLength(1);

    // Another push, for a project that does not hold it: asked, still none.
    await served("alpha", "gamma");
    await act(async () => {});
    expect(result.current).toEqual({ kind: "none" });
    expect(gets()).toHaveLength(2);

    let answer!: (value: unknown) => void;
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.get).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }) as never,
    );
    await served("alpha", "gamma", "epsilon");
    // While it is asked, the kept answer stays on screen: nothing flashes.
    expect(result.current).toEqual({ kind: "none" });
    await act(async () => answer({ data: { repo: "epsilon" } }));
    expect(result.current).toEqual({ kind: "found", repo: "epsilon" });

    // Found is kept for the session: a later push asks nothing.
    await served("alpha", "gamma", "epsilon", "zeta");
    await act(async () => {});
    expect(gets()).toHaveLength(1);
  });

  it("is asked again by a page opened after the projects changed, which paints it meanwhile", async () => {
    await served("alpha");
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { repo: null } });
    expect(await askPlanningSpace(ID)).toEqual({ kind: "none" });
    // The reader is on another page as the daemon finds the checkout.
    await served("alpha", "epsilon");
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { repo: "epsilon" } });
    const { result } = renderHook(() => usePlanningSpace(ID));
    expect(result.current).toEqual({ kind: "none" });
    await act(async () => {});
    expect(result.current).toEqual({ kind: "found", repo: "epsilon" });
    expect(gets()).toHaveLength(2);
  });

  it("is not asked again while the projects stay as they were", async () => {
    await served("alpha");
    vi.mocked(axios.get).mockResolvedValue({ data: { repo: null } });
    expect(await askPlanningSpace(ID)).toEqual({ kind: "none" });
    const { result, unmount } = renderHook(() => usePlanningSpace(ID));
    await act(async () => {});
    unmount();
    renderHook(() => usePlanningSpace(ID));
    await act(async () => {});
    expect(result.current).toEqual({ kind: "none" });
    expect(gets()).toHaveLength(1);
  });
});

describe("the hold for the answer (planning-index.md §12.3)", () => {
  it("holds until the answer is in", async () => {
    setPlanningLimitsForTests({ holdMs: 60_000 });
    let answer!: (value: unknown) => void;
    vi.mocked(axios.get).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }) as never,
    );
    const { result } = renderHook(() => usePlanningSpaceHold(ID));
    expect(result.current).toBe(true);
    await act(async () => answer({ data: { repo: "beta" } }));
    expect(result.current).toBe(false);
  });

  it("holds no longer than the deadline", async () => {
    vi.useFakeTimers();
    try {
      setPlanningLimitsForTests({ holdMs: 150 });
      vi.mocked(axios.get).mockReturnValue(new Promise(() => {}) as never);
      const { result } = renderHook(() => usePlanningSpaceHold(ID));
      expect(result.current).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(149);
      });
      expect(result.current).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds nothing for no id, nor for an answer already kept", async () => {
    expect(renderHook(() => usePlanningSpaceHold(null)).result.current).toBe(
      false,
    );
    vi.mocked(axios.get).mockResolvedValue({ data: { repo: null } });
    await askPlanningSpace(ID);
    expect(renderHook(() => usePlanningSpaceHold(ID)).result.current).toBe(
      false,
    );
  });
});
