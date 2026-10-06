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
  heldPlanningPageInputs,
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

  // planning-filter.md §6.5: the applied filter joins the set's identity.
  it("keeps the same pages under another filter as another set", async () => {
    const asked = serve();
    const ready = readyOf();
    const filter = "path:plans/b.md";
    const unfiltered = layoutOf(ready);
    const filtered = layoutPlanningPage(
      ready.index,
      sectionsOf(ready.index, null, filter),
      {},
      filter,
    );
    expect(filtered.pages).toBe(unfiltered.pages);
    expect(filtered.roadmap).toBe(unfiltered.roadmap);
    const first = loadPageInputs("", ready, unfiltered);
    const a = await first.promise;
    const second = loadPageInputs("", ready, filtered);
    expect(second).not.toBe(first);
    expect(loadPageInputs("", ready, filtered)).toBe(second);
    expect(loadPageInputs("", ready, unfiltered)).toBe(first);
    const b = await second.promise;
    expect(a?.key).not.toBe(b?.key);
    expect(b?.layout.filter).toBe(filter);
    expect(b?.documents).toEqual(["plans/b.md"]);
    // Its one card's block is the first set's, for the same content.
    expect(asked).toHaveLength(1);
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

// planning-filter.md §6.5: typing lays out a page per keystroke, and none of
// that may cost what Back relies on.
describe("the sets of a filter being typed", () => {
  const typedLayout = (
    ready: Extract<PlanningLoad, { status: "ready" }>,
    filter: string,
  ) =>
    layoutPlanningPage(
      ready.index,
      sectionsOf(ready.index, null, filter),
      {},
      filter,
    );
  /**
   * Three history entries' sets: Needs you's two pages, and the first page
   * of an index that came before.
   */
  const historyOf = async (
    ready: Extract<PlanningLoad, { status: "ready" }>,
  ): Promise<string[]> => {
    const earlier = readyOf();
    const keys: string[] = [];
    for (const [load, request] of [
      [earlier, {}],
      [ready, {}],
      [ready, { "needs-you": "2" }],
    ] as const) {
      const entry = loadPageInputs("", load, layoutOf(load, request));
      keys.push((await entry.promise)!.key);
    }
    return keys;
  };
  /** Twelve texts, as typed one key at a time. */
  const TYPED = "oq-a1 oq-b1".split("").map((_, i, all) =>
    all
      .slice(0, i + 1)
      .join("")
      .trim(),
  );

  it("evicts, typing past a dozen texts, no set another history entry was shown with, and holds two in the typing slot", async () => {
    setPlanningLimitsForTests({ pageEntries: 1, pageInputsKept: 4 });
    serve();
    const ready = readyOf();
    // Three history entries' sets: Needs you's pages 1 to 3.
    const history = await historyOf(ready);
    expect(heldPlanningPageInputs().cached).toEqual(history);
    let shown = history[1]!;
    const texts = [...new Set(TYPED)].filter((text) => text !== "");
    expect(texts.length).toBeGreaterThanOrEqual(10);
    for (const text of texts) {
      const entry = loadPageInputs("", ready, typedLayout(ready, text), {
        typed: true,
        shown,
      });
      // Every other keystroke's set is in before the next key.
      if (texts.indexOf(text) % 2 === 0) shown = (await entry.promise)!.key;
      const held = heldPlanningPageInputs();
      expect(held.cached).toEqual(history);
      expect(held.typing.length).toBeLessThanOrEqual(2);
    }
  });

  it("moves a typed set into the cache once the URL takes its text, and the visit's earlier one out", async () => {
    setPlanningLimitsForTests({ pageEntries: 1, pageInputsKept: 4 });
    serve();
    const ready = readyOf();
    const history = await historyOf(ready);
    const visit = Symbol("visit");
    const write = async (text: string) => {
      const layout = typedLayout(ready, text);
      const typed = loadPageInputs("", ready, layout, { typed: true });
      const key = (await typed.promise)!.key;
      // The URL takes it: the same set, and no new request for it.
      expect(loadPageInputs("", ready, layout, { visit })).toBe(typed);
      return key;
    };
    const first = await write("oq-a");
    expect(heldPlanningPageInputs()).toEqual({
      cached: [...history, first],
      typing: [],
    });
    // The same visit types on and pauses again: its first write's set
    // leaves, since the entry it was shown with holds the newer filter.
    const second = await write("oq-a1");
    expect(heldPlanningPageInputs()).toEqual({
      cached: [...history, second],
      typing: [],
    });
    // Another visit's typing is another entry's: it costs a place, as an
    // Enter would.
    const layout = typedLayout(ready, "oq-b");
    await loadPageInputs("", ready, layout, { typed: true }).promise;
    loadPageInputs("", ready, layout, { visit: Symbol("another") });
    expect(heldPlanningPageInputs().cached).toEqual([
      ...history.slice(1),
      second,
      expect.stringContaining("\noq-b\n"),
    ]);
  });

  it("takes a typed set the cache holds from the cache, and reuses the blocks the typing slot holds", async () => {
    const asked = serve();
    const ready = readyOf();
    const cached = loadPageInputs("", ready, layoutOf(ready));
    await cached.promise;
    expect(loadPageInputs("", ready, layoutOf(ready), { typed: true })).toBe(
      cached,
    );
    expect(heldPlanningPageInputs().typing).toEqual([]);
    expect(asked).toHaveLength(1);
    // With nothing cached, a typed set's blocks serve the next one's cards,
    // as a cached set's do.
    resetPlanningPageInputs();
    await loadPageInputs("", ready, typedLayout(ready, "oq-a"), {
      typed: true,
    }).promise;
    expect(heldPlanningPageInputs().cached).toEqual([]);
    expect(asked).toHaveLength(2);
    await loadPageInputs("", ready, typedLayout(ready, "oq-a1"), {
      typed: true,
    }).promise;
    expect(asked).toHaveLength(2);
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

  it("lays a pager's page out under the filter the page applies, and g p's under none", async () => {
    usePlanningStore.setState({ byRepo: { "": readyOf() } });
    const asked = serve();
    prefetchPlanningPage("", {}, null, "path:plans/b.md");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked.map((want) => want.map((w) => w.path))).toEqual([
      ["plans/b.md"],
    ]);
    prefetchPlanningPage("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toHaveLength(2);
    expect(asked[1]?.map((w) => w.path)).toEqual(["plans/a.md", "plans/a.md"]);
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
