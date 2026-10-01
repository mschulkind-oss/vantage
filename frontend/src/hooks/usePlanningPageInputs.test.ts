/**
 * The planning page's page inputs (`docs/reference/planning-index.md`
 * §6.5), below the page: what one set asks for, how the sets are cached and
 * kept, and what a prefetch does. The page's own suite covers what the reader
 * sees of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { buildPlanningIndex, type PlanningConfig } from "vantage-md/planning";
import {
  blockKey,
  loadPageInputs,
  prefetchPlanningPage,
  resetPlanningPageInputs,
  type PageInputs,
} from "./usePlanningPageInputs";
import { resetPlanningReviews } from "./usePlanningReviews";
import { layoutPlanningPage, sectionsOf } from "../lib/planningPages";
import {
  inlineScannerClient,
  setPlanningScannerForTests,
  type CardAnswer,
  type CardWant,
  type ScannerClient,
} from "../planningScan/client";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import { memoryScanStore } from "../planningScan/memoryStore";
import {
  resetPlanningTrackers,
  usePlanningStore,
  type PlanningLoad,
} from "../stores/usePlanningStore";
import { contentHash, sourcesOf } from "../test/planning";
import { fakePlanningServer } from "../test/planningStream";

vi.mock("axios");

const OPEN = "\u{1F4AC}";

const q = (id: string) =>
  [
    `1. ${OPEN} **${id}: Question ${id}?**`,
    "",
    `   <!-- vantage: oq id=${id} leaning="Yes." -->`,
    "",
    "   _Leaning:_ Yes.",
    "",
  ].join("\n");

const doc = (...body: string[]) =>
  ["---\nstage: DESIGN\n---", "", "# Doc", "", ...body].join("\n");

const TREE: Record<string, string> = {
  "roadmap.md": "# Roadmap\n\n- [A](plans/a.md)\n",
  "plans/a.md": doc(q("OQ-A1"), "## More", "", q("OQ-A2")),
  "plans/b.md": doc(q("OQ-B1")),
};
const CONFIG: Partial<PlanningConfig> = { stages: { DESIGN: "open" } };

let version = 0;
function readyOf(tree = TREE): Extract<PlanningLoad, { status: "ready" }> {
  const index = buildPlanningIndex(sourcesOf(tree, {}, CONFIG));
  return {
    status: "ready",
    index,
    version: ++version,
    rescanning: false,
    hashes: Object.fromEntries(
      index.documents.map((d) => [d.path, contentHash(tree[d.path] ?? "")]),
    ),
  };
}

/** The tree's scanner, recording each cards request, with any call replaced. */
function serve(
  replaced: (inline: ScannerClient) => Partial<ScannerClient> = () => ({}),
): CardWant[][] {
  const asked: CardWant[][] = [];
  const server = fakePlanningServer(TREE);
  const inline = inlineScannerClient({
    store: memoryScanStore(),
    scannerId: "test",
    fetch: server.fetch,
  });
  const client: ScannerClient = { ...inline, ...replaced(inline) };
  setPlanningScannerForTests({
    ...client,
    cards: (repo, want, options) => {
      asked.push(want);
      return client.cards(repo, want, options);
    },
  });
  return asked;
}

const layoutOf = (
  ready: Extract<PlanningLoad, { status: "ready" }>,
  request = {},
) => layoutPlanningPage(ready.index, sectionsOf(ready.index), request);

const inputsOf = async (
  ready: Extract<PlanningLoad, { status: "ready" }>,
  request = {},
): Promise<PageInputs> => {
  const inputs = await loadPageInputs("", ready, layoutOf(ready, request))
    .promise;
  if (inputs === null) throw new Error("superseded");
  return inputs;
};

beforeEach(() => {
  resetPlanningTrackers();
  resetPlanningReviews();
  resetPlanningPageInputs();
  usePlanningStore.setState({ byRepo: {}, reviewEpoch: {} });
  vi.mocked(axios.post).mockReset();
  vi.mocked(axios.post).mockResolvedValue({ data: { reviews: [] } });
});

afterEach(() => {
  setPlanningScannerForTests(null);
  setPlanningLimitsForTests(null);
  delete window.__VANTAGE_STATIC__;
});

describe("one set of inputs", () => {
  it("asks for each shown card's block once, by its content hash, and reads the shown documents' reviews", async () => {
    const asked = serve();
    const ready = readyOf();
    const inputs = await inputsOf(ready);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(
      expect.arrayContaining([
        {
          path: "plans/a.md",
          hash: ready.hashes["plans/a.md"],
          startLine: expect.any(Number),
        },
        {
          path: "plans/b.md",
          hash: ready.hashes["plans/b.md"],
          startLine: expect.any(Number),
        },
      ]),
    );
    expect(asked[0]).toHaveLength(3);
    const a1 = ready.index.documents
      .find((d) => d.path === "plans/a.md")!
      .questions.find((x) => x.id === "OQ-A1")!;
    expect(
      inputs.blocks.get(blockKey("plans/a.md", a1.block.startLine))?.markdown,
    ).toContain("OQ-A1");
    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      "/api/planning/reviews",
      { paths: ["plans/a.md", "plans/b.md"] },
    );
    expect(inputs.reviewsFailed).toBe(false);
  });

  it("asks for the shown pages only", async () => {
    setPlanningLimitsForTests({ pageEntries: 1 });
    const asked = serve();
    const ready = readyOf();
    await inputsOf(ready);
    // Needs you's first card, and Not on a roadmap's.
    expect(asked[0]?.map((w) => w.path)).toEqual(["plans/a.md", "plans/b.md"]);
    // Page 2 of Needs you, and Not on a roadmap's page again, whose block the first
    // set already holds.
    await inputsOf(ready, { "needs-you": "2" });
    expect(asked[1]?.map((w) => w.path)).toEqual(["plans/a.md"]);
    expect(asked[1]?.[0]?.startLine).not.toBe(asked[0]?.[0]?.startLine);
  });

  it("says the reviews failed when their request did", async () => {
    serve();
    vi.mocked(axios.post).mockRejectedValue(new Error("down"));
    expect((await inputsOf(readyOf())).reviewsFailed).toBe(true);
  });

  it("holds a card the scanner answers as a preview as one", async () => {
    serve((inline) => ({
      cards: async (repo, want, options) => {
        const answers = await inline.cards(repo, want, options);
        return answers.map((answer): CardAnswer =>
          answer.path === "plans/b.md"
            ? {
                path: answer.path,
                startLine: want[1]!.startLine,
                preview: true,
              }
            : answer,
        );
      },
    }));
    const inputs = await inputsOf(readyOf());
    expect(inputs.previews.size).toBe(1);
    expect([...inputs.previews][0]).toMatch(/^plans\/b\.md\n/);
  });

  it("asks for the same set once, however often it is asked for", async () => {
    const asked = serve();
    const ready = readyOf();
    const first = loadPageInputs("", ready, layoutOf(ready));
    const again = loadPageInputs("", ready, layoutOf(ready));
    expect(again).toBe(first);
    await first.promise;
    expect(asked).toHaveLength(1);
  });

  it("keeps the same pages under another roadmap as another set", async () => {
    const asked = serve();
    // docs/roadmap.md, found by name, routes plans/b.md.
    const ready = readyOf({
      ...TREE,
      "docs/roadmap.md": "# Docs\n\n- [B](../plans/b.md)\n",
    });
    const nearest = layoutPlanningPage(
      ready.index,
      sectionsOf(ready.index),
      {},
    );
    const other = layoutPlanningPage(
      ready.index,
      sectionsOf(ready.index, "docs/roadmap.md"),
      {},
    );
    expect(nearest.pages).toBe(other.pages);
    const first = loadPageInputs("", ready, nearest);
    const second = loadPageInputs("", ready, other);
    expect(second).not.toBe(first);
    expect(loadPageInputs("", ready, other)).toBe(second);
    const [a, b] = await Promise.all([first.promise, second.promise]);
    expect(a?.key).not.toBe(b?.key);
    expect(asked).toHaveLength(2);
  });

  it("refreshes a stale block's path once for its hash", async () => {
    setPlanningLimitsForTests({ reviewsDeadlineMs: 10 });
    serve(() => ({
      cards: async (_repo, want) =>
        want.map((w) => ({
          path: w.path,
          startLine: w.startLine,
          stale: true as const,
        })),
    }));
    const refreshed = vi.fn();
    const ready = readyOf();
    usePlanningStore.setState({
      byRepo: { "": ready },
      noteFilesChanged: refreshed,
    });
    const inputs = await inputsOf(ready);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(refreshed).toHaveBeenCalledWith(
      "",
      ["plans/a.md", "plans/b.md"],
      [],
    );
    expect([...inputs.blocks.values()].every((b) => b === null)).toBe(true);
    // Another page asks about the same files under the same hashes: they are
    // not refreshed again, and nothing waits.
    setPlanningLimitsForTests({ reviewsDeadlineMs: 60_000, pageEntries: 1 });
    await inputsOf(ready, { "needs-you": "2" });
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("gives up on a set whose stale block's refresh lands, for the index that follows", async () => {
    serve(() => ({
      cards: async (_repo, want) =>
        want.map((w) => ({
          path: w.path,
          startLine: w.startLine,
          stale: true as const,
        })),
    }));
    const ready = readyOf();
    const next = readyOf();
    usePlanningStore.setState({
      byRepo: { "": ready },
      noteFilesChanged: () =>
        queueMicrotask(() =>
          usePlanningStore.setState({ byRepo: { "": next } }),
        ),
    });
    await expect(
      loadPageInputs("", ready, layoutOf(ready)).promise,
    ).resolves.toBeNull();
  });
});

describe("the cache of sets", () => {
  it("keeps the last pageInputsKept sets, least recently used first out", async () => {
    setPlanningLimitsForTests({ pageEntries: 1, pageInputsKept: 2 });
    serve();
    const first = readyOf();
    const second = readyOf();
    const load = (
      ready: Extract<PlanningLoad, { status: "ready" }>,
      request = {},
    ) => loadPageInputs("", ready, layoutOf(ready, request));
    const one = load(first);
    await one.promise;
    const two = load(first, { "needs-you": "2" });
    await two.promise;
    // Used again, so page 2's set is now the oldest.
    expect(load(first)).toBe(one);
    // A third set pushes it out.
    await load(second).promise;
    expect(load(first)).toBe(one);
    expect(load(first, { "needs-you": "2" })).not.toBe(two);
  });

  it("reuses, in a set of a new version, the blocks a cached set holds for the same content", async () => {
    const asked = serve();
    const first = await inputsOf(readyOf());
    const second = await inputsOf(readyOf());
    expect(second.key).not.toBe(first.key);
    expect(asked).toHaveLength(1);
    for (const [key, block] of first.blocks) {
      expect(second.blocks.get(key)).toBe(block);
    }
  });

  it("asks again for a block whose document changed", async () => {
    const asked = serve(() => ({
      cards: async (_repo, want) =>
        want.map((w) => ({
          path: w.path,
          block: {
            startLine: w.startLine,
            endLine: w.startLine,
            markdown: `${w.path} at ${w.hash}`,
            lineOffset: 0,
          },
        })),
    }));
    await inputsOf(readyOf());
    const changed = readyOf();
    const edited = {
      ...changed,
      hashes: { ...changed.hashes, "plans/b.md": "0".repeat(32) },
    };
    await inputsOf(edited);
    expect(asked).toHaveLength(2);
    expect(asked[1]?.map((w) => w.path)).toEqual(["plans/b.md"]);
  });
});

describe("prefetchPlanningPage", () => {
  it("asks for page 1's inputs once the index is ready", async () => {
    const asked = serve();
    prefetchPlanningPage("");
    expect(asked).toHaveLength(0);
    usePlanningStore.setState({ byRepo: { "": readyOf() } });
    prefetchPlanningPage("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toHaveLength(1);
    // Asked again, it is the same set.
    prefetchPlanningPage("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toHaveLength(1);
  });

  it("asks for the remembered roadmap's first page, else the default's, and a pager's own", async () => {
    const tree = {
      ...TREE,
      "docs/roadmap.md": "# Docs\n\n- [B](../plans/b.md)\n",
    };
    usePlanningStore.setState({ byRepo: { "": readyOf(tree) } });
    const paths = (want: CardWant[] | undefined) =>
      want?.map((item) => item.path);
    // Nothing remembered: the nearest the root, roadmap.md, routing a.md.
    const byDefault = serve();
    prefetchPlanningPage("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(paths(byDefault[0])).toEqual(["plans/a.md", "plans/a.md"]);
    resetPlanningPageInputs();
    localStorage.setItem("vantage:planningRoadmap:", "docs/roadmap.md");
    try {
      const asked = serve();
      prefetchPlanningPage("");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(asked).toHaveLength(1);
      expect(paths(asked[0])).toEqual(["plans/b.md"]);
      // A pager names the roadmap the page shows, over the remembered one.
      prefetchPlanningPage("", {}, "roadmap.md");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(asked).toHaveLength(2);
      expect(paths(asked[1])).toEqual(["plans/a.md", "plans/a.md"]);
    } finally {
      localStorage.clear();
    }
  });

  it("asks for nothing while the index builds, when it is refused, or in a static export", async () => {
    const asked = serve();
    usePlanningStore.setState({
      byRepo: { "": { status: "loading", warm: false, progress: null } },
    });
    prefetchPlanningPage("");
    const refused = readyOf();
    usePlanningStore.setState({
      byRepo: {
        "": { ...refused, index: { ...refused.index, refused: true } },
      },
    });
    prefetchPlanningPage("");
    usePlanningStore.setState({ byRepo: { "": readyOf() } });
    window.__VANTAGE_STATIC__ = true;
    prefetchPlanningPage("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toHaveLength(0);
    expect(vi.mocked(axios.post)).not.toHaveBeenCalled();
  });
});
