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
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import axios from "axios";
import {
  PLANNING_NOTICES,
  buildPlanningIndex,
  type PlanningConfig,
  type PlanningSources,
} from "vantage-md/planning";
import { PlanningPage } from "./PlanningPage";
import { resetPlanningReviews } from "../hooks/usePlanningReviews";
import {
  prefetchPlanningPage,
  resetPlanningPageInputs,
} from "../hooks/usePlanningPageInputs";
import { clearMermaidCache } from "../../../packages/vantage-md/src/mermaidCache";
import {
  STATIC_MESSAGE,
  resetPlanningTrackers,
  usePlanningStore,
  type PlanningLoad,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import {
  answersPayload,
  linesOfText,
  useReviewStore,
} from "../stores/useReviewStore";
import { readPreference, reviewModePreferenceKey } from "../lib/preferences";
import {
  inlineScannerClient,
  setPlanningScannerForTests,
  type CardAnswer,
  type CardWant,
  type ScannerClient,
} from "../planningScan/client";
import { memoryScanStore } from "../planningScan/memoryStore";
import { setPlanningLimitsForTests } from "../planningScan/limits";
import { contentHash, readRepoFile, sourcesOf } from "../test/planning";
import { fakePlanningServer } from "../test/planningStream";
import type { ReviewComment, ReviewData } from "../types";

vi.mock("axios");
vi.mock("../hooks/useWebSocket", () => ({ useWebSocket: vi.fn() }));
/**
 * Mermaid itself stays out of the suite. The diagram stands in for the
 * viewer's own: drawn from the SVG cache at once when it holds the diagram,
 * and empty until then. The pre-draw fills that cache when `mermaid.draw`
 * lets it, which a test holds back to see the page wait.
 */
const mermaid = vi.hoisted(() => ({
  draw: (code: string): Promise<void> => Promise.resolve(void code),
}));
vi.mock("vantage-md/react", async () => {
  const actual = await vi.importActual("vantage-md/react");
  const cache = await vi.importActual<
    typeof import("../../../packages/vantage-md/src/mermaidCache")
  >("../../../packages/vantage-md/src/mermaidCache");
  return {
    ...actual,
    MermaidDiagram: ({ code }: { code: string }) => (
      <div data-testid="mermaid-container">
        <div className="mermaid">
          {cache.getCachedSvg(code) !== undefined && <svg data-code={code} />}
        </div>
      </div>
    ),
    prerenderMermaid: async (code: string) => {
      await mermaid.draw(code);
      cache.setCachedSvg(code, "<svg></svg>");
    },
  };
});

/**
 * How often each card's body rendered, by document: the viewer stands inside
 * a wrapper that is not memoized, so it renders exactly when its card does.
 */
const viewerRenders = vi.hoisted(() => new Map<string, number>());
vi.mock("../components/MarkdownViewer", async () => {
  const actual = await vi.importActual<
    typeof import("../components/MarkdownViewer")
  >("../components/MarkdownViewer");
  const Counted = (
    props: React.ComponentProps<typeof actual.MarkdownViewer>,
  ) => {
    const path = props.currentPath ?? "";
    viewerRenders.set(path, (viewerRenders.get(path) ?? 0) + 1);
    return <actual.MarkdownViewer {...props} />;
  };
  return { ...actual, MarkdownViewer: Counted };
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
    if (String(url).endsWith("/planning/reviews")) {
      const { paths } = body as { paths: string[] };
      return {
        data: {
          reviews: paths.flatMap((path) =>
            reviews[path]
              ? [{ path, review: { file_path: path, comments: reviews[path] } }]
              : [],
          ),
        },
      };
    }
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
  resetPlanningReviews();
  resetPlanningPageInputs();
  clearMermaidCache();
  mermaid.draw = () => Promise.resolve();
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
  setPlanningLimitsForTests(null);
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
const entry = (url: string) => {
  const [rest, fragment] = url.split("#");
  const [pathname, query] = (rest ?? url).split("?");
  return {
    pathname: pathname ?? url,
    search: query === undefined ? "" : `?${query}`,
    hash: fragment === undefined ? "" : `#${fragment}`,
    key: `entry-${++entries}`,
  };
};

/** Where the router is, and a way to move it, from outside the routes. */
const router: { location: string; navigate: NavigateFunction | null } = {
  location: "",
  navigate: null,
};
function RouterProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    router.location = `${location.pathname}${location.search}`;
    router.navigate = navigate;
  });
  return null;
}

async function renderPage(url = "/.vantage/planning", before: string[] = []) {
  const view = render(
    <MemoryRouter
      initialEntries={[...before.map(entry), entry(url)]}
      initialIndex={before.length}
    >
      <RouterProbe />
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
        .map((h) => h.textContent?.replace(/ [\d,]+$/, "")),
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

  it("shows a failed build's error with Retry, which rescans without the scan cache", async () => {
    const rescan = vi.fn();
    const real = usePlanningStore.getState().rescan;
    usePlanningStore.setState({ rescan });
    try {
      setLoad({ status: "error", message: "Could not load: boom" });
      await renderPage();
      expect(screen.getByText("Could not load: boom")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(rescan).toHaveBeenCalledWith("", { bypassCache: true });
    } finally {
      usePlanningStore.setState({ rescan: real });
    }
  });

  it("shows a progress line where the section bar will be while the first scan runs", async () => {
    setLoad({ status: "loading", warm: false, progress: null });
    await renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reading planning documents…",
    );
    setLoad({
      status: "loading",
      warm: false,
      progress: { done: 412, total: 1000 },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Scanning planning documents: 412 of 1,000",
    );
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });

  it("replaces the progress line with the section bar and the sections in one commit", async () => {
    setLoad({ status: "loading", warm: false, progress: null });
    serveTree(TREE);
    let release: () => void = () => {};
    serveTree(TREE, "/api", (inline) => ({
      cards: (repo, want, options) =>
        new Promise<CardAnswer[]>((resolve) => {
          release = () => resolve(inline.cards(repo, want, options));
        }),
    }));
    await renderPage();
    setLoad(readyOf(TREE));
    await settle();
    // The index is ready, and the sections are not: the line stays.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Scanning planning documents",
    );
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    release();
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
    expect(cardsIn("Unrouted")).toHaveLength(2);
  });
});

describe("pages (planning-index-at-scale.md §10.2)", () => {
  // Needs you holds three cards, and Unrouted two, so at two a page Needs you
  // has two pages and Unrouted one.
  beforeEach(() => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    seed();
  });

  const pager = (name: string, place: "top" | "bottom" = "top") =>
    screen.getByRole("navigation", {
      name: place === "top" ? `${name} pages` : `${name} pages, below`,
    });
  const flip = async (label: "Next ›" | "‹ Previous", place?: "bottom") => {
    await act(async () => {
      fireEvent.click(
        within(pager("Needs you", place)).getByRole("button", { name: label }),
      );
    });
    await settle();
  };

  it("shows one page of a section, with its range above and below it", async () => {
    await renderPage();
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
    ]);
    for (const place of ["top", "bottom"] as const) {
      const nav = pager("Needs you", place);
      expect(nav).toHaveTextContent("1–2 of 3");
      expect(
        within(nav).getByRole("button", { name: "‹ Previous" }),
      ).toHaveAttribute("aria-disabled", "true");
      expect(
        within(nav).getByRole("button", { name: "Next ›" }),
      ).not.toHaveAttribute("aria-disabled");
    }
    // The heading's count is the section's, not the page's, and a word of
    // its name of its own.
    expect(
      within(section("Needs you")).getByRole("heading", { level: 2 }),
    ).toHaveAccessibleName("Needs you 3");
    expect(section("Needs you")).toHaveAccessibleName("Needs you 3");
  });

  it("gives a section of one page no pager", async () => {
    await renderPage();
    expect(cardsIn("Unrouted")).toHaveLength(2);
    expect(
      screen.queryByRole("navigation", { name: /^Unrouted pages/ }),
    ).toBeNull();
  });

  it("flips to the next page in place of the history entry", async () => {
    await renderPage("/.vantage/planning", ["/plans/roadmap.md"]);
    await flip("Next ›");
    expect(cardsIn("Needs you")).toEqual(["OQ-A1: Question OQ-A1?"]);
    expect(router.location).toBe("/.vantage/planning?needs-you=2");
    const nav = pager("Needs you");
    expect(nav).toHaveTextContent("3–3 of 3");
    expect(within(nav).getByRole("button", { name: "Next ›" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // Back leaves the page rather than stepping back through its pages.
    act(() => router.navigate!(-1));
    expect(router.location).toBe("/plans/roadmap.md");
  });

  // A focused button that becomes disabled drops the focus to the body, and
  // in a section of two pages every flip ends on an end.
  it("keeps an end's button focusable, and inert, so a flip onto the last page keeps the focus", async () => {
    await renderPage();
    const next = () =>
      within(pager("Needs you")).getByRole("button", { name: "Next ›" });
    next().focus();
    await flip("Next ›");
    expect(router.location).toBe("/.vantage/planning?needs-you=2");
    expect(next()).not.toBeDisabled();
    expect(next()).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(next());
    // Pressed again, it does nothing.
    await flip("Next ›");
    expect(router.location).toBe("/.vantage/planning?needs-you=2");
    expect(cardsIn("Needs you")).toEqual(["OQ-A1: Question OQ-A1?"]);
  });

  it("says where a flip landed in a polite live region, once it lands, and nothing before", async () => {
    await renderPage();
    const said = () =>
      section("Needs you").querySelector('[aria-live="polite"][aria-atomic]');
    expect(said()).not.toBeNull();
    expect(said()).toHaveTextContent(/^$/);
    await flip("Next ›");
    expect(said()).toHaveTextContent(
      "Needs you, page 2 of 2, entries 3–3 of 3",
    );
    await flip("‹ Previous");
    expect(said()).toHaveTextContent(
      "Needs you, page 1 of 2, entries 1–2 of 3",
    );
  });

  it("clamps a page past the end to the last, and rewrites the URL in place", async () => {
    await renderPage("/.vantage/planning?needs-you=9&other=x");
    expect(cardsIn("Needs you")).toEqual(["OQ-A1: Question OQ-A1?"]);
    expect(router.location).toBe("/.vantage/planning?needs-you=2&other=x");
  });

  it.each(["abc", "0", "1"])(
    "reads needs-you=%s as page 1, and leaves it out of the URL",
    async (raw) => {
      await renderPage(`/.vantage/planning?needs-you=${raw}`);
      expect(cardsIn("Needs you")).toHaveLength(2);
      expect(router.location).toBe("/.vantage/planning");
    },
  );

  it("brings the section's heading into view from the bottom pager, and leaves the scroll alone from the top", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage();
      const top = within(pager("Needs you")).getByRole("button", {
        name: "Next ›",
      });
      top.focus();
      await flip("Next ›");
      expect(scrolled).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(top);
      // The focus goes with the heading: left on the bottom pager, it would
      // be far below the viewport.
      within(pager("Needs you", "bottom"))
        .getByRole("button", { name: "‹ Previous" })
        .focus();
      await flip("‹ Previous", "bottom");
      expect(scrolled).toHaveBeenCalledTimes(1);
      const heading = within(section("Needs you")).getByRole("heading", {
        level: 2,
      });
      expect(scrolled.mock.contexts[0]).toBe(heading);
      expect(document.activeElement).toBe(heading);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("asks for the next page's inputs when the pointer or the focus reaches a pager", async () => {
    const asked: CardWant[][] = [];
    serveTree(TREE, "/api", (inline) => ({
      cards: (repo, want, options) => {
        asked.push(want);
        return inline.cards(repo, want, options);
      },
    }));
    await renderPage();
    const a1Asked = () =>
      asked.some((want) => want.some((w) => w.path === "plans/answered.md"));
    expect(a1Asked()).toBe(false);
    fireEvent.pointerEnter(pager("Needs you"));
    await settle();
    expect(a1Asked()).toBe(true);
    // The flip then has its page in hand, and asks nothing more.
    const before = asked.length;
    await flip("Next ›");
    expect(cardsIn("Needs you")).toEqual(["OQ-A1: Question OQ-A1?"]);
    expect(asked).toHaveLength(before);
    // On the last page there is no next page to ask for.
    fireEvent.focus(
      within(pager("Needs you", "bottom")).getByRole("button", {
        name: "‹ Previous",
      }),
    );
    await settle();
    expect(asked).toHaveLength(before);
  });

  // While a flip waits for its page, the pager goes on from the page asked
  // for: a second Next is not lost, and the select does not jump back.
  it("goes on from the page asked for while the one shown waits", async () => {
    // Unrouted holds four questions of four documents, so each page asks
    // for a block no other page holds.
    const tree = {
      ...TREE,
      "plans/u2.md": doc("stage: DESIGN", q("OQ-U2", OPEN)),
      "plans/u3.md": doc("stage: DESIGN", q("OQ-U3", OPEN)),
    };
    setPlanningLimitsForTests({ pageEntries: 1, pageSelectFrom: 3 });
    let hold = false;
    const releases: (() => void)[] = [];
    serveTree(tree, "/api", (inline) => ({
      cards: (repo, want, options) =>
        hold
          ? new Promise<CardAnswer[]>((resolve) => {
              releases.push(() => resolve(inline.cards(repo, want, options)));
            })
          : inline.cards(repo, want, options),
    }));
    setLoad(readyOf(tree));
    await renderPage();
    const first = cardsIn("Unrouted");
    hold = true;
    const select = () =>
      within(pager("Unrouted")).getByRole<HTMLSelectElement>("combobox", {
        name: "Unrouted page",
      });
    const next = async () => {
      await act(async () => {
        fireEvent.click(
          within(pager("Unrouted")).getByRole("button", { name: "Next ›" }),
        );
      });
      await settle();
    };
    await next();
    expect(router.location).toBe("/.vantage/planning?unrouted=2");
    // Still page 1 on screen, and page 2 in the select.
    expect(cardsIn("Unrouted")).toEqual(first);
    expect(pager("Unrouted")).toHaveTextContent("1–1 of 4");
    expect(select().value).toBe("2");
    await next();
    expect(router.location).toBe("/.vantage/planning?unrouted=3");
    expect(select().value).toBe("3");
    for (const release of releases) release();
    await settle();
    expect(pager("Unrouted")).toHaveTextContent("3–3 of 4");
    expect(select().value).toBe("3");
  });

  it("offers a page select in a long section", async () => {
    setPlanningLimitsForTests({ pageEntries: 1, pageSelectFrom: 3 });
    await renderPage();
    const select = within(pager("Needs you")).getByRole("combobox", {
      name: "Needs you page",
    });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Page 1", "Page 2", "Page 3"]);
    await act(async () => {
      fireEvent.change(select, { target: { value: "3" } });
    });
    await settle();
    expect(cardsIn("Needs you")).toEqual(["OQ-A1: Question OQ-A1?"]);
    // Unrouted has two pages, fewer than a select is offered from.
    expect(within(pager("Unrouted")).queryByRole("combobox")).toBeNull();
  });

  it("returns from Open document to the same pages, at the same scroll", async () => {
    await renderPage();
    await flip("Next ›");
    Object.defineProperty(window, "scrollY", {
      value: 640,
      configurable: true,
    });
    fireEvent.click(
      within(cardFor("OQ-A1")).getByRole("link", { name: "Open document" }),
    );
    expect(screen.getByTestId("viewer")).toBeTruthy();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.mocked(window.scrollTo).mockClear();
    act(() => router.navigate!(-1));
    await settle();
    expect(router.location).toBe("/.vantage/planning?needs-you=2");
    expect(cardsIn("Needs you")).toEqual(["OQ-A1: Question OQ-A1?"]);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 640);
  });
});

describe("a flip's scroll position", () => {
  beforeEach(() => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    seed();
  });

  // A replaced entry has a key of its own, so the position the reader flipped
  // at goes with it: Back from any link on the new page returns there, not
  // only from Open document, which saves as it leaves.
  it("carries over to the replaced history entry", async () => {
    await renderPage();
    Object.defineProperty(window, "scrollY", {
      value: 300,
      configurable: true,
    });
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("navigation", { name: "Needs you pages" }),
        ).getByRole("button", { name: "Next ›" }),
      );
    });
    await settle();
    // A link that saves nothing on its way out.
    fireEvent.click(
      within(section("Waiting")).getByRole("link", { name: "design.md#OQ-D1" }),
    );
    expect(screen.getByTestId("viewer")).toBeTruthy();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.mocked(window.scrollTo).mockClear();
    act(() => router.navigate!(-1));
    await settle();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 300);
  });
});

describe("the section bar (planning-index-at-scale.md §10.1)", () => {
  beforeEach(() => seed());

  const bar = () => screen.getByRole("navigation", { name: "Sections" });

  it("names each non-empty section with its exact count, whatever the page", async () => {
    setPlanningLimitsForTests({ pageEntries: 1 });
    await renderPage();
    expect(
      within(bar())
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "Needs you 3",
      "Unrouted 2",
      "Waiting 2",
      "Ready 1",
      "Graduate 1",
      "Disagrees 1",
    ]);
  });

  it("jumps to a section without adding a history entry, and takes the focus there", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage();
      const link = within(bar()).getByRole("link", { name: /^Waiting/ });
      link.focus();
      fireEvent.click(link);
      const heading = within(section("Waiting")).getByRole("heading", {
        level: 2,
      });
      expect(scrolled.mock.contexts[0]).toBe(heading);
      expect(router.location).toBe("/.vantage/planning");
      // So Tab goes on from the section, not from the bar.
      expect(document.activeElement).toBe(heading);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("scrolls to the section a link's fragment names once the sections are in", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage("/.vantage/planning#graduate");
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toBe(
        within(section("Graduate")).getByRole("heading", { level: 2 }),
      );
      expect(
        within(bar()).getByRole("link", { name: /^Graduate/ }),
      ).toHaveAttribute("href", "#graduate");
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  // §10.3: the page on screen stays until an index update's inputs are
  // ready, then changes in one commit — the frame with it.
  it("changes its counts in the commit that changes the sections, not before", async () => {
    await renderPage();
    const unroutedCount = () =>
      within(bar()).getByRole("link", { name: /^Unrouted/ }).textContent;
    expect(unroutedCount()).toBe("Unrouted 2");
    // One more unrouted question, whose page is held back.
    const tree = {
      ...TREE,
      "plans/more.md": doc("stage: DESIGN", q("OQ-M1", OPEN)),
    };
    let release: () => void = () => {};
    serveTree(tree, "/api", (inline) => ({
      cards: (repo, want, options) =>
        new Promise<CardAnswer[]>((resolve) => {
          release = () => resolve(inline.cards(repo, want, options));
        }),
    }));
    setLoad(readyOf(tree));
    await settle();
    expect(section("Unrouted")).toHaveAccessibleName("Unrouted 2");
    expect(unroutedCount()).toBe("Unrouted 2");
    release();
    await settle();
    expect(section("Unrouted")).toHaveAccessibleName("Unrouted 3");
    expect(unroutedCount()).toBe("Unrouted 3");
  });

  it("writes every count in one number format, in the heading's name too", async () => {
    setPlanningLimitsForTests({ pageLines: 5 });
    seed(
      TREE,
      { stages: STAGES },
      {
        skipped: Array.from({ length: 1200 }, (_, i) => ({
          path: `docs/huge-${i}.md`,
          size: 2 * 1024 * 1024,
        })),
      },
    );
    await renderPage();
    expect(
      within(bar()).getByRole("link", { name: /^Skipped/ }),
    ).toHaveTextContent("Skipped 1,200");
    expect(
      within(section("Skipped")).getByRole("heading", { level: 2 }),
    ).toHaveAccessibleName("Skipped 1,200");
    expect(
      screen.getByRole("navigation", { name: "Skipped pages" }),
    ).toHaveTextContent("1–5 of 1,200");
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

  it("asks for every shown card's block, by the index's content hash", async () => {
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
    // Within the size a card renders unasked, so not in full.
    expect(asked[0]?.full).toBeFalsy();
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

  it("paints the frame first, and keeps the sections back until every card's block is in hand", async () => {
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
    // The frame: the header, and the section bar with its exact counts.
    expect(screen.getByRole("heading", { name: "Planning" })).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toHaveTextContent("Needs you 3");
    // Not past spinnerMs yet, so no spinner either.
    expect(screen.queryByLabelText("Loading this page's cards")).toBeNull();
    release();
    await settle();
    expect(cardsIn("Unrouted")).toEqual([
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
  });

  it("refreshes a stale block's path, and says its document no longer has it when nothing changes in time", async () => {
    setPlanningLimitsForTests({ reviewsDeadlineMs: 10 });
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
    const refreshed = vi.fn();
    const real = usePlanningStore.getState().noteFilesChanged;
    usePlanningStore.setState({ noteFilesChanged: refreshed });
    try {
      await renderPage();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      await settle();
      expect(refreshed).toHaveBeenCalledWith("", ["plans/stale.md"], []);
      expect(
        within(cardFor("OQ-S1")).getByText(
          "This question's document is not in the planning index any more.",
        ),
      ).toBeTruthy();
    } finally {
      usePlanningStore.setState({ noteFilesChanged: real });
    }
  });

  it("keeps the page until a stale block's refresh lands, then asks again", async () => {
    const tree = edited("stale then fresh");
    let fresh = false;
    serveTree(tree, "/api", (inline) => ({
      cards: async (repo, want, options) =>
        fresh
          ? inline.cards(repo, want, options)
          : want.map((w) => ({
              path: w.path,
              startLine: w.startLine,
              stale: true as const,
            })),
    }));
    setLoad(readyOf(tree));
    const refreshed = vi.fn();
    const real = usePlanningStore.getState().noteFilesChanged;
    usePlanningStore.setState({ noteFilesChanged: refreshed });
    try {
      await renderPage();
      expect(refreshed).toHaveBeenCalled();
      expect(screen.queryAllByRole("region")).toHaveLength(0);
      // The refresh lands: a new version of the index, whose blocks answer.
      fresh = true;
      setLoad(readyOf(tree));
      await settle();
      expect(
        cardFor("OQ-U1").querySelector("[data-planning-card-unit]")
          ?.textContent,
      ).toContain("OQ-U1: Question OQ-U1?");
    } finally {
      usePlanningStore.setState({ noteFilesChanged: real });
    }
  });
});

describe("the reviews, in one request (planning-index-at-scale.md §6.3)", () => {
  beforeEach(() => seed());

  const reviewRequests = () =>
    vi
      .mocked(axios.post)
      .mock.calls.filter(([url]) => String(url).endsWith("/planning/reviews"));

  const pathsOf = (at: number) =>
    (reviewRequests()[at]?.[1] as { paths: string[] }).paths;

  it("reads the shown pages' documents with their inputs, in one POST, and none with a GET", async () => {
    await renderPage();
    // Every section fits on its page, so the one request holds every listed
    // document, and every row's.
    expect(reviewRequests()).toHaveLength(1);
    expect(new Set(pathsOf(0))).toEqual(
      new Set([
        "plans/design.md",
        "plans/answered.md",
        "plans/unrouted.md",
        "plans/disagrees.md",
        "plans/deps.md",
        "plans/ready.md",
        "plans/built.md",
      ]),
    );
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
  });

  it("reads every other listed document in one more POST once the sections have painted", async () => {
    setPlanningLimitsForTests({ pageEntries: 1 });
    await renderPage();
    expect(reviewRequests()).toHaveLength(2);
    const first = new Set(pathsOf(0));
    const rest = pathsOf(1);
    expect(rest.filter((path) => first.has(path))).toEqual([]);
    expect(new Set([...first, ...rest])).toEqual(
      new Set([
        "plans/design.md",
        "plans/answered.md",
        "plans/unrouted.md",
        "plans/disagrees.md",
        "plans/deps.md",
        "plans/ready.md",
        "plans/built.md",
      ]),
    );
    // And a flip asks nothing more: its documents are in hand.
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("navigation", { name: "Needs you pages" }),
        ).getByRole("button", { name: "Next ›" }),
      );
    });
    await settle();
    expect(cardsIn("Needs you")).toEqual(["OQ-D3: Question OQ-D3?"]);
    expect(reviewRequests()).toHaveLength(2);
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
  });
});

describe("page inputs, and one commit (planning-index-at-scale.md §10.3)", () => {
  beforeEach(() => seed());

  /** The reviews request, held until `release` answers it. */
  function holdReviews(): { release: () => void; fail: () => void } {
    const real = vi.mocked(axios.post).getMockImplementation()!;
    const held: { release: () => void; fail: () => void } = {
      release: () => {},
      fail: () => {},
    };
    vi.mocked(axios.post).mockImplementation((url, body, config) => {
      if (!String(url).endsWith("/planning/reviews")) {
        return real(url, body, config);
      }
      return new Promise((resolve, reject) => {
        held.release = () => resolve(real(url, body, config));
        held.fail = () => reject(new Error("down"));
      });
    });
    return held;
  }

  /** A pending take on OQ-U1, filed from its own card, so its card lists it. */
  async function fileOnU1(): Promise<void> {
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-U1")).getByRole("button", {
          name: "Take this leaning",
        }),
      );
    });
    cleanup();
    resetPlanningReviews();
    resetPlanningPageInputs();
  }

  const commentsOn = (id: string) =>
    within(cardFor(id)).queryByRole("list", {
      name: "Comments on this question",
    });

  it("keeps the sections back until their documents' reviews are in, then paints the comments with the cards", async () => {
    await fileOnU1();
    const held = holdReviews();
    await renderPage();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    held.release();
    await settle();
    expect(commentsOn("OQ-U1")).toHaveTextContent("Yes.");
  });

  it("past the reviews deadline, paints without comments, and puts those that come later only in the card's count", async () => {
    setPlanningLimitsForTests({ reviewsDeadlineMs: 10 });
    await fileOnU1();
    const held = holdReviews();
    await renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();
    expect(cardsIn("Unrouted")).toHaveLength(2);
    expect(commentsOn("OQ-U1")).toBeNull();

    held.release();
    await settle();
    const count = within(cardFor("OQ-U1")).getByRole("button", {
      name: "1 comment",
    });
    expect(count).toHaveAttribute("aria-expanded", "false");
    expect(commentsOn("OQ-U1")).toBeNull();
    // The reader opens it.
    fireEvent.click(count);
    expect(commentsOn("OQ-U1")).toHaveTextContent("Yes.");
  });

  it("paints without comments, says so, and disables Copy answers when the reviews request fails", async () => {
    const held = holdReviews();
    await renderPage();
    await act(async () => {
      held.fail();
    });
    await settle();
    const region = screen.getByRole("alert");
    expect(region).toHaveTextContent("Comments could not be loaded.");
    expect(cardsIn("Unrouted")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Copy answers/ })).toBeDisabled();
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("–");
  });

  // §12: the second request comes after the sections painted, so a line
  // above them would move them. Copy answers says it where nothing moves.
  it("says so, and keeps Copy answers disabled, when the second reviews request fails", async () => {
    setPlanningLimitsForTests({ pageEntries: 1 });
    const real = vi.mocked(axios.post).getMockImplementation()!;
    let requests = 0;
    vi.mocked(axios.post).mockImplementation((url, body, config) => {
      if (String(url).endsWith("/planning/reviews") && ++requests === 2) {
        return Promise.reject(new Error("down"));
      }
      return real(url, body, config);
    });
    await renderPage();
    expect(requests).toBe(2);
    const copy = screen.getByRole("button", { name: /Copy answers/ });
    expect(copy).toBeDisabled();
    expect(copy).toHaveAttribute(
      "title",
      "Comments could not be loaded, so the answers waiting on the agent cannot be counted",
    );
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("–");
    expect(screen.getByTestId("reviews-failed")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Comments could not be loaded.",
    );
    // A push asks again, and the count is known.
    act(() =>
      usePlanningStore.getState().noteReviewChanged("", "plans/design.md"),
    );
    await settle();
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("0");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("reviews-failed")).toBeNull();
  });

  it("shows a spinner once the wait passes spinnerMs, and not before", async () => {
    setPlanningLimitsForTests({ spinnerMs: 20 });
    serveTree(TREE, "/api", () => ({
      cards: () => new Promise<CardAnswer[]>(() => {}),
    }));
    await renderPage();
    expect(screen.queryByLabelText("Loading this page's cards")).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(screen.getByLabelText("Loading this page's cards")).toBeTruthy();
  });

  it("keeps the old page on a flip until the new page's inputs are ready", async () => {
    setPlanningLimitsForTests({ pageEntries: 2, spinnerMs: 0 });
    let hold = false;
    let release: () => void = () => {};
    serveTree(TREE, "/api", (inline) => ({
      cards: (repo, want, options) =>
        hold
          ? new Promise<CardAnswer[]>((resolve) => {
              release = () => resolve(inline.cards(repo, want, options));
            })
          : inline.cards(repo, want, options),
    }));
    await renderPage();
    hold = true;
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("navigation", { name: "Needs you pages" }),
        ).getByRole("button", { name: "Next ›" }),
      );
    });
    await settle();
    expect(router.location).toBe("/.vantage/planning?needs-you=2");
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
    ]);
    // Its pager says it is on its way.
    expect(
      within(
        screen.getByRole("navigation", { name: "Needs you pages" }),
      ).getByLabelText("Loading the page"),
    ).toBeTruthy();
    release();
    await settle();
    expect(cardsIn("Needs you")).toEqual(["OQ-A1: Question OQ-A1?"]);
  });

  it("renders a returned-to page's frame and sections in one commit when its inputs are cached", async () => {
    render(
      <MemoryRouter initialEntries={[entry("/.vantage/planning")]}>
        <RouterProbe />
        <Routes>
          <Route path="/.vantage/planning/*" element={<PlanningPage />} />
          <Route path="/*" element={<div data-testid="viewer">viewer</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    fireEvent.click(
      within(cardFor("OQ-U1")).getByRole("link", { name: "Open document" }),
    );
    expect(screen.getByTestId("viewer")).toBeTruthy();
    // No settling: what the first render commits.
    act(() => router.navigate!(-1));
    expect(cardsIn("Unrouted")).toHaveLength(2);
  });

  it("asks for page 1's inputs ahead of a visit, so the visit asks for nothing more", async () => {
    const asked: CardWant[][] = [];
    serveTree(TREE, "/api", (inline) => ({
      cards: (repo, want, options) => {
        asked.push(want);
        return inline.cards(repo, want, options);
      },
    }));
    prefetchPlanningPage("");
    await settle();
    expect(asked).toHaveLength(1);
    const posts = vi.mocked(axios.post).mock.calls.length;
    await renderPage();
    expect(asked).toHaveLength(1);
    // The visit's one more request reads again what an earlier moment read.
    expect(vi.mocked(axios.post).mock.calls.length).toBeLessThanOrEqual(
      posts + 1,
    );
    expect(cardsIn("Unrouted")).toHaveLength(2);
  });

  it("reserves the pending count four digits, and shows – until every listed document is counted", async () => {
    const held = holdReviews();
    setPlanningLimitsForTests({ reviewsDeadlineMs: 10 });
    await renderPage();
    const count = screen.getByTestId("pending-answers");
    expect(count).toHaveTextContent("–");
    expect(count.style.minWidth).toBe("4ch");
    expect(count).toHaveClass("tabular-nums");
    held.release();
    await settle();
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("0");
    expect(screen.getByTestId("pending-answers").style.minWidth).toBe("4ch");
  });
});

describe("Mermaid, drawn before the cards commit (planning-index-at-scale.md §10.3)", () => {
  const DIAGRAM = "graph LR\n  A --> B";
  const tree = {
    ...TREE,
    "plans/unrouted.md": doc(
      "stage: DESIGN",
      q("OQ-U1", OPEN) +
        ["", "   ```mermaid", "   graph LR", "     A --> B", "   ```", ""].join(
          "\n",
        ),
    ),
  };
  beforeEach(() => seed(tree));

  const diagram = () =>
    cardFor("OQ-U1").querySelector<HTMLElement>(
      '[data-testid="mermaid-container"]',
    )!;

  it("keeps the sections back until the diagrams are drawn, which then render at once", async () => {
    let drawn: () => void = () => {};
    const asked: string[] = [];
    mermaid.draw = (code) => {
      asked.push(code);
      return new Promise<void>((resolve) => {
        drawn = resolve;
      });
    };
    await renderPage();
    expect(asked).toEqual([DIAGRAM]);
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    await act(async () => {
      drawn();
    });
    await settle();
    expect(diagram().querySelector("svg")).not.toBeNull();
    expect(diagram()).not.toHaveAttribute("data-planning-mermaid-frame");
  });

  it("past the Mermaid deadline, paints the card and frames the diagram at a fixed height", async () => {
    setPlanningLimitsForTests({ mermaidDeadlineMs: 10 });
    mermaid.draw = () => new Promise<void>(() => {});
    await renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();
    expect(diagram().querySelector("svg")).toBeNull();
    expect(diagram()).toHaveAttribute("data-planning-mermaid-frame");
    const body = cardFor("OQ-U1").querySelector<HTMLElement>(
      ".planning-card-body",
    )!;
    expect(body.style.getPropertyValue("--planning-mermaid-frame")).toBe(
      "240px",
    );
  });
});

describe("memoized cards (planning-index-at-scale.md §10.4)", () => {
  beforeEach(() => seed());

  it("renders no card of another document when one document's reviews answer", async () => {
    await renderPage();
    const before = new Map(viewerRenders);
    reviews["plans/unrouted.md"] = [
      {
        id: "elsewhere-0002",
        comment: "About something else",
        created_at: 0,
        reactions: [],
      },
    ];
    act(() =>
      usePlanningStore.getState().noteReviewChanged("", "plans/unrouted.md"),
    );
    await settle();
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith("/api/review", {
      params: { path: "plans/unrouted.md" },
    });
    // Its own card rendered again, and no card of any other document did.
    expect(viewerRenders.get("plans/unrouted.md")).toBeGreaterThan(
      before.get("plans/unrouted.md") ?? 0,
    );
    for (const path of [
      "plans/design.md",
      "plans/answered.md",
      "plans/disagrees.md",
    ]) {
      expect(viewerRenders.get(path), path).toBe(before.get(path));
    }
  });
});

describe("a preview card (planning-index-at-scale.md §10.4)", () => {
  // OQ-U1's card, 150-odd characters, is past a limit configured down to
  // 100; every other card of the tree is within it.
  const tree = {
    ...TREE,
    "plans/unrouted.md": doc(
      "stage: DESIGN",
      q("OQ-U1", OPEN).replace(
        "_Leaning:_ Yes.",
        "_Leaning:_ Yes, with a long enough reason to pass the limit.",
      ),
    ),
  };

  beforeEach(() => {
    setPlanningLimitsForTests({ cardChars: 100 });
    seed(tree);
  });

  it("draws a question past the size limit from the index alone, and asks for no block", async () => {
    const asked: CardWant[][] = [];
    serveTree(tree, "/api", (inline) => ({
      cards: (repo, want, options) => {
        asked.push(want);
        return inline.cards(repo, want, options);
      },
    }));
    await renderPage();
    const card = cardFor("OQ-U1");
    expect(card.querySelector("[data-planning-preview]")).not.toBeNull();
    expect(card).toHaveTextContent("OQ-U1: Question OQ-U1?");
    expect(card).toHaveTextContent("Open · Leaning: Yes.");
    expect(card.querySelector("[data-planning-card-unit]")).toBeNull();
    expect(
      within(card).getByRole("button", { name: "Show question" }),
    ).toBeTruthy();
    expect(
      within(card).getByRole("link", { name: "Open document" }),
    ).toBeTruthy();
    // Both need the rendered host for their anchor.
    expect(
      within(card).queryByRole("button", { name: "Take this leaning" }),
    ).toBeNull();
    expect(within(card).queryByRole("button", { name: "Answer…" })).toBeNull();
    expect(asked.flat().some((want) => want.path === "plans/unrouted.md")).toBe(
      false,
    );
  });

  it("renders the whole card in place on Show question, asked for in full", async () => {
    const asked: { want: CardWant[]; full: boolean | undefined }[] = [];
    serveTree(tree, "/api", (inline) => ({
      cards: (repo, want, options) => {
        asked.push({ want, full: options?.full });
        return inline.cards(repo, want, options);
      },
    }));
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-U1")).getByRole("button", { name: "Show question" }),
      );
    });
    await settle();
    const card = cardFor("OQ-U1");
    expect(card.querySelector("[data-planning-preview]")).toBeNull();
    expect(
      card.querySelector("[data-planning-card-unit]")?.textContent,
    ).toContain("a long enough reason to pass the limit");
    expect(
      within(card).getByRole("button", { name: "Take this leaning" }),
    ).toBeTruthy();
    expect(asked.at(-1)).toEqual({
      want: [
        {
          path: "plans/unrouted.md",
          hash: contentHash(tree["plans/unrouted.md"]),
          startLine: expect.any(Number),
        },
      ],
      full: true,
    });
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
    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      "/api/r/alpha/planning/reviews",
      { paths: expect.arrayContaining(["plans/design.md"]) },
    );
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
          lines: linesOfText(TREE["plans/unrouted.md"] ?? null),
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

describe("Copy answers across pages (planning-index-at-scale.md §10.5)", () => {
  const copyButton = () => screen.getByRole("button", { name: /Copy answers/ });
  const pendingCount = () => screen.getByTestId("pending-answers").textContent;

  /** A pending comment anchored at `line`, with `hash` as its block's. */
  const pendingAt = (
    id: string,
    comment: string,
    line: number,
    hash = "00000000",
  ): ReviewComment => ({
    id,
    comment,
    created_at: 0,
    reactions: [],
    anchor: {
      source_line: line,
      block_text_hash: hash,
      selection_offset: 0,
      selection_length: 0,
    },
  });

  const lineOf = (tree: Record<string, string>, id: string) =>
    readyOf(tree)
      .index.documents.flatMap((d) => d.questions)
      .find((x) => x.id === id)!.line;

  it("counts and copies a pending comment on a question no page shows", async () => {
    setPlanningLimitsForTests({ pageEntries: 2 });
    seed();
    // OQ-A1 is on Needs you's second page, so its card never renders.
    reviews["plans/answered.md"] = [
      pendingAt("placed-0001", "Ruled on page two", lineOf(TREE, "OQ-A1")),
    ];
    await renderPage();
    expect(screen.queryByRole("article", { name: /OQ-A1/ })).toBeNull();
    expect(pendingCount()).toBe("1");
    await act(async () => {
      fireEvent.click(copyButton());
    });
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toContain("## Review Comments for `plans/answered.md`");
    expect(payload).toContain("**Comment:** Ruled on page two");
    // Quoted from the lines the scanner handed over, as the whole text would.
    expect(payload).toBe(
      answersPayload([
        {
          path: "plans/answered.md",
          comments: reviews["plans/answered.md"],
          lines: linesOfText(TREE["plans/answered.md"] ?? null),
        },
      ]),
    );
  });

  // A comment filed on OQ-S1's line whose block text is the note beside it:
  // the rendered card finds it on the note, outside the question, and
  // placement, by line alone, would have put it on the question.
  const SCOPED = {
    ...TREE,
    "plans/scoped.md": doc(
      "stage: DESIGN",
      [
        `1. ${OPEN} **OQ-S1: Question OQ-S1?**`,
        "",
        '   <!-- vantage: oq id=OQ-S1 leaning="Yes." -->',
        "",
        "   _Leaning:_ Yes.",
        "",
        "2. A note beside it.",
        "",
      ].join("\n"),
    ),
  };

  /** The note's block hash, as the card's own pass stamps it. */
  async function noteHash(): Promise<string> {
    seed(SCOPED);
    await renderPage();
    const note = Array.from(
      cardFor("OQ-S1").querySelectorAll<HTMLElement>("[data-block-hash]"),
    ).find((el) => el.textContent?.includes("A note beside it."));
    const hash = note?.getAttribute("data-block-hash");
    cleanup();
    resetPlanningReviews();
    resetPlanningPageInputs();
    if (!hash) throw new Error("no note block");
    return hash;
  }

  it("takes a rendered card's own scoping over placement", async () => {
    const hash = await noteHash();
    reviews["plans/scoped.md"] = [
      pendingAt("moved-0001", "On the note", lineOf(SCOPED, "OQ-S1"), hash),
    ];
    seed(SCOPED);
    await renderPage();
    expect(cardFor("OQ-S1")).toBeTruthy();
    expect(pendingCount()).toBe("0");
  });

  it("places the same comment by its line when the card is on a page not shown", async () => {
    const hash = await noteHash();
    reviews["plans/scoped.md"] = [
      pendingAt("moved-0001", "On the note", lineOf(SCOPED, "OQ-S1"), hash),
    ];
    // Unrouted is OQ-X1, OQ-S1, OQ-U1: at one a page, OQ-S1 is on page 2.
    setPlanningLimitsForTests({ pageEntries: 1 });
    seed(SCOPED);
    await renderPage();
    expect(screen.queryByRole("article", { name: /OQ-S1/ })).toBeNull();
    expect(pendingCount()).toBe("1");
  });

  // "A card rendered this visit reports its exact scoping": flipping away
  // does not make the comment it found on the note OQ-S1's again, so Copy
  // answers holds the same comments on either page.
  it("keeps a card's own scoping after it is flipped off the page", async () => {
    const hash = await noteHash();
    reviews["plans/scoped.md"] = [
      pendingAt("moved-0001", "On the note", lineOf(SCOPED, "OQ-S1"), hash),
    ];
    // Unrouted's first page is OQ-X1 and OQ-S1, its second OQ-U1.
    setPlanningLimitsForTests({ pageEntries: 2 });
    seed(SCOPED);
    await renderPage();
    expect(pendingCount()).toBe("0");
    const flipUnrouted = async (label: "Next ›" | "‹ Previous") => {
      await act(async () => {
        fireEvent.click(
          within(
            screen.getByRole("navigation", { name: "Unrouted pages" }),
          ).getByRole("button", { name: label }),
        );
      });
      await settle();
    };
    await flipUnrouted("Next ›");
    expect(screen.queryByRole("article", { name: /OQ-S1/ })).toBeNull();
    expect(pendingCount()).toBe("0");
    await flipUnrouted("‹ Previous");
    expect(cardFor("OQ-S1")).toBeTruthy();
    expect(pendingCount()).toBe("0");
  });

  it("places by line again once the document's comments change after its card left", async () => {
    const hash = await noteHash();
    reviews["plans/scoped.md"] = [
      pendingAt("moved-0001", "On the note", lineOf(SCOPED, "OQ-S1"), hash),
    ];
    setPlanningLimitsForTests({ pageEntries: 2 });
    seed(SCOPED);
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("navigation", { name: "Unrouted pages" }),
        ).getByRole("button", { name: "Next ›" }),
      );
    });
    await settle();
    expect(pendingCount()).toBe("0");
    // Another comment on the document, which the card never saw: what it
    // read is no longer what the document has, so placement decides.
    reviews["plans/scoped.md"] = [
      ...reviews["plans/scoped.md"],
      pendingAt("added-0002", "On the question", lineOf(SCOPED, "OQ-S1")),
    ];
    act(() =>
      usePlanningStore.getState().noteReviewChanged("", "plans/scoped.md"),
    );
    await settle();
    expect(pendingCount()).toBe("2");
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
    expect(vi.mocked(axios.post)).not.toHaveBeenCalled();
  });
});
