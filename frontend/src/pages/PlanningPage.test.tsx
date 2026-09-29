/**
 * The planning page (`docs/design/planning-index.md` §6): each section of
 * §6.2 with its notices and its empty and degenerate states, the cards'
 * controls per state (Plan Q5), filing, and Copy answers.
 *
 * Rendered with the app's real cards over a planning store seeded with a
 * ready index, against a review endpoint simulated in memory, so a comment
 * filed from a card comes back through the page's own reviews. The cards'
 * blocks and Copy's quoted lines come from the real inline scanner client,
 * over a fake planning server holding the same tree.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  PLANNING_NOTICES,
  buildPlanningIndex,
  type PlanningConfig,
  type PlanningSources,
} from "vantage-md/planning";
import { PlanningPage } from "./PlanningPage";
import {
  STATIC_MESSAGE,
  resetPlanningTrackers,
  usePlanningStore,
  type PlanningLoad,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { answersPayload, useReviewStore } from "../stores/useReviewStore";
import { readPreference, reviewModePreferenceKey } from "../lib/preferences";
import {
  inlineScannerClient,
  setPlanningScannerForTests,
  type CardAnswer,
  type CardWant,
  type ScannerClient,
} from "../planningScan/client";
import { memoryScanStore } from "../planningScan/memoryStore";
import { contentHash, readRepoFile, sourcesOf } from "../test/planning";
import { fakePlanningServer } from "../test/planningStream";
import type { ReviewComment, ReviewData } from "../types";

vi.mock("axios");
vi.mock("../hooks/useWebSocket", () => ({ useWebSocket: vi.fn() }));
vi.mock("vantage-md/react", async () => {
  const actual = await vi.importActual("vantage-md/react");
  return {
    ...actual,
    MermaidDiagram: ({ code }: { code: string }) => <pre>{code}</pre>,
  };
});

/* ------------------------------------------------------------------ *
 * The corpus: one of everything §6.2 sorts
 * ------------------------------------------------------------------ */

const q = (id: string, marker: string, leaning: string | null = "Yes.") =>
  [
    `1. ${marker} **${id}: Question ${id}?**`,
    "",
    leaning === null
      ? `   <!-- vantage: oq id=${id} -->`
      : `   <!-- vantage: oq id=${id} leaning="${leaning}" -->`,
    "",
    `   _Leaning:_ ${leaning ?? "none"}`,
    "",
  ].join("\n");

const OPEN = "\u{1F4AC}";
const BLOCKED = "\u{1F512}";
const ANSWERED = "✅";

const doc = (front: string, ...body: string[]) =>
  [`---\n${front}\n---`, "", "# Doc", "", ...body].join("\n");

const TREE: Record<string, string> = {
  "roadmap.md": [
    "# Roadmap",
    "",
    "## Rule these first",
    "",
    "1. [The design](plans/design.md) comes first.",
    "2. [Its settled one](plans/answered.md#OQ-A1) needs compacting.",
    "",
  ].join("\n"),
  "plans/design.md": doc(
    "status: in-review\nstage: DESIGN",
    q("OQ-D1", OPEN),
    q("OQ-D2", BLOCKED),
    q("OQ-D3", OPEN),
  ),
  "plans/answered.md": doc("stage: DESIGN", q("OQ-A1", ANSWERED)),
  "plans/unrouted.md": doc("stage: DESIGN", q("OQ-U1", OPEN)),
  "plans/deps.md": doc(
    "stage: DESIGN\ndepends-on:\n  - design.md#OQ-D1",
    "Waits.",
  ),
  "plans/ready.md": doc("status: accepted\nstage: DECIDED", "Decided."),
  "plans/built.md": doc("status: accepted\nstage: BUILT", "Built."),
  "plans/disagrees.md": doc("stage: DECIDED", q("OQ-X1", OPEN)),
  "plans/gone.md": doc("stage: GONE", q("OQ-G1", OPEN)),
};

const STAGES: PlanningConfig["stages"] = {
  DESIGN: "open",
  DECIDED: "ready",
  BUILT: "built",
  GONE: "done",
};

let version = 0;

/**
 * Serve `tree` to the page's scanner client, as the planning server would,
 * under `apiBase`, with any of the client's calls replaced.
 */
function serveTree(
  tree: Record<string, string>,
  apiBase = "/api",
  replaced: (inline: ScannerClient) => Partial<ScannerClient> = () => ({}),
): void {
  const server = fakePlanningServer(tree, { apiBase });
  const inline = inlineScannerClient({
    store: memoryScanStore(),
    scannerId: "test",
    fetch: server.fetch,
  });
  setPlanningScannerForTests({ ...inline, ...replaced(inline) });
}

/** A ready load of `tree`'s index, with each planning document's hash. */
function readyOf(
  tree: Record<string, string>,
  config: Partial<PlanningConfig> = { stages: STAGES },
  overrides: Partial<PlanningSources> = {},
): PlanningLoad {
  const index = buildPlanningIndex(sourcesOf(tree, overrides, config));
  const hashes = Object.fromEntries(
    index.documents.map((d) => [d.path, contentHash(tree[d.path] ?? "")]),
  );
  return {
    status: "ready",
    index,
    version: ++version,
    rescanning: false,
    hashes,
  };
}

function seed(
  tree: Record<string, string> = TREE,
  config: Partial<PlanningConfig> = { stages: STAGES },
  overrides: Partial<PlanningSources> = {},
): void {
  serveTree(tree);
  setLoad(readyOf(tree, config, overrides));
}

function setLoad(load: PlanningLoad, repo = ""): void {
  act(() => {
    usePlanningStore.setState((state) => ({
      byRepo: { ...state.byRepo, [repo]: load },
    }));
  });
}

/* ------------------------------------------------------------------ *
 * The review endpoint, in memory
 * ------------------------------------------------------------------ */

let reviews: Record<string, ReviewComment[]>;

function serveReviews(): void {
  vi.mocked(axios.get).mockImplementation(async (url, config) => {
    if (String(url).endsWith("/review")) {
      const path = (config?.params as { path: string }).path;
      const comments = reviews[path];
      return { data: comments ? { file_path: path, comments } : null };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(axios.post).mockImplementation(async (url, body, config) => {
    if (String(url).endsWith("/review/comments")) {
      const path = (config?.params as { path: string }).path;
      const created = {
        ...(body as ReviewComment),
        reactions: [],
      };
      reviews[path] = [...(reviews[path] ?? []), created];
      const data: ReviewData = { file_path: path, comments: reviews[path] };
      return { data };
    }
    throw new Error(`unexpected POST ${url}`);
  });
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  resetPlanningTrackers();
  usePlanningStore.setState({ byRepo: {}, reviewEpoch: {} });
  useRepoStore.setState({
    reposLoaded: true,
    isMultiRepo: false,
    currentRepo: null,
    repos: [{ name: "", path: "/repo" }] as never,
  });
  useReviewStore.setState({ comments: [], filePath: null });
  reviews = {};
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.post).mockReset();
  serveReviews();
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
  window.scrollTo = vi.fn() as never;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setPlanningScannerForTests(null);
});

/** Let the reviews, the card blocks and the quoted lines all answer. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * A history entry of its own for each render. The page saves its scroll
 * position by entry key, and the router gives every first entry the same one.
 */
let entries = 0;
const entry = (pathname: string) => ({ pathname, key: `entry-${++entries}` });

async function renderPage(url = "/.vantage/planning") {
  const view = render(
    <MemoryRouter initialEntries={[entry(url)]}>
      <Routes>
        <Route path="/.vantage/planning/*" element={<PlanningPage />} />
        <Route path="/*" element={<div data-testid="viewer">viewer</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return view;
}

const section = (name: string) =>
  screen.getByRole("region", { name: new RegExp(`^${name}`) });
const querySection = (name: string) =>
  screen.queryByRole("region", { name: new RegExp(`^${name}`) });
/** The cards in a section, by the question each renders. */
const cardsIn = (name: string) =>
  within(section(name))
    .queryAllByRole("article")
    .map((a) => a.getAttribute("aria-label"));
const cardFor = (id: string) =>
  screen.getByRole("article", { name: `${id}: Question ${id}?` });
/** The documents a section lists, by path. */
const documentsIn = (name: string) =>
  Array.from(section(name).querySelectorAll("[data-planning-document]"), (el) =>
    el.getAttribute("data-planning-document"),
  );

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

describe("the sections, top to bottom (§6.2)", () => {
  beforeEach(() => seed());

  it("lists routed questions under Needs you, in roadmap order, answered ones included", async () => {
    await renderPage();
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
      "OQ-A1: Question OQ-A1?",
    ]);
  });

  it("lists open questions nothing routes under Unrouted, a done document's aside", async () => {
    await renderPage();
    expect(cardsIn("Unrouted")).toEqual([
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
    expect(
      screen.queryByRole("article", { name: "OQ-G1: Question OQ-G1?" }),
    ).toBeNull();
  });

  it("lists blocked questions and waiting documents under Waiting", async () => {
    await renderPage();
    expect(cardsIn("Waiting")).toEqual(["OQ-D2: Question OQ-D2?"]);
    expect(documentsIn("Waiting")).toEqual(["plans/deps.md"]);
    const waits = within(section("Waiting")).getByText(/waits on/);
    expect(
      within(waits).getByRole("link", { name: "design.md#OQ-D1" }),
    ).toHaveAttribute("href", "/plans/design.md#OQ-D1");
    expect(
      within(waits).getByRole("img", { name: "open question" }),
    ).toBeTruthy();
  });

  // §6.2's Disagrees holds both roles, and the checker's matching finding
  // tells them apart; the page said "decided" for both.
  it("says a Disagrees row's stage is built or decided, by its role", async () => {
    seed({
      ...TREE,
      "plans/built-open.md": doc("stage: BUILT", q("OQ-Y1", OPEN)),
    });
    await renderPage();
    const rows = section("Disagrees");
    const rowOf = (path: string) =>
      rows.querySelector(`[data-planning-document="${path}"]`)!.textContent;
    expect(rowOf("plans/built-open.md")).toContain(
      "Its stage says it is built, and it still has open questions.",
    );
    expect(rowOf("plans/disagrees.md")).toContain(
      "Its stage says it is decided, and it still has open questions.",
    );
  });

  it("lists Ready, Graduate and Disagrees by stage", async () => {
    await renderPage();
    expect(documentsIn("Ready")).toEqual(["plans/ready.md"]);
    expect(documentsIn("Graduate")).toEqual(["plans/built.md"]);
    expect(documentsIn("Disagrees")).toEqual(["plans/disagrees.md"]);
    // Each by name, with its badge.
    expect(
      within(section("Ready")).getByRole("link", { name: "plans/ready.md" }),
    ).toHaveAttribute("href", "/plans/ready.md");
    expect(
      within(section("Ready")).getByRole("img", {
        name: "accepted, decided",
      }),
    ).toBeTruthy();
  });

  it("lists Skipped and Could not read", async () => {
    seed(
      TREE,
      { stages: STAGES },
      {
        skipped: [{ path: "docs/huge.md", size: 2 * 1024 * 1024 }],
        unreadable: [{ path: "docs/latin1.md", reason: "not UTF-8" }],
      },
    );
    await renderPage();
    expect(section("Skipped")).toHaveTextContent(
      "docs/huge.md 2.0 MiB, over max-file-bytes (1.0 MiB)",
    );
    expect(section("Could not read")).toHaveTextContent(
      "docs/latin1.md not UTF-8",
    );
  });

  it("puts the sections in the design's order", async () => {
    seed(
      TREE,
      { stages: STAGES },
      {
        skipped: [{ path: "docs/huge.md", size: 2 * 1024 * 1024 }],
        unreadable: [{ path: "docs/latin1.md", reason: "not UTF-8" }],
      },
    );
    await renderPage();
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent?.replace(/\d+$/, "")),
    ).toEqual([
      "Needs you",
      "Unrouted",
      "Waiting",
      "Ready",
      "Graduate",
      "Disagrees",
      "Skipped",
      "Could not read",
    ]);
  });

  it("shows no notice when there is a roadmap, declared stages and an open question", async () => {
    await renderPage();
    expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
    expect(screen.queryByText(/No roadmap/)).toBeNull();
    expect(screen.queryByText(/No stages are declared/)).toBeNull();
  });
});

describe("empty and degenerate states", () => {
  it("hides every empty section", async () => {
    seed({ "roadmap.md": "# Roadmap\n", "plans/x.md": doc("stage: DESIGN") });
    await renderPage();
    for (const name of [
      "Needs you",
      "Unrouted",
      "Waiting",
      "Ready",
      "Graduate",
      "Disagrees",
      "Skipped",
      "Could not read",
    ]) {
      expect(querySection(name), name).toBeNull();
    }
  });

  it("says Nothing needs you, above a Needs you holding only answered questions", async () => {
    seed({
      "roadmap.md": "# Roadmap\n\n- [Settled](plans/answered.md)\n",
      "plans/answered.md": TREE["plans/answered.md"],
    });
    await renderPage();
    const line = screen.getByTestId("nothing-needs-you");
    expect(line).toHaveTextContent(PLANNING_NOTICES.nothingNeedsYou);
    expect(cardsIn("Needs you")).toEqual(["OQ-A1: Question OQ-A1?"]);
    expect(
      line.compareDocumentPosition(section("Needs you")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("without a roadmap, lists every open question under Needs you by document, and drops Unrouted", async () => {
    const { "roadmap.md": _, ...noRoadmap } = TREE;
    void _;
    seed(noRoadmap);
    await renderPage();
    expect(
      screen.getByText(PLANNING_NOTICES.noRoadmap("roadmap.md")),
    ).toBeTruthy();
    expect(querySection("Unrouted")).toBeNull();
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
  });

  it("names the configured roadmap when it is missing", async () => {
    seed(TREE, { stages: STAGES, roadmap: "plans/roadmap.md" });
    await renderPage();
    expect(
      screen.getByText(PLANNING_NOTICES.noRoadmap("plans/roadmap.md")),
    ).toBeTruthy();
  });

  it("without stages, drops the three stage sections and says how to declare them", async () => {
    seed(TREE, { stages: null });
    await renderPage();
    expect(screen.getByText(PLANNING_NOTICES.noStages)).toBeTruthy();
    expect(querySection("Ready")).toBeNull();
    expect(querySection("Graduate")).toBeNull();
    expect(querySection("Disagrees")).toBeNull();
    // Needs you, Unrouted and Waiting need only questions and links.
    expect(querySection("Needs you")).not.toBeNull();
    expect(querySection("Waiting")).not.toBeNull();
  });

  it("says how many files there are, and nothing else, past max-candidates", async () => {
    seed({}, { maxCandidates: 5000 }, { refused: true, candidateCount: 5001 });
    await renderPage();
    expect(screen.getByText(PLANNING_NOTICES.refused(5001, 5000))).toBeTruthy();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("shows a failed batch's error with Retry, which rescans", async () => {
    const rescan = vi.fn();
    const real = usePlanningStore.getState().rescan;
    usePlanningStore.setState({ rescan });
    try {
      setLoad({ status: "error", message: "Could not load: boom" });
      await renderPage();
      expect(screen.getByText("Could not load: boom")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(rescan).toHaveBeenCalledWith("");
    } finally {
      usePlanningStore.setState({ rescan: real });
    }
  });

  it("shows a spinner, not an empty page, while the first scan runs", async () => {
    setLoad({ status: "loading" });
    await renderPage();
    expect(
      screen.getByLabelText("Scanning the planning documents"),
    ).toBeTruthy();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });
});

describe("the cards' blocks, from the scanner client (planning-index-at-scale.md §7.4)", () => {
  /** The tree with every file changed, so nothing an earlier test held fits. */
  const edited = (label: string) =>
    Object.fromEntries(
      Object.entries(TREE).map(([path, content]) => [
        path,
        `${content}\n<!-- ${label} -->\n`,
      ]),
    );

  it("asks for every listed card in full, by the index's content hash", async () => {
    const tree = edited("asked");
    const asked: { want: CardWant[]; full: boolean | undefined }[] = [];
    serveTree(tree, "/api", (inline) => ({
      cards: (repo, want, options) => {
        asked.push({ want, full: options?.full });
        return inline.cards(repo, want, options);
      },
    }));
    setLoad(readyOf(tree));
    await renderPage();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.full).toBe(true);
    expect(new Set(asked[0]?.want.map((w) => w.path))).toEqual(
      new Set([
        "plans/design.md",
        "plans/answered.md",
        "plans/unrouted.md",
        "plans/disagrees.md",
      ]),
    );
    for (const want of asked[0]?.want ?? []) {
      expect(want.hash).toBe(contentHash(tree[want.path] ?? ""));
    }
    // And the cards render what came back: the question's own unit.
    expect(
      cardFor("OQ-U1").querySelector("[data-planning-card-unit]")?.textContent,
    ).toContain("OQ-U1: Question OQ-U1?");
  });

  it("keeps the sections back until every card's block is in hand", async () => {
    const tree = edited("held back");
    let release: () => void = () => {};
    serveTree(tree, "/api", (inline) => ({
      cards: (repo, want, options) =>
        new Promise<CardAnswer[]>((resolve) => {
          release = () => resolve(inline.cards(repo, want, options));
        }),
    }));
    setLoad(readyOf(tree));
    await renderPage();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(
      screen.getByLabelText("Scanning the planning documents"),
    ).toBeTruthy();
    release();
    await settle();
    expect(cardsIn("Unrouted")).toEqual([
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
  });

  it("says a card's document no longer has its block when the version it asked for is gone", async () => {
    // A document no other test shows, so no block of it is on screen already.
    const tree = { "plans/stale.md": doc("stage: DESIGN", q("OQ-S1", OPEN)) };
    serveTree(tree, "/api", () => ({
      cards: async (_repo, want) =>
        want.map((w) => ({
          path: w.path,
          startLine: w.startLine,
          stale: true,
        })),
    }));
    setLoad(readyOf(tree));
    await renderPage();
    expect(
      within(cardFor("OQ-S1")).getByText(
        "This question's document is not in the planning index any more.",
      ),
    ).toBeTruthy();
  });
});

describe("in daemon mode", () => {
  beforeEach(() => {
    useRepoStore.setState({
      isMultiRepo: true,
      currentRepo: "alpha",
      repos: [{ name: "alpha" }, { name: "beta" }] as never,
    });
  });

  it("shows the repository in its URL, and links its documents under it", async () => {
    serveTree(TREE, "/api/r/alpha");
    setLoad(readyOf(TREE), "alpha");
    await renderPage("/.vantage/planning/alpha");
    expect(
      within(cardFor("OQ-D1")).getByRole("link", { name: "Open document" }),
    ).toHaveAttribute("href", "/alpha/plans/design.md");
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith("/api/r/alpha/review", {
      params: { path: "plans/design.md" },
    });
  });

  it("says so for a repository it does not serve", async () => {
    await renderPage("/.vantage/planning/nope");
    expect(screen.getByText("Repository not found: nope")).toBeTruthy();
  });

  it("asks for a project when the URL names none", async () => {
    useRepoStore.setState({ currentRepo: null });
    await renderPage("/.vantage/planning");
    expect(screen.getByText(/Choose a project/)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * Cards on the page
 * ------------------------------------------------------------------ */

describe("each card's controls follow its state (Plan Q5)", () => {
  beforeEach(() => seed());

  it("gives a blocked card under Waiting Open document alone", async () => {
    await renderPage();
    const card = within(section("Waiting")).getByRole("article");
    expect(card).toHaveAccessibleName("OQ-D2: Question OQ-D2?");
    expect(
      within(card).getByRole("link", { name: "Open document" }),
    ).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: "Take this leaning" }),
    ).toBe(null);
    expect(within(card).queryByRole("button", { name: "Answer…" })).toBe(null);
  });

  it("gives an answered card under Needs you Answer… and Open document, and no Take", async () => {
    await renderPage();
    const card = cardFor("OQ-A1");
    expect(section("Needs you")).toContainElement(card);
    expect(within(card).getByRole("button", { name: "Answer…" })).toBeTruthy();
    expect(
      within(card).getByRole("link", { name: "Open document" }),
    ).toBeTruthy();
    expect(
      within(card).queryByRole("button", { name: "Take this leaning" }),
    ).toBe(null);
  });

  it("gives an open card all three", async () => {
    await renderPage();
    const card = cardFor("OQ-D1");
    expect(
      within(card).getByRole("button", { name: "Take this leaning" }),
    ).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Answer…" })).toBeTruthy();
    expect(
      within(card).getByRole("link", { name: "Open document" }),
    ).toBeTruthy();
  });
});

describe("filing from the page", () => {
  beforeEach(() => seed());

  it("files on the question's own document, and shows it waiting on the agent", async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-D3")).getByRole("button", {
          name: "Take this leaning",
        }),
      );
    });
    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      "/api/review/comments",
      expect.objectContaining({ comment: "Yes." }),
      { params: { path: "plans/design.md" } },
    );
    const comments = within(cardFor("OQ-D3")).getByRole("list", {
      name: "Comments on this question",
    });
    expect(comments).toHaveTextContent("Yes.");
    expect(comments).toHaveTextContent("waiting on the agent");
    // Its sibling in the same document and the same list lists nothing.
    expect(
      within(cardFor("OQ-D1")).queryByRole("list", {
        name: "Comments on this question",
      }),
    ).toBeNull();
  });

  it("does not reorder the page", async () => {
    await renderPage();
    const before = screen
      .getAllByRole("article")
      .map((a) => a.getAttribute("aria-label"));
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-D3")).getByRole("button", {
          name: "Take this leaning",
        }),
      );
    });
    expect(
      screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")),
    ).toEqual(before);
  });

  it("opens the document without touching its review-mode preference", async () => {
    localStorage.setItem(reviewModePreferenceKey("plans/design.md"), "on");
    await renderPage();
    fireEvent.click(
      within(cardFor("OQ-D1")).getByRole("link", { name: "Open document" }),
    );
    expect(screen.getByTestId("viewer")).toBeTruthy();
    expect(readPreference(reviewModePreferenceKey("plans/design.md"))).toBe(
      "on",
    );
    expect(
      readPreference(reviewModePreferenceKey("plans/unrouted.md")),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Copy answers
 * ------------------------------------------------------------------ */

describe("Copy answers (§6.3)", () => {
  beforeEach(() => seed());

  const copyButton = () => screen.getByRole("button", { name: /Copy answers/ });
  const pendingCount = () => screen.getByTestId("pending-answers").textContent;

  async function take(id: string) {
    await act(async () => {
      fireEvent.click(
        within(cardFor(id)).getByRole("button", { name: "Take this leaning" }),
      );
    });
    // And the lines the new pending set quotes.
    await settle();
  }

  it("is disabled with nothing pending, and counts what is", async () => {
    await renderPage();
    expect(copyButton()).toBeDisabled();
    expect(pendingCount()).toBe("0");
    await take("OQ-D1");
    await take("OQ-U1");
    expect(copyButton()).toBeEnabled();
    expect(pendingCount()).toBe("2");
  });

  it("copies every pending answer on the page, grouped by document, with one set of instructions", async () => {
    await renderPage();
    await take("OQ-D1");
    await take("OQ-U1");
    await take("OQ-D3");
    await act(async () => {
      fireEvent.click(copyButton());
    });
    const payload = writeText.mock.calls[0][0] as string;
    const headings = payload.match(/^## Review Comments for `[^`]+`$/gm);
    expect(headings).toEqual([
      "## Review Comments for `plans/design.md`",
      "## Review Comments for `plans/unrouted.md`",
    ]);
    expect(payload.match(/^## Responding to Comments$/gm)).toHaveLength(1);
    expect(payload).toContain(
      "`uvx vantage-check plans/design.md plans/unrouted.md`",
    );
    // Each comment once, and the design's two in its own group.
    const design = payload.slice(
      payload.indexOf("plans/design.md`"),
      payload.indexOf("## Review Comments for `plans/unrouted.md`"),
    );
    expect(design.match(/\*\*Comment:\*\* Yes\./g)).toHaveLength(2);
    expect(payload.match(/\*\*Comment:\*\* Yes\./g)).toHaveLength(3);
  });

  it("quotes each answer's lines exactly as its document's own Copy would", async () => {
    await renderPage();
    await take("OQ-U1");
    await act(async () => {
      fireEvent.click(copyButton());
    });
    const comments = reviews["plans/unrouted.md"] ?? [];
    expect(comments).toHaveLength(1);
    // The whole text gives the same payload as the lines the scanner quoted.
    expect(writeText.mock.calls[0][0]).toBe(
      answersPayload([
        {
          path: "plans/unrouted.md",
          comments,
          content: TREE["plans/unrouted.md"] ?? null,
        },
      ]),
    );
    expect(writeText.mock.calls[0][0]).toContain("   _Leaning:_ Yes.");
  });

  it("waits for the quoted lines before it copies", async () => {
    serveTree(TREE, "/api", () => ({
      quotes: () => new Promise(() => {}),
    }));
    await renderPage();
    await take("OQ-U1");
    expect(pendingCount()).toBe("1");
    expect(copyButton()).toBeDisabled();
  });

  it("leaves out a comment on the same document that is not on a listed question", async () => {
    // A comment on the design's title paragraph, filed in the document itself.
    reviews["plans/design.md"] = [
      {
        id: "elsewhere-0001",
        comment: "About the title",
        created_at: 0,
        reactions: [],
        anchor: {
          source_line: 6,
          block_text_hash: "00000000",
          selection_offset: 0,
          selection_length: 0,
        },
      },
    ];
    await renderPage();
    expect(copyButton()).toBeDisabled();
    await take("OQ-D1");
    expect(pendingCount()).toBe("1");
    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(writeText.mock.calls[0][0]).not.toContain("About the title");
  });

  it("leaves out an answer the agent has already answered", async () => {
    await renderPage();
    await take("OQ-D1");
    const [filed] = reviews["plans/design.md"];
    reviews["plans/design.md"] = [
      {
        ...filed,
        reactions: [
          {
            actor: "agent",
            kind: "addressed",
            summary: "Done.",
            before_text: "",
            after_text: "",
            timestamp: filed.created_at + 10,
          },
        ],
      },
    ];
    // The delivery's push.
    act(() =>
      usePlanningStore.getState().noteReviewChanged("", "plans/design.md"),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(pendingCount()).toBe("0");
    expect(within(cardFor("OQ-D1")).getByText("Agent: Done.")).toBeTruthy();
  });
});

describe("Open document, then Back (§6.3, §15)", () => {
  beforeEach(() => seed());

  function BackButton() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
    );
  }

  it("returns to the page at the scroll position it left", async () => {
    render(
      <MemoryRouter initialEntries={[entry("/.vantage/planning")]}>
        <Routes>
          <Route path="/.vantage/planning/*" element={<PlanningPage />} />
          <Route path="/*" element={<BackButton />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();

    // The reader scrolls down to a card, then opens its document.
    Object.defineProperty(window, "scrollY", {
      value: 640,
      configurable: true,
    });
    fireEvent.click(
      within(cardFor("OQ-U1")).getByRole("link", { name: "Open document" }),
    );
    expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();

    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.mocked(window.scrollTo).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(cardFor("OQ-U1")).toBeTruthy();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 640);
  });

  it("restores nothing on a fresh visit", async () => {
    vi.mocked(window.scrollTo).mockClear();
    await renderPage();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe("scoping a comment to its question, over agent-bootstrap.md", () => {
  // Its five open questions are items of one loose list, so every card's DOM
  // holds all five (the plan's first WP-E trap).
  const PATH = "docs/design/agent-bootstrap.md";
  beforeEach(() => seed({ [PATH]: readRepoFile(PATH) }, { stages: null }));

  const bootstrapCard = (id: string) =>
    screen
      .getAllByRole("article")
      .find((a) => a.getAttribute("aria-label")?.startsWith(`${id}:`))!;

  it("files on OQ-B3 from its card: only its card lists it, Copy answers holds it once, and it reads 3.", async () => {
    await renderPage();
    const b3 = bootstrapCard("OQ-B3");
    expect(
      b3.querySelector("[data-planning-card-unit]")?.getAttribute("value"),
    ).toBe("3");
    await act(async () => {
      fireEvent.click(
        within(b3).getByRole("button", { name: "Take this leaning" }),
      );
    });

    for (const id of ["OQ-B1", "OQ-B2", "OQ-B3", "OQ-B4", "OQ-B5"]) {
      const list = within(bootstrapCard(id)).queryByRole("list", {
        name: "Comments on this question",
      });
      if (id === "OQ-B3") expect(list, id).not.toBeNull();
      else expect(list, id).toBeNull();
    }

    expect(screen.getByTestId("pending-answers")).toHaveTextContent("1");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy answers/ }));
    });
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload.match(/^\*\*Comment:\*\* /gm)).toHaveLength(1);
    expect(payload).toContain("**Comment:** Both, and stop there.");
  });
});

describe("in a static export (§3.6, Plan Q3)", () => {
  afterEach(() => {
    delete window.__VANTAGE_STATIC__;
  });

  it("shows the failed-fetch error, and asks for no review", async () => {
    window.__VANTAGE_STATIC__ = true;
    await renderPage();
    expect(screen.getByText(STATIC_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
  });
});
