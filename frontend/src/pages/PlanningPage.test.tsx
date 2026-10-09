/**
 * The planning page (`docs/reference/planning-index.md` §6): each section of
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
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigateFunction,
} from "react-router-dom";
import axios from "axios";
import {
  PLANNING_NOTICES,
  PLANNING_SECTION_GUIDE,
  buildPlanningIndex,
  derivePlanningSections,
  filterKeepsQuestion,
  parsePlanningFilter,
  planningAgentRequest,
  type PlanningQuestionKeeper,
  sectionExplanation,
  type PlanningConfig,
  type PlanningSources,
} from "vantage-md/planning";
import { filterSummaryOf, sectionsOf } from "../lib/planningPages";

/** The question test of the filter `text`, which `compact` reads. */
const keepsOf = (text: string): PlanningQuestionKeeper => {
  const filter = parsePlanningFilter(text);
  if (filter.kind !== "understood") throw new Error(`not understood: ${text}`);
  return (q) => filterKeepsQuestion(filter, q);
};
import { VIEWER_RELEASE } from "../lib/viewerRelease";
import { PlanningPage } from "./PlanningPage";
import { AppShell } from "../components/AppShell";
import { FILTER_HINT } from "../components/PlanningFilterLine";
import {
  fetchPlanningReviews,
  resetPlanningReviews,
} from "../hooks/usePlanningReviews";
import { resetRepoRootsForTests } from "../hooks/useRepoRoot";
import {
  heldPlanningPageInputs,
  prefetchPlanningPage,
  resetPlanningPageInputs,
} from "../hooks/usePlanningPageInputs";
import { clearMermaidCache } from "../../../packages/vantage-md/src/mermaidCache";
import { run } from "../../../packages/vantage-check/src/cli";
import { bufferIo } from "../../../packages/vantage-check/src/io";
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
import {
  contentHash,
  filterForms,
  planningConfig,
  questionDirective,
  readRepoFile,
  sourcesOf,
} from "../test/planning";
import { fakePlanningServer } from "../test/planningStream";
import { planningCardId } from "../lib/planningCardId";
import {
  PLANNING_SPACE_MESSAGES,
  resetPlanningSpacesForTests,
} from "../lib/planningSpace";
import { planningRowId } from "../lib/planningOutline";
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
 * The page's warm-up of the Markdown pipeline (`lib/warmMarkdown.ts`), which
 * a page opened before its index was ready runs before its first sections
 * render: done at once, unless a test holds it back.
 */
const warming = vi.hoisted(() => ({
  runs: 0,
  run: (): Promise<void> => Promise.resolve(),
}));
vi.mock("../lib/warmMarkdown", () => ({
  warmMarkdown: () => {
    warming.runs += 1;
    return warming.run();
  },
}));

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
    `   ${questionDirective(marker, id, leaning)}`,
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

/**
 * The corpus with OQ-U1's document on the roadmap too, so it is a card of
 * Needs you in a document of its own: what the suites of a card's inputs
 * read, since Not on a roadmap lists rows (planning-to-do-list.md §3.4).
 */
const ROUTED: Record<string, string> = {
  ...TREE,
  "roadmap.md": `${TREE["roadmap.md"]}3. [The other](plans/unrouted.md) next.\n`,
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

/** What the app shell reads for its sidebar and banner, or `undefined`. */
function shellAnswer(url: string): unknown {
  const { pathname } = new URL(url, "http://localhost");
  if (pathname === "/api/degraded") return [];
  if (pathname === "/api/starred") return { entries: [] };
  if (pathname.endsWith("/tree") || pathname.endsWith("/git/recent")) {
    return [];
  }
  return undefined;
}

/** Every GET for one document's review, which the page must never send. */
const reviewGets = () =>
  vi
    .mocked(axios.get)
    .mock.calls.filter(([url]) => String(url).endsWith("/review"));

let reviews: Record<string, ReviewComment[]>;

function serveReviews(): void {
  vi.mocked(axios.get).mockImplementation(async (url, config) => {
    // The app shell's own reads: the sidebar's bookmarks, file tree and
    // recent files, and the degradation banner's list. None to show.
    const shell = shellAnswer(String(url));
    if (shell !== undefined) return { data: shell };
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

/**
 * Animation frames, each run on a task of its own — or held back while a test
 * says so, until {@link releaseFrames}. The page's first sections wait for its
 * frame to have painted, an animation frame and a task after it
 * (`lib/afterPaint.ts`); jsdom's own frames come every 16 ms, which `settle`
 * does not wait for.
 */
const frames = {
  held: false,
  next: 0,
  pending: new Map<number, FrameRequestCallback>(),
};
function runFrame(id: number): void {
  const callback = frames.pending.get(id);
  if (callback === undefined) return;
  frames.pending.delete(id);
  callback(performance.now());
}
async function releaseFrames(): Promise<void> {
  frames.held = false;
  await act(async () => {
    for (const id of [...frames.pending.keys()]) runFrame(id);
  });
  await settle();
}
let frameSpies: { mockRestore(): void }[] = [];

beforeEach(() => {
  // Most suites read the folded groups' rows, so their visits open them;
  // the suite of the groups themselves clears this.
  openGroups();
  frames.held = false;
  frames.pending.clear();
  frameSpies = [
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++frames.next;
      frames.pending.set(id, callback);
      if (!frames.held) setTimeout(() => runFrame(id), 0);
      return id;
    }),
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.pending.delete(id);
    }),
  ];
  warming.runs = 0;
  warming.run = () => Promise.resolve();
  resetPlanningTrackers();
  resetPlanningReviews();
  resetPlanningPageInputs();
  resetPlanningSpacesForTests();
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
  for (const spy of frameSpies) spy.mockRestore();
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
const router: {
  location: string;
  hash: string;
  navigate: NavigateFunction | null;
  /** Every location's key, in the order they came: one per navigation. */
  keys: string[];
  /** How each of them came: `PUSH`, `REPLACE` or `POP`. */
  types: string[];
} = {
  location: "",
  hash: "",
  navigate: null,
  keys: [],
  types: [],
};
function RouterProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    router.location = `${location.pathname}${location.search}`;
    router.hash = location.hash;
    router.navigate = navigate;
    if (router.keys.at(-1) !== location.key) {
      router.keys.push(location.key);
      router.types.push(navigationType);
    }
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
        <Route element={<AppShell />}>
          <Route path="/.vantage/planning/*" element={<PlanningPage />} />
          <Route path="/*" element={<div data-testid="viewer">viewer</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return view;
}

/**
 * What the page's own column holds: the degradation banner beside it has a
 * live region too, a status of its own.
 */
const inPage = () => within(screen.getByRole("main"));
/** The pane, which is what scrolls in the app shell. */
const scroller = () =>
  document.querySelector<HTMLElement>("[data-content-scroll]")!;
/**
 * Every assignment to any element's `scrollTop` until `restore`, by element
 * and value: how a scroll the page makes is seen, where jsdom lays nothing
 * out.
 */
function watchScrollTop() {
  const own = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
  const spy = vi.fn<(el: Element, value: number) => void>();
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get: own.get,
    set(this: Element, value: number) {
      spy(this, value);
      own.set!.call(this, value);
    },
  });
  return Object.assign(spy, {
    restore: () => Object.defineProperty(Element.prototype, "scrollTop", own),
  });
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
/**
 * Every question a section lists, as a card or as a one-line row, by the
 * question each names: *Needs you*'s answered rows, and the folded groups'
 * rows (planning-to-do-list.md §3.3, §3.4).
 */
const listedIn = (name: string) =>
  Array.from(
    section(name).querySelectorAll(
      "article, [data-planning-row], [data-planning-group-question]",
    ),
    (el) => el.getAttribute("aria-label"),
  );
/** *Needs you*'s answered rows, by the question each names. */
const rowsIn = () =>
  Array.from(
    section("Needs you").querySelectorAll("[data-planning-row]"),
    (el) => el.getAttribute("aria-label"),
  );
/** Open both folded groups for the visits that follow, as a reader would. */
const openGroups = () => {
  localStorage.setItem("vantage:planningBlockedOpen", "true");
  localStorage.setItem("vantage:planningMaintenanceOpen", "true");
};
/** The page size the visits that follow lay *Needs you* out with. */
const pageSize = (n: number) => {
  setPlanningLimitsForTests({ pageSizes: [n, 20, 30, 50], defaultPageSize: n });
};
const cardFor = (id: string) =>
  screen.getByRole("article", { name: `${id}: Question ${id}?` });
/**
 * The document's name at the top of a card, which opens the document in this
 * tab and saves the page's place first; Open document opens a new tab.
 */
const nameLink = (id: string, path: string) =>
  within(cardFor(id)).getByRole("link", { name: path });
/**
 * Copy answers' accessible name, and not its neighbour Copy answers +
 * maintenance's (planning-to-do-list.md §5).
 */
const COPY_ANSWERS = /^(Copy answers|Copied)(?! \+)/;
/** Open document's accessible name, which says what its icon does. */
const OPEN_DOCUMENT = "Open document (opens in a new tab)";
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

  it("lists routed open questions under Needs you, in roadmap order, and a ✅ one under Maintenance (planning-to-do-list.md §3.3)", async () => {
    await renderPage();
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
    ]);
    expect(listedIn("To fold into the ledger")).toEqual([
      "OQ-A1: Question OQ-A1?",
    ]);
  });

  it("lists open questions nothing routes under Not on a roadmap, a done document's aside", async () => {
    await renderPage();
    expect(listedIn("Not on a roadmap")).toEqual([
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
    expect(
      screen.queryByRole("article", { name: "OQ-G1: Question OQ-G1?" }),
    ).toBeNull();
  });

  it("lists blocked questions and waiting documents under Blocked", async () => {
    await renderPage();
    expect(listedIn("Blocked")).toEqual(["OQ-D2: Question OQ-D2?"]);
    expect(documentsIn("Blocked")).toEqual(["plans/deps.md"]);
    const waits = within(section("Blocked")).getByText(/blocked on/);
    expect(
      within(waits).getByRole("link", { name: "design.md#OQ-D1" }),
    ).toHaveAttribute("href", "/plans/design.md#OQ-D1");
    expect(
      within(waits).getByRole("img", { name: "open question" }),
    ).toBeTruthy();
  });

  // §6.2's Stage conflict holds both roles, and the checker's matching finding
  // tells them apart; the page said "decided" for both.
  it("says a Stage conflict row's stage is built or decided, by its role", async () => {
    seed({
      ...TREE,
      "plans/built-open.md": doc("stage: BUILT", q("OQ-Y1", OPEN)),
    });
    await renderPage();
    const rows = section("Stage conflict");
    const rowOf = (path: string) =>
      rows.querySelector(`[data-planning-document="${path}"]`)!.textContent;
    expect(rowOf("plans/built-open.md")).toContain(
      "Its stage says it is built, and it still has open questions.",
    );
    expect(rowOf("plans/disagrees.md")).toContain(
      "Its stage says it is decided, and it still has open questions.",
    );
  });

  it("lists Ready to build, Ready to graduate and Stage conflict by stage", async () => {
    await renderPage();
    expect(documentsIn("Ready to build")).toEqual(["plans/ready.md"]);
    expect(documentsIn("Ready to graduate")).toEqual(["plans/built.md"]);
    expect(documentsIn("Stage conflict")).toEqual(["plans/disagrees.md"]);
    // Each by name, with its badge.
    expect(
      within(section("Ready to build")).getByRole("link", {
        name: "plans/ready.md",
      }),
    ).toHaveAttribute("href", "/plans/ready.md");
    expect(
      within(section("Ready to build")).getByRole("img", {
        name: "accepted, decided",
      }),
    ).toBeTruthy();
  });

  it("lists Too large and Unreadable", async () => {
    seed(
      TREE,
      { stages: STAGES },
      {
        skipped: [{ path: "docs/huge.md", size: 2 * 1024 * 1024 }],
        unreadable: [{ path: "docs/latin1.md", reason: "not UTF-8" }],
      },
    );
    await renderPage();
    expect(section("Too large")).toHaveTextContent(
      "docs/huge.md 2.0 MiB, over max-file-bytes (1.0 MiB)",
    );
    expect(section("Unreadable")).toHaveTextContent("docs/latin1.md not UTF-8");
  });

  it("puts Needs you first, then the folded groups, Maintenance's kinds in their order (planning-to-do-list.md §3.4)", async () => {
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
        .map((h) => h.textContent?.replace(/ [\d,]+(?: .*)?$/, "")),
    ).toEqual(["Needs you", "Blocked", "Maintenance"]);
    expect(
      within(section("Maintenance"))
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent?.replace(/ [\d,]+$/, "")),
    ).toEqual([
      "Not on a roadmap",
      "Ready to build",
      "Ready to graduate",
      "Stage conflict",
      "To fold into the ledger",
      "Too large",
      "Unreadable",
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
      "Not on a roadmap",
      "Blocked",
      "Ready to build",
      "Ready to graduate",
      "Stage conflict",
      "Too large",
      "Unreadable",
    ]) {
      expect(querySection(name), name).toBeNull();
    }
  });

  it("says Nothing needs you, with only ✅ questions left, which Maintenance lists to fold into the ledger", async () => {
    seed({
      "roadmap.md": "# Roadmap\n\n- [Settled](plans/answered.md)\n",
      "plans/answered.md": TREE["plans/answered.md"],
    });
    await renderPage();
    const line = screen.getByTestId("nothing-needs-you");
    expect(line).toHaveTextContent(PLANNING_NOTICES.nothingNeedsYou);
    expect(querySection("Needs you")).toBeNull();
    expect(listedIn("To fold into the ledger")).toEqual([
      "OQ-A1: Question OQ-A1?",
    ]);
  });

  it("without a roadmap, lists every open question under Needs you by document, and drops Not on a roadmap", async () => {
    const { "roadmap.md": _, ...noRoadmap } = TREE;
    void _;
    seed(noRoadmap);
    await renderPage();
    // Found by name, and nothing is named roadmap.md.
    expect(screen.getByTestId("roadmap-notice")).toHaveTextContent(
      PLANNING_NOTICES.roadmapNotice(planningConfig({ stages: STAGES }), [])!,
    );
    expect(querySection("Not on a roadmap")).toBeNull();
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
  });

  it("names the configured roadmap when it is missing", async () => {
    const config = { stages: STAGES, roadmaps: ["plans/roadmap.md"] };
    seed(TREE, config);
    await renderPage();
    expect(screen.getByTestId("roadmap-notice")).toHaveTextContent(
      PLANNING_NOTICES.roadmapNotice(planningConfig(config), [
        { path: "plans/roadmap.md", state: "missing", needsYouCount: 0 },
      ])!,
    );
    expect(querySection("Not on a roadmap")).toBeNull();
  });

  it("names each roadmap it found by name and why none routes", async () => {
    // roadmap.md retired by a done stage, and plans/roadmap.md too large.
    const tree = {
      ...TREE,
      "roadmap.md": `---\nstage: GONE\n---\n\n${TREE["roadmap.md"]}`,
      "plans/roadmap.md": "# Too large\n",
    };
    seed(
      tree,
      { stages: STAGES },
      {
        files: Object.entries(tree)
          .filter(([path]) => path !== "plans/roadmap.md")
          .map(([path, content]) => ({ path, content })),
        skipped: [{ path: "plans/roadmap.md", size: 2_000_000 }],
      },
    );
    await renderPage();
    expect(screen.getByTestId("roadmap-notice")).toHaveTextContent(
      PLANNING_NOTICES.roadmapNotice(planningConfig({ stages: STAGES }), [
        { path: "roadmap.md", state: "done", needsYouCount: 0 },
        { path: "plans/roadmap.md", state: "skipped", needsYouCount: 0 },
      ])!,
    );
    expect(screen.queryByRole("combobox", { name: "Roadmap" })).toBeNull();
    expect(querySection("Not on a roadmap")).toBeNull();
    expect(cardsIn("Needs you")).toContain("OQ-U1: Question OQ-U1?");
  });

  it("says so when roadmap under [planning] is an empty list", async () => {
    const config = { stages: STAGES, roadmaps: [] };
    seed(TREE, config);
    await renderPage();
    expect(screen.getByTestId("roadmap-notice")).toHaveTextContent(
      PLANNING_NOTICES.roadmapNotice(planningConfig(config), [])!,
    );
    expect(querySection("Not on a roadmap")).toBeNull();
  });

  it("names a listed roadmap it could not read while another routes", async () => {
    const config = {
      stages: STAGES,
      roadmaps: ["roadmap.md", "plans/next/roadmap.md"],
    };
    seed(TREE, config);
    await renderPage();
    const notice = PLANNING_NOTICES.roadmapNotice(planningConfig(config), [
      { path: "roadmap.md", state: "routes", needsYouCount: 3 },
      { path: "plans/next/roadmap.md", state: "missing", needsYouCount: 0 },
    ]);
    expect(notice).toMatch(/^Not read as a roadmap/);
    expect(screen.getByTestId("roadmap-notice")).toHaveTextContent(notice!);
    // The one that routes still orders Needs you, with no picker for one.
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
    ]);
    expect(screen.queryByRole("combobox", { name: "Roadmap" })).toBeNull();
  });

  it("without stages, drops the three stage sections and says how to declare them", async () => {
    seed(TREE, { stages: null });
    await renderPage();
    expect(screen.getByText(PLANNING_NOTICES.noStages)).toBeTruthy();
    expect(querySection("Ready to build")).toBeNull();
    expect(querySection("Ready to graduate")).toBeNull();
    expect(querySection("Stage conflict")).toBeNull();
    // Needs you, Not on a roadmap and Blocked need only questions and links.
    expect(querySection("Needs you")).not.toBeNull();
    expect(querySection("Blocked")).not.toBeNull();
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

  it("shows a progress line where the sections will be while the first scan runs", async () => {
    setLoad({ status: "loading", warm: false, progress: null });
    await renderPage();
    expect(inPage().getByRole("status")).toHaveTextContent(
      "Reading planning documents…",
    );
    setLoad({
      status: "loading",
      warm: false,
      progress: { done: 412, total: 1000 },
    });
    expect(inPage().getByRole("status")).toHaveTextContent(
      "Scanning planning documents: 412 of 1,000",
    );
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("replaces the progress line with the sections in one commit", async () => {
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
    expect(inPage().getByRole("status")).toHaveTextContent(
      "Scanning planning documents",
    );
    release();
    await settle();
    expect(inPage().queryByRole("status")).toBeNull();
    // No section bar (planning-to-do-list.md §3.5).
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(listedIn("Not on a roadmap")).toHaveLength(2);
  });

  // D6 (planning-index.md §6.10, §18): the pipeline's first run in a
  // page load costs several times any later one, and one card's Markdown is a
  // task React cannot split.
  it("runs the Markdown pipeline once while the index builds, after the frame paints, and renders the sections only after it", async () => {
    serveTree(TREE);
    setLoad({ status: "loading", warm: false, progress: null });
    let warmed: () => void = () => {};
    warming.run = () =>
      new Promise<void>((resolve) => {
        warmed = resolve;
      });
    frames.held = true;
    await renderPage();
    // Not before the frame has painted.
    expect(warming.runs).toBe(0);
    await releaseFrames();
    expect(warming.runs).toBe(1);

    setLoad(readyOf(TREE));
    await settle();
    // The index and the page's inputs are in hand; the warm-up is not done.
    expect(inPage().getByRole("status")).toHaveTextContent(
      "Scanning planning documents",
    );
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    await act(async () => warmed());
    await settle();
    expect(listedIn("Not on a roadmap")).toHaveLength(2);
    expect(warming.runs).toBe(1);
  });

  it("runs no warm-up on a page opened with its index ready", async () => {
    seed();
    await renderPage();
    expect(listedIn("Not on a roadmap")).toHaveLength(2);
    expect(warming.runs).toBe(0);
  });
});

/**
 * A pending comment typed on `id`'s title in its document, the first line
 * of its unit — not the leaning's block, which a take anchors on.
 */
function typedOnTitle(
  tree: Record<string, string>,
  id: string,
  patch: Partial<ReviewComment> = {},
): { path: string; comment: ReviewComment } {
  const question = readyOf(tree)
    .index.documents.flatMap((d) => d.questions)
    .find((x) => x.id === id)!;
  expect(question.unitLine).not.toBe(question.line);
  return {
    path: question.path,
    comment: {
      id: `typed-${id}`,
      comment: `My answer to ${id}.`,
      created_at: 0,
      reactions: [],
      anchor: {
        source_line: question.unitLine,
        block_text_hash: "00000000",
        selection_offset: 0,
        selection_length: 0,
      },
      ...patch,
    },
  };
}

/** A pending comment of yours on each of `ids`, in the review store. */
function answer(tree: Record<string, string>, ...ids: string[]): void {
  for (const id of ids) {
    const { path, comment } = typedOnTitle(tree, id);
    reviews[path] = [...(reviews[path] ?? []), comment];
  }
}

/** A review change pushed for `path`, as the socket says one landed. */
async function reviewPushed(path: string): Promise<void> {
  act(() => usePlanningStore.getState().noteReviewChanged("", path));
  await settle();
}

/* ------------------------------------------------------------------ *
 * Needs you as a to-do list (planning-to-do-list.md §3.3, §7)
 * ------------------------------------------------------------------ */

/** A roadmap routing `count` open questions of one document, OQ-T1 on. */
function todoTree(count: number, extra: Record<string, string> = {}) {
  const ids = Array.from({ length: count }, (_, i) => `OQ-T${i + 1}`);
  return {
    "roadmap.md": "# Roadmap\n\n1. [The list](plans/todo.md)\n",
    "plans/todo.md": doc("stage: DESIGN", ...ids.map((id) => q(id, OPEN))),
    ...extra,
  };
}

const cardIds = () =>
  cardsIn("Needs you").map((name) => name!.replace(/: .*/, ""));
const rowIds = () => rowsIn().map((name) => name!.replace(/: .*/, ""));
const endLine = () => screen.getByTestId("needs-you-end");
const updatesButton = () =>
  document.querySelector<HTMLButtonElement>("[data-planning-updates]")!;
const updatesCount = () => screen.getByTestId("planning-updates-count");
const refresh = async () => {
  await act(async () => {
    fireEvent.click(updatesButton());
  });
  await settle();
};

describe("Needs you as a to-do list (planning-to-do-list.md §3.3)", () => {
  it("shows the page size of questions that need you as cards, and counts the rest on the end line", async () => {
    pageSize(2);
    seed(todoTree(5));
    await renderPage();
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2"]);
    expect(endLine()).toHaveTextContent(
      /^3 more need you · show 2 \| 20 \| 30 \| 50$/,
    );
    // The heading counts every question that needs you, whatever the size.
    expect(
      within(section("Needs you")).getByRole("heading", { level: 2 }),
    ).toHaveTextContent(/^Needs you 5$/);
  });

  it("defaults to 10 a page, from the sizes 10, 20, 30 and 50", async () => {
    seed(todoTree(12));
    await renderPage();
    expect(cardIds()).toHaveLength(10);
    expect(
      within(endLine())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["10", "20", "30", "50"]);
    expect(
      within(endLine()).getByRole("button", { name: "10" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("takes a size chosen on the end line at once, and remembers it in this browser", async () => {
    pageSize(2);
    seed(todoTree(5));
    await renderPage();
    await act(async () => {
      fireEvent.click(within(endLine()).getByRole("button", { name: "20" }));
    });
    await settle();
    expect(cardIds()).toHaveLength(5);
    expect(endLine()).toHaveTextContent(/^show 2 \| 20 \| 30 \| 50$/);
    expect(readPreference("vantage:planningPageSize")).toBe("20");
    cleanup();
    await renderPage();
    expect(cardIds()).toHaveLength(5);
  });

  it("puts the answered rows first, the first five shown, and … N more answered opens the rest in place", async () => {
    pageSize(2);
    const tree = todoTree(9);
    seed(tree);
    answer(tree, "OQ-T2", "OQ-T3", "OQ-T4", "OQ-T5", "OQ-T6", "OQ-T7");
    await renderPage();
    expect(rowIds()).toEqual(["OQ-T2", "OQ-T3", "OQ-T4", "OQ-T5", "OQ-T6"]);
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T8"]);
    expect(
      within(section("Needs you")).getByRole("heading", { level: 2 }),
    ).toHaveTextContent("Needs you 3 · 6 answered");
    expect(section("Needs you")).toHaveTextContent("… 1 more answered · Show");
    // Each row is one line: its id, title, chip and Show.
    const row = screen.getByRole("group", { name: "OQ-T2: Question OQ-T2?" });
    expect(row).toHaveTextContent("Answered — waiting on the agent");
    expect(within(row).getByRole("button", { name: /^Show/ })).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        section("Needs you").querySelector("[data-planning-more-answered]")!,
      );
    });
    await settle();
    expect(rowIds()).toHaveLength(6);
    expect(section("Needs you")).not.toHaveTextContent("more answered");
  });

  it("opens an answered row into its card where it stands on Show", async () => {
    pageSize(2);
    const tree = todoTree(3);
    seed(tree);
    answer(tree, "OQ-T1");
    await renderPage();
    expect(rowIds()).toEqual(["OQ-T1"]);
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("group", { name: "OQ-T1: Question OQ-T1?" }),
        ).getByRole("button", { name: /^Show/ }),
      );
    });
    await settle();
    expect(rowIds()).toEqual([]);
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2", "OQ-T3"]);
    expect(
      within(cardFor("OQ-T1")).getByText(/My answer to OQ-T1/),
    ).toBeTruthy();
  });

  it("ignores an old address's page parameters, and the in-place rewrite drops them (§7)", async () => {
    pageSize(2);
    seed(todoTree(5));
    await renderPage("/.vantage/planning?needs-you=2&other=x");
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2"]);
    expect(router.location).toBe("/.vantage/planning?other=x");
  });

  it("paints every full card of a layout in one commit, whatever the page size (§7)", async () => {
    pageSize(5);
    const tree = todoTree(8);
    let release: () => void = () => {};
    serveTree(tree, "/api", (inline) => ({
      cards: (repo, want, options) =>
        new Promise<CardAnswer[]>((resolve) => {
          release = () => resolve(inline.cards(repo, want, options));
        }),
    }));
    setLoad(readyOf(tree));
    await renderPage();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    const counts: number[] = [];
    const observer = new MutationObserver(() =>
      counts.push(document.querySelectorAll("article").length),
    );
    observer.observe(document.body, { childList: true, subtree: true });
    release();
    await settle();
    observer.disconnect();
    expect(cardIds()).toHaveLength(5);
    // No commit painted some of the cards and not the rest.
    expect(counts.filter((n) => n > 0 && n < 5)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * What moves, and who moves it (planning-to-do-list.md §4)
 * ------------------------------------------------------------------ */

describe("your own actions (planning-to-do-list.md §4.1)", () => {
  it("shrinks a card answered here to a row where it was, and the next question joins the cards", async () => {
    pageSize(2);
    const tree = todoTree(4);
    seed(tree);
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-T1")).getByRole("button", {
          name: "Take this leaning",
        }),
      );
    });
    await settle();
    // Nothing reorders: the row stands where its card was.
    expect(
      Array.from(
        section("Needs you").querySelectorAll("[data-planning-item]"),
        (el) => el.getAttribute("aria-label")!.replace(/: .*/, ""),
      ),
    ).toEqual(["OQ-T1", "OQ-T2", "OQ-T3"]);
    expect(rowIds()).toEqual(["OQ-T1"]);
    expect(cardIds()).toEqual(["OQ-T2", "OQ-T3"]);
    expect(
      screen.getByRole("group", { name: "OQ-T1: Question OQ-T1?" }),
    ).toHaveTextContent("Leaning taken");
    expect(endLine()).toHaveTextContent(/^1 more needs you/);
    // An action of your own is no held update.
    expect(updatesButton()).toHaveAttribute("aria-hidden", "true");
  });

  it("shrinks a card when its Answer… box closes holding text, never as it is typed in", async () => {
    pageSize(2);
    seed(todoTree(3));
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-T1")).getByRole("button", { name: "Answer…" }),
      );
    });
    const box = await screen.findByPlaceholderText(/comment/i);
    fireEvent.change(box, { target: { value: "The second way." } });
    await settle();
    // Typing never shrinks it.
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2"]);
    // Past the pause, the box has saved what it holds: the review answers
    // the question now, and it is still no late data of anyone else's.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });
    await settle();
    expect(reviews["plans/todo.md"]?.[0]?.comment).toBe("The second way.");
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2"]);
    expect(
      cardFor("OQ-T1").querySelector(
        '[data-planning-mark="answered-elsewhere"]',
      ),
    ).toBeNull();
    expect(updatesButton()).toHaveAttribute("aria-hidden", "true");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    });
    await settle();
    expect(rowIds()).toEqual(["OQ-T1"]);
    expect(cardIds()).toEqual(["OQ-T2", "OQ-T3"]);
    expect(updatesButton()).toHaveAttribute("aria-hidden", "true");
    // The focus, whose control the shrink took away, goes to the row's Show.
    expect(document.activeElement).toBe(
      within(
        screen.getByRole("group", { name: "OQ-T1: Question OQ-T1?" }),
      ).getByRole("button", { name: /^Show/ }),
    );
  });

  it("opens the row back into its card on Undo, and keeps the card that joined", async () => {
    pageSize(2);
    const tree = todoTree(4);
    seed(tree);
    vi.mocked(axios.delete).mockImplementation(async (url, config) => {
      const path = (config?.params as { path: string }).path;
      const id = String(url).split("/").pop();
      reviews[path] = (reviews[path] ?? []).filter((c) => c.id !== id);
      return { data: { file_path: path, comments: reviews[path] } };
    });
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-T1")).getByRole("button", {
          name: "Take this leaning",
        }),
      );
    });
    await settle();
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("group", { name: "OQ-T1: Question OQ-T1?" }),
        ).getByRole("button", { name: /Undo/ }),
      );
    });
    await settle();
    expect(rowIds()).toEqual([]);
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2", "OQ-T3"]);
    expect(
      within(cardFor("OQ-T1")).getByRole("button", {
        name: "Take this leaning",
      }),
    ).toBeTruthy();
  });

  it("makes a new layout on Refresh, gathering the answered rows at the top", async () => {
    pageSize(2);
    const tree = todoTree(4);
    seed(tree);
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-T2")).getByRole("button", {
          name: "Take this leaning",
        }),
      );
    });
    await settle();
    await refresh();
    expect(rowIds()).toEqual(["OQ-T2"]);
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T3"]);
    expect(
      section("Needs you").querySelector("[data-planning-item]"),
    ).toHaveAttribute("data-planning-row");
  });

  it("opens and closes a folded group in place, closed until opened and remembered per group (§3.4)", async () => {
    localStorage.clear();
    seed();
    await renderPage();
    const toggle = (name: RegExp) =>
      screen.getByRole("button", { name, expanded: false });
    expect(querySection("Not on a roadmap")).toBeNull();
    expect(screen.queryByRole("group", { name: /OQ-D2/ })).toBeNull();
    await act(async () => {
      fireEvent.click(toggle(/^Maintenance/));
    });
    await settle();
    expect(listedIn("Not on a roadmap")).toEqual([
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
    expect(readPreference("vantage:planningMaintenanceOpen")).toBe("true");
    expect(readPreference("vantage:planningBlockedOpen")).toBeNull();
    // The next visit opens it as it was left, and Blocked still closed.
    cleanup();
    await renderPage();
    expect(listedIn("Not on a roadmap")).toHaveLength(2);
    expect(toggle(/^Blocked/)).toBeTruthy();
  });
});

describe("the focus, where the reader's own action takes its control away (§4.1)", () => {
  it("goes to the row's Show when Take this leaning shrinks the card", async () => {
    pageSize(2);
    seed(todoTree(3));
    await renderPage();
    const take = within(cardFor("OQ-T1")).getByRole("button", {
      name: "Take this leaning",
    });
    take.focus();
    await act(async () => {
      fireEvent.click(take);
    });
    await settle();
    expect(document.activeElement).toBe(
      within(
        screen.getByRole("group", { name: "OQ-T1: Question OQ-T1?" }),
      ).getByRole("button", { name: /^Show/ }),
    );
  });

  it("goes to the opened card's heading on Show", async () => {
    pageSize(2);
    const tree = todoTree(3);
    seed(tree);
    answer(tree, "OQ-T1");
    await renderPage();
    const show = within(
      screen.getByRole("group", { name: "OQ-T1: Question OQ-T1?" }),
    ).getByRole("button", { name: /^Show/ });
    show.focus();
    await act(async () => {
      fireEvent.click(show);
    });
    await settle();
    expect(document.activeElement).toBe(
      within(cardFor("OQ-T1")).getByRole("heading", { level: 3 }),
    );
  });

  it("goes to the first row … N more answered shows", async () => {
    pageSize(2);
    const tree = todoTree(8);
    seed(tree);
    answer(tree, "OQ-T1", "OQ-T2", "OQ-T3", "OQ-T4", "OQ-T5", "OQ-T6");
    await renderPage();
    const more = section("Needs you").querySelector<HTMLButtonElement>(
      "[data-planning-more-answered]",
    )!;
    more.focus();
    await act(async () => {
      fireEvent.click(more);
    });
    await settle();
    expect(document.activeElement).toBe(
      within(
        screen.getByRole("group", { name: "OQ-T6: Question OQ-T6?" }),
      ).getByRole("button", { name: /^Show/ }),
    );
  });

  it("goes after Refresh to the item it kept in place, else Needs you's heading", async () => {
    pageSize(2);
    const tree = todoTree(3);
    seed(tree);
    await renderPage();
    answer(tree, "OQ-T1");
    await reviewPushed("plans/todo.md");
    updatesButton().focus();
    await refresh();
    // jsdom lays nothing out, so no item is on screen to keep.
    expect(document.activeElement).toBe(
      within(section("Needs you")).getByRole("heading", { level: 2 }),
    );
  });
});

describe("a group the layout did not have (§4.2)", () => {
  it("is not drawn until the next layout: its items count in the updates slot", async () => {
    pageSize(2);
    const tree = todoTree(2);
    seed(tree);
    await renderPage();
    expect(querySection("Blocked")).toBeNull();
    expect(querySection("Maintenance")).toBeNull();
    const after = {
      ...tree,
      "plans/todo.md": doc(
        "stage: DESIGN",
        q("OQ-T1", OPEN),
        q("OQ-T2", OPEN),
        q("OQ-T3", BLOCKED),
      ),
      "plans/ready.md": doc("status: accepted\nstage: DECIDED", "Decided."),
    };
    serveTree(after);
    setLoad(readyOf(after));
    await settle();
    expect(querySection("Blocked")).toBeNull();
    expect(querySection("Maintenance")).toBeNull();
    expect(updatesButton()).toHaveAttribute(
      "title",
      expect.stringContaining("new under Blocked"),
    );
    await refresh();
    expect(querySection("Blocked")).not.toBeNull();
    expect(querySection("Maintenance")).not.toBeNull();
  });

  it("names in Maintenance's heading only the kinds the layout has, their numbers live", async () => {
    const tree = todoTree(1, {
      "plans/ready.md": doc("status: accepted\nstage: DECIDED", "Decided."),
    });
    seed(tree);
    await renderPage();
    const kinds = () => screen.getByTestId("maintenance-kinds");
    expect(kinds()).toHaveTextContent(/^· 1 ready to build$/);
    const after = {
      ...tree,
      "plans/ready2.md": doc("status: accepted\nstage: DECIDED", "Decided."),
      "plans/built.md": doc("status: accepted\nstage: BUILT", "Built."),
    };
    serveTree(after);
    setLoad(readyOf(after));
    await settle();
    expect(kinds()).toHaveTextContent(/^· 2 ready to build$/);
    await refresh();
    expect(kinds()).toHaveTextContent(/^· 2 ready to build · 1 to graduate$/);
  });
});

describe("the end line follows the layout on screen (§3.3)", () => {
  it("never says Nothing needs you while a full card is still painted", async () => {
    pageSize(2);
    const tree = todoTree(1);
    seed(tree);
    await renderPage();
    answer(tree, "OQ-T1");
    await reviewPushed("plans/todo.md");
    expect(cardIds()).toEqual(["OQ-T1"]);
    expect(endLine()).not.toHaveTextContent("Nothing needs you");
    await refresh();
    expect(endLine()).toHaveTextContent("Nothing needs you");
  });
});

describe("a card a row opens into (§4.1)", () => {
  it("is drawn from the document as it is at the layout, after an edit and Refresh", async () => {
    pageSize(2);
    // Its block, in a document of its own, is past those a layout fetches
    // ahead, so Show fetches it.
    const tree = {
      ...todoTree(9),
      "roadmap.md":
        "# Roadmap\n\n1. [The list](plans/todo.md)\n2. [Late](plans/late.md)\n",
      "plans/late.md": doc("stage: DESIGN", q("OQ-T10", OPEN)),
    };
    seed(tree);
    answer(tree, "OQ-T10");
    await renderPage();
    const show = async () => {
      await act(async () => {
        fireEvent.click(
          within(
            screen.getByRole("group", { name: "OQ-T10: Question OQ-T10?" }),
          ).getByRole("button", { name: /^Show/ }),
        );
      });
      await settle();
    };
    await show();
    expect(cardFor("OQ-T10")).not.toHaveTextContent("and more besides");
    const after = {
      ...tree,
      "plans/late.md": tree["plans/late.md"].replace(
        "_Leaning:_ Yes.",
        "_Leaning:_ Yes, and more besides.",
      ),
    };
    serveTree(after);
    setLoad(readyOf(after));
    await settle();
    await refresh();
    await show();
    expect(cardFor("OQ-T10")).toHaveTextContent("and more besides");
  });
});

describe("what arrives late (planning-to-do-list.md §4.2)", () => {
  /** A reply of the agent's on your comment on `id`. */
  function agentReplied(tree: Record<string, string>, id: string): string {
    const { path } = typedOnTitle(tree, id);
    reviews[path] = (reviews[path] ?? []).map((c) =>
      c.id === `typed-${id}`
        ? {
            ...c,
            reactions: [
              {
                actor: "agent",
                kind: "addressed",
                timestamp: 1,
                summary: `Which way for ${id}?`,
              },
            ] as ReviewComment["reactions"],
          }
        : c,
    );
    return path;
  }
  const heights = () =>
    Array.from(
      section("Needs you").querySelectorAll("[data-planning-item]"),
      (el) => `${el.getAttribute("aria-label")}:${el.tagName}`,
    );

  it("marks a reply New reply, moves nothing, opens the reply on the mark, and Refresh brings it back as a card", async () => {
    pageSize(2);
    const tree = todoTree(3);
    seed(tree);
    answer(tree, "OQ-T1");
    await renderPage();
    const before = heights();
    const path = agentReplied(tree, "OQ-T1");
    await reviewPushed(path);
    expect(heights()).toEqual(before);
    const row = screen.getByRole("group", { name: "OQ-T1: Question OQ-T1?" });
    expect(row.querySelector("[data-planning-new-reply-bar]")).not.toBeNull();
    // The reply, and OQ-T3, which the card it becomes would put past the
    // page size.
    expect(updatesCount()).toHaveTextContent("2");
    expect(updatesButton()).toHaveAttribute(
      "title",
      expect.stringContaining("1 new reply"),
    );
    // Pressing the mark opens the reply in place: your action.
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "New reply" }));
    });
    await settle();
    expect(within(cardFor("OQ-T1")).getByText(/Agent: Which way/)).toBeTruthy();
    expect(
      cardFor("OQ-T1").querySelector("[data-planning-new-reply-bar]"),
    ).toBeNull();
    // It needs you again, which the next layout says with a card.
    await refresh();
    expect(rowIds()).toEqual([]);
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2"]);
  });

  it("keeps a card's comment list as it painted it until the reader opens it", async () => {
    pageSize(2);
    const tree = todoTree(2);
    seed(tree);
    const { path, comment } = typedOnTitle(tree, "OQ-T2", {
      resolved: true,
    });
    reviews[path] = [comment];
    await renderPage();
    const list = () =>
      within(cardFor("OQ-T2")).queryByRole("list", {
        name: "Comments on this question",
      });
    const listed = list()?.textContent;
    reviews[path] = [
      {
        ...comment,
        reactions: [
          { actor: "agent", kind: "addressed", timestamp: 1, summary: "Done." },
        ] as ReviewComment["reactions"],
      },
    ];
    await reviewPushed(path);
    expect(list()?.textContent).toBe(listed);
  });

  it("marks a card answered elsewhere, and the next layout makes it a row", async () => {
    pageSize(2);
    const tree = todoTree(3);
    seed(tree);
    await renderPage();
    answer(tree, "OQ-T1");
    await reviewPushed("plans/todo.md");
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2"]);
    expect(
      within(cardFor("OQ-T1")).getByText("Answered elsewhere"),
    ).toBeTruthy();
    // Its controls stay as they were painted: the mark says what changed.
    expect(
      within(cardFor("OQ-T1")).getByRole("button", {
        name: "Take this leaning",
      }),
    ).toBeTruthy();
    // The heading's count changed live; the layout waits.
    expect(screen.getByTestId("needs-you-count")).toHaveTextContent("2");
    await refresh();
    expect(rowIds()).toEqual(["OQ-T1"]);
    expect(cardIds()).toEqual(["OQ-T2", "OQ-T3"]);
  });

  it("marks Done a question that became ✅, keeps it, and the next layout lists it under Maintenance", async () => {
    pageSize(2);
    const tree = todoTree(3);
    seed(tree);
    await renderPage();
    const after = {
      ...tree,
      "plans/todo.md": doc(
        "stage: DESIGN",
        q("OQ-T1", ANSWERED),
        q("OQ-T2", OPEN),
        q("OQ-T3", OPEN),
      ),
    };
    serveTree(after);
    setLoad(readyOf(after));
    await settle();
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2"]);
    expect(within(cardFor("OQ-T1")).getByText("Done")).toBeTruthy();
    expect(updatesButton()).toHaveAttribute(
      "title",
      expect.stringContaining("1 done"),
    );
    // Maintenance, which the layout did not have, waits for the next one;
    // its item is counted in the updates slot meanwhile.
    expect(querySection("Maintenance")).toBeNull();
    expect(updatesButton()).toHaveAttribute(
      "title",
      expect.stringContaining("1 new under Maintenance"),
    );
    await refresh();
    expect(cardIds()).toEqual(["OQ-T2", "OQ-T3"]);
    expect(listedIn("To fold into the ledger")).toEqual([
      "OQ-T1: Question OQ-T1?",
    ]);
  });

  it("keeps a changed question's card as it painted it, marked, until the next layout", async () => {
    pageSize(2);
    const tree = todoTree(2);
    seed(tree);
    await renderPage();
    const after = {
      ...tree,
      "plans/todo.md": tree["plans/todo.md"]!.replace(
        "_Leaning:_ Yes.",
        "_Leaning:_ Yes, and more besides.",
      ),
    };
    serveTree(after);
    setLoad(readyOf(after, { stages: STAGES }));
    await settle();
    expect(
      within(cardFor("OQ-T1")).getByText("Changed in the document"),
    ).toBeTruthy();
    expect(cardFor("OQ-T1")).not.toHaveTextContent("and more besides");
    await refresh();
    expect(cardFor("OQ-T1")).toHaveTextContent("and more besides");
    expect(
      within(cardFor("OQ-T1")).queryByText("Changed in the document"),
    ).toBeNull();
  });

  it("counts a new question in the updates slot only, and Refresh places it in roadmap order", async () => {
    pageSize(2);
    const tree = todoTree(2);
    seed(tree);
    await renderPage();
    const before = heights();
    const after = {
      ...tree,
      "roadmap.md":
        "# Roadmap\n\n1. [First](plans/first.md)\n2. [The list](plans/todo.md)\n",
      "plans/first.md": doc("stage: DESIGN", q("OQ-F1", OPEN)),
    };
    serveTree(after);
    setLoad(readyOf(after));
    await settle();
    expect(heights()).toEqual(before);
    expect(updatesButton()).toHaveAttribute(
      "title",
      expect.stringContaining("1 new question"),
    );
    expect(screen.getByTestId("needs-you-count")).toHaveTextContent("3");
    await refresh();
    expect(cardIds()).toEqual(["OQ-F1", "OQ-T1"]);
    expect(updatesButton()).toHaveAttribute("aria-hidden", "true");
  });

  it("counts a reordered roadmap once", async () => {
    pageSize(2);
    const tree = {
      "roadmap.md": "# Roadmap\n\n1. [A](plans/a.md)\n2. [B](plans/b.md)\n",
      "plans/a.md": doc("stage: DESIGN", q("OQ-A1", OPEN)),
      "plans/b.md": doc("stage: DESIGN", q("OQ-B1", OPEN)),
    };
    seed(tree);
    await renderPage();
    const after = {
      ...tree,
      "roadmap.md": "# Roadmap\n\n1. [B](plans/b.md)\n2. [A](plans/a.md)\n",
    };
    serveTree(after);
    setLoad(readyOf(after));
    await settle();
    expect(cardIds()).toEqual(["OQ-A1", "OQ-B1"]);
    expect(updatesCount()).toHaveTextContent("1");
    expect(updatesButton()).toHaveAttribute(
      "title",
      expect.stringContaining("1 roadmap reordered"),
    );
    await refresh();
    expect(cardIds()).toEqual(["OQ-B1", "OQ-A1"]);
  });

  it("changes a group's count when a maintenance item comes or goes, marking a gone row Done", async () => {
    seed();
    await renderPage();
    const after = { ...TREE };
    delete after["plans/unrouted.md"];
    after["plans/more.md"] = doc("stage: DESIGN", q("OQ-M1", OPEN));
    after["plans/more2.md"] = doc("stage: DESIGN", q("OQ-M2", OPEN));
    serveTree(after);
    setLoad(readyOf(after));
    await settle();
    // Listed as painted, the gone one marked, the count the data in hand's.
    expect(listedIn("Not on a roadmap")).toEqual([
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
    expect(
      screen
        .getByRole("listitem", { name: "OQ-U1: Question OQ-U1?" })
        .querySelector('[data-planning-mark="done"]'),
    ).not.toBeNull();
    expect(section("Not on a roadmap")).toHaveAccessibleName(
      /^Not on a roadmap 3/,
    );
    expect(updatesCount()).toHaveTextContent("3");
    await refresh();
    expect(listedIn("Not on a roadmap")).toEqual([
      "OQ-X1: Question OQ-X1?",
      "OQ-M1: Question OQ-M1?",
      "OQ-M2: Question OQ-M2?",
    ]);
  });

  it("applies nothing on its own: an index update, a review or a rescan only marks and counts", async () => {
    pageSize(2);
    const tree = todoTree(4);
    seed(tree);
    await renderPage();
    answer(tree, "OQ-T1", "OQ-T2");
    await reviewPushed("plans/todo.md");
    setLoad(readyOf(tree));
    await settle();
    expect(cardIds()).toEqual(["OQ-T1", "OQ-T2"]);
    expect(rowIds()).toEqual([]);
    expect(updatesCount()).toHaveTextContent("4");
  });
});

describe("Refresh (planning-to-do-list.md §4.3)", () => {
  it("keeps the room of its slot from the first paint, and shows N updates only while some are held", async () => {
    pageSize(2);
    seed(todoTree(3));
    await renderPage();
    const button = updatesButton();
    expect(button).toBeTruthy();
    expect(button).toHaveAttribute("aria-hidden", "true");
    expect(button).toHaveClass("invisible");
    // Never folded into the ⋯.
    expect(button.closest(".hdr-overflow")).toBeNull();
  });

  it("keeps the first item on screen at the same height through the new layout", async () => {
    pageSize(2);
    const tree = todoTree(4);
    seed(tree);
    await renderPage();
    answer(tree, "OQ-T2");
    await reviewPushed("plans/todo.md");
    // Lay the page out by hand: each item 100 px tall, in DOM order, under
    // the pane's scroll.
    const pane = scroller();
    pane.scrollTop = 150;
    const rect = (top: number) =>
      ({ top, bottom: top + 100, height: 100 }) as DOMRect;
    const spy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        if (this === pane) return rect(0);
        const items = [...pane.querySelectorAll("[data-planning-item]")];
        const at = items.indexOf(this);
        return rect(at === -1 ? 0 : at * 100 - pane.scrollTop);
      });
    const top = watchScrollTop();
    try {
      // OQ-T2, the second card, is the first item on screen, its top 50 px
      // above the pane's.
      await refresh();
      // The new layout puts OQ-T2's row first: the pane scrolls up by one
      // item to keep it where it was.
      expect(rowIds()).toEqual(["OQ-T2"]);
      expect(top.mock.calls.filter(([el]) => el === pane).at(-1)?.[1]).toBe(50);
    } finally {
      top.restore();
      spy.mockRestore();
    }
  });

  it("closes an open comment box first, keeping its text, which the new layout shows as an answered row", async () => {
    pageSize(2);
    seed(todoTree(3));
    await renderPage();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-T2")).getByRole("button", { name: "Answer…" }),
      );
    });
    const box = await screen.findByPlaceholderText(/comment/i);
    fireEvent.change(box, { target: { value: "Go the second way." } });
    // Something late, so there is an update to apply.
    setLoad(readyOf(todoTree(3)));
    await settle();
    await refresh();
    expect(screen.queryByPlaceholderText(/comment/i)).toBeNull();
    expect(reviews["plans/todo.md"]?.map((c) => c.comment)).toEqual([
      "Go the second way.",
    ]);
    expect(rowIds()).toEqual(["OQ-T2"]);
  });
});

describe("no section bar (planning-to-do-list.md §3.5)", () => {
  beforeEach(() => seed());

  it("has none: the page's top is the filter line, then Needs you's heading and its first card", async () => {
    localStorage.clear();
    await renderPage();
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    const main = screen.getByRole("main");
    const filter = within(main).getByRole("search");
    const heading = within(section("Needs you")).getByRole("heading", {
      level: 2,
    });
    expect(
      filter.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Nothing between them but the notices' box and the sections' own.
    expect(
      Array.from(main.querySelectorAll("nav, [data-planning-cards-toggle]")),
    ).toEqual([]);
  });

  it("scrolls to the section a link's fragment names once the sections are in", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage("/.vantage/planning#graduate");
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toBe(
        within(section("Ready to graduate")).getByRole("heading", { level: 3 }),
      );
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("writes every count in one number format, in the heading's name too", async () => {
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
    expect(screen.getByTestId("maintenance-kinds")).toHaveTextContent(
      "1,200 too large",
    );
    expect(
      within(section("Too large")).getByRole("heading", { level: 3 }),
    ).toHaveAccessibleName("Too large 1,200");
    // The first rows of a long list, then Show all.
    expect(
      within(section("Too large")).getByRole("button", {
        name: "Show all 1,200 of Too large",
      }),
    ).toHaveTextContent("Show all 1,200");
  });
});

describe("the cards' blocks, from the scanner client (planning-index.md §10.4)", () => {
  /** The tree with every file changed, so nothing an earlier test held fits. */
  const edited = (label: string) =>
    Object.fromEntries(
      Object.entries(ROUTED).map(([path, content]) => [
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
    // Needs you's cards: no row, nor a ✅ question, has a card.
    expect(new Set(asked[0]?.want.map((w) => w.path))).toEqual(
      new Set(["plans/design.md", "plans/unrouted.md"]),
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
    // The frame: the header and the filter line, with no progress line.
    expect(screen.getByRole("heading", { name: "Planning" })).toBeTruthy();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(inPage().queryByRole("status")).toBeNull();
    // Not past spinnerMs yet, so no spinner either.
    expect(screen.queryByLabelText("Loading this page's cards")).toBeNull();
    release();
    await settle();
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
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

describe("the reviews, in one request (planning-index.md §9.3)", () => {
  beforeEach(() => seed(ROUTED));

  const reviewRequests = () =>
    vi
      .mocked(axios.post)
      .mock.calls.filter(([url]) => String(url).endsWith("/planning/reviews"));

  const pathsOf = (at: number) =>
    (reviewRequests()[at]?.[1] as { paths: string[] }).paths;

  it("reads the cards' documents, and every one holding a question that needs you, with their inputs, in one POST, and none with a GET", async () => {
    await renderPage();
    expect(new Set(pathsOf(0))).toEqual(
      new Set([
        "plans/design.md",
        "plans/answered.md",
        "plans/unrouted.md",
        "plans/disagrees.md",
      ]),
    );
    // The rows' documents, which show no comment, come once the sections
    // have painted.
    expect(new Set(pathsOf(1))).toEqual(
      new Set(["plans/deps.md", "plans/ready.md", "plans/built.md"]),
    );
    expect(reviewRequests()).toHaveLength(2);
    expect(reviewGets()).toEqual([]);
  });

  it("reads every other listed document in one more POST once the sections have painted", async () => {
    // A document whose one question is blocked, on Waiting's last page: the
    // one listed document the first request leaves out.
    seed({
      ...TREE,
      "plans/waits.md": doc("stage: DESIGN", q("OQ-W9", BLOCKED)),
    });
    pageSize(1);
    await renderPage();
    expect(reviewRequests()).toHaveLength(2);
    const first = new Set(pathsOf(0));
    const rest = pathsOf(1);
    expect(rest.filter((path) => first.has(path))).toEqual([]);
    // The first holds the cards' documents and every one holding a question
    // that needs you: plans/answered.md's OQ-A1 has no card, and its answers
    // are what the need-you numbers painted with the sections read.
    expect(first.has("plans/answered.md")).toBe(true);
    expect(rest).toContain("plans/waits.md");
    expect(new Set([...first, ...rest])).toEqual(
      new Set([
        "plans/design.md",
        "plans/answered.md",
        "plans/unrouted.md",
        "plans/disagrees.md",
        "plans/deps.md",
        "plans/ready.md",
        "plans/waits.md",
        "plans/built.md",
      ]),
    );
    // And a larger page size asks nothing more: its documents are in hand.
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("needs-you-end")).getByRole("button", {
          name: "20",
        }),
      );
    });
    await settle();
    expect(cardsIn("Needs you")).toHaveLength(2);
    expect(reviewRequests()).toHaveLength(2);
    expect(reviewGets()).toEqual([]);
  });
});

describe("page inputs, and one commit (planning-index.md §6.5)", () => {
  beforeEach(() => seed(ROUTED));

  /** Every reviews request, held until `release` answers them all. */
  function holdReviews(): { release: () => void; fail: () => void } {
    const real = vi.mocked(axios.post).getMockImplementation()!;
    const waiting: { release: () => void; fail: () => void }[] = [];
    vi.mocked(axios.post).mockImplementation((url, body, config) => {
      if (!String(url).endsWith("/planning/reviews")) {
        return real(url, body, config);
      }
      return new Promise((resolve, reject) => {
        waiting.push({
          release: () => resolve(real(url, body, config)),
          fail: () => reject(new Error("down")),
        });
      });
    });
    return {
      release: () => {
        for (const w of waiting.splice(0)) w.release();
      },
      fail: () => {
        for (const w of waiting.splice(0)) w.fail();
      },
    };
  }

  /**
   * A comment on OQ-U1 that answers nothing, dismissed, so its card lists it
   * and stays a card.
   */
  async function fileOnU1(): Promise<void> {
    const { path, comment } = typedOnTitle(ROUTED, "OQ-U1", {
      resolved: true,
    });
    reviews[path] = [comment];
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
    expect(commentsOn("OQ-U1")).toHaveTextContent("My answer to OQ-U1.");
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
    expect(cardsIn("Needs you")).toHaveLength(3);
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
    expect(commentsOn("OQ-U1")).toHaveTextContent("My answer to OQ-U1.");
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
    expect(cardsIn("Needs you")).toHaveLength(3);
    expect(screen.getByRole("button", { name: COPY_ANSWERS })).toBeDisabled();
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("–");
  });

  // §15: the second request comes after the sections painted, so a line
  // above them would move them. Copy answers says it where nothing moves.
  it("says so, and keeps Copy answers disabled, when the second reviews request fails", async () => {
    seed({
      ...TREE,
      "plans/waits.md": doc("stage: DESIGN", q("OQ-W9", BLOCKED)),
    });
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
    const copy = screen.getByRole("button", { name: COPY_ANSWERS });
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
    // Long enough for the page and the app shell around it to render and
    // settle first, on a loaded machine too.
    setPlanningLimitsForTests({ spinnerMs: 150 });
    serveTree(TREE, "/api", () => ({
      cards: () => new Promise<CardAnswer[]>(() => {}),
    }));
    await renderPage();
    expect(screen.queryByLabelText("Loading this page's cards")).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(screen.getByLabelText("Loading this page's cards")).toBeTruthy();
  });

  it("keeps the old layout on a page size chosen until the new layout's inputs are ready", async () => {
    pageSize(2);
    setPlanningLimitsForTests({
      pageSizes: [2, 20, 30, 50],
      defaultPageSize: 2,
      cardsAhead: 0,
    });
    let hold = false;
    let release: () => void = () => {};
    serveTree(ROUTED, "/api", (inline) => ({
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
        within(screen.getByTestId("needs-you-end")).getByRole("button", {
          name: "20",
        }),
      );
    });
    await settle();
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
    ]);
    release();
    await settle();
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
      "OQ-U1: Question OQ-U1?",
    ]);
  });

  it("renders a returned-to page's frame and sections in one commit when its inputs are cached", async () => {
    render(
      <MemoryRouter initialEntries={[entry("/.vantage/planning")]}>
        <RouterProbe />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/.vantage/planning/*" element={<PlanningPage />} />
            <Route path="/*" element={<div data-testid="viewer">viewer</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    fireEvent.click(nameLink("OQ-U1", "plans/unrouted.md"));
    expect(screen.getByTestId("viewer")).toBeTruthy();
    // No settling: what the first render commits.
    act(() => router.navigate!(-1));
    expect(cardsIn("Needs you")).toHaveLength(3);
  });

  // D1 (§6.3, §18): on `g p`, the `g` has asked for page 1's inputs, which
  // are in hand when the frame commits. Rendering their cards at once kept
  // the main thread from painting the frame until they yielded.
  it("keeps a set already in hand back until the frame has painted, as on g p", async () => {
    prefetchPlanningPage("");
    await settle();
    render(
      <MemoryRouter initialEntries={[entry("/plans/design.md")]}>
        <RouterProbe />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/.vantage/planning/*" element={<PlanningPage />} />
            <Route path="/*" element={<div data-testid="viewer">viewer</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    frames.held = true;
    act(() => router.navigate!("/.vantage/planning"));
    await settle();
    expect(screen.getByRole("search")).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    await releaseFrames();
    expect(cardsIn("Needs you")).toHaveLength(3);
    expect(warming.runs).toBe(0);
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
    expect(cardsIn("Needs you")).toHaveLength(3);
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

describe("Mermaid, drawn before the cards commit (planning-index.md §6.5)", () => {
  const DIAGRAM = "graph LR\n  A --> B";
  const tree = {
    ...ROUTED,
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

describe("memoized cards (planning-index.md §6.6)", () => {
  beforeEach(() => seed(ROUTED));

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

describe("a preview card (planning-index.md §6.6)", () => {
  // OQ-U1's card, 150-odd characters, is past a limit configured down to
  // 100; every other card of the tree is within it.
  const tree = {
    ...ROUTED,
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
      within(card).getByRole("link", { name: OPEN_DOCUMENT }),
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

describe("several roadmaps (§6.8)", () => {
  // Found by name: roadmap.md routes OQ-D1, OQ-D3 and OQ-A1, and
  // docs/plans/roadmap.md routes OQ-U1, then OQ-D3 again.
  const NESTED = "docs/plans/roadmap.md";
  const TWO: Record<string, string> = {
    ...TREE,
    [NESTED]: [
      "# Plans",
      "",
      "## Later",
      "",
      "1. [Not on a roadmap until now](../../plans/unrouted.md)",
      "2. [One of the design's](../../plans/design.md#OQ-D3)",
      "",
    ].join("\n"),
  };
  const KEY = "vantage:planningRoadmap:";

  const picker = () =>
    screen.getByRole("combobox", { name: "Roadmap" }) as HTMLSelectElement;
  const options = () =>
    Array.from(picker().options, (option) => option.textContent);
  const search = () => new URLSearchParams(router.location.split("?")[1]);
  async function pick(path: string): Promise<void> {
    await act(async () => {
      fireEvent.change(picker(), { target: { value: path } });
    });
    await settle();
  }

  it("with one roadmap, has no roadmap line and leaves the URL alone", async () => {
    seed();
    await renderPage();
    expect(screen.queryByTestId("roadmap-line")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Roadmap" })).toBeNull();
    expect(router.location).toBe("/.vantage/planning");
  });

  // One picker, where the planning outline is drawn at its head, and on
  // Needs you's heading line when it is not (planning-to-do-list.md §3.5).
  it("puts the picker at the head of the planning outline while it is drawn, and only there", async () => {
    localStorage.setItem("vantage:tocOpen", "true");
    seed(TWO);
    await renderPage();
    const outline = screen.getByRole("navigation", {
      name: "On this page",
    });
    expect(screen.getAllByRole("combobox", { name: "Roadmap" })).toHaveLength(
      1,
    );
    expect(outline).toContainElement(picker());
    expect(screen.getByRole("main")).not.toContainElement(picker());
    await pick(NESTED);
    expect(search().get("roadmap")).toBe(NESTED);

    // Hidden, the column gives the picker to Needs you's heading line.
    fireEvent.click(
      within(screen.getByTestId("planning-header")).getByRole("button", {
        name: "Hide contents",
      }),
    );
    expect(screen.getAllByRole("combobox", { name: "Roadmap" })).toHaveLength(
      1,
    );
    expect(section("Needs you")).toContainElement(picker());
    expect(section("Needs you").firstElementChild!.contains(picker())).toBe(
      true,
    );
    expect(picker().value).toBe(NESTED);
  });

  // Late data never moves painted content (§6.9): the picker comes with the
  // index, so a label painted before it would be pushed down by it. The
  // outline's head comes with the outline.
  it("draws the outline's head with the outline, never a label the picker lands above", async () => {
    localStorage.setItem("vantage:tocOpen", "true");
    setLoad({ status: "loading", warm: false, progress: null });
    serveTree(TWO);
    await renderPage();
    const column = screen.getByTestId("planning-outline");
    expect(column.textContent).toBe("");
    expect(screen.queryByRole("combobox", { name: "Roadmap" })).toBeNull();
    setLoad(readyOf(TWO));
    await settle();
    const outline = screen.getByRole("navigation", {
      name: "On this page",
    });
    const label = within(outline).getByText("On this page");
    // The picker first, then the label, both there at once.
    expect(
      picker().compareDocumentPosition(label) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers each roadmap that routes, nearest the root first and chosen, with its count", async () => {
    seed(TWO);
    await renderPage();
    expect(options()).toEqual([
      "roadmap.md (3 need you)",
      "docs/plans/roadmap.md (2 need you)",
    ]);
    expect(picker().value).toBe("roadmap.md");
    // On Needs you's heading line, the list the roadmap orders.
    expect(section("Needs you")).toContainElement(picker());
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
    ]);
    // OQ-U1 is routed, by the other roadmap: neither Needs you here nor
    // Not on a roadmap, and counted on the line instead.
    expect(listedIn("Not on a roadmap")).toEqual(["OQ-X1: Question OQ-X1?"]);
    expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
      PLANNING_NOTICES.otherRoadmaps(1),
    );
    // The address says which roadmap is shown, written in place.
    expect(search().get("roadmap")).toBe("roadmap.md");
  });

  it("shows the chosen roadmap's whole path in the closed control, which wraps rather than cut it off", async () => {
    seed(TWO);
    await renderPage();
    // Drawn by the page, since a closed select clips its text to one line,
    // and hidden from a screen reader, which hears the select's own value.
    const shown = screen.getByTestId("roadmap-shown");
    expect(shown).toHaveTextContent(/^roadmap\.md \(3 need you\)$/);
    expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(shown).toHaveClass("[overflow-wrap:anywhere]");
    expect(picker()).toHaveAttribute("title", "roadmap.md");
    await pick(NESTED);
    expect(screen.getByTestId("roadmap-shown")).toHaveTextContent(
      /^docs\/plans\/roadmap\.md \(2 need you\)$/,
    );
    expect(picker()).toHaveAttribute("title", NESTED);
  });

  it("draws the sections in a box of their own, so the roadmap line on Needs you moves no painted box", async () => {
    setLoad({ status: "loading", warm: false, progress: null });
    serveTree(TWO);
    await renderPage();
    // The progress line's, not the degradation banner's live region, which
    // the app shell keeps mounted.
    const progressBox = within(screen.getByRole("main")).getByRole(
      "status",
    ).parentElement!;
    setLoad(readyOf(TWO));
    await settle();
    expect(screen.getByTestId("roadmap-line")).toBeTruthy();
    // A box reused from the progress line would be one the roadmap line,
    // inserted above it, pushed down: a layout shift on every cold load.
    expect(progressBox.isConnected).toBe(false);
  });

  it("follows a pick: the URL rewritten in place, a new layout of Needs you, and the other count", async () => {
    seed(TWO);
    await renderPage("/.vantage/planning?x=1", ["/plans/a.md"]);
    expect(cardsIn("Needs you")).toEqual([
      "OQ-D1: Question OQ-D1?",
      "OQ-D3: Question OQ-D3?",
    ]);
    await pick(NESTED);
    expect(picker().value).toBe(NESTED);
    expect(search().get("roadmap")).toBe(NESTED);
    expect(search().has("needs-you")).toBe(false);
    expect(search().get("x")).toBe("1");
    expect(cardsIn("Needs you")).toEqual([
      "OQ-U1: Question OQ-U1?",
      "OQ-D3: Question OQ-D3?",
    ]);
    expect(listedIn("Not on a roadmap")).toEqual(["OQ-X1: Question OQ-X1?"]);
    expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
      PLANNING_NOTICES.otherRoadmaps(2),
    );
    expect(screen.getByTestId("needs-you-count")).toHaveTextContent("2");
    // No history entry: Back leaves the page.
    act(() => router.navigate!(-1));
    expect(router.location).toBe("/plans/a.md");
  });

  it("remembers a pick for the repository, which a later visit reopens", async () => {
    seed(TWO);
    await renderPage();
    await pick(NESTED);
    expect(readPreference(KEY)).toBe(NESTED);
    cleanup();
    await renderPage();
    expect(picker().value).toBe(NESTED);
    expect(search().get("roadmap")).toBe(NESTED);
    expect(cardsIn("Needs you")[0]).toBe("OQ-U1: Question OQ-U1?");
  });

  it("puts the URL's roadmap over the remembered one, and never remembers a visit", async () => {
    localStorage.setItem(KEY, NESTED);
    seed(TWO);
    await renderPage("/.vantage/planning?roadmap=roadmap.md");
    expect(picker().value).toBe("roadmap.md");
    expect(localStorage.getItem(KEY)).toBe(NESTED);
  });

  it("reads an escaped slash as a slash", async () => {
    seed(TWO);
    await renderPage("/.vantage/planning?roadmap=docs%2Fplans%2Froadmap.md");
    expect(picker().value).toBe(NESTED);
  });

  it("rewrites a URL naming a document that is no roadmap to the one it shows", async () => {
    localStorage.setItem(KEY, "plans/design.md");
    seed(TWO);
    await renderPage("/.vantage/planning?roadmap=plans/unrouted.md");
    expect(picker().value).toBe("roadmap.md");
    expect(search().get("roadmap")).toBe("roadmap.md");
  });

  it("reads the remembered roadmap once per visit, so another tab's pick changes nothing on screen", async () => {
    seed(TWO);
    await renderPage();
    localStorage.setItem(KEY, NESTED);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: KEY,
        newValue: NESTED,
        storageArea: localStorage,
      }),
    );
    await settle();
    expect(picker().value).toBe("roadmap.md");
  });

  it("works, remembering nothing and saying nothing, when storage fails", async () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    try {
      seed(TWO);
      await renderPage();
      expect(picker().value).toBe("roadmap.md");
      await pick(NESTED);
      expect(picker().value).toBe(NESTED);
      expect(search().get("roadmap")).toBe(NESTED);
      expect(cardsIn("Needs you")[0]).toBe("OQ-U1: Question OQ-U1?");
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("falls back when the chosen roadmap stops routing, and drops the parameter with one left", async () => {
    seed(TWO);
    await renderPage(`/.vantage/planning?roadmap=${NESTED}`);
    expect(picker().value).toBe(NESTED);
    // Retired by a done stage, as an archived roadmap is.
    const retired = {
      ...TWO,
      [NESTED]: `---\nstage: GONE\n---\n\n${TWO[NESTED]}`,
    };
    serveTree(retired);
    setLoad(readyOf(retired));
    await settle();
    // Late data (planning-to-do-list.md §4.2): held until the next layout.
    expect(picker().value).toBe(NESTED);
    expect(cardsIn("Needs you")[0]).toBe("OQ-U1: Question OQ-U1?");
    await refresh();
    expect(screen.queryByRole("combobox", { name: "Roadmap" })).toBeNull();
    expect(search().has("roadmap")).toBe(false);
    expect(cardsIn("Needs you")[0]).toBe("OQ-D1: Question OQ-D1?");
    expect(listedIn("Not on a roadmap")).toEqual([
      "OQ-X1: Question OQ-X1?",
      "OQ-U1: Question OQ-U1?",
    ]);
  });

  it("keeps Needs you on screen through a swap until the new roadmap's inputs are in", async () => {
    setPlanningLimitsForTests({ spinnerMs: 0 });
    let hold = false;
    let release: () => void = () => {};
    const tree = TWO;
    serveTree(tree, "/api", (inline) => ({
      cards: (repo, want, options) =>
        hold
          ? new Promise<CardAnswer[]>((resolve) => {
              release = () => resolve(inline.cards(repo, want, options));
            })
          : inline.cards(repo, want, options),
    }));
    setLoad(readyOf(tree));
    await renderPage();
    // The spinner's slot is there before it is needed, so showing it moves
    // nothing (on a phone, a spinner appended to the full line wrapped).
    const slot = screen.getByTestId("roadmap-spinner-slot");
    expect(slot).toBeEmptyDOMElement();
    hold = true;
    await pick(NESTED);
    // The picker shows the roadmap asked for at once; the rest waits.
    expect(picker().value).toBe(NESTED);
    expect(screen.getByTestId("roadmap-spinner-slot")).toBe(slot);
    expect(slot.querySelector("svg.animate-spin")).not.toBeNull();
    expect(cardsIn("Needs you")[0]).toBe("OQ-D1: Question OQ-D1?");
    expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
      PLANNING_NOTICES.otherRoadmaps(1),
    );
    release();
    await settle();
    expect(cardsIn("Needs you")[0]).toBe("OQ-U1: Question OQ-U1?");
    expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
      PLANNING_NOTICES.otherRoadmaps(2),
    );
    expect(screen.getByTestId("roadmap-spinner-slot")).toBe(slot);
    expect(slot).toBeEmptyDOMElement();
  });

  it("asks ahead of a visit for the roadmap the visit will choose", async () => {
    localStorage.setItem(KEY, NESTED);
    const asked: CardWant[][] = [];
    serveTree(TWO, "/api", (inline) => ({
      cards: (repo, want, options) => {
        asked.push(want);
        return inline.cards(repo, want, options);
      },
    }));
    setLoad(readyOf(TWO));
    prefetchPlanningPage("");
    await settle();
    expect(asked).toHaveLength(1);
    await renderPage();
    expect(asked).toHaveLength(1);
    expect(cardsIn("Needs you")[0]).toBe("OQ-U1: Question OQ-U1?");
  });

  it("counts in Copy answers a comment on a question only the other roadmap routes, under either", async () => {
    seed(TWO);
    const line = readyOf(TWO)
      .index.documents.flatMap((d) => d.questions)
      .find((x) => x.id === "OQ-U1")!.line;
    reviews["plans/unrouted.md"] = [
      {
        id: "other-0001",
        comment: "Ruled on the other roadmap",
        created_at: 0,
        reactions: [],
        anchor: {
          source_line: line,
          block_text_hash: "00000000",
          selection_offset: 0,
          selection_length: 0,
        },
      },
    ];
    await renderPage();
    expect(screen.queryByRole("article", { name: /OQ-U1/ })).toBeNull();
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Review answers" }));
    const pendingMenu = screen.getByRole("menu", {
      name: "Answers waiting on the agent",
    });
    expect(
      within(pendingMenu).getByText("Ruled on the other roadmap"),
    ).toBeTruthy();
    expect(
      within(pendingMenu).getByRole("menuitem", {
        name: `Open plans/unrouted.md at line ${line}`,
      }),
    ).toHaveAttribute("href", `/plans/unrouted.md#L${line}`);
    fireEvent.keyDown(document, { key: "Escape" });
    await pick(NESTED);
    // Answered: a row of Needs you under this roadmap.
    expect(
      screen.getByRole("group", { name: "OQ-U1: Question OQ-U1?" }),
    ).toBeTruthy();
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("1");
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
      within(cardFor("OQ-D1")).getByRole("link", { name: OPEN_DOCUMENT }),
    ).toHaveAttribute("href", "/alpha/plans/design.md");
    expect(nameLink("OQ-D1", "plans/design.md")).toHaveAttribute(
      "href",
      "/alpha/plans/design.md",
    );
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

  it("lists a blocked question under Blocked as one row, answered from its document (planning-to-do-list.md §3.4)", async () => {
    await renderPage();
    expect(within(section("Blocked")).queryByRole("article")).toBeNull();
    const row = screen.getByRole("listitem", {
      name: "OQ-D2: Question OQ-D2?",
    });
    expect(within(row).getByRole("link", { name: "OQ-D2" })).toHaveAttribute(
      "href",
      "/plans/design.md#OQ-D2",
    );
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("lists a ✅ question under To fold into the ledger as one row, never a card (planning-to-do-list.md §3.3)", async () => {
    await renderPage();
    expect(
      screen.queryByRole("article", { name: "OQ-A1: Question OQ-A1?" }),
    ).toBeNull();
    expect(listedIn("To fold into the ledger")).toEqual([
      "OQ-A1: Question OQ-A1?",
    ]);
  });

  it("gives an open card all three", async () => {
    await renderPage();
    const card = cardFor("OQ-D1");
    expect(
      within(card).getByRole("button", { name: "Take this leaning" }),
    ).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Answer…" })).toBeTruthy();
    expect(
      within(card).getByRole("link", { name: OPEN_DOCUMENT }),
    ).toBeTruthy();
  });
});

describe("filing from the page", () => {
  beforeEach(() => seed());

  it("files on the question's own document, and shows it taken on the row it shrinks to", async () => {
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
    await settle();
    expect(
      screen.getByRole("group", { name: "OQ-D3: Question OQ-D3?" }),
    ).toHaveTextContent("Leaning taken");
    // Its sibling in the same document and the same list lists nothing.
    expect(
      within(cardFor("OQ-D1")).queryByRole("list", {
        name: "Comments on this question",
      }),
    ).toBeNull();
  });

  it("does not reorder the page", async () => {
    await renderPage();
    const items = () =>
      Array.from(
        section("Needs you").querySelectorAll("[data-planning-item]"),
        (el) => el.getAttribute("aria-label"),
      );
    const before = items();
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-D3")).getByRole("button", {
          name: "Take this leaning",
        }),
      );
    });
    await settle();
    expect(items()).toEqual(before);
  });

  it("opens the document without touching its review-mode preference", async () => {
    localStorage.setItem(reviewModePreferenceKey("plans/design.md"), "on");
    await renderPage();
    fireEvent.click(nameLink("OQ-D1", "plans/design.md"));
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

describe("Copy answers (§6.7)", () => {
  beforeEach(() => seed(ROUTED));

  const copyButton = () => screen.getByRole("button", { name: COPY_ANSWERS });
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
          lines: linesOfText(ROUTED["plans/unrouted.md"] ?? null),
        },
      ]),
    );
    expect(writeText.mock.calls[0][0]).toContain("   _Leaning:_ Yes.");
  });

  it("waits for the quoted lines before it copies", async () => {
    serveTree(ROUTED, "/api", () => ({
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
    // Its row is marked; the mark opens the reply in place.
    const row = screen.getByRole("group", { name: "OQ-D1: Question OQ-D1?" });
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "New reply" }));
    });
    await settle();
    expect(within(cardFor("OQ-D1")).getByText("Agent: Done.")).toBeTruthy();
  });
});

describe("Copy answers across pages (planning-index.md §6.7)", () => {
  // Sizes a test can choose from on the end line.
  beforeEach(() =>
    setPlanningLimitsForTests({ pageSizes: [1, 10, 20], defaultPageSize: 10 }),
  );
  const copyButton = () => screen.getByRole("button", { name: COPY_ANSWERS });
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

  /** Show on an answered row: it opens into its card. */
  async function showRow(id: string): Promise<void> {
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("group", { name: `${id}: Question ${id}?` }),
        ).getByRole("button", { name: /^Show/ }),
      );
    });
    await settle();
  }

  /** A page size chosen on Needs you's end line, from 1, 10 and 20. */
  async function choose(size: string): Promise<void> {
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("needs-you-end")).getByRole("button", {
          name: size,
        }),
      );
    });
    await settle();
  }

  const lineOf = (tree: Record<string, string>, id: string) =>
    readyOf(tree)
      .index.documents.flatMap((d) => d.questions)
      .find((x) => x.id === id)!.line;

  it("lets the reader find an off-page answer's document without copying it", async () => {
    seed();
    const line = lineOf(TREE, "OQ-A1");
    reviews["plans/answered.md"] = [
      pendingAt("placed-0001", "Ruled on page two", line),
    ];
    await renderPage();
    expect(screen.queryByRole("article", { name: /OQ-A1/ })).toBeNull();
    expect(pendingCount()).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Review answers" }));
    const answers = screen.getByRole("menu", {
      name: "Answers waiting on the agent",
    });
    expect(within(answers).getByText("Ruled on page two")).toBeTruthy();
    expect(
      within(answers).getByRole("menuitem", {
        name: `Open plans/answered.md at line ${line}`,
      }),
    ).toHaveAttribute("href", `/plans/answered.md#L${line}`);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("counts and copies a pending comment on a question no page shows", async () => {
    seed();
    // OQ-A1 is ✅, so its card never renders.
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
    "roadmap.md": `${TREE["roadmap.md"]}3. [Scoped](plans/scoped.md) last.\n`,
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
    // Placed by its line before any card read it, the comment made OQ-S1 an
    // answered row; its card, opened, reads it on the note.
    expect(pendingCount()).toBe("1");
    await showRow("OQ-S1");
    expect(cardFor("OQ-S1")).toBeTruthy();
    expect(pendingCount()).toBe("0");
  });

  it("places the same comment by its line when the card is on a page not shown", async () => {
    const hash = await noteHash();
    reviews["plans/scoped.md"] = [
      pendingAt("moved-0001", "On the note", lineOf(SCOPED, "OQ-S1"), hash),
    ];
    // Needs you is OQ-D1, OQ-D3, OQ-S1: at one a page, OQ-S1 has no card.
    pageSize(1);
    seed(SCOPED);
    await renderPage();
    expect(screen.queryByRole("article", { name: /OQ-S1/ })).toBeNull();
    expect(pendingCount()).toBe("1");
  });

  // "A card rendered this visit reports its exact scoping": a smaller page
  // size taking its card away does not make the comment it found on the
  // note OQ-S1's again, so Copy answers holds the same comments either way.
  it("keeps a card's own scoping after a new layout takes its card away", async () => {
    const hash = await noteHash();
    reviews["plans/scoped.md"] = [
      pendingAt("moved-0001", "On the note", lineOf(SCOPED, "OQ-S1"), hash),
    ];
    seed(SCOPED);
    await renderPage();
    await showRow("OQ-S1");
    expect(pendingCount()).toBe("0");
    await choose("1");
    expect(screen.queryByRole("article", { name: /OQ-S1/ })).toBeNull();
    expect(pendingCount()).toBe("0");
    await choose("10");
    expect(cardFor("OQ-S1")).toBeTruthy();
    expect(pendingCount()).toBe("0");
  });

  it("places by line again once the document's comments change after its card left", async () => {
    const hash = await noteHash();
    reviews["plans/scoped.md"] = [
      pendingAt("moved-0001", "On the note", lineOf(SCOPED, "OQ-S1"), hash),
    ];
    seed(SCOPED);
    await renderPage();
    await showRow("OQ-S1");
    await choose("1");
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

/* ------------------------------------------------------------------ *
 * What each section means, and the agent requests
 * ------------------------------------------------------------------ */

describe("each section's explanation, and Copy agent request", () => {
  const ROOT = "/home/me/repo";

  /** Answer `/info` with `root` (a rejection when `null`), on top of the rest. */
  function serveInfo(root: string | null, base = "/api"): void {
    const rest = vi.mocked(axios.get).getMockImplementation()!;
    vi.mocked(axios.get).mockImplementation(async (url, config) => {
      if (String(url) !== `${base}/info`) return rest(url, config);
      if (root === null) throw new Error("no /info");
      return { data: { name: "repo", root_path: root } };
    });
  }

  /** The index the page shows, and its sections, for the default roadmap. */
  function shownState(repo = "") {
    const load = usePlanningStore.getState().byRepo[repo];
    if (load?.status !== "ready") throw new Error("no ready index");
    return {
      index: load.index,
      sections: derivePlanningSections(load.index),
    };
  }

  const copyFor = (title: string) =>
    screen.getByRole("button", { name: `Copy agent request for ${title}` });
  /**
   * Copy answers + maintenance, which replaced Copy all agent requests
   * (planning-to-do-list.md §5): with every kind checked and no answer
   * pending, what it copies is every request, as `--request` prints it.
   */
  const copyAll = () =>
    screen.getByRole("button", { name: /^Copy answers \+ maintenance / });
  const agentButtons = () =>
    screen
      .queryAllByRole("button", { name: /agent request/ })
      .map((b) => b.getAttribute("aria-label"));

  async function press(button: HTMLElement): Promise<void> {
    await act(async () => {
      fireEvent.click(button);
    });
  }

  beforeEach(() => {
    resetRepoRootsForTests();
    seed();
    serveInfo(ROOT);
    // Every kind checked, Ready to build too.
    localStorage.setItem("vantage:planningCopyLeftOut", "");
  });

  it("says under each heading what its entries are and who acts, in the shared guide's words", async () => {
    await renderPage();
    const shown = [
      "needs-you",
      "unrouted",
      "waiting",
      "ready",
      "graduate",
      "disagrees",
    ] as const;
    for (const id of shown) {
      const { title, explanation } = PLANNING_SECTION_GUIDE[id];
      const region = section(title);
      expect(region, id).toHaveAccessibleDescription(explanation);
      // Directly under the heading's line, ahead of every entry.
      const about = region.querySelector("[data-planning-section-about]")!;
      expect(about.textContent, id).toBe(explanation);
      expect(
        about.compareDocumentPosition(region.querySelector("h2, h3")!) &
          Node.DOCUMENT_POSITION_PRECEDING,
      ).toBeTruthy();
    }
    expect(section("Needs you")).toHaveAccessibleDescription(
      "Open or answered questions on this roadmap, in its order. Rule each open one, then Copy answers.",
    );
  });

  it("gives the contents column's Blocked line the same line on hover", async () => {
    localStorage.setItem("vantage:tocOpen", "true");
    await renderPage();
    const blocked = within(
      screen.getByRole("navigation", { name: "On this page" }),
    )
      .getAllByTestId("outline-line")
      .find((a) => a.getAttribute("data-outline-line") === "waiting")!;
    expect(blocked).toHaveAttribute(
      "title",
      PLANNING_SECTION_GUIDE.waiting.explanation,
    );
  });

  it("says what Needs you holds when no roadmap routes", async () => {
    const { "roadmap.md": _roadmap, ...tree } = TREE;
    seed(tree);
    await renderPage();
    expect(section("Needs you")).toHaveAccessibleDescription(
      sectionExplanation("needs-you", { chosenRoadmap: null }),
    );
  });

  it("gives each agent section Copy agent request, and no Copy all agent requests (planning-to-do-list.md §5)", async () => {
    await renderPage();
    expect(agentButtons()).toEqual([
      "Copy agent request for Not on a roadmap",
      "Copy agent request for Ready to build",
      "Copy agent request for Ready to graduate",
      "Copy agent request for Stage conflict",
      "Copy agent request for To fold into the ledger",
    ]);
    for (const title of ["Needs you", "Blocked"]) {
      expect(
        within(section(title)).queryByRole("button", { name: /agent/ }),
      ).toBeNull();
    }
    // Labelled concisely, named in full, and never printed.
    expect(copyFor("Ready to graduate")).toHaveTextContent(
      /^Copy agent request$/,
    );
    expect(copyFor("Ready to graduate")).toHaveClass("print:hidden");
    expect(
      screen.queryByRole("button", { name: "Copy all agent requests" }),
    ).toBeNull();
  });

  it("copies the request for every entry of its section, on every page, with nothing selected and no network", async () => {
    await renderPage();
    expect(listedIn("Not on a roadmap")).toHaveLength(2);
    // Nothing more is fetched for it.
    vi.mocked(axios.get).mockRejectedValue(new Error("offline"));
    vi.mocked(axios.post).mockRejectedValue(new Error("offline"));
    const { index, sections } = shownState();
    await press(copyFor("Not on a roadmap"));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toBe(
      planningAgentRequest(index, sections, {
        repository: ROOT,
        ids: ["unrouted"],
      }),
    );
    expect(copied).toContain(`Repository: ${ROOT}`);
    expect(copied).toContain("plans/unrouted.md");
    expect(copied).toContain("plans/disagrees.md");
    expect(copied).not.toContain("plans/built.md");
    // Confirmed in the label's own room, and once to a screen reader.
    expect(copyFor("Not on a roadmap")).toHaveTextContent(/^Copied$/);
    expect(
      within(section("Not on a roadmap")).getByText(
        "Copied the agent request for Not on a roadmap.",
      ),
    ).toBeTruthy();

    await press(copyFor("Ready to graduate"));
    expect(writeText.mock.calls[1][0]).toBe(
      planningAgentRequest(index, sections, {
        repository: ROOT,
        ids: ["graduate"],
      }),
    );
  });

  it("copies every agent section's request in one with every kind checked, as vantage-check index --request prints it by default", async () => {
    await renderPage();
    const { index, sections } = shownState();
    await press(copyAll());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toBe(
      planningAgentRequest(index, sections, { repository: ROOT }),
    );
    for (const title of [
      "Not on a roadmap",
      "Ready to build",
      "Ready to graduate",
      "Stage conflict",
    ]) {
      expect(copied).toContain(title);
    }
    expect(copyAll()).toHaveTextContent(/^Copied/);
    expect(
      screen.getByText("Copied your answers and the maintenance checked."),
    ).toBeTruthy();
  });

  describe("Copy answers + maintenance (planning-to-do-list.md §5)", () => {
    const answersButton = () =>
      screen.getByRole("button", { name: COPY_ANSWERS });
    const count = () => screen.getByTestId("copy-maintenance-count");

    it("sits in the header beside Copy answers, counting the answers and the checked kinds' items", async () => {
      // The default: Ready to build left out.
      localStorage.removeItem("vantage:planningCopyLeftOut");
      await renderPage();
      expect(header()).toContainElement(copyAll());
      expect(
        answersButton().compareDocumentPosition(copyAll()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // Not on a roadmap 2, Stage conflict 1, To fold into the ledger 1,
      // Ready to graduate 1; Ready to build's 1 left out.
      expect(count()).toHaveTextContent("5");
      await act(async () => {
        fireEvent.click(
          within(cardFor("OQ-D1")).getByRole("button", {
            name: "Take this leaning",
          }),
        );
      });
      await settle();
      expect(count()).toHaveTextContent("6");
    });

    it("copies Copy answers' text byte for byte, then the request for the checked kinds, as vantage-check index --request prints them", async () => {
      localStorage.setItem("vantage:planningCopyLeftOut", "ready,graduate");
      await renderPage();
      await act(async () => {
        fireEvent.click(
          within(cardFor("OQ-D1")).getByRole("button", {
            name: "Take this leaning",
          }),
        );
      });
      await settle();
      await press(answersButton());
      const answers = writeText.mock.calls[0][0] as string;
      await press(copyAll());
      const copied = writeText.mock.calls[1][0] as string;
      const { index, sections } = shownState();
      expect(copied).toBe(
        `${answers}\n\n${planningAgentRequest(index, sections, {
          repository: ROOT,
          ids: ["unrouted", "disagrees", "compact"],
        })}`,
      );
    });

    it("follows the filter in its counts and in what it copies", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/ready.md");
      expect(count()).toHaveTextContent("1");
      await press(copyAll());
      const { index } = shownState();
      expect(writeText.mock.calls[0][0]).toBe(
        planningAgentRequest(
          index,
          sectionsOf(index, null, "path:plans/ready.md"),
          {
            repository: ROOT,
            filter: {
              text: "path:plans/ready.md",
              unfiltered: derivePlanningSections(index),
              keeps: keepsOf("path:plans/ready.md"),
            },
          },
        ),
      );
    });

    it("is greyed out with nothing to copy, and copies nothing", async () => {
      localStorage.setItem(
        "vantage:planningCopyLeftOut",
        "unrouted,disagrees,compact,graduate,ready",
      );
      await renderPage();
      expect(copyAll()).toHaveAttribute("aria-disabled", "true");
      await press(copyAll());
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  it("shows neither button when no section is an agent's work", async () => {
    seed(
      {
        "roadmap.md": "# Roadmap\n\n1. [Design](plans/design.md)\n",
        "plans/design.md": doc(
          "stage: DESIGN",
          q("OQ-D1", OPEN),
          q("OQ-D2", BLOCKED),
        ),
      },
      {},
    );
    await renderPage();
    expect(section("Needs you")).toBeTruthy();
    expect(section("Blocked")).toBeTruthy();
    expect(agentButtons()).toEqual([]);
  });

  it("names the repository `.` when /info has not reported its root", async () => {
    resetRepoRootsForTests();
    serveInfo(null);
    await renderPage();
    const { index, sections } = shownState();
    await press(copyAll());
    expect(writeText.mock.calls[0][0]).toBe(
      planningAgentRequest(index, sections, { repository: "." }),
    );
  });

  it("names a daemon's repository by its own root", async () => {
    useRepoStore.setState({
      isMultiRepo: true,
      currentRepo: "alpha",
      repos: [{ name: "alpha" }] as never,
    });
    serveTree(TREE, "/api/r/alpha");
    setLoad(readyOf(TREE), "alpha");
    serveInfo("/srv/alpha", "/api/r/alpha");
    await renderPage("/.vantage/planning/alpha");
    const { index, sections } = shownState("alpha");
    await press(copyFor("Ready to build"));
    expect(writeText.mock.calls[0][0]).toBe(
      planningAgentRequest(index, sections, {
        repository: "/srv/alpha",
        ids: ["ready"],
      }),
    );
  });

  // P7, end to end: what a button copies is what the CLI prints for the same
  // files on disk, the same roadmap chosen and the same sections asked for,
  // with the CLI's own newline the only difference. The CLI reads the tree
  // from a directory and its stages from a `.vantage.toml`, as an agent's run
  // does; the page reads the same tree through its scanner.
  it("copies exactly what vantage-check index --request prints for the same tree and roadmap", async () => {
    const NESTED = "docs/plans/roadmap.md";
    const tree: Record<string, string> = {
      ...TREE,
      [NESTED]: [
        "# Plans",
        "",
        "## Later",
        "",
        "1. [One of the design's](../../plans/design.md#OQ-D3)",
        "",
      ].join("\n"),
    };
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vantage-agree-")));
    try {
      const files: Record<string, string> = {
        ...tree,
        ".git/HEAD": "ref: refs/heads/main\n",
        ".vantage.toml": [
          "[planning.stages]",
          ...Object.entries(STAGES ?? {}).map(([w, r]) => `${w} = "${r}"`),
          "",
        ].join("\n"),
      };
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      const cli = async (...args: string[]) => {
        const io = bufferIo(root);
        const code = await run(["index", ...args], io);
        expect(code, args.join(" ")).toBe(0);
        return io.stdout;
      };

      resetRepoRootsForTests();
      seed(tree);
      serveInfo(root);
      await renderPage(`/.vantage/planning?roadmap=${NESTED}`);
      expect(
        (
          screen.getByRole("combobox", {
            name: "Roadmap",
          }) as HTMLSelectElement
        ).value,
      ).toBe(NESTED);

      const pressed: [HTMLElement, string[]][] = [
        [copyAll(), []],
        [copyFor("Not on a roadmap"), ["unrouted"]],
        [copyFor("Ready to build"), ["ready"]],
        [copyFor("Ready to graduate"), ["graduate"]],
        [copyFor("Stage conflict"), ["disagrees"]],
      ];
      for (const [i, [button, ids]] of pressed.entries()) {
        await press(button);
        const copied = writeText.mock.calls[i][0] as string;
        const printed = await cli("--request", ...ids, "--roadmap", NESTED);
        expect(`${copied}\n`, ids.join(" ") || "all").toBe(printed);
        expect(copied.startsWith(`Repository: ${root}\n\n`)).toBe(true);
      }
      // And the default roadmap's run prints the same: no request depends on
      // which roadmap Needs you follows.
      expect(await cli("--request")).toBe(
        `${writeText.mock.calls[0][0] as string}\n`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("says a blocked document is blocked on what it waits on", async () => {
    await renderPage();
    expect(
      within(section("Blocked")).getByText(/^blocked on/),
    ).toHaveTextContent("blocked on design.md#OQ-D1");
  });

  // planning-index.md §6.2: a filtered page's request says so after
  // `Repository:`, in a line whose text leaves out the unmatched terms, lists
  // the kept entries alone, and reads every blocked-on fact from the
  // unfiltered sections.
  it("copies, on a filtered page, the kept entries under a Filter: line", async () => {
    await renderPage(
      "/.vantage/planning?filter=path:plans/desing+path:plans/ready.md",
    );
    await press(copyAll());
    const copied = writeText.mock.calls[0][0] as string;
    const { index } = shownState();
    const sections = sectionsOf(
      index,
      null,
      "path:plans/desing path:plans/ready.md",
    );
    expect(copied).toBe(
      planningAgentRequest(index, sections, {
        repository: ROOT,
        filter: {
          text: "path:plans/ready.md",
          unfiltered: derivePlanningSections(index),
          keeps: keepsOf("path:plans/desing path:plans/ready.md"),
        },
      }),
    );
    expect(copied.split("\n").slice(0, 2)).toEqual([
      `Repository: ${ROOT}`,
      "Filter: `path:plans/ready.md`. Only the entries it keeps are listed.",
    ]);
    expect(copied).toContain("plans/ready.md");
    expect(copied).not.toContain("plans/built.md");
    // Not understood, it is not applied, and its request is the plain one.
    cleanup();
    writeText.mockClear();
    await renderPage("/.vantage/planning?filter=is:closed");
    await press(copyAll());
    expect(writeText.mock.calls[0][0]).toBe(
      planningAgentRequest(index, derivePlanningSections(index), {
        repository: ROOT,
      }),
    );
  });

  it("offers no request when every path: term is unmatched, since nothing is kept", async () => {
    await renderPage("/.vantage/planning?filter=path:plans/desing+is:open");
    expect(agentButtons()).toEqual([]);
  });

  // Criterion 4: on a filtered page, what Copy all agent requests copies is
  // what `vantage-check index --request --filter '<its Filter: line's
  // text>'` prints for the same tree, for every understood text of the
  // fixture of forms whose request is not empty. The CLI reads the fixture
  // from disk, its Too large file a real file over max-file-bytes, as an
  // agent's run does; the page reads it through its scanner.
  it("copies, filtered, exactly what vantage-check index --request --filter prints, for every text of the fixture of forms", async () => {
    const forms = filterForms();
    const { files, skipped, stages, maxFileBytes } = forms.index;
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "vantage-filter-agree-")),
    );
    try {
      const onDisk: Record<string, string> = {
        ...files,
        ...Object.fromEntries(
          skipped.map(({ path, size }) => [path, "x".repeat(size)]),
        ),
        ".git/HEAD": "ref: refs/heads/main\n",
        ".vantage.toml": [
          "[planning]",
          `max-file-bytes = ${maxFileBytes}`,
          "",
          "[planning.stages]",
          ...Object.entries(stages).map(([w, r]) => `${w} = "${r}"`),
          "",
        ].join("\n"),
      };
      for (const [path, content] of Object.entries(onDisk)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      const cli = async (...args: string[]) => {
        const io = bufferIo(root);
        const code = await run(["index", ...args], io);
        return { code, stdout: io.stdout, stderr: io.stderr };
      };
      resetRepoRootsForTests();
      serveTree(files);
      setLoad(
        readyOf(
          files,
          { stages, maxFileBytes },
          {
            skipped,
            candidateCount: Object.keys(files).length + skipped.length,
          },
        ),
      );
      serveInfo(root);
      await renderPage();
      const { index } = shownState();
      let compared = 0;
      for (const { text, canonical } of forms.read) {
        writeText.mockClear();
        if (/[\r\n]/.test(text)) {
          // A text input holds no line break, so this one comes as a link.
          act(() =>
            router.navigate!(
              { search: `?${new URLSearchParams({ filter: text })}` },
              { replace: true },
            ),
          );
        } else {
          await act(async () => {
            fireEvent.change(screen.getByRole("textbox", { name: "Filter" }), {
              target: { value: text },
            });
          });
          await act(async () => {
            fireEvent.submit(screen.getByRole("search"));
          });
        }
        await settle();
        expect(
          new URLSearchParams(router.location.split("?")[1]).get("filter"),
          text,
        ).toBe(canonical);
        const summary = filterSummaryOf(index, "roadmap.md", canonical);
        const button = copyAll();
        if (
          button.getAttribute("aria-disabled") === "true" ||
          summary?.requestText == null
        ) {
          continue;
        }
        await press(button);
        const copied = writeText.mock.calls[0][0] as string;
        expect(copied, text).toBe(
          planningAgentRequest(
            index,
            sectionsOf(index, "roadmap.md", canonical),
            {
              repository: root,
              viewer: VIEWER_RELEASE,
              filter: {
                text: summary.requestText,
                unfiltered: sectionsOf(index, "roadmap.md"),
                keeps: keepsOf(text),
              },
            },
          ),
        );
        const printed = await cli("--request", "--filter", summary.requestText);
        expect(printed.code, text).toBe(0);
        expect(`${copied}\n`, text).toBe(printed.stdout);
        compared++;
      }
      // Most of the fixture's texts keep an agent's entry.
      expect(compared).toBeGreaterThan(20);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("a card's document name, then Back (§6.6)", () => {
  beforeEach(() => seed(ROUTED));

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
          <Route element={<AppShell />}>
            <Route path="/.vantage/planning/*" element={<PlanningPage />} />
            <Route path="/*" element={<BackButton />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await settle();

    // The reader scrolls the pane down to a card, then opens its document
    // in this tab by its name.
    scroller().scrollTop = 640;
    fireEvent.click(nameLink("OQ-U1", "plans/unrouted.md"));
    expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(cardFor("OQ-U1")).toBeTruthy();
    expect(scroller().scrollTop).toBe(640);
  });

  // The pane arrives with the app shell, which waits for the repositories:
  // a page that opened before them follows its scroll all the same.
  it("saves the pane's position as it scrolls, when the page opened before the repositories were known", async () => {
    const { loadRepos } = useRepoStore.getState();
    useRepoStore.setState({ reposLoaded: false, loadRepos: async () => {} });
    try {
      await renderPage();
      expect(screen.queryByTestId("sidebar")).toBeNull();
      act(() => useRepoStore.setState({ reposLoaded: true }));
      await settle();
      scroller().scrollTop = 480;
      await act(async () => {
        scroller().dispatchEvent(new Event("scroll"));
      });
      await settle();
      // A link that saves nothing on its way out.
      fireEvent.click(
        within(section("Blocked")).getByRole("link", {
          name: "design.md#OQ-D1",
        }),
      );
      expect(screen.getByTestId("viewer")).toBeTruthy();
      act(() => router.navigate!(-1));
      await settle();
      expect(scroller().scrollTop).toBe(480);
    } finally {
      useRepoStore.setState({ loadRepos });
    }
  });

  it("restores nothing on a fresh visit", async () => {
    const scrolled = watchScrollTop();
    try {
      await renderPage();
      expect(scrolled).not.toHaveBeenCalled();
    } finally {
      scrolled.restore();
    }
  });
});

describe("Open document (§6.6)", () => {
  beforeEach(() => seed(ROUTED));

  // Its icon is the one for a link that opens elsewhere, and a reader who
  // clicked it expected a new tab (user direction, 2026-10-01). The page
  // stays as it was in its own.
  it("opens the card's document in a new tab, and leaves the page where it is", async () => {
    await renderPage();
    scroller().scrollTop = 640;
    const link = within(cardFor("OQ-U1")).getByRole("link", {
      name: OPEN_DOCUMENT,
    });
    // The document's top: no fragment.
    expect(link).toHaveAttribute("href", "/plans/unrouted.md");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Not prevented: the browser opens the tab, and this one stays.
    expect(fireEvent.click(link)).toBe(true);
    await settle();
    expect(router.location).toBe("/.vantage/planning");
    expect(screen.queryByTestId("viewer")).toBeNull();
    expect(cardFor("OQ-U1")).toBeTruthy();
    expect(scroller().scrollTop).toBe(640);
  });
});

describe("scoping a comment to its question, over agent-bootstrap.md", () => {
  // Its five open questions are items of one loose list, so every card's DOM
  // holds all five (the trap `docs/reference/planning-index.md` §6.6 warns of).
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

    await settle();
    // Answered here, its card is a row now (planning-to-do-list.md §4.1).
    expect(bootstrapCard("OQ-B3")).toBeUndefined();
    for (const id of ["OQ-B1", "OQ-B2", "OQ-B4", "OQ-B5"]) {
      const list = within(bootstrapCard(id)).queryByRole("list", {
        name: "Comments on this question",
      });
      expect(list, id).toBeNull();
    }
    // Shown again, its card lists the take.
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("group", { name: /^OQ-B3:/ })).getByRole(
          "button",
          { name: /^Show/ },
        ),
      );
    });
    await settle();
    expect(
      within(bootstrapCard("OQ-B3")).getByRole("list", {
        name: "Comments on this question",
      }),
    ).toHaveTextContent("Both, and stop there.");

    expect(screen.getByTestId("pending-answers")).toHaveTextContent("1");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: COPY_ANSWERS }));
    });
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload.match(/^\*\*Comment:\*\* /gm)).toHaveLength(1);
    expect(payload).toContain("**Comment:** Both, and stop there.");
  });
});

describe("in a static export (§15, Plan Q3)", () => {
  afterEach(() => {
    delete window.__VANTAGE_STATIC__;
  });

  it("shows the failed-fetch error, and asks for no review", async () => {
    window.__VANTAGE_STATIC__ = true;
    await renderPage();
    expect(screen.getByText(STATIC_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(reviewGets()).toEqual([]);
    expect(vi.mocked(axios.post)).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * The app shell, and the planning outline (planning-index.md §6.1, §6.9)
 * ------------------------------------------------------------------ */

const header = () => screen.getByTestId("planning-header");

describe("in the app shell (§6.1)", () => {
  beforeEach(() => seed());

  it("draws the page beside the sidebar, under the viewer's header", async () => {
    await renderPage();
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    // The sidebar's file tree, read as the viewer reads it.
    expect(
      vi
        .mocked(axios.get)
        .mock.calls.some(([url]) => String(url).startsWith("/api/tree?")),
    ).toBe(true);
    expect(
      within(header()).getByRole("heading", { level: 1, name: "Planning" }),
    ).toBeTruthy();
    expect(
      within(header()).getByRole("link", { name: "root" }),
    ).toHaveAttribute("href", "/");
    expect(
      within(header()).getByRole("button", { name: "Open sidebar" }),
    ).toBeTruthy();
    expect(
      within(header()).getByRole("button", { name: "Show contents" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(header()).getByRole("button", { name: "Use full width" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(header()).getByRole("button", { name: COPY_ANSWERS }),
    ).toBeTruthy();
    // A document's controls have no meaning here.
    for (const name of ["Raw", "Path", "Review"]) {
      expect(within(header()).queryByRole("button", { name })).toBeNull();
    }
  });

  it("puts the sidebar away with b, as the viewer does", async () => {
    await renderPage();
    const open = within(header()).getByRole("button", { name: "Open sidebar" });
    expect(open).toHaveClass("md:hidden");
    act(() => {
      fireEvent.keyDown(document, { key: "b" });
    });
    expect(localStorage.getItem("vantage:sidebarCollapsed")).toBe("true");
    expect(open).not.toHaveClass("md:hidden");
  });

  it("widens the cards on Use full width, which is the viewer's own preference", async () => {
    await renderPage();
    const column = screen.getByRole("main");
    expect(column).toHaveClass("max-w-4xl");
    fireEvent.click(
      within(header()).getByRole("button", { name: "Use full width" }),
    );
    expect(column).toHaveClass("max-w-none");
    expect(localStorage.getItem("vantage:fullWidth")).toBe("true");
    expect(
      within(header()).getByRole("button", { name: "Use fixed width" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("offers neither the sidebar nor the contents column where no repository is named", async () => {
    useRepoStore.setState({
      isMultiRepo: true,
      currentRepo: null,
      repos: [{ name: "alpha" }] as never,
    });
    await renderPage("/.vantage/planning");
    expect(screen.getByText(/Choose a project/)).toBeTruthy();
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(
      within(header()).queryByRole("button", { name: "Show contents" }),
    ).toBeNull();
  });
});

describe("the planning outline, On this page (planning-to-do-list.md §3.5)", () => {
  beforeEach(() => {
    localStorage.setItem("vantage:tocOpen", "true");
  });

  const outline = () =>
    screen.getByRole("navigation", { name: "On this page" });
  const outlineDocuments = () =>
    within(outline())
      .queryAllByTestId("outline-document")
      .map((a) => a.getAttribute("aria-label"));
  const outlineLines = () =>
    within(outline())
      .queryAllByTestId("outline-line")
      .map((a) => a.textContent);
  const outlineLine = (id: string) =>
    outline().querySelector<HTMLAnchorElement>(`[data-outline-line="${id}"]`)!;
  const outlineDocument = (path: string) =>
    outline().querySelector<HTMLAnchorElement>(
      `[data-testid=outline-document][data-path="${path}"]`,
    )!;

  /** A question's card id (`planningCardId`), from the index seeded. */
  const cardId = (path: string, id: string) => {
    const load = usePlanningStore.getState().byRepo[""];
    const index = load?.status === "ready" ? load.index : null;
    const question = index!.documents
      .find((d) => d.path === path)!
      .questions.find((x) => x.id === id)!;
    return planningCardId(path, id, question.unitLine);
  };

  it("is the contents column, which the header's toggle shows and hides", async () => {
    localStorage.removeItem("vantage:tocOpen");
    seed();
    await renderPage();
    expect(
      screen.queryByRole("navigation", { name: "On this page" }),
    ).toBeNull();
    fireEvent.click(
      within(header()).getByRole("button", { name: "Show contents" }),
    );
    expect(outline()).toBeTruthy();
    expect(within(outline()).getByText("On this page")).toBeTruthy();
    expect(localStorage.getItem("vantage:tocOpen")).toBe("true");
  });

  it("lists the full cards' documents in list order, each with its questions that need you, then the answered rows, Blocked and Maintenance", async () => {
    pageSize(2);
    const tree = {
      ...todoTree(4),
      "roadmap.md":
        "# Roadmap\n\n1. [The list](plans/todo.md)\n2. [Other](plans/other.md)\n3. [Third](plans/third.md)\n",
      "plans/other.md": doc(
        "stage: DESIGN",
        q("OQ-O1", OPEN),
        q("OQ-O2", BLOCKED),
      ),
      "plans/third.md": doc("stage: DESIGN", q("OQ-H1", OPEN)),
      "plans/ready.md": doc("status: accepted\nstage: DECIDED", "Decided."),
    };
    seed(tree);
    answer(tree, "OQ-T1", "OQ-T2", "OQ-T3");
    await renderPage();
    expect(cardIds()).toEqual(["OQ-T4", "OQ-O1"]);
    // The documents of the full cards only, with all their questions that
    // need you; third.md's question is past the page size.
    expect(outlineDocuments()).toEqual([
      "plans/todo.md, 1 needs you",
      "plans/other.md, 1 needs you",
    ]);
    expect(outlineLines()).toEqual([
      "Answered 3",
      "Blocked 1",
      "Maintenance 1",
    ]);
    // Maintenance's items are not listed.
    expect(outline()).not.toHaveTextContent("ready.md");
  });

  it("goes to a document's first card, with no history entry, and the focus to its first control", async () => {
    seed();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage();
      scrolled.mockClear();
      await act(async () => {
        fireEvent.click(outlineDocument("plans/design.md"));
      });
      await settle();
      expect(router.location).toBe("/.vantage/planning");
      const card = cardFor("OQ-D1");
      expect(card.id).toBe(cardId("plans/design.md", "OQ-D1"));
      expect(scrolled.mock.contexts).toContain(card);
      expect(card.contains(document.activeElement)).toBe(true);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("goes to a folded group's heading, opening the group first, with no history entry", async () => {
    localStorage.removeItem("vantage:planningMaintenanceOpen");
    seed();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage("/.vantage/planning", ["/plans/roadmap.md"]);
      expect(querySection("Ready to build")).toBeNull();
      scrolled.mockClear();
      await act(async () => {
        fireEvent.click(outlineLine("maintenance"));
      });
      await settle();
      expect(router.location).toBe("/.vantage/planning");
      expect(querySection("Ready to build")).not.toBeNull();
      const heading = document.getElementById("maintenance")!;
      expect(scrolled.mock.contexts).toContain(heading);
      expect(document.activeElement).toBe(heading);
      act(() => router.navigate!(-1));
      expect(router.location).toBe("/plans/roadmap.md");
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("goes to the first answered row", async () => {
    pageSize(2);
    const tree = todoTree(3);
    seed(tree);
    answer(tree, "OQ-T2");
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage();
      await act(async () => {
        fireEvent.click(outlineLine("answered"));
      });
      await settle();
      const row = screen.getByRole("group", {
        name: "OQ-T2: Question OQ-T2?",
      });
      expect(scrolled.mock.contexts).toContain(row);
      expect(row.contains(document.activeElement)).toBe(true);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("links each entry to what it goes to, and leaves a modified click to the browser", async () => {
    seed();
    await renderPage();
    const design = outlineDocument("plans/design.md");
    expect(design).toHaveAttribute(
      "href",
      `/.vantage/planning#${cardId("plans/design.md", "OQ-D1")}`,
    );
    expect(outlineLine("waiting")).toHaveAttribute(
      "href",
      "/.vantage/planning#waiting",
    );
    fireEvent.click(design, { ctrlKey: true });
    await settle();
    expect(router.location).toBe("/.vantage/planning");
  });

  it("scrolls to the card a link's fragment names once the sections are in", async () => {
    seed();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage(
        `/.vantage/planning#${cardId("plans/design.md", "OQ-D1")}`,
      );
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toBe(cardFor("OQ-D1"));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("keeps a link's fragment through the rewrite of its query, and scrolls to its card", async () => {
    seed();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      const id = cardId("plans/design.md", "OQ-D1");
      // An old page parameter, which the rewrite drops.
      await renderPage(`/.vantage/planning?unrouted=1#${id}`);
      expect(router.location).toBe("/.vantage/planning");
      expect(router.hash).toBe(`#${id}`);
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toBe(cardFor("OQ-D1"));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("scrolls to the row a link's fragment names once the sections are in", async () => {
    seed();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    try {
      await renderPage(
        `/.vantage/planning#${planningRowId("ready", "plans/ready.md")}`,
      );
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.contexts[0]).toBe(
        section("Ready to build").querySelector(
          '[data-planning-document="plans/ready.md"]',
        ),
      );
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("marks the document and the line being read as the pane scrolls", async () => {
    seed();
    // A layout of the page's own: every element of the sections that has
    // an id stands 100px below the one before it, less how far the pane has
    // scrolled, and the pane itself at the top of the window.
    let scrolledBy = 0;
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const placed = Array.from(
          document.querySelectorAll("[data-planning-sections] [id]"),
        );
        const at = placed.indexOf(this);
        const top = at === -1 ? 0 : at * 100 - scrolledBy;
        return { top, bottom: top, left: 0, right: 0 } as DOMRect;
      });
    try {
      await renderPage();
      const current = () =>
        Array.from(
          outline().querySelectorAll("[aria-current=location]"),
          (a) => a.getAttribute("aria-label") ?? a.textContent,
        );
      expect(current()).toEqual(["plans/design.md, 2 need you"]);
      const placed = Array.from(
        document.querySelectorAll("[data-planning-sections] [id]"),
      );
      scrolledBy =
        placed.indexOf(document.getElementById("maintenance")!) * 100 - 20;
      await act(async () => {
        scroller().dispatchEvent(new Event("scroll"));
      });
      await settle();
      expect(current()).toEqual(["Maintenance 6"]);
    } finally {
      rect.mockRestore();
    }
  });

  it("lists outlineDocuments documents, and says how many more", async () => {
    setPlanningLimitsForTests({ outlineDocuments: 1 });
    seed(ROUTED);
    await renderPage();
    expect(outlineDocuments()).toEqual(["plans/design.md, 2 need you"]);
    expect(within(outline()).getByTestId("outline-more")).toHaveTextContent(
      "and 1 more document",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Expand all and Collapse all (user direction, 2026-10-01)
 * ------------------------------------------------------------------ */

describe("Expand all and Collapse all (planning-index.md §6.6)", () => {
  const KEY = "vantage:planningCardsExpanded";
  const UNFOLDED = "data-planning-card-unfolded";

  /** A question with a second paragraph, which a folded card folds away. */
  const long = (id: string) =>
    [
      `1. ${OPEN} **${id}: Question ${id}?** Some background.`,
      "",
      `   More of ${id}, folded away.`,
      "",
      `   ${questionDirective(OPEN, id, "Yes.")}`,
      "",
      "   _Leaning:_ Yes.",
      "",
    ].join("\n");
  const FOLDING: Record<string, string> = {
    "roadmap.md": "# Roadmap\n\n1. [The design](plans/design.md) first.\n",
    "plans/design.md": doc(
      "status: in-review\nstage: DESIGN",
      long("OQ-L1"),
      long("OQ-L2"),
      long("OQ-L3"),
    ),
    "plans/unrouted.md": doc("stage: DESIGN", long("OQ-U1")),
  };

  // Needs you at two cards, and a larger page size that brings in OQ-L3.
  beforeEach(() => {
    pageSize(2);
    seed(FOLDING);
  });

  const toggle = () =>
    screen.getByRole("button", { name: /^(Expand all|Collapse all)$/ });
  const press = async (button: HTMLElement) => {
    await act(async () => {
      fireEvent.click(button);
    });
    await settle();
  };
  /** Every card on screen, by question, and whether it is unfolded. */
  const folds = () =>
    Object.fromEntries(
      screen
        .getAllByRole("article")
        .map((a) => [
          a.getAttribute("aria-label")!.split(":")[0],
          a.querySelector(".planning-card-body")!.hasAttribute(UNFOLDED),
        ]),
    );
  const foldOf = (id: string) =>
    within(cardFor(id)).getByRole("button", {
      name: /^Show (full question|less)$/,
    });
  /** A page size chosen on the end line: a new layout. */
  const size = async (n: "2" | "20") =>
    press(
      within(screen.getByTestId("needs-you-end")).getByRole("button", {
        name: n,
      }),
    );

  it("sits with the header's view toggles, and folds and unfolds every card on the page (planning-to-do-list.md §3.1)", async () => {
    await renderPage();
    const button = toggle();
    expect(button).toHaveAccessibleName("Expand all");
    // In the header, after the full-width toggle, and never in the pane.
    expect(header()).toContainElement(button);
    const width = within(header()).getByRole("button", {
      name: "Use full width",
    });
    expect(
      width.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(button).toHaveClass("hdr-view");
    expect(folds()).toEqual({ "OQ-L1": false, "OQ-L2": false });

    await press(button);
    expect(folds()).toEqual({ "OQ-L1": true, "OQ-L2": true });
    expect(toggle()).toHaveAccessibleName("Collapse all");
    expect(readPreference(KEY)).toBe("true");

    await press(toggle());
    expect(folds()).toEqual({ "OQ-L1": false, "OQ-L2": false });
    expect(toggle()).toHaveAccessibleName("Expand all");
    expect(readPreference(KEY)).toBe("false");
  });

  it("opens every card rendered later its way: a new layout, and the next visit, from its first render", async () => {
    const view = await renderPage();
    await press(toggle());
    await size("20");
    expect(folds()).toEqual({ "OQ-L1": true, "OQ-L2": true, "OQ-L3": true });
    view.unmount();

    // The next visit: every card is unfolded when it is put on the page, so
    // none of them unfolds after.
    const flipped: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      flipped.push(...records),
    );
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: [UNFOLDED],
    });
    await renderPage();
    flipped.push(...observer.takeRecords());
    observer.disconnect();
    expect(folds()).toEqual({ "OQ-L1": true, "OQ-L2": true, "OQ-L3": true });
    expect(flipped).toEqual([]);
    expect(toggle()).toHaveAccessibleName("Collapse all");
  });
  it("lets a card's own fold win until the next Expand all or Collapse all, across a new layout", async () => {
    await renderPage();
    await press(toggle());
    await press(foldOf("OQ-L1"));
    expect(folds()).toEqual({ "OQ-L1": false, "OQ-L2": true });

    // Through a new layout, it is as the reader left it.
    await size("20");
    expect(folds()).toEqual({ "OQ-L1": false, "OQ-L2": true, "OQ-L3": true });

    // The next press brings every card to the page's, its own included.
    await press(toggle());
    expect(folds()).toEqual({ "OQ-L1": false, "OQ-L2": false, "OQ-L3": false });
    await press(toggle());
    expect(folds()).toEqual({ "OQ-L1": true, "OQ-L2": true, "OQ-L3": true });
    // And forgets the card's own fold.
    await size("2");
    expect(folds()).toEqual({ "OQ-L1": true, "OQ-L2": true });
  });
  it("follows another tab's choice for the cards it renders later, and moves none on screen", async () => {
    await renderPage();
    localStorage.setItem(KEY, "true");
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: KEY,
          newValue: "true",
          storageArea: localStorage,
        }),
      );
    });
    await settle();
    expect(folds()).toEqual({ "OQ-L1": false, "OQ-L2": false });
    // Named for what a press does to the cards on screen, which the other
    // tab's choice left folded.
    expect(toggle()).toHaveAccessibleName("Expand all");
    await size("20");
    expect(folds()).toEqual({ "OQ-L1": false, "OQ-L2": false, "OQ-L3": true });
    expect(toggle()).toHaveAccessibleName("Expand all");
    // So the first press here does what it says.
    await press(toggle());
    expect(folds()).toEqual({ "OQ-L1": true, "OQ-L2": true, "OQ-L3": true });
    expect(toggle()).toHaveAccessibleName("Collapse all");
    expect(readPreference(KEY)).toBe("true");
    await press(toggle());
    expect(folds()).toEqual({ "OQ-L1": false, "OQ-L2": false, "OQ-L3": false });
    expect(readPreference(KEY)).toBe("false");
  });

  it("tells a screen reader what a press did, and nothing before one", async () => {
    await renderPage();
    const status = document.querySelector("[data-planning-cards-status]")!;
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/^$/);
    await press(toggle());
    expect(status).toHaveTextContent("Every question is shown in full.");
    await press(toggle());
    expect(status).toHaveTextContent(
      "Every question is folded to its first lines.",
    );
  });

  it("keeps its place in the header on a page with no question cards, from the first paint", async () => {
    seed({
      "roadmap.md": "# Roadmap\n",
      "plans/ready.md": doc("status: accepted\nstage: DECIDED", "Decided."),
    });
    await renderPage();
    expect(documentsIn("Ready to build")).toEqual(["plans/ready.md"]);
    expect(header()).toContainElement(toggle());
  });
});

/* ------------------------------------------------------------------ *
 * A comment on a question is its answer (§6.7)
 * ------------------------------------------------------------------ */

describe("a comment on a question is its answer (§6.7)", () => {
  const ANSWERED_CHIP = "Answered — waiting on the agent";

  it("lists a question your comment answers as an answered row with its card's chip, and copies it (planning-to-do-list.md §3.3)", async () => {
    seed();
    answer(TREE, "OQ-D1");
    await renderPage();
    const row = screen.getByRole("group", { name: "OQ-D1: Question OQ-D1?" });
    expect(within(row).getByText(ANSWERED_CHIP)).toHaveClass(
      "review-oq-answered",
    );
    expect(rowIds()).toEqual(["OQ-D1"]);
    expect(cardsIn("Needs you")).toEqual(["OQ-D3: Question OQ-D3?"]);
    // Its sibling in the same list is not answered by it.
    expect(
      within(cardFor("OQ-D3")).getByRole("button", {
        name: "Take this leaning",
      }),
    ).toBeTruthy();
    // And Copy answers holds it.
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("1");
  });
  it("does not take a comment the agent has answered for the human's answer", async () => {
    seed();
    const { path, comment } = typedOnTitle(TREE, "OQ-D1", {
      reactions: [
        {
          actor: "agent",
          kind: "addressed",
          summary: "Done.",
          before_text: "",
          after_text: "",
          timestamp: Date.now() / 1000 + 10,
        },
      ],
    });
    reviews[path] = [comment];
    await renderPage();
    expect(within(cardFor("OQ-D1")).queryByText(ANSWERED_CHIP)).toBeNull();
    expect(screen.getByTestId("pending-answers")).toHaveTextContent("0");
  });

  it("says Nothing needs you on Needs you's end line once the last card is answered here", async () => {
    seed();
    answer(TREE, "OQ-D1");
    await renderPage();
    expect(screen.getByTestId("needs-you-end")).toHaveTextContent(/^show /);
    await act(async () => {
      fireEvent.click(
        within(cardFor("OQ-D3")).getByRole("button", {
          name: "Take this leaning",
        }),
      );
    });
    await settle();
    expect(screen.getByTestId("needs-you-end")).toHaveTextContent(
      "Nothing needs you",
    );
    // Every row still listed, each with its chip.
    expect(rowIds()).toEqual(["OQ-D1", "OQ-D3"]);
    expect(
      screen.getByRole("group", { name: "OQ-D3: Question OQ-D3?" }),
    ).toHaveTextContent("Leaning taken");
  });
  it("draws it with the first sections when every answer is in their documents' reviews", async () => {
    seed();
    answer(TREE, "OQ-D1", "OQ-D3");
    await renderPage();
    expect(screen.getByTestId("needs-you-end")).toHaveTextContent(
      "Nothing needs you",
    );
    // The index's own line is for no open question at all.
    expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
  });
  it("says in Needs you's heading how many need you, live, and how many answered rows it lists", async () => {
    seed();
    answer(TREE, "OQ-D1", "OQ-D3");
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 2, name: /^Needs you/ }),
    ).toHaveTextContent(/^Needs you\s*0\s*·\s*2 answered$/);
  });
  describe("with several roadmaps", () => {
    const NESTED = "docs/plans/roadmap.md";
    const TWO: Record<string, string> = {
      ...TREE,
      [NESTED]: [
        "# Plans",
        "",
        "## Later",
        "",
        "1. [Not on a roadmap until now](../../plans/unrouted.md)",
        "2. [One of the design's](../../plans/design.md#OQ-D3)",
        "",
      ].join("\n"),
    };
    const picker = () =>
      screen.getByRole("combobox", { name: "Roadmap" }) as HTMLSelectElement;
    const options = () =>
      Array.from(picker().options, (option) => option.textContent);

    it("takes the answered questions off the picker's counts and the other-roadmaps line", async () => {
      seed(TWO);
      answer(TWO, "OQ-D1", "OQ-U1");
      // Held before the page opens, as a visit earlier in the tab leaves them.
      await act(async () => {
        await fetchPlanningReviews("", [
          "plans/design.md",
          "plans/unrouted.md",
        ]);
      });
      await renderPage();

      expect(options()).toEqual([
        "roadmap.md (2 need you)",
        "docs/plans/roadmap.md (1 needs you)",
      ]);
      const shown = screen.getByTestId("roadmap-shown");
      expect(shown).toHaveTextContent("roadmap.md (2 need you)");
      // Room for the count the index gives, so a count lowered later moves
      // nothing.
      expect(shown.querySelector(".hdr-reserve")).toHaveAttribute(
        "data-reserve",
        "(3 needs you)",
      );
      const others = screen.getByTestId("other-roadmaps");
      expect(others).toHaveTextContent(
        "No more questions need you on other roadmaps.",
      );
      expect(others).toHaveAttribute(
        "data-reserve",
        PLANNING_NOTICES.otherRoadmaps(1),
      );
      // Listed as an answered row, with its chip.
      expect(
        within(
          screen.getByRole("group", { name: "OQ-D1: Question OQ-D1?" }),
        ).getByText(ANSWERED_CHIP),
      ).toBeTruthy();
    });

    it("says nothing matches, and not that nothing needs you, for a filter that keeps none of the answered questions' entries", async () => {
      seed(TWO);
      // Every question the filter keeps is answered and on the other
      // roadmap, so it keeps no entry under this one.
      answer(TWO, "OQ-U1");
      await renderPage("/.vantage/planning?filter=path:plans/unrouted.md");
      expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
        "No more questions need you on other roadmaps.",
      );
      expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
      expect(screen.getByTestId("nothing-matches")).toHaveTextContent(
        /^Nothing on this roadmap matches path:plans\/unrouted\.md\./,
      );
    });

    it("counts an answer on another roadmap's question on a cold visit, from the first paint", async () => {
      seed(TWO);
      // OQ-U1 is on no page shown under roadmap.md, and nothing read its
      // document's reviews before this visit: they come with the page inputs,
      // since its question needs you on the other roadmap.
      answer(TWO, "OQ-U1");
      await renderPage();
      expect(screen.getByTestId("pending-answers")).toHaveTextContent("1");
      expect(options()).toEqual([
        "roadmap.md (3 need you)",
        "docs/plans/roadmap.md (1 needs you)",
      ]);
      expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
        "No more questions need you on other roadmaps.",
      );
    });

    it("lowers the reserved counts at once when an answer's reviews arrive late, and draws Nothing needs you only with the next sections", async () => {
      // Every open question answered, OQ-U1's in a document whose reviews
      // come past the deadline, after the sections painted.
      setPlanningLimitsForTests({ reviewsDeadlineMs: 10 });
      const done = { ...TWO };
      delete done["plans/disagrees.md"];
      seed(done);
      answer(done, "OQ-D1", "OQ-D3", "OQ-U1");
      await act(async () => {
        await fetchPlanningReviews("", ["plans/design.md"]);
      });
      const real = vi.mocked(axios.post).getMockImplementation()!;
      let release = () => {};
      vi.mocked(axios.post).mockImplementation((url, body, config) => {
        const paths = (body as { paths?: string[] } | undefined)?.paths ?? [];
        if (
          String(url).endsWith("/planning/reviews") &&
          paths.includes("plans/unrouted.md")
        ) {
          return new Promise((resolve) => {
            release = () => resolve(real(url, body, config));
          });
        }
        return real(url, body, config);
      });
      await renderPage();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      await settle();
      // Painted before OQ-U1's answer was known.
      expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
        PLANNING_NOTICES.otherRoadmaps(1),
      );
      expect(screen.queryByTestId("nothing-needs-you")).toBeNull();

      await act(async () => {
        release();
      });
      await settle();
      // The reserved counts follow at once, within the room they kept.
      expect(options()).toEqual([
        "roadmap.md (1 needs you)",
        "docs/plans/roadmap.md (0 need you)",
      ]);
      expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
        "No more questions need you on other roadmaps.",
      );
      // The line that would move the sections waits for the next commit.
      expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
      await act(async () => {
        fireEvent.change(picker(), { target: { value: NESTED } });
      });
      await settle();
      expect(screen.getByTestId("needs-you-end")).toHaveTextContent(
        "Nothing needs you",
      );
    });
  });
});

/* ------------------------------------------------------------------ *
 * The planning filter (docs/reference/planning-index.md §6.11)
 * ------------------------------------------------------------------ */

describe("the planning filter (planning-index.md §6.11)", () => {
  beforeEach(() => seed());

  /** A second roadmap, which routes plans/unrouted.md alone. */
  const NESTED = "docs/plans/roadmap.md";
  const TWO: Record<string, string> = {
    ...TREE,
    [NESTED]: "# Plans\n\n1. [The unrouted one](../../plans/unrouted.md)\n",
  };

  const box = () =>
    screen.getByRole("textbox", { name: "Filter" }) as HTMLInputElement;
  const form = () =>
    screen.getByRole("search", { name: "Filter the planning page" });
  const notice = () => screen.queryByTestId("filter-notice");
  const noticeLines = () =>
    Array.from(notice()?.querySelectorAll("p") ?? [], (p) => p.textContent);
  /** The hint, which shares its slot with the counts: `""` when it is not shown. */
  const hint = () => {
    const slot = screen.getByTestId("planning-filter-hint");
    return slot.querySelector("[data-testid=planning-filter-counts]") === null
      ? slot.textContent
      : "";
  };
  const status = () => screen.getByTestId("planning-filter-status");
  /**
   * The filter the page on screen is laid out under, as its sections' box
   * says: what the notice's first line named until the filter line's counts
   * replaced it (planning-to-do-list.md §3.2).
   */
  const filterShown = () =>
    document
      .querySelector("[data-planning-sections]")
      ?.getAttribute("data-planning-filter") ?? null;
  /** The filter line's counts, *N match · M hidden*, or `null`. */
  const counts = () =>
    screen.queryByTestId("planning-filter-counts")?.textContent ?? null;
  /** What else the summary says, in the counts' tooltip. */
  const clauses = () =>
    screen.getByTestId("planning-filter-hint").getAttribute("title");
  /** What stands in place of the sections when a filter keeps no entry. */
  const nothingMatches = () => screen.queryByTestId("nothing-matches");
  /** Its headline, then its reason line, as read; `null` while it is not shown. */
  const nothingMatchesLines = () => {
    const shown = nothingMatches();
    return shown === null
      ? null
      : [shown.querySelector("h2"), ...shown.querySelectorAll("p")].map(
          (el) => el?.textContent,
        );
  };
  /** The reason line after Nothing matches for a word that matches nothing. */
  const WORDS =
    "Words and quoted phrases are matched only against a question's id, title and leaning, and a document's path, stage and next step.";
  /** The box's own ✕, whose name the empty state's button shares. */
  const clearX = () =>
    within(form()).getByRole("button", { name: "Clear the filter" });
  const spinning = () =>
    screen.getByTestId("planning-filter-spinner-slot").querySelector("svg") !==
    null;

  async function type(text: string): Promise<void> {
    await act(async () => {
      fireEvent.change(box(), { target: { value: text } });
    });
  }
  /** Enter in the box: its form's submit, which is what Enter does. */
  async function enter(text?: string): Promise<void> {
    if (text !== undefined) await type(text);
    await act(async () => {
      fireEvent.submit(form());
    });
    await settle();
  }
  async function paste(text: string): Promise<void> {
    await act(async () => {
      fireEvent.paste(box(), { clipboardData: { getData: () => text } });
    });
    await settle();
  }
  async function press(key: string, target: EventTarget = document) {
    await act(async () => {
      fireEvent.keyDown(target, { key });
    });
    await settle();
  }

  /**
   * What the checker prints for criterion 1, around its link: the whole of
   * `vantage-check index --filter 'path:/plans/design.md is:open'` over the
   * tree on disk, so it is always what this release's checker prints.
   */
  async function checkerBlock(): Promise<string> {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vantage-block-")));
    try {
      const files: Record<string, string> = {
        ...TREE,
        ".git/HEAD": "ref: refs/heads/main\n",
        ".vantage.toml": [
          "[planning.stages]",
          ...Object.entries(STAGES ?? {}).map(([w, r]) => `${w} = "${r}"`),
          "",
        ].join("\n"),
      };
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      const io = bufferIo(root);
      const code = await run(
        ["index", "--filter", "path:/plans/design.md is:open"],
        io,
      );
      expect(code).toBe(0);
      // Its link ends with the space id the run made in the tree
      // (planning-index.md §13.6).
      const space = readFileSync(join(root, ".vantage/space"), "utf8").trim();
      expect(io.stdout).toContain(
        `\nPlanning page: /.vantage/planning?filter=path:/plans/design.md+is:open&space=${space}\n`,
      );
      return io.stdout;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  describe("opened from a link", () => {
    it("draws the sections' box anew when its frame lands after the index builds, so nothing painted moves", async () => {
      // Opened cold, the spinner paints in the sections' box under the
      // progress line. The frame lands with the notice above that box, so
      // the box is replaced, a removal and an insertion, rather than moved
      // down (planning-index.md §18, criterion 8).
      setPlanningLimitsForTests({ spinnerMs: 0 });
      setLoad({ status: "loading", warm: false, progress: null });
      let release: () => void = () => {};
      serveTree(TREE, "/api", (inline) => ({
        cards: (repo, want, options) =>
          new Promise<CardAnswer[]>((resolve) => {
            release = () => resolve(inline.cards(repo, want, options));
          }),
      }));
      await renderPage(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      setLoad(readyOf(TREE));
      await settle();
      const spinnerBox = document.querySelector("[data-planning-sections]")!;
      expect(
        within(spinnerBox as HTMLElement).getByLabelText(
          "Loading this page's cards",
        ),
      ).toBeTruthy();
      expect(counts()).toBeNull();
      release();
      await settle();
      expect(counts()).not.toBeNull();
      expect(cardsIn("Needs you")).toHaveLength(2);
      expect(document.querySelector("[data-planning-sections]")).not.toBe(
        spinnerBox,
      );
      expect(spinnerBox.isConnected).toBe(false);
    });

    it("shows only what the filter keeps, counted in the filter line, with the box holding its text (planning-to-do-list.md §3.2)", async () => {
      await renderPage(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
      for (const name of ["Not on a roadmap", "Blocked", "Ready to build"]) {
        expect(querySection(name)).toBeNull();
      }
      expect(screen.getByTestId("needs-you-count")).toHaveTextContent("2");
      expect(box().value).toBe("path:plans/design.md is:open");
      // An item is a question or a document row, counted once; no notice
      // line repeats the box.
      expect(counts()).toBe("2 match · 8 hidden");
      expect(notice()).toBeNull();
      // What the counts cannot say is in their tooltip.
      expect(clauses()).toBe(
        "1 of its questions is blocked and will need you later.",
      );
      // Already canonical, in the link encoding: nothing to rewrite.
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      expect(box()).not.toHaveAttribute("aria-invalid");
      // The box never takes the focus as the page opens.
      expect(document.activeElement).not.toBe(box());
    });

    it("rewrites the filter to its canonical text as one parameter, in place, keeping the fragment", async () => {
      await renderPage(
        "/.vantage/planning?filter=path:./plans/design.md&x=1&filter=is:open#needs-you",
        ["/plans/roadmap.md"],
      );
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:/plans/design.md+is:open&x=1",
      );
      expect(router.hash).toBe("#needs-you");
      expect(box().value).toBe("path:/plans/design.md is:open");
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
      // In place of the history entry.
      act(() => router.navigate!(-1));
      expect(router.location).toBe("/plans/roadmap.md");
    });

    it("removes an empty filter, so an unfiltered address never carries one", async () => {
      await renderPage("/.vantage/planning?filter=&x=1&filter=+");
      expect(router.location).toBe("/.vantage/planning?x=1");
      expect(notice()).toBeNull();
      expect(cardsIn("Needs you")).toHaveLength(2);
    });

    it("applies nothing it cannot read, shows every entry, names the term and leaves the address as written", async () => {
      const url =
        "/.vantage/planning?filter=path:plans/design.md+is:closed+is:open";
      await renderPage(url);
      expect(cardsIn("Needs you")).toHaveLength(2);
      expect(listedIn("Not on a roadmap")).toHaveLength(2);
      expect(querySection("Blocked")).not.toBeNull();
      expect(noticeLines()).toEqual([
        `Not filtered: this Vantage cannot read is:closed. It reads words, "quoted phrases", path: and is:open terms, and a - before any of them to leave out what it matches, such as generator path:docs/design/*.md is:open. Every entry is shown.`,
      ]);
      expect(notice()!.querySelector("code")).toHaveTextContent(/^is:closed$/);
      expect(box()).toHaveAttribute("aria-invalid", "true");
      expect(box().value).toBe("path:plans/design.md is:closed is:open");
      expect(router.location).toBe(url);
    });

    it("gives the reason where there is no term to name", async () => {
      await renderPage('/.vantage/planning?filter=path:"plans');
      expect(noticeLines()).toEqual([
        `Not filtered: this Vantage cannot read an unclosed quote. It reads words, "quoted phrases", path: and is:open terms, and a - before any of them to leave out what it matches, such as generator path:docs/design/*.md is:open. Every entry is shown.`,
      ]);
      expect(box()).toHaveAttribute("aria-invalid", "true");
    });

    // OQ-PF1, overturned: a word searches what the index holds, and an
    // unknown key is searched as text, with a line saying so.
    it("searches a word, says an unknown key is none, and marks neither invalid", async () => {
      await renderPage("/.vantage/planning?filter=QUESTION+oq-d3");
      expect(cardsIn("Needs you")).toEqual(["OQ-D3: Question OQ-D3?"]);
      expect(querySection("Not on a roadmap")).toBeNull();
      expect(counts()).toBe("1 matches · 9 hidden");
      expect(box()).not.toHaveAttribute("aria-invalid");
      expect(router.location).toBe("/.vantage/planning?filter=QUESTION+oq-d3");

      cleanup();
      await renderPage("/.vantage/planning?filter=stage:decided");
      expect(clauses()).toContain(
        "stage: is not a filter key, so stage:decided is searched as text. The keys are path: and is:.",
      );
      expect(box()).not.toHaveAttribute("aria-invalid");
    });

    it("names an unmatched term, keeps nothing, and says nothing matches", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/desing");
      // Said once, as the reason it keeps nothing; Clear the filter is the
      // button under it.
      expect(notice()).toBeNull();
      expect(counts()).toBe("0 match · 10 hidden");
      expect(clauses()).toBeNull();
      expect(nothingMatchesLines()).toEqual([
        "Nothing matches path:plans/desing.",
        "path:plans/desing matches no path the index lists.",
      ]);
      expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
      expect(screen.queryAllByRole("article")).toEqual([]);
    });

    it("names a kept document's blocker the filter leaves out beside it in Blocked, with every blocker still on its row", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/deps.md");
      expect(documentsIn("Blocked")).toEqual(["plans/deps.md"]);
      expect(
        within(section("Blocked")).getByText(/^blocked on/),
      ).toHaveTextContent("blocked on design.md#OQ-D1");
      // Beside the document, not in a notice (planning-to-do-list.md §3.2).
      expect(
        section("Blocked").querySelector("[data-planning-left-out]"),
      ).toHaveTextContent("(which this filter leaves out)");
      expect(notice()).toBeNull();
      expect(counts()).toBe("1 matches · 9 hidden");
      expect(clauses()).toBeNull();
    });

    it("names each other roadmap holding a question it keeps, and a pick keeps the filter", async () => {
      seed(TWO);
      await renderPage("/.vantage/planning?filter=path:plans/unrouted.md");
      expect(screen.queryAllByRole("article")).toEqual([]);
      // It keeps nothing here, so Nothing on this roadmap matches names the
      // roadmap, and the counts' tooltip does not say it again.
      expect(notice()).toBeNull();
      expect(counts()).toBe("0 match · 9 hidden");
      expect(clauses()).toBeNull();
      expect(nothingMatchesLines()?.[1]).toBe(
        `1 question it keeps is on another roadmap: ${NESTED} (1). The filter stays when you choose that roadmap.`,
      );
      // The picker's counts and the line after it are the filter's too.
      expect(
        Array.from(
          (
            screen.getByRole("combobox", {
              name: "Roadmap",
            }) as HTMLSelectElement
          ).options,
          (o) => o.textContent,
        ),
      ).toEqual(["roadmap.md (0 need you)", `${NESTED} (1 needs you)`]);
      expect(screen.getByTestId("other-roadmaps")).toHaveTextContent(
        "1 more question needs you on another roadmap.",
      );
      await act(async () => {
        fireEvent.change(screen.getByRole("combobox", { name: "Roadmap" }), {
          target: { value: NESTED },
        });
      });
      await settle();
      expect(
        new URLSearchParams(router.location.split("?")[1]).get("filter"),
      ).toBe("path:plans/unrouted.md");
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(box().value).toBe("path:plans/unrouted.md");
    });

    it("drops a filtered link's page parameters, which name no page (planning-to-do-list.md §7)", async () => {
      await renderPage(
        "/.vantage/planning?filter=path:plans/design.md&needs-you=2&waiting=4",
      );
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
    });

    it("applies the same text to the next index at the next layout", async () => {
      await renderPage(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      const grown = {
        ...TREE,
        "plans/design.md": doc(
          "status: in-review\nstage: DESIGN",
          q("OQ-D1", OPEN),
          q("OQ-D2", BLOCKED),
          q("OQ-D3", OPEN),
          q("OQ-D4", OPEN),
        ),
      };
      serveTree(grown);
      setLoad(readyOf(grown));
      await settle();
      // Held (planning-to-do-list.md §4.2): counted, and laid out on Refresh.
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
      expect(updatesCount()).toHaveTextContent("1");
      await refresh();
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
        "OQ-D4: Question OQ-D4?",
      ]);
      expect(counts()).toBe("3 match · 8 hidden");
    });

    it("prints a line saying what it is filtered by, in place of the box", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      expect(form()).toHaveClass("print:hidden");
      const printed = screen.getByTestId("planning-filter-print");
      expect(printed).toHaveClass("hidden", "print:block");
      expect(printed).toHaveTextContent(
        /^Filter: path:plans\/design\.md, 3 match, 7 hidden$/,
      );
      cleanup();
      await renderPage();
      expect(screen.queryByTestId("planning-filter-print")).toBeNull();
    });
  });

  describe("Nothing matches, in place of the sections (§6.18)", () => {
    it("says what words are matched against when a word matches nothing, and nothing of what needs you", async () => {
      await renderPage("/.vantage/planning?filter=zz");
      // The counts say how much it hides; no notice line repeats the box.
      expect(notice()).toBeNull();
      expect(counts()).toBe("0 match · 10 hidden");
      expect(nothingMatchesLines()).toEqual(["Nothing matches zz.", WORDS]);
      const shown = nothingMatches()!;
      // The filter as code, in the page's own text size, in no warning's
      // color, and in the sections' box, where the sections would be.
      expect(shown.querySelector("h2 code")).toHaveTextContent(/^zz$/);
      expect(shown.querySelector("h2")).toHaveClass("text-base");
      expect(shown.outerHTML).not.toMatch(/amber|red-/);
      expect(
        document.querySelector("[data-planning-sections]")!.contains(shown),
      ).toBe(true);
      expect(screen.getByRole("region", { name: "Nothing matches zz." })).toBe(
        shown,
      );
      expect(screen.queryAllByRole("article")).toEqual([]);
      expect(querySection("Needs you")).toBeNull();
      // No row stands between the box and it, whose room under the box
      // read as something that failed to load.
      expect(document.querySelector(".min-h-7")).toBeNull();
      expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
      // It prints, but for its button.
      expect(shown).not.toHaveClass("print:hidden");
      expect(
        within(shown).getByRole("button", { name: "Clear the filter" }),
      ).toHaveClass("print:hidden");
    });

    it("says the documents its path: terms keep list nothing here", async () => {
      // plans/gone.md's stage has the done role.
      await renderPage("/.vantage/planning?filter=path:plans/gone.md");
      expect(nothingMatchesLines()).toEqual([
        "Nothing matches path:plans/gone.md.",
        "It keeps 1 document, and it has no question or next step listed here.",
      ]);
      expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
    });

    it("says nothing on this roadmap matches where the questions it keeps are on another, and offers that roadmap first", async () => {
      seed(TWO);
      await renderPage("/.vantage/planning?filter=path:plans/unrouted.md");
      // It does match a question, so the headline does not say nothing
      // matches; the roadmap is named once, here.
      expect(nothingMatchesLines()).toEqual([
        "Nothing on this roadmap matches path:plans/unrouted.md.",
        `1 question it keeps is on another roadmap: ${NESTED} (1). The filter stays when you choose that roadmap.`,
      ]);
      expect(notice()).toBeNull();
      expect(clauses()).toBeNull();
      const buttons = within(nothingMatches()!).getAllByRole("button");
      expect(buttons.map((b) => b.textContent)).toEqual([
        `Choose ${NESTED}`,
        "Clear the filter",
      ]);
      expect(buttons[0]).toHaveClass("print:hidden");
      // Pressed with the pointer, it takes no focus on the way.
      expect(fireEvent.mouseDown(buttons[0]!)).toBe(false);
      await act(async () => {
        fireEvent.click(buttons[0]!);
      });
      await settle();
      expect(router.types.at(-1)).toBe("REPLACE");
      const query = new URLSearchParams(router.location.split("?")[1]);
      expect(query.get("roadmap")).toBe(NESTED);
      expect(query.get("filter")).toBe("path:plans/unrouted.md");
      expect(nothingMatches()).toBeNull();
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(box().value).toBe("path:plans/unrouted.md");
      expect(document.activeElement).toBe(box());
      // So does the Roadmap menu, as it always has.
      cleanup();
      seed(TWO);
      await renderPage("/.vantage/planning?filter=path:plans/unrouted.md");
      await act(async () => {
        fireEvent.change(screen.getByRole("combobox", { name: "Roadmap" }), {
          target: { value: NESTED },
        });
      });
      await settle();
      expect(nothingMatches()).toBeNull();
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
    });

    it("says what a - word leaves out when every entry matches it", async () => {
      // Every path ends in .md.
      await renderPage("/.vantage/planning?filter=-md");
      expect(nothingMatchesLines()).toEqual([
        "Nothing matches -md.",
        "Without -md it would keep 10 entries, and every one of them matches md.",
      ]);
      expect(
        Array.from(
          nothingMatches()!.querySelectorAll("code"),
          (c) => c.textContent,
        ),
      ).toEqual(["-md", "-md", "md"]);
      expect(
        within(nothingMatches()!)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(["Clear the filter"]);
    });

    it("says what is:open leaves out of what the rest keeps", async () => {
      // plans/answered.md's one question is answered: in Needs you, not open.
      await renderPage(
        "/.vantage/planning?filter=path:plans/answered.md+is:open",
      );
      expect(nothingMatchesLines()).toEqual([
        "Nothing matches path:plans/answered.md is:open.",
        "Without is:open it would keep 1 entry, and it is not an open question.",
      ]);
      expect(nothingMatches()!.querySelectorAll("code")).toHaveLength(2);
    });

    it("clears the filter as the box's ✕ does: at once, as a new history entry Back undoes, with the box emptied, focused and said", async () => {
      await renderPage("/.vantage/planning?filter=zz");
      const clear = within(nothingMatches()!).getByRole("button", {
        name: "Clear the filter",
      });
      // Pressed with the pointer, it takes no focus on the way, so the box
      // is never left, as for ✕.
      expect(fireEvent.mouseDown(clear)).toBe(false);
      await act(async () => {
        fireEvent.click(clear);
      });
      await settle();
      expect(router.location).toBe("/.vantage/planning");
      // A new entry (planning-to-do-list.md §3.2, OQ-TD13).
      expect(router.types.at(-1)).toBe("PUSH");
      expect(box().value).toBe("");
      expect(document.activeElement).toBe(box());
      expect(nothingMatches()).toBeNull();
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
      expect(status()).toHaveTextContent(
        "The filter is cleared. Every entry is shown.",
      );
      // Back brings the filter back.
      act(() => router.navigate!(-1));
      await settle();
      expect(router.location).toBe("/.vantage/planning?filter=zz");
      expect(box().value).toBe("zz");
      expect(nothingMatches()).not.toBeNull();
    });

    it("never stands in for the sections without a filter, or for one it cannot read, which shows every entry", async () => {
      await renderPage();
      expect(nothingMatches()).toBeNull();
      cleanup();
      await renderPage("/.vantage/planning?filter=zz+is:closed");
      expect(noticeLines()[0]).toMatch(/^Not filtered: /);
      expect(nothingMatches()).toBeNull();
      expect(cardsIn("Needs you")).toHaveLength(2);
      // Nor on a page with no entry at all, where a filter that is
      // understood says there was none to match.
      const gone = { "plans/gone.md": TREE["plans/gone.md"]! };
      for (const url of [
        "/.vantage/planning",
        "/.vantage/planning?filter=is:closed",
      ]) {
        cleanup();
        seed(gone);
        await renderPage(url);
        expect(nothingMatches(), url).toBeNull();
      }
      cleanup();
      seed(gone);
      await renderPage("/.vantage/planning?filter=zz");
      expect(nothingMatchesLines()).toEqual([
        "Nothing matches zz.",
        "The page lists no entry without a filter either.",
      ]);
    });

    it("leaves Nothing this filter keeps needs you where the filter keeps an entry", async () => {
      // A Blocked row alone.
      await renderPage("/.vantage/planning?filter=path:plans/deps.md");
      expect(screen.getByTestId("nothing-needs-you")).toHaveTextContent(
        PLANNING_NOTICES.nothingFilteredNeedsYou,
      );
      expect(nothingMatches()).toBeNull();
      expect(documentsIn("Blocked")).toEqual(["plans/deps.md"]);
    });
  });

  describe("the box", () => {
    it("applies on Enter in one replace: page parameters gone, the roadmap and the rest kept, the fragment dropped", async () => {
      seed(TWO);
      await renderPage("/.vantage/planning?roadmap=roadmap.md&x=1#needs-you", [
        "/plans/roadmap.md",
      ]);
      await enter("path:./plans/design.md");
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:/plans/design.md&roadmap=roadmap.md&x=1",
      );
      expect(router.hash).toBe("");
      expect(box().value).toBe("path:/plans/design.md");
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
      act(() => router.navigate!(-1));
      expect(router.location).toBe("/plans/roadmap.md");
    });

    it("writes what an agent's link writes, and the same page (criterion 3)", async () => {
      await renderPage();
      await enter("path:/plans/design.md is:open");
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:/plans/design.md+is:open",
      );
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
      // `*` is written %2A, so no chat client reads it as emphasis.
      await enter("path:plans/*.md");
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/%2A.md",
      );
    });

    it("keeps the old page up until the new one's inputs are in, with a spinner in its own slot past spinnerMs", async () => {
      // One card a page, and no block asked for ahead: OQ-U1's block is not
      // in hand.
      setPlanningLimitsForTests({
        pageSizes: [1, 20, 30, 50],
        defaultPageSize: 1,
        cardsAhead: 0,
        spinnerMs: 0,
      });
      seed(ROUTED);
      let hold = false;
      let release: () => void = () => {};
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          hold
            ? new Promise<CardAnswer[]>((resolve) => {
                release = () => resolve(inline.cards(repo, want, options));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      hold = true;
      await enter("path:plans/unrouted.md");
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/unrouted.md",
      );
      // The page on screen, its frame included, is still the unfiltered one.
      expect(cardsIn("Needs you")).toEqual(["OQ-D1: Question OQ-D1?"]);
      expect(screen.getByTestId("needs-you-count")).toHaveTextContent("3");
      expect(notice()).toBeNull();
      expect(spinning()).toBe(true);
      expect(box().value).toBe("path:plans/unrouted.md");
      release();
      await settle();
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(screen.getByTestId("needs-you-count")).toHaveTextContent("1");
      expect(filterShown()).toMatch(/^path:plans\/unrouted\.md$/);
      expect(spinning()).toBe(false);
    });

    it("draws its spinner in the commit of the reader's Enter, for the browser to show past spinnerMs", async () => {
      // Rendering the new page is a transition, and in a browser no later
      // commit lands until it does: a spinner a timer asks for would show
      // only once it is no longer needed (planning-index.md §6.16).
      setPlanningLimitsForTests({
        pageSizes: [1, 20, 30, 50],
        defaultPageSize: 1,
        cardsAhead: 0,
        spinnerMs: 150,
      });
      seed(ROUTED);
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          want.some((w) => w.path === "plans/unrouted.md")
            ? new Promise<CardAnswer[]>(() => {})
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      const spinner = () => screen.queryByTestId("planning-filter-spinner");
      expect(spinner()).toBeNull();
      await type("path:plans/unrouted.md");
      await act(async () => {
        fireEvent.submit(form());
      });
      expect(spinner()).not.toBeNull();
      expect(spinner()).toHaveClass("planning-reveal");
      expect(spinner()!.style.animationDelay).toBe("150ms");
      // The old page is still the one on screen.
      expect(cardsIn("Needs you")).toEqual(["OQ-D1: Question OQ-D1?"]);
    });

    it("never shows its spinner at once for a page that was slow once before", async () => {
      // A wait that passed spinnerMs once is not slow from its start the
      // next time: the spinner would flash as the page clears the filter.
      setPlanningLimitsForTests({ spinnerMs: 150 });
      let hold = true;
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
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(screen.getByLabelText("Loading this page's cards")).toBeTruthy();
      hold = false;
      release();
      await settle();
      await enter("path:plans/design.md");
      expect(filterShown()).toMatch(/^path:plans\/design\.md$/);
      const delays: string[] = [];
      const slot = screen.getByTestId("planning-filter-spinner-slot");
      const observer = new MutationObserver(() => {
        const shown = slot.querySelector<HTMLElement>(
          "[data-testid=planning-filter-spinner]",
        );
        if (shown !== null) delays.push(shown.style.animationDelay);
      });
      observer.observe(slot, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Clear the filter" }),
        );
      });
      await settle();
      observer.disconnect();
      expect(notice()).toBeNull();
      expect(delays).not.toContain("0ms");
    });

    it("does nothing on Enter with the text already applied", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md&x=1");
      await enter("  path:plans/design.md ");
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md&x=1",
      );
      expect(box().value).toBe("path:plans/design.md");
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
    });

    it("applies text it cannot read as typed, and shows every entry", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      await enter("path:plans/design.md is:Open");
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md+is:Open",
      );
      expect(box().value).toBe("path:plans/design.md is:Open");
      expect(box()).toHaveAttribute("aria-invalid", "true");
      expect(cardsIn("Needs you")).toHaveLength(2);
      expect(noticeLines()[0]).toMatch(
        /^Not filtered: this Vantage cannot read is:Open\./,
      );
    });

    it("applies an unknown key's text as text, which may keep nothing", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      await enter("Path:plans/design.md");
      expect(router.location).toBe(
        "/.vantage/planning?filter=Path:plans/design.md",
      );
      expect(box()).not.toHaveAttribute("aria-invalid");
      expect(querySection("Needs you")).toBeNull();
      expect(counts()).toBe("0 match · 10 hidden");
    });

    it("clears the filter on hidden as a new history entry, which Back undoes, and typing after it replaces it (planning-to-do-list.md §3.2)", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md", [
        "/plans/roadmap.md",
      ]);
      expect(counts()).toBe("3 match · 7 hidden");
      await act(async () => {
        fireEvent.click(screen.getByTestId("planning-filter-hidden"));
      });
      await settle();
      expect(router.location).toBe("/.vantage/planning");
      expect(router.types.at(-1)).toBe("PUSH");
      expect(counts()).toBeNull();
      expect(box().value).toBe("");
      expect(document.activeElement).toBe(box());
      expect(status()).toHaveTextContent(
        "The filter is cleared. Every entry is shown.",
      );
      // Back brings the filter back.
      act(() => router.navigate!(-1));
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
      expect(box().value).toBe("path:plans/design.md");
      expect(counts()).toBe("3 match · 7 hidden");
      // Cleared again, a filter typed after it replaces the cleared entry,
      // so Back from it returns to the filter before.
      await act(async () => {
        fireEvent.click(screen.getByTestId("planning-filter-hidden"));
      });
      await settle();
      await enter("oq-d3");
      expect(router.location).toBe("/.vantage/planning?filter=oq-d3");
      expect(router.types.at(-1)).toBe("REPLACE");
      act(() => router.navigate!(-1));
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
    });

    it("never clears on Esc", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      box().focus();
      await press("Escape", box());
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
      expect(box().value).toBe("path:plans/design.md");
    });

    it("clears and applies with ✕, the focus staying in the box", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md&x=1");
      box().focus();
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Clear the filter" }),
        );
      });
      await settle();
      expect(router.location).toBe("/.vantage/planning?x=1");
      // A new history entry, which Back undoes (OQ-TD13).
      expect(router.types.at(-1)).toBe("PUSH");
      expect(box().value).toBe("");
      expect(document.activeElement).toBe(box());
      expect(counts()).toBeNull();
      expect(cardsIn("Needs you")).toHaveLength(2);
      // Its slot stays, empty while there is no text.
      expect(
        screen.queryByRole("button", { name: "Clear the filter" }),
      ).toBeNull();
    });

    it("is reset by a replace it did not cause while it holds the URL's own text, and never while it has the focus", async () => {
      // A replace from elsewhere, with the box untouched and unfocused: it
      // follows the URL, as the open rewrite shows a link's canonical text.
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      act(() =>
        router.navigate!(
          { search: "?filter=path:plans/unrouted.md" },
          { replace: true },
        ),
      );
      await settle();
      expect(box().value).toBe("path:plans/unrouted.md");
      // With the focus in the box, the same replace leaves its text alone.
      box().focus();
      await type('still "typing');
      act(() =>
        router.navigate!(
          { search: "?filter=path:plans/design.md" },
          { replace: true },
        ),
      );
      await settle();
      expect(box().value).toBe('still "typing');
      expect(hint()).toBe(FILTER_HINT);
    });

    it("says the counts in a polite live region after Enter or ✕, never as the page opens", async () => {
      await renderPage(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      expect(status()).toHaveAttribute("aria-live", "polite");
      expect(status()).toHaveTextContent(/^$/);
      // The counts, and what else the summary says, describe the box.
      expect(box()).toHaveAccessibleDescription(
        "2 match, 8 hidden. 1 of its questions is blocked and will need you later.",
      );
      await enter("path:plans/deps.md");
      // It keeps a Blocked row alone, so nothing it keeps needs you, which
      // is said and describes the box too (planning-index.md §6.18).
      expect(status().textContent).toBe(
        "1 matches, 9 hidden. Nothing this filter keeps needs you.",
      );
      expect(box()).toHaveAccessibleDescription(
        "Nothing this filter keeps needs you. 1 matches, 9 hidden.",
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Clear the filter" }),
        );
      });
      await settle();
      expect(status()).toHaveTextContent(
        "The filter is cleared. Every entry is shown.",
      );
      expect(box()).not.toHaveAttribute("aria-describedby");
    });

    it("says that nothing matches a filter that keeps no entry, after the notice, and describes the box with it", async () => {
      // Nothing matches (planning-index.md §6.18): the notice, then Nothing
      // matches in place of the sections, and never the filtered Nothing
      // needs you, which reads as though something were kept.
      await renderPage();
      await enter("path:plans/answered.md is:open");
      expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
      const headline = within(nothingMatches()!).getByRole("heading", {
        name: "Nothing matches path:plans/answered.md is:open.",
      });
      const reason = within(nothingMatches()!).getByTestId(
        "nothing-matches-reason",
      );
      expect(status()).toHaveTextContent(
        "0 match, 10 hidden. Nothing matches path:plans/answered.md is:open. Without is:open it would keep 1 entry, and it is not an open question.",
      );
      expect(box().getAttribute("aria-describedby")).toContain(
        `${headline.id} ${reason.id}`,
      );
      // A filter that keeps something that needs you says nothing of it.
      await enter("path:plans/design.md");
      expect(screen.queryByTestId("nothing-needs-you")).toBeNull();
      expect(nothingMatches()).toBeNull();
      expect(status()).not.toHaveTextContent(/needs you\.$/);
      expect(status()).not.toHaveTextContent("Nothing matches");
      expect(box()).toHaveAccessibleDescription("3 match, 7 hidden.");
    });

    it("says the notice of an Enter made while the index builds once the page is on screen", async () => {
      setLoad({ status: "loading", warm: false, progress: null });
      await renderPage();
      await enter("path:plans/design.md");
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
      expect(status()).toHaveTextContent(/^$/);
      setLoad(readyOf(TREE));
      await settle();
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
      expect(status()).toHaveTextContent(/^3 match, 7 hidden\.$/);
    });

    it("forgets what it said on a navigation it did not cause, so the same filter applied again is said again", async () => {
      await renderPage();
      await enter("path:plans/design.md is:open");
      const said = status().textContent;
      expect(said).toMatch(/^2 match, 8 hidden\./);
      // g p opens the bare page, whose region says nothing of a filter.
      act(() => scroller().focus());
      await press("g");
      await press("p");
      expect(router.location).toBe("/.vantage/planning");
      expect(status()).toHaveTextContent(/^$/);
      await enter("path:plans/design.md is:open");
      expect(status().textContent).toBe(said);
      // Back, to the entry the first Enter replaced, is no Enter either.
      act(() => router.navigate!(-1));
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      expect(counts()).not.toBeNull();
      expect(status()).toHaveTextContent(/^$/);
    });
  });

  describe("as the reader types (§6.16, OQ-PF6)", () => {
    // The idle pause, on a clock of the test's own: long, so that it passes
    // only when a test runs it out, and advancing with real time besides, so
    // the page's other waits pass as they do outside a test.
    const IDLE = 60_000;
    /**
     * One card a page and no block asked for ahead, over the corpus with
     * OQ-U1 routed: `oq-u` lays out a card whose block is not in hand, so its
     * page waits on the scanner.
     */
    const oneCard = () => {
      limits({ pageSizes: [1, 20, 30, 50], defaultPageSize: 1, cardsAhead: 0 });
      seed(ROUTED);
    };
    const limits = (more: Parameters<typeof setPlanningLimitsForTests>[0]) =>
      setPlanningLimitsForTests({ filterIdleMs: IDLE, ...more });
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout"],
        shouldAdvanceTime: true,
        advanceTimeDelta: 1,
      });
      limits({});
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    /** Run the idle pause's clock on by `ms`. */
    async function idle(ms = IDLE): Promise<void> {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
      await settle();
    }
    /** Type `text` one key at a time, each change handed over and settled. */
    async function typeKeys(text: string, from = ""): Promise<void> {
      for (let i = from.length + 1; i <= text.length; i++) {
        await type(text.slice(0, i));
        await settle();
      }
    }
    const D1 = "OQ-D1: Question OQ-D1?";
    const D3 = "OQ-D3: Question OQ-D3?";
    const A1 = "OQ-A1: Question OQ-A1?";
    const filterOf = () =>
      new URLSearchParams(router.location.split("?")[1] ?? "").get("filter");

    it("narrows the page at each keystroke with no Enter, adds no history entry, and lets the URL take the text once, after the idle pause (criterion 13)", async () => {
      await renderPage("/.vantage/planning", ["/plans/roadmap.md"]);
      const from = router.types.length;
      box().focus();
      const seen: string[][] = [];
      for (const text of ["o", "oq", "oq-", "oq-d", "oq-d3"]) {
        await type(text);
        await settle();
        seen.push(cardsIn("Needs you"));
      }
      expect(seen).toEqual([[D1, D3], [D1, D3], [D1, D3], [D1, D3], [D3]]);
      // Rows hold no id, so a word only an id holds leaves them out.
      expect(querySection("Ready to build")).toBeNull();
      expect(filterShown()).toMatch(/^oq-d3$/);
      expect(router.location).toBe("/.vantage/planning");
      // Halfway through the pause, nothing is written yet; after it, once.
      await idle(IDLE / 2);
      expect(router.location).toBe("/.vantage/planning");
      await idle(IDLE / 2);
      expect(router.location).toBe("/.vantage/planning?filter=oq-d3");
      // One replace, and no history entry.
      expect(router.types.slice(from)).toEqual(["REPLACE"]);
      expect(box().value).toBe("oq-d3");
      expect(document.activeElement).toBe(box());
      act(() => router.navigate!(-1));
      await settle();
      expect(router.location).toBe("/plans/roadmap.md");
    });

    it("keeps the page of the last text it read while the text is not understood, and Enter then shows every entry under Not filtered (criterion 14)", async () => {
      await renderPage();
      box().focus();
      await typeKeys('path:plans/design.md "is');
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      expect(filterShown()).toMatch(/^path:plans\/design\.md$/);
      expect(hint()).toBe(FILTER_HINT);
      // Not applied is not invalid: the amber ring is an applied filter's.
      expect(box()).not.toHaveAttribute("aria-invalid");
      // The URL takes what is applied, and the box keeps what it holds.
      await idle();
      expect(filterOf()).toBe("path:plans/design.md");
      expect(box().value).toBe('path:plans/design.md "is');
      expect(hint()).toBe(FILTER_HINT);
      await enter();
      expect(filterOf()).toBe('path:plans/design.md "is');
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      expect(noticeLines()[0]).toMatch(
        /^Not filtered: this Vantage cannot read an unclosed quote\./,
      );
      expect(box()).toHaveAttribute("aria-invalid", "true");
      expect(hint()).toBe("");
    });

    it("keeps every entry while a qualifier is half typed, and the page of each term it can read", async () => {
      await renderPage();
      box().focus();
      const seen: (string | null)[] = [];
      for (const text of ["is", "is:", "is:o", "is:open"]) {
        await type(text);
        await settle();
        seen.push(filterShown());
      }
      // `is` is a word, which only the paths holding "plans/disagrees.md"
      // hold; `is:` and `is:o` are not understood, so they leave that page
      // as it is, until `is:open` is read.
      expect(seen).toEqual(["is", "is", "is", "is:open"]);
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
    });

    // A typed text that keeps no entry at all waits for the idle pause, the
    // one that writes the URL, and the last results stay on screen until
    // then; every other text applies at once (§6.16).
    it("holds the last results while a typed text keeps no entry, and applies it once the idle pause passes", async () => {
      await renderPage();
      box().focus();
      await typeKeys("oq-d");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      const keys = router.keys.length;
      await typeKeys("oq-dz", "oq-d");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      expect(filterShown()).toMatch(/^oq-d$/);
      expect(box().value).toBe("oq-dz");
      expect(hint()).toBe("");
      expect(router.location).toBe("/.vantage/planning");
      await idle(IDLE / 2);
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      expect(router.location).toBe("/.vantage/planning");
      await idle(IDLE / 2);
      // The pause writes it, once, and the page then says nothing matches.
      expect(router.location).toBe("/.vantage/planning?filter=oq-dz");
      expect(router.keys).toHaveLength(keys + 1);
      expect(querySection("Needs you")).toBeNull();
      expect(filterShown()).toMatch(/^oq-dz$/);
      expect(box().value).toBe("oq-dz");
      expect(document.activeElement).toBe(box());
    });

    it("never empties the page as an exclusion's first letter is typed", async () => {
      await renderPage();
      box().focus();
      // `-` is not understood, and `-m` drops every entry, since every path
      // holds `.md`: neither changes the page.
      for (const text of ["-", "-m"]) {
        await type(text);
        await settle();
        expect(cardsIn("Needs you"), text).toEqual([D1, D3]);
        expect(notice(), text).toBeNull();
      }
      // `-mz` drops nothing, and applies with no pause.
      await type("-mz");
      await settle();
      expect(filterShown()).toMatch(/^-mz$/);
      expect(router.location).toBe("/.vantage/planning");
      await type("-m");
      await settle();
      expect(filterShown()).toMatch(/^-mz$/);
      await idle();
      expect(router.location).toBe("/.vantage/planning?filter=-m");
      expect(filterShown()).toMatch(/^-m$/);
    });

    it("applies at once a typed text that keeps entries, after one held back", async () => {
      await renderPage();
      box().focus();
      await typeKeys("oq-dz");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      // Back to `oq-d`, which is on screen, then on to `oq-d3`: no pause.
      await type("oq-d");
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      await type("oq-d3");
      await settle();
      expect(cardsIn("Needs you")).toEqual([D3]);
      expect(filterShown()).toMatch(/^oq-d3$/);
      expect(router.location).toBe("/.vantage/planning");
      await idle();
      expect(router.location).toBe("/.vantage/planning?filter=oq-d3");
    });

    it("applies a typed text that keeps no entry at once on Enter, a paste and the focus leaving the box", async () => {
      await renderPage();
      box().focus();
      // `z` is in no field of the tree's entries.
      await typeKeys("zz");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      await enter();
      expect(router.location).toBe("/.vantage/planning?filter=zz");
      expect(querySection("Needs you")).toBeNull();
      expect(filterShown()).toMatch(/^zz$/);
      await act(async () => {
        fireEvent.click(clearX());
      });
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      // A paste that is no planning link is typing written at once.
      await act(async () => {
        fireEvent.paste(box(), { clipboardData: { getData: () => "qq" } });
        fireEvent.change(box(), { target: { value: "qq" } });
      });
      await settle();
      expect(router.location).toBe("/.vantage/planning?filter=qq");
      expect(querySection("Needs you")).toBeNull();
      await act(async () => {
        fireEvent.click(clearX());
      });
      await settle();
      await typeKeys("zz");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      act(() => scroller().focus());
      await settle();
      expect(router.location).toBe("/.vantage/planning?filter=zz");
      expect(querySection("Needs you")).toBeNull();
      const keys = router.keys.length;
      await idle();
      expect(router.keys).toHaveLength(keys);
    });

    it("puts back on Esc the held text the URL is about to take, over a text it cannot read", async () => {
      await renderPage();
      box().focus();
      await typeKeys("oq-dz");
      await type('oq-dz "');
      await settle();
      expect(hint()).toBe(FILTER_HINT);
      await press("Escape", box());
      expect(box().value).toBe("oq-dz");
      // Still `oq-d`'s page, the last text applied.
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      await idle();
      expect(router.location).toBe("/.vantage/planning?filter=oq-dz");
      expect(querySection("Needs you")).toBeNull();
    });

    it("writes at once when the focus leaves the box, and owes nothing after", async () => {
      await renderPage();
      box().focus();
      await typeKeys("oq-d");
      act(() => scroller().focus());
      await settle();
      expect(router.location).toBe("/.vantage/planning?filter=oq-d");
      const keys = router.keys.length;
      await idle();
      expect(router.keys).toHaveLength(keys);
    });

    it("writes at once on Enter, and on ✕, and owes nothing after either", async () => {
      await renderPage();
      box().focus();
      await typeKeys("oq-d");
      await enter();
      expect(router.location).toBe("/.vantage/planning?filter=oq-d");
      await typeKeys("oq-d3", "oq-d");
      expect(cardsIn("Needs you")).toEqual([D3]);
      let keys = router.keys.length;
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Clear the filter" }),
        );
      });
      await settle();
      expect(router.location).toBe("/.vantage/planning");
      expect(router.keys).toHaveLength(keys + 1);
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      keys = router.keys.length;
      await idle();
      expect(router.keys).toHaveLength(keys);
      expect(router.location).toBe("/.vantage/planning");
    });

    it("never rewrites the box while the URL takes its text, caret and selection included, and Enter shows the canonical text", async () => {
      await renderPage();
      box().focus();
      await type("path:./plans/design.md");
      await settle();
      box().setSelectionRange(5, 9);
      await idle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:/plans/design.md",
      );
      expect(box().value).toBe("path:./plans/design.md");
      expect([box().selectionStart, box().selectionEnd]).toEqual([5, 9]);
      // Nor as the focus leaves it, which writes at once.
      await type("path:./plans/answered.md");
      await settle();
      act(() => scroller().focus());
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:/plans/answered.md",
      );
      expect(box().value).toBe("path:./plans/answered.md");
      expect(listedIn("To fold into the ledger")).toEqual([A1]);
      box().focus();
      await enter();
      expect(box().value).toBe("path:/plans/answered.md");
    });

    it("drops a write still owed on a pop, which the box and the page both follow", async () => {
      await renderPage("/.vantage/planning", [
        "/.vantage/planning?filter=path:plans/design.md",
      ]);
      box().focus();
      await typeKeys("oq-a");
      expect(listedIn("To fold into the ledger")).toEqual([A1]);
      act(() => router.navigate!(-1));
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
      expect(box().value).toBe("path:plans/design.md");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      await idle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
      // The entry typed in holds what it held.
      act(() => router.navigate!(1));
      await settle();
      expect(router.location).toBe("/.vantage/planning");
      expect(box().value).toBe("");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
    });

    it("drops a write still owed on a push", async () => {
      await renderPage();
      box().focus();
      await typeKeys("oq-a");
      act(() => router.navigate!("/.vantage/planning?x=1"));
      await settle();
      expect(router.location).toBe("/.vantage/planning?x=1");
      expect(box().value).toBe("");
      await idle();
      expect(router.location).toBe("/.vantage/planning?x=1");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
    });

    it("speaks the notice once the URL takes the text, never per keystroke", async () => {
      await renderPage();
      box().focus();
      for (const text of ["o", "oq", "oq-", "oq-d"]) {
        await type(text);
        await settle();
        expect(status()).toHaveTextContent(/^$/);
      }
      await idle();
      expect(status().textContent).toMatch(/^3 match, 7 hidden\./);
      await typeKeys("oq-d3", "oq-d");
      expect(status().textContent).toMatch(/^3 match, 7 hidden\./);
      await idle();
      expect(status().textContent).toMatch(/^1 matches, 9 hidden\./);
    });

    it("carries a filter still owed into a roadmap pick", async () => {
      const NESTED = "docs/plans/roadmap.md";
      seed({
        ...TREE,
        [NESTED]: "# Plans\n\n1. [The unrouted one](../../plans/unrouted.md)\n",
      });
      await renderPage();
      box().focus();
      await typeKeys("oq-u");
      await act(async () => {
        fireEvent.change(screen.getByRole("combobox", { name: "Roadmap" }), {
          target: { value: NESTED },
        });
      });
      await settle();
      expect(filterOf()).toBe("oq-u");
      expect(
        new URLSearchParams(router.location.split("?")[1]).get("roadmap"),
      ).toBe(NESTED);
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      const keys = router.keys.length;
      await idle();
      expect(router.keys).toHaveLength(keys);
    });

    it("keeps the old page up while a typed text's page is on its way, with the spinner drawn for past spinnerMs", async () => {
      oneCard();
      limits({
        pageSizes: [1, 20, 30, 50],
        defaultPageSize: 1,
        cardsAhead: 0,
        spinnerMs: 150,
      });
      let hold = false;
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          hold
            ? new Promise<CardAnswer[]>(() => {})
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      hold = true;
      box().focus();
      await type("oq-u");
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1]);
      expect(notice()).toBeNull();
      const spinner = screen.getByTestId("planning-filter-spinner");
      expect(spinner).toHaveClass("planning-reveal");
      expect(spinner.style.animationDelay).toBe("150ms");
      expect(box().value).toBe("oq-u");
    });

    it("keeps every card a keystroke still shows mounted, rendering none of them again, and puts the sections' box back where it stands", async () => {
      await renderPage();
      const sections = document.querySelector("[data-planning-sections]")!;
      const d3 = cardFor("OQ-D3");
      const placed: Node[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) placed.push(...record.addedNodes);
      });
      observer.observe(sections.parentNode!, { childList: true });
      viewerRenders.clear();
      box().focus();
      await typeKeys("oq-d");
      await typeKeys("oq-d3", "oq-d");
      observer.disconnect();
      expect(cardsIn("Needs you")).toEqual([D3]);
      expect(cardFor("OQ-D3")).toBe(d3);
      expect(document.querySelector("[data-planning-sections]")).toBe(sections);
      // Every card on screen was on screen before: no body rendered again.
      expect([...viewerRenders.values()].reduce((a, b) => a + b, 0)).toBe(0);
      // Each filter the page showed put the box back once, in place.
      expect(placed.filter((node) => node === sections)).toHaveLength(5);
      expect(sections.getAttribute("data-planning-filter")).toBe("oq-d3");
    });

    it("sends the visit's second review request when the reader types before the sections paint, and makes no third", async () => {
      const reviewRequests = () =>
        vi
          .mocked(axios.post)
          .mock.calls.filter(([url]) =>
            String(url).endsWith("/planning/reviews"),
          )
          .map(([, body]) => (body as { paths: string[] }).paths);
      // Rows of Ready to build: the first request holds the cards' documents
      // and those needing the human, and leaves the rows' for the second.
      const ROWS: Record<string, string> = { ...TREE };
      for (let i = 0; i < 3; i++) {
        ROWS[`plans/r${i}.md`] = doc(
          "status: accepted\nstage: DECIDED",
          "Decided.",
        );
      }
      seed(ROWS);
      let hold = true;
      const releases: (() => void)[] = [];
      serveTree(ROWS, "/api", (inline) => ({
        cards: (repo, want, options) =>
          hold
            ? new Promise<CardAnswer[]>((resolve) => {
                releases.push(() => resolve(inline.cards(repo, want, options)));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      expect(querySection("Needs you")).toBeNull();
      expect(reviewRequests()).toHaveLength(1);
      box().focus();
      await type("oq-u");
      // Sent at once, ahead of the typed text's own inputs.
      expect(reviewRequests()).toHaveLength(2);
      hold = false;
      for (const release of releases) release();
      await settle();
      expect(listedIn("Not on a roadmap")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(reviewRequests()[1]).toEqual(
        expect.arrayContaining(["plans/r1.md", "plans/r2.md"]),
      );
      await typeKeys("oq-x1", "oq-");
      await type("");
      await settle();
      await idle();
      expect(documentsIn("Ready to build")).toEqual([
        "plans/r0.md",
        "plans/r1.md",
        "plans/r2.md",
        "plans/ready.md",
      ]);
      expect(reviewRequests()).toHaveLength(2);
      expect(reviewGets()).toEqual([]);
    });

    it("evicts, typing a dozen texts, no set another history entry was shown with, and Back finds it", async () => {
      limits({ pageInputsKept: 2 });
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      act(() => router.navigate!("/.vantage/planning"));
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      const held = () => heldPlanningPageInputs().cached.join("|");
      expect(held()).toContain("\npath:plans/design.md\n");
      box().focus();
      await typeKeys("oq-a1 oq-d3 x");
      expect(held()).toContain("\npath:plans/design.md\n");
      expect(heldPlanningPageInputs().typing.length).toBeLessThanOrEqual(2);
      act(() => router.navigate!(-1));
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
    });

    it("writes the URL as the reader types where there are no sections to filter: Choose a project", async () => {
      useRepoStore.setState({
        isMultiRepo: true,
        currentRepo: null,
        repos: [{ name: "alpha" }] as never,
      });
      await renderPage("/.vantage/planning");
      expect(screen.getByText(/Choose a project/)).toBeTruthy();
      box().focus();
      await typeKeys("oq-d");
      expect(router.location).toBe("/.vantage/planning");
      await idle();
      expect(router.location).toBe("/.vantage/planning?filter=oq-d");
      expect(
        within(screen.getByTestId("planning-projects"))
          .getByRole("link", { name: "alpha" })
          .getAttribute("href"),
      ).toBe("/.vantage/planning/alpha?filter=oq-d");
    });

    it("puts the applied text back on Esc over a text it cannot read, then gives the pane the focus, and never clears", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      box().focus();
      await typeKeys("path:plans/unrouted.md");
      expect(listedIn("Not on a roadmap")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(hint()).toBe("");
      await type('path:plans/unrouted.md "x');
      expect(hint()).toBe(FILTER_HINT);
      await press("Escape", box());
      expect(box().value).toBe("path:plans/unrouted.md");
      expect(hint()).toBe("");
      expect(document.activeElement).toBe(box());
      await press("Escape", box());
      expect(document.activeElement).toBe(scroller());
      expect(box().value).toBe("path:plans/unrouted.md");
      // Leaving the box wrote what it applied.
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/unrouted.md",
      );
    });

    it("leaves a text it cannot read in the box with its hint when the focus leaves, and the URL holds what is applied", async () => {
      setPlanningLimitsForTests({ filterIdleMs: IDLE });
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      await type('x"');
      // A replace the box did not cause, with the focus elsewhere.
      act(() =>
        router.navigate!(
          { search: "?filter=path:plans/design.md&x=1" },
          { replace: true },
        ),
      );
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md&x=1",
      );
      expect(box().value).toBe('x"');
      expect(hint()).toBe(FILTER_HINT);
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
    });

    it("puts the spinner away once the page of a text typed after an Enter is on screen, though the entered text's page never came", async () => {
      oneCard();
      limits({
        pageSizes: [1, 20, 30, 50],
        defaultPageSize: 1,
        cardsAhead: 0,
        spinnerMs: 150,
      });
      let held = true;
      let release: () => void = () => {};
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          held && want.some((w) => w.path === "plans/unrouted.md")
            ? new Promise<CardAnswer[]>((resolve) => {
                release = () => resolve(inline.cards(repo, want, options));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      box().focus();
      await enter("path:plans/unrouted.md");
      expect(spinning()).toBe(true);
      // Typed past the entered text before its page came.
      await type("path:plans/design.md");
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1]);
      expect(spinning()).toBe(false);
      held = false;
      release();
      await settle();
      await idle();
      expect(filterOf()).toBe("path:plans/design.md");
      expect(cardsIn("Needs you")).toEqual([D1]);
      expect(spinning()).toBe(false);
    });

    it("puts the spinner away once the page of a text typed after a cold ✕ is on screen", async () => {
      oneCard();
      limits({
        pageSizes: [1, 20, 30, 50],
        defaultPageSize: 1,
        cardsAhead: 0,
        spinnerMs: 150,
      });
      let held = false;
      const releases: (() => void)[] = [];
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          held
            ? new Promise<CardAnswer[]>((resolve) => {
                releases.push(() => resolve(inline.cards(repo, want, options)));
              })
            : inline.cards(repo, want, options),
      }));
      // OQ-U1's card alone, so the bare page's OQ-D1 is not in hand.
      await renderPage("/.vantage/planning?filter=path:plans/unrouted.md");
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      box().focus();
      held = true;
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Clear the filter" }),
        );
      });
      await settle();
      expect(spinning()).toBe(true);
      held = false;
      await type("oq-u");
      await settle();
      for (const release of releases) release();
      await settle();
      expect(filterShown()).toMatch(/^oq-u$/);
      expect(spinning()).toBe(false);
      await idle();
      expect(filterOf()).toBe("oq-u");
      expect(spinning()).toBe(false);
    });

    it("carries the newest text typed into a roadmap pick made before that keystroke's render commits", async () => {
      const NESTED = "docs/plans/roadmap.md";
      seed({
        ...TREE,
        [NESTED]: "# Plans\n\n1. [The unrouted one](../../plans/unrouted.md)\n",
      });
      await renderPage();
      box().focus();
      await typeKeys("oq-");
      await act(async () => {
        fireEvent.change(box(), { target: { value: "oq-u" } });
        fireEvent.change(screen.getByRole("combobox", { name: "Roadmap" }), {
          target: { value: NESTED },
        });
      });
      await settle();
      expect(filterOf()).toBe("oq-u");
      expect(
        new URLSearchParams(router.location.split("?")[1]).get("roadmap"),
      ).toBe(NESTED);
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
    });

    it("says a text is not applied while the box leads, though the URL holds that same text it cannot read, and Esc puts back the text the page shows", async () => {
      await renderPage("/.vantage/planning?filter=oq-d+%22");
      expect(noticeLines()[0]).toMatch(/^Not filtered/);
      expect(hint()).toBe("");
      box().focus();
      await type("oq-d ");
      await settle();
      expect(filterShown()).toMatch(/^oq-d$/);
      // Back to the URL's text, which the page does not show.
      await type('oq-d "');
      await settle();
      expect(filterShown()).toMatch(/^oq-d$/);
      expect(hint()).toBe(FILTER_HINT);
      await press("Escape", box());
      expect(box().value).toBe("oq-d");
      expect(document.activeElement).toBe(box());
      expect(hint()).toBe("");
      await idle();
      expect(filterOf()).toBe("oq-d");
    });

    it("says a text is not applied once the box leads, after an Enter that changed nothing", async () => {
      await renderPage("/.vantage/planning?filter=oq-d+%22");
      box().focus();
      // Enter on the URL's own text: nothing to do.
      await enter();
      expect(filterOf()).toBe('oq-d "');
      await type("oq-d ");
      await settle();
      await type('oq-d "');
      await settle();
      expect(filterShown()).toMatch(/^oq-d$/);
      expect(hint()).toBe(FILTER_HINT);
    });

    it("never shows the page of a text typed past, though its inputs come in before the newer text's render commits (§6.16)", async () => {
      oneCard();
      let held = false;
      let release: () => void = () => {};
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          held
            ? new Promise<CardAnswer[]>((resolve) => {
                release = () => resolve(inline.cards(repo, want, options));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      const sections = document.querySelector("[data-planning-sections]")!;
      const seen: (string | null)[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) seen.push(record.oldValue);
      });
      observer.observe(sections, {
        attributes: true,
        attributeFilter: ["data-planning-filter"],
        attributeOldValue: true,
      });
      box().focus();
      // OQ-U1's block is not in hand, so its page waits on the scanner.
      held = true;
      await type("oq-u");
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1]);
      held = false;
      // The next key, and the first text's inputs coming in before React
      // renders it: one act scope.
      await act(async () => {
        fireEvent.change(box(), { target: { value: "oq-d" } });
        release();
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });
      await settle();
      observer.disconnect();
      seen.push(sections.getAttribute("data-planning-filter"));
      expect(seen).toEqual(["", "oq-d"]);
      expect(cardsIn("Needs you")).toEqual([D1]);
      expect(filterShown()).toMatch(/^oq-d$/);
    });

    it("never shows the page of a text typed past, though its inputs came in while it was the newest, before React rendered them (§6.16)", async () => {
      oneCard();
      let held = false;
      let release: () => void = () => {};
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          held
            ? new Promise<CardAnswer[]>((resolve) => {
                release = () => resolve(inline.cards(repo, want, options));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      const sections = document.querySelector("[data-planning-sections]")!;
      const seen: (string | null)[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) seen.push(record.oldValue);
      });
      observer.observe(sections, {
        attributes: true,
        attributeFilter: ["data-planning-filter"],
        attributeOldValue: true,
      });
      box().focus();
      held = true;
      await type("oq-u");
      await settle();
      held = false;
      // The first text's inputs come in while it is still the newest, and
      // the next key lands before React renders them: one act scope.
      await act(async () => {
        release();
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        fireEvent.change(box(), { target: { value: "oq-d" } });
      });
      await settle();
      observer.disconnect();
      seen.push(sections.getAttribute("data-planning-filter"));
      expect(seen).toEqual(["", "oq-d"]);
      expect(filterShown()).toMatch(/^oq-d$/);
    });

    it("shows the page of the text it applied last, when the next keeps no entry and that page comes in before React renders it (§6.16)", async () => {
      oneCard();
      let held = false;
      let release: () => void = () => {};
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          held
            ? new Promise<CardAnswer[]>((resolve) => {
                release = () => resolve(inline.cards(repo, want, options));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      box().focus();
      // OQ-U1's block is not in hand, so its page waits on the scanner.
      held = true;
      await type("oq-u");
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1]);
      held = false;
      // The next key keeps nothing, and `oq-u`'s inputs come in before
      // React renders it: one act scope.
      await act(async () => {
        fireEvent.change(box(), { target: { value: "oq-uz" } });
        release();
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });
      await settle();
      expect(filterShown()).toMatch(/^oq-u$/);
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(spinning()).toBe(false);
      await idle();
      expect(router.location).toBe("/.vantage/planning?filter=oq-uz");
      expect(querySection("Needs you")).toBeNull();
    });

    it("shows the page of the text it applied last, when the next keeps no entry and that page comes in after", async () => {
      oneCard();
      let held = false;
      let release: () => void = () => {};
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          held
            ? new Promise<CardAnswer[]>((resolve) => {
                release = () => resolve(inline.cards(repo, want, options));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      box().focus();
      held = true;
      await type("oq-u");
      await settle();
      held = false;
      await type("oq-uz");
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1]);
      release();
      await settle();
      expect(filterShown()).toMatch(/^oq-u$/);
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(spinning()).toBe(false);
    });

    // A keystroke that leaves the held text's canonical text as it was, such
    // as a space after it, types nothing newer: the page the box goes on
    // applying is still the one to show when it comes in, and so it stays
    // while the reader types on into a quote that is not understood.
    it("shows the page of the text it applied last when it comes in after a key that keeps the held text as it was", async () => {
      oneCard();
      let held = false;
      let release: () => void = () => {};
      serveTree(ROUTED, "/api", (inline) => ({
        cards: (repo, want, options) =>
          held
            ? new Promise<CardAnswer[]>((resolve) => {
                release = () => resolve(inline.cards(repo, want, options));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      box().focus();
      held = true;
      await type("oq-u");
      await settle();
      held = false;
      await type("oq-uz");
      await settle();
      await type("oq-uz ");
      await settle();
      expect(cardsIn("Needs you")).toEqual([D1]);
      release();
      await settle();
      expect(filterShown()).toMatch(/^oq-u$/);
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(spinning()).toBe(false);
      for (const text of ['oq-uz "', 'oq-uz "a', "oq-uz  "]) {
        await type(text);
        await settle();
        expect(filterShown(), text).toMatch(/^oq-u$/);
        expect(spinning(), text).toBe(false);
      }
      await idle();
      expect(router.location).toBe("/.vantage/planning?filter=oq-uz");
      expect(filterShown()).toMatch(/^oq-uz$/);
    });

    it("shows the page of a text typed past and typed again, when its inputs came in between", async () => {
      limits({ pageEntries: 1 });
      let held = false;
      let release: () => void = () => {};
      serveTree(TREE, "/api", (inline) => ({
        cards: (repo, want, options) =>
          held
            ? new Promise<CardAnswer[]>((resolve) => {
                release = () => resolve(inline.cards(repo, want, options));
              })
            : inline.cards(repo, want, options),
      }));
      await renderPage();
      box().focus();
      held = true;
      await type("oq-u");
      await settle();
      held = false;
      // Typed past, its inputs in, and typed back, all before React renders
      // the text typed past.
      await act(async () => {
        fireEvent.change(box(), { target: { value: "oq-u1" } });
        release();
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        fireEvent.change(box(), { target: { value: "oq-u" } });
      });
      await settle();
      expect(filterShown()).toMatch(/^oq-u$/);
      expect(listedIn("Not on a roadmap")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(spinning()).toBe(false);
    });

    it("shows Nothing matches for a held text once the idle pause passes, says it as the notice is said, and its Clear the filter writes nothing typed since", async () => {
      limits({ filterIdleMs: 300, filterSpeechMs: 1000 });
      await renderPage();
      box().focus();
      await typeKeys("zz");
      // Held back: the last results stay, and nothing says nothing matches.
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      expect(nothingMatches()).toBeNull();
      await idle(300);
      expect(filterOf()).toBe("zz");
      expect(querySection("Needs you")).toBeNull();
      expect(nothingMatchesLines()).toEqual(["Nothing matches zz.", WORDS]);
      expect(status()).toHaveTextContent(/^$/);
      await idle(700);
      expect(status().textContent).toBe(
        `0 match, 10 hidden. Nothing matches zz. ${WORDS}`,
      );
      expect(document.activeElement).toBe(box());
      // A key more, which also keeps nothing and is held, then the button:
      // the filter is cleared, and what was typed is never written.
      await typeKeys("zzq", "zz");
      expect(nothingMatchesLines()?.[0]).toBe("Nothing matches zz.");
      const clear = within(nothingMatches()!).getByRole("button", {
        name: "Clear the filter",
      });
      fireEvent.mouseDown(clear);
      await act(async () => {
        fireEvent.click(clear);
      });
      await settle();
      expect(filterOf()).toBeNull();
      expect(box().value).toBe("");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      await idle();
      expect(filterOf()).toBeNull();
    });

    // A slow typist: the pause has emptied the page, so the filter applied
    // last is one that keeps nothing, and a held text that keeps nothing too
    // goes on showing it rather than the results from before the pause.
    it("keeps Nothing matches up through a further key that keeps nothing, and applies a key that keeps something at once (§6.16)", async () => {
      limits({ filterIdleMs: 300 });
      await renderPage();
      box().focus();
      await typeKeys("oq-d3x", "oq-d");
      expect(cardsIn("Needs you")).toEqual([D3]);
      await idle(300);
      expect(filterOf()).toBe("oq-d3x");
      expect(nothingMatchesLines()?.[0]).toBe("Nothing matches oq-d3x.");
      // Every commit from here on, as the DOM has it: no frame between two
      // keys shows a card while the text keeps nothing.
      const seen: { nothing: boolean; cards: number }[] = [];
      const observer = new MutationObserver(() => {
        seen.push({
          nothing: nothingMatches() !== null,
          cards: screen.queryAllByRole("article").length,
        });
      });
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      await typeKeys("oq-d3xy", "oq-d3x");
      await type("oq-d3x");
      await settle();
      expect(seen.every(({ nothing, cards }) => nothing && cards === 0)).toBe(
        true,
      );
      expect(nothingMatchesLines()?.[0]).toBe("Nothing matches oq-d3x.");
      expect(querySection("Needs you")).toBeNull();
      expect(filterOf()).toBe("oq-d3x");
      observer.disconnect();
      // A key whose text keeps an entry applies with no pause, and the URL
      // takes it after one.
      await type("oq-d3");
      await settle();
      expect(nothingMatches()).toBeNull();
      expect(cardsIn("Needs you")).toEqual([D3]);
      expect(filterShown()).toMatch(/^oq-d3$/);
      expect(filterOf()).toBe("oq-d3x");
      await idle(300);
      expect(filterOf()).toBe("oq-d3");
      expect(cardsIn("Needs you")).toEqual([D3]);
    });

    it("speaks a typed filter's notice once, after the reader stops, though the URL takes each text a slow typist pauses on (§6.17)", async () => {
      limits({ filterIdleMs: 300, filterSpeechMs: 1000 });
      await renderPage();
      box().focus();
      const said: string[] = [];
      const observer = new MutationObserver(() => {
        said.push(status().textContent ?? "");
      });
      observer.observe(status(), {
        childList: true,
        characterData: true,
        subtree: true,
      });
      const written: (string | null)[] = [];
      // 400 ms a key: past the idle pause after every one.
      for (const text of ["o", "oq", "oq-", "oq-d"]) {
        await type(text);
        await idle(400);
        written.push(filterOf());
      }
      expect(written).toEqual(["o", "oq", "oq-", "oq-d"]);
      expect(said.filter((s) => s !== "")).toEqual([]);
      await idle(600);
      expect(said.filter((s) => s !== "")).toEqual([
        expect.stringMatching(/^3 match, 7 hidden\./),
      ]);
      // Leaving the box says what is owed at once.
      said.length = 0;
      await type("oq-d3");
      await idle(400);
      expect(filterOf()).toBe("oq-d3");
      expect(said.filter((s) => s !== "")).toEqual([]);
      act(() => scroller().focus());
      await settle();
      observer.disconnect();
      expect(said.filter((s) => s !== "")).toEqual([
        expect.stringMatching(/^1 matches, 9 hidden\./),
      ]);
    });

    // Typing has applied the text already, so Enter also leaves the box
    // for the results (planning-index.md §6.17, OQ-PF9).
    it("takes the focus to the top of the pane on Enter, and says at once what the idle pause wrote", async () => {
      limits({ filterIdleMs: 300, filterSpeechMs: 1000 });
      await renderPage();
      scroller().scrollTop = 640;
      box().focus();
      await type("oq-d3");
      await idle(400);
      expect(filterOf()).toBe("oq-d3");
      expect(status()).toHaveTextContent(/^$/);
      await enter();
      expect(filterOf()).toBe("oq-d3");
      expect(document.activeElement).toBe(scroller());
      expect(scroller().scrollTop).toBe(0);
      expect(status().textContent).toMatch(/^1 matches, 9 hidden\./);
      // A text it cannot read keeps the focus, for the reader to correct
      // what the notice names, and the pane where it was.
      box().focus();
      scroller().scrollTop = 640;
      await enter('oq-d3 "');
      expect(noticeLines()[0]).toMatch(/^Not filtered/);
      expect(document.activeElement).toBe(box());
      expect(scroller().scrollTop).toBe(640);
    });

    it("changes nothing for a text with the applied canonical text, such as one with a space added (§6.16)", async () => {
      await renderPage();
      box().focus();
      await typeKeys("oq-d");
      const held = heldPlanningPageInputs();
      const d1 = cardFor("OQ-D1");
      const keys = router.keys.length;
      viewerRenders.clear();
      await type("oq-d ");
      await settle();
      await type(" oq-d  ");
      await settle();
      expect(heldPlanningPageInputs()).toEqual(held);
      expect(cardFor("OQ-D1")).toBe(d1);
      expect([...viewerRenders.values()].reduce((a, b) => a + b, 0)).toBe(0);
      expect(router.keys).toHaveLength(keys);
      await idle();
      expect(filterOf()).toBe("oq-d");
      expect(router.keys).toHaveLength(keys + 1);
    });

    it("applies a typed text the URL has not taken to an index update (§6.16)", async () => {
      await renderPage();
      box().focus();
      await typeKeys("oq-d");
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      const MORE: Record<string, string> = {
        ...TREE,
        "plans/design.md": doc(
          "status: in-review\nstage: DESIGN",
          q("OQ-D1", OPEN),
          q("OQ-D2", BLOCKED),
          q("OQ-D3", OPEN),
          q("OQ-D4", OPEN),
        ),
      };
      serveTree(MORE);
      setLoad(readyOf(MORE));
      await settle();
      expect(router.location).toBe("/.vantage/planning");
      expect(filterShown()).toMatch(/^oq-d$/);
      // Late data (planning-to-do-list.md §4.2): counted, and laid out by
      // the reader's next layout, under the same text.
      expect(cardsIn("Needs you")).toEqual([D1, D3]);
      expect(updatesCount()).toHaveTextContent("1");
      await refresh();
      expect(cardsIn("Needs you")).toEqual([D1, D3, "OQ-D4: Question OQ-D4?"]);
      expect(filterShown()).toMatch(/^oq-d$/);
      expect(box().value).toBe("oq-d");
      await idle();
      expect(filterOf()).toBe("oq-d");
    });

    it("reserves the room of the picker's count and of the other-roadmaps line from the unfiltered index, so typing moves neither (planning-index.md §12)", async () => {
      const NESTED = "docs/plans/roadmap.md";
      const MORE: Record<string, string> = {
        ...TREE,
        "plans/other.md": doc("stage: DESIGN", q("OQ-O1", OPEN)),
        [NESTED]: [
          "# Plans",
          "",
          "1. [The unrouted one](../../plans/unrouted.md)",
          "2. [Another](../../plans/other.md)",
          "",
        ].join("\n"),
      };
      seed(MORE);
      await renderPage();
      const count = () =>
        screen.getByTestId("roadmap-shown").querySelector(".hdr-reserve")!;
      const others = () => screen.getByTestId("other-roadmaps");
      expect(count()).toHaveTextContent("(3 need you)");
      expect(others()).toHaveTextContent(PLANNING_NOTICES.otherRoadmaps(2));
      const rooms = () => [
        count().getAttribute("data-reserve"),
        others().getAttribute("data-reserve"),
      ];
      expect(rooms()).toEqual([
        "(3 needs you)",
        PLANNING_NOTICES.otherRoadmaps(2),
      ]);
      box().focus();
      // `oq-u` keeps no entry, OQ-U1 being on the other roadmap only, so it
      // waits for the idle pause (§6.16).
      await typeKeys("oq-u");
      await idle();
      // Both counts are the filter's, and the room for them the index's.
      expect(count()).toHaveTextContent("(0 need you)");
      expect(others()).toHaveTextContent(PLANNING_NOTICES.otherRoadmaps(1));
      expect(rooms()).toEqual([
        "(3 needs you)",
        PLANNING_NOTICES.otherRoadmaps(2),
      ]);
    });

    it("writes the URL as the reader types in the load error and the refusal, where there are no sections to filter (§6.17)", async () => {
      setLoad({ status: "error", message: "Could not load: boom" });
      await renderPage();
      expect(screen.getByText(/Could not load: boom/)).toBeTruthy();
      box().focus();
      await typeKeys("oq-d");
      expect(router.location).toBe("/.vantage/planning");
      await idle();
      expect(router.location).toBe("/.vantage/planning?filter=oq-d");
      cleanup();
      seed(
        {},
        { maxCandidates: 5000 },
        { refused: true, candidateCount: 5001 },
      );
      await renderPage();
      expect(
        screen.getByText(PLANNING_NOTICES.refused(5001, 5000)),
      ).toBeTruthy();
      box().focus();
      await typeKeys("path:x");
      expect(router.location).toBe("/.vantage/planning");
      await idle();
      expect(router.location).toBe("/.vantage/planning?filter=path:x");
    });
  });

  describe("the / key, and the navigations the box follows", () => {
    it("focuses the box and selects its text with /", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      const event = new KeyboardEvent("keydown", {
        key: "/",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        document.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(box());
      expect([box().selectionStart, box().selectionEnd]).toEqual([
        0,
        "path:plans/design.md".length,
      ]);
    });

    it("does nothing with / while the shortcuts are off, and the box is still there to click", async () => {
      localStorage.setItem("vantage:shortcuts-enabled", "false");
      await renderPage();
      const event = new KeyboardEvent("keydown", {
        key: "/",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        document.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(box());
      expect(box()).toBeEnabled();
    });

    it("lists / in the shortcuts help on the planning page", async () => {
      await renderPage();
      await press("?");
      expect(
        within(
          screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
        ).getByText("Filter the planning page"),
      ).toBeInTheDocument();
    });

    it("opens the bare page on g p, and Back returns to the filtered one with the box holding its text (criterion 9)", async () => {
      await renderPage(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      await press("g");
      await press("p");
      expect(router.location).toBe("/.vantage/planning");
      expect(box().value).toBe("");
      expect(notice()).toBeNull();
      expect(cardsIn("Needs you")).toHaveLength(2);
      // With the focus in the box and text unapplied: Back still wins.
      await press("/");
      await type("unapplied");
      act(() => router.navigate!(-1));
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      expect(box().value).toBe("path:plans/design.md is:open");
      expect(document.activeElement).toBe(box());
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
    });
  });

  describe("a pasted planning link", () => {
    it("applies a bare link at once, showing its filter", async () => {
      await renderPage();
      await paste("/.vantage/planning?filter=path:plans/design.md+is:open");
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      expect(box().value).toBe("path:plans/design.md is:open");
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
    });

    it("reads a whole address from another origin for its filter alone, ignoring its pages and fragment", async () => {
      await renderPage("/.vantage/planning?x=1");
      await paste(
        "https://elsewhere.example:9000/.vantage/planning/other?filter=path%3Aplans%2Fdesign.md&needs-you=2#OQ-D3",
      );
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md&x=1",
      );
      expect(router.hash).toBe("");
    });

    it("reads back whole the address a roadmap pick and an outline link write", async () => {
      // Each writes the filter as Enter does, `*` as %2A, so a copy of the
      // address bar pasted into the box applies the same filter, a later
      // term and all (planning-index.md §6.17, §13.5).
      seed(TWO);
      localStorage.setItem("vantage:tocOpen", "true");
      await renderPage();
      const text = "path:plans/*.md is:open";
      await enter(text);
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/%2A.md+is:open&roadmap=roadmap.md",
      );
      const outlineLink = screen
        .getByRole("navigation", { name: "On this page" })
        .querySelector<HTMLAnchorElement>(
          '[data-testid=outline-document][data-path="plans/design.md"]',
        )!;
      expect(outlineLink.getAttribute("href")).toMatch(
        /^\/\.vantage\/planning\?filter=path:plans\/%2A\.md\+is:open&roadmap=roadmap\.md#/,
      );
      const entered = `http://localhost:8000${router.location}`;
      await act(async () => {
        fireEvent.change(screen.getByRole("combobox", { name: "Roadmap" }), {
          target: { value: NESTED },
        });
      });
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/%2A.md+is:open&roadmap=docs%2Fplans%2Froadmap.md",
      );
      for (const address of [entered, outlineLink.href]) {
        cleanup();
        resetPlanningPageInputs();
        await renderPage();
        await paste(address);
        expect(box().value, address).toBe(text);
        expect(
          new URLSearchParams(router.location.split("?")[1]).get("filter"),
        ).toBe(text);
      }
    });

    it("reads the checker's whole output around its link (criterion 11)", async () => {
      await renderPage();
      await paste(await checkerBlock());
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:/plans/design.md+is:open",
      );
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
    });

    it("chooses the roadmap a link names, and remembers nothing", async () => {
      seed(TWO);
      await renderPage();
      await paste(
        `/.vantage/planning?filter=path:plans/unrouted.md&roadmap=${NESTED}`,
      );
      expect(
        new URLSearchParams(router.location.split("?")[1]).get("roadmap"),
      ).toBe(NESTED);
      expect(
        (screen.getByRole("combobox", { name: "Roadmap" }) as HTMLSelectElement)
          .value,
      ).toBe(NESTED);
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(
        Object.keys(localStorage).filter((key) =>
          key.startsWith("vantage:planningRoadmap"),
        ),
      ).toEqual([]);
    });

    // A paste applies its link's filter as Enter does (planning-index.md
    // §6.17): in one replace navigation, with its roadmap written as the page's
    // own rewrite would leave it, and its notice said once the page is in.
    const navigations = async (paste: () => Promise<void>) => {
      const before = router.keys.length;
      await paste();
      return router.keys.length - before;
    };

    it("writes a ./ roadmap as the page writes it, in one replace, and says the notice", async () => {
      seed(TWO);
      await renderPage();
      expect(router.location).toBe("/.vantage/planning?roadmap=roadmap.md");
      expect(
        await navigations(() =>
          paste(
            `/.vantage/planning?filter=path:plans/unrouted.md&roadmap=./${NESTED}`,
          ),
        ),
      ).toBe(1);
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/unrouted.md&roadmap=docs%2Fplans%2Froadmap.md",
      );
      expect(cardsIn("Needs you")).toEqual(["OQ-U1: Question OQ-U1?"]);
      expect(status()).toHaveTextContent(/^\d+ match(es)?, \d+ hidden\./);
    });

    it("drops the roadmap of a link where fewer than two route, in one replace, and says the notice", async () => {
      await renderPage();
      expect(
        await navigations(() =>
          paste(
            "/.vantage/planning?filter=path:plans/design.md&roadmap=roadmap.md",
          ),
        ),
      ).toBe(1);
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
      expect(status()).toHaveTextContent(/^3 match, 7 hidden\./);
    });

    it("chooses for a link's roadmap that does not route what the page would, in one replace, and says the notice", async () => {
      seed(TWO);
      await renderPage(`/.vantage/planning?roadmap=${NESTED}`);
      expect(
        await navigations(() =>
          paste(
            "/.vantage/planning?filter=path:plans/design.md&roadmap=docs/nowhere.md",
          ),
        ),
      ).toBe(1);
      // What `?roadmap=docs/nowhere.md` opens with nothing remembered: the
      // default (planning-index.md §6.8).
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md&roadmap=roadmap.md",
      );
      expect(status()).toHaveTextContent(/^\d+ match(es)?, \d+ hidden\./);
    });

    it("clears the filter with a link that has none", async () => {
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      await paste("Planning page: http://localhost:8000/.vantage/planning");
      expect(router.location).toBe("/.vantage/planning");
      expect(box().value).toBe("");
    });

    it("applies a link's filter it cannot read as written, so the notice names its term", async () => {
      await renderPage();
      await paste(
        "/.vantage/planning?filter=path:plans/design.md+is:closed+is:open",
      );
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md+is:closed+is:open",
      );
      expect(box().value).toBe("path:plans/design.md is:closed is:open");
      expect(box()).toHaveAttribute("aria-invalid", "true");
      expect(noticeLines()[0]).toMatch(/cannot read is:closed\./);
    });

    it("never says a text is not applied through a paste, a ✕ or an Enter, which apply what the box holds", async () => {
      // The router commits a location in a transition, after the box shows
      // what it applied: in between, nothing in the box is unapplied (§6.17).
      await renderPage();
      // The hint, which shares its slot with the counts.
      const shown: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            const text = node.textContent ?? "";
            if (text.includes(FILTER_HINT)) shown.push(text);
          }
        }
      });
      observer.observe(screen.getByTestId("planning-filter-hint"), {
        childList: true,
        characterData: true,
        subtree: true,
      });
      try {
        await paste("/.vantage/planning?filter=path:plans/design.md+is:open");
        expect(router.location).toBe(
          "/.vantage/planning?filter=path:plans/design.md+is:open",
        );
        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: "Clear the filter" }),
          );
        });
        await settle();
        expect(router.location).toBe("/.vantage/planning");
        await act(async () => {});
        expect(shown).toEqual([]);
        // Typed, a text it can read is applied as it is typed, and Enter
        // writes it: neither is "not applied".
        await type("path:./plans/design.md");
        await settle();
        expect(hint()).toBe("");
        await enter();
        expect(router.location).toBe(
          "/.vantage/planning?filter=path:/plans/design.md",
        );
        await act(async () => {});
        expect(shown).toEqual([]);
        // One it cannot read is not applied, and the hint says so until
        // Enter, which applies it as written.
        await type('path:plans/design.md "is');
        expect(hint()).toBe(FILTER_HINT);
        await act(async () => {});
        shown.length = 0;
        await enter();
        expect(
          new URLSearchParams(router.location.split("?")[1]).get("filter"),
        ).toBe('path:plans/design.md "is');
        await act(async () => {});
      } finally {
        observer.disconnect();
      }
      expect(shown).toEqual([]);
      expect(hint()).toBe("");
    });

    it("takes any other paste as typing, written at once", async () => {
      await renderPage();
      box().focus();
      await act(async () => {
        fireEvent.paste(box(), {
          clipboardData: { getData: () => "path:plans/design.md" },
        });
        // jsdom inserts nothing on a paste: the browser's own input follows.
        fireEvent.change(box(), { target: { value: "path:plans/design.md" } });
      });
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning?filter=path:plans/design.md",
      );
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
    });

    it("applies to the repository on screen in daemon mode (criterion 11)", async () => {
      useRepoStore.setState({
        isMultiRepo: true,
        currentRepo: "alpha",
        repos: [{ name: "alpha" }, { name: "beta" }] as never,
      });
      serveTree(TREE, "/api/r/alpha");
      setLoad(readyOf(TREE), "alpha");
      await renderPage("/.vantage/planning/alpha");
      await paste(await checkerBlock());
      expect(router.location).toBe(
        "/.vantage/planning/alpha?filter=path:/plans/design.md+is:open",
      );
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
    });
  });

  describe("in daemon mode, with no repository or a wrong one (criterion 10)", () => {
    beforeEach(() => {
      useRepoStore.setState({
        isMultiRepo: true,
        currentRepo: null,
        repos: [{ name: "alpha" }, { name: "my notes" }] as never,
      });
    });

    const projectLinks = () =>
      within(screen.getByTestId("planning-projects"))
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]);

    it("lists each project's planning page with the same query on Choose a project, and one click reaches it filtered", async () => {
      await renderPage(
        "/.vantage/planning?filter=path:plans/design.md+is:open",
      );
      expect(screen.getByText(/Choose a project/)).toBeTruthy();
      expect(projectLinks()).toEqual([
        [
          "alpha",
          "/.vantage/planning/alpha?filter=path:plans/design.md+is:open",
        ],
        [
          "my notes",
          "/.vantage/planning/my%20notes?filter=path:plans/design.md+is:open",
        ],
      ]);
      // The box reads the URL here too.
      expect(box().value).toBe("path:plans/design.md is:open");
      serveTree(TREE, "/api/r/alpha");
      setLoad(readyOf(TREE), "alpha");
      await act(async () => {
        fireEvent.click(screen.getByRole("link", { name: "alpha" }));
      });
      await settle();
      expect(router.location).toBe(
        "/.vantage/planning/alpha?filter=path:plans/design.md+is:open",
      );
      expect(cardsIn("Needs you")).toEqual([
        "OQ-D1: Question OQ-D1?",
        "OQ-D3: Question OQ-D3?",
      ]);
    });

    it("lists the projects with the filter kept on Repository not found", async () => {
      await renderPage("/.vantage/planning/nope?filter=path:x.md");
      expect(screen.getByText("Repository not found: nope")).toBeTruthy();
      expect(projectLinks()).toEqual([
        ["alpha", "/.vantage/planning/alpha?filter=path:x.md"],
        ["my notes", "/.vantage/planning/my%20notes?filter=path:x.md"],
      ]);
    });
  });

  describe("a link naming a space (planning-index.md §13.6)", () => {
    // Two checkouts' space ids: beta's, which the daemon serves, and one it
    // does not.
    const BETA = "betaspace2345677";
    const ELSEWHERE = "elsewhere2345677";
    const FILTERED = "filter=path:plans/design.md+is:open";

    beforeEach(() => {
      useRepoStore.setState({
        isMultiRepo: true,
        currentRepo: null,
        repos: [{ name: "alpha" }, { name: "beta" }] as never,
      });
    });

    /** Answer `GET /api/spaces/{id}` with `answer`, every other GET as before. */
    function serveSpaces(answer: (id: string) => Promise<unknown>): void {
      const rest = vi.mocked(axios.get).getMockImplementation()!;
      vi.mocked(axios.get).mockImplementation(async (url, config) => {
        const asked = /^\/api\/spaces\/([^/]+)$/.exec(String(url));
        if (asked !== null) return { data: await answer(asked[1]!) };
        return rest(url, config);
      });
    }
    const spaceGets = () =>
      vi
        .mocked(axios.get)
        .mock.calls.map(([url]) => String(url))
        .filter((url) => url.startsWith("/api/spaces/"));
    function deferred() {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<unknown>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }
    /**
     * Every node the page inserts from now on that is or holds *Choose a
     * project* or the projects' list, read as it was inserted, so one drawn
     * and taken away again in the same task is seen too.
     */
    function watchForChooser() {
      const seen: string[] = [];
      const read = (records: MutationRecord[]) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if ((node.textContent ?? "").includes("Choose a project")) {
              seen.push("Choose a project");
            }
            if (
              node instanceof Element &&
              (node.matches("[data-testid=planning-projects]") ||
                node.querySelector("[data-testid=planning-projects]") !== null)
            ) {
              seen.push("the projects' list");
            }
          }
        }
      };
      const observer = new MutationObserver(read);
      observer.observe(document.body, { childList: true, subtree: true });
      return {
        seen: () => {
          read(observer.takeRecords());
          return seen;
        },
        stop: () => observer.disconnect(),
      };
    }
    const projectLinks = () =>
      within(screen.getByTestId("planning-projects"))
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]);

    it("opens the project holding it, held in the shell's loading state on a first load, so Choose a project never paints", async () => {
      // The answer waits on the test, and the hold on it.
      setPlanningLimitsForTests({ holdMs: 60_000 });
      const answer = deferred();
      serveSpaces(() => answer.promise);
      serveTree(TREE, "/api/r/beta");
      setLoad(readyOf(TREE), "beta");
      const watch = watchForChooser();
      try {
        await renderPage(`/.vantage/planning?${FILTERED}&space=${BETA}`);
        expect(screen.getByText("Loading…")).toBeTruthy();
        expect(screen.queryByRole("main")).toBeNull();
        expect(spaceGets()).toEqual([`/api/spaces/${BETA}`]);
        await act(async () => answer.resolve({ repo: "beta" }));
        await settle();
        expect(router.location).toBe(`/.vantage/planning/beta?${FILTERED}`);
        expect(cardsIn("Needs you")).toEqual([
          "OQ-D1: Question OQ-D1?",
          "OQ-D3: Question OQ-D3?",
        ]);
        expect(box().value).toBe("path:plans/design.md is:open");
        expect(useRepoStore.getState().currentRepo).toBe("beta");
        expect(watch.seen()).toEqual([]);
        // Asked once, the shell and the page sharing the request.
        expect(spaceGets()).toHaveLength(1);
      } finally {
        watch.stop();
      }
    });

    it("keeps the filter, the roadmap and the fragment in one replace navigation, adding no history entry and storing nothing", async () => {
      serveSpaces(async () => ({ repo: "beta" }));
      serveTree(TWO, "/api/r/beta");
      setLoad(readyOf(TWO), "beta");
      const stored = Object.keys(localStorage).sort();
      const from = router.types.length;
      await renderPage(
        `/.vantage/planning?filter=is:open&roadmap=${NESTED}&space=${BETA}#needs-you`,
      );
      const types = router.types.slice(from);
      expect(router.location).toBe(
        `/.vantage/planning/beta?filter=is:open&roadmap=${encodeURIComponent(NESTED)}`,
      );
      expect(router.hash).toBe("#needs-you");
      expect(
        (screen.getByRole("combobox", { name: "Roadmap" }) as HTMLSelectElement)
          .value,
      ).toBe(NESTED);
      expect(box().value).toBe("is:open");
      expect(types[0]).toBe("POP");
      expect(types.length).toBeGreaterThan(1);
      expect(types.slice(1).every((type) => type === "REPLACE")).toBe(true);
      expect(Object.keys(localStorage).sort()).toEqual(stored);
      expect(
        Object.values(localStorage).some((value) => value.includes(BETA)),
      ).toBe(false);
    });

    it("shows the frame and the filter line alone while it asks, after the shell has painted, then opens the project", async () => {
      const answer = deferred();
      serveSpaces(() => answer.promise);
      serveTree(TREE, "/api/r/beta");
      setLoad(readyOf(TREE), "beta");
      await renderPage("/notes.md");
      const watch = watchForChooser();
      try {
        // A link followed in the app, as a click on it in a document is.
        await act(async () => {
          router.navigate!(`/.vantage/planning?${FILTERED}&space=${BETA}`);
        });
        await settle();
        expect(screen.getByTestId("planning-header")).toBeTruthy();
        expect(box().value).toBe("path:plans/design.md is:open");
        expect(
          screen.queryByRole("navigation", { name: "Sections" }),
        ).toBeNull();
        expect(screen.queryByTestId("space-not-found")).toBeNull();
        expect(screen.queryByRole("article")).toBeNull();
        await act(async () => answer.resolve({ repo: "beta" }));
        await settle();
        expect(router.location).toBe(`/.vantage/planning/beta?${FILTERED}`);
        expect(router.types.at(-1)).toBe("REPLACE");
        expect(cardsIn("Needs you")).toEqual([
          "OQ-D1: Question OQ-D1?",
          "OQ-D3: Question OQ-D3?",
        ]);
        expect(watch.seen()).toEqual([]);
      } finally {
        watch.stop();
      }
    });

    it("waits no longer than the hold's deadline on a first load, and still never paints Choose a project", async () => {
      setPlanningLimitsForTests({ holdMs: 0 });
      const answer = deferred();
      serveSpaces(() => answer.promise);
      serveTree(TREE, "/api/r/beta");
      setLoad(readyOf(TREE), "beta");
      const watch = watchForChooser();
      try {
        await renderPage(`/.vantage/planning?${FILTERED}&space=${BETA}`);
        expect(screen.queryByText("Loading…")).toBeNull();
        expect(box().value).toBe("path:plans/design.md is:open");
        expect(screen.queryByRole("article")).toBeNull();
        await act(async () => answer.resolve({ repo: "beta" }));
        await settle();
        expect(router.location).toBe(`/.vantage/planning/beta?${FILTERED}`);
        expect(cardsIn("Needs you")).toHaveLength(2);
        expect(watch.seen()).toEqual([]);
      } finally {
        watch.stop();
      }
    });

    it("says the link was made in a checkout this Vantage does not serve, keeps the filter, and only then lists the projects", async () => {
      serveSpaces(async () => ({ repo: null }));
      await renderPage(`/.vantage/planning?${FILTERED}&space=${ELSEWHERE}`);
      const said = screen.getByTestId("space-not-found");
      expect(said).toHaveTextContent(PLANNING_SPACE_MESSAGES.notServed);
      expect(screen.queryByText(/Choose a project/)).toBeNull();
      expect(
        said.compareDocumentPosition(screen.getByTestId("planning-projects")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // Each project's page with the filter, and without the space, which
      // a project segment makes mean nothing.
      expect(projectLinks()).toEqual([
        ["alpha", `/.vantage/planning/alpha?${FILTERED}`],
        ["beta", `/.vantage/planning/beta?${FILTERED}`],
      ]);
      expect(box().value).toBe("path:plans/design.md is:open");
      // The URL is left as it is, the link it was.
      expect(router.location).toBe(
        `/.vantage/planning?${FILTERED}&space=${ELSEWHERE}`,
      );
    });

    it("says it could not find the project when the request fails, and lists the projects with the filter", async () => {
      serveSpaces(async () => {
        throw new Error("offline");
      });
      await renderPage(`/.vantage/planning?${FILTERED}&space=${BETA}`);
      expect(screen.getByTestId("space-not-found")).toHaveTextContent(
        PLANNING_SPACE_MESSAGES.failed,
      );
      expect(projectLinks()).toEqual([
        ["alpha", `/.vantage/planning/alpha?${FILTERED}`],
        ["beta", `/.vantage/planning/beta?${FILTERED}`],
      ]);
      expect(screen.queryByText(/Choose a project/)).toBeNull();
    });

    // A checkout copied whole keeps the original's id, so two projects hold
    // it: the page opens neither, says why and what to do, and lists only
    // those two, each with the filter.
    it("says two projects hold the space and lists only theirs when a checkout was copied whole", async () => {
      useRepoStore.setState({
        repos: [
          { name: "alpha" },
          { name: "beta" },
          { name: "gamma" },
        ] as never,
      });
      serveSpaces(async () => ({ repo: null, repos: ["alpha", "gamma"] }));
      await renderPage(`/.vantage/planning?${FILTERED}&space=${BETA}`);
      expect(screen.getByTestId("space-not-found")).toHaveTextContent(
        PLANNING_SPACE_MESSAGES.several(2),
      );
      expect(projectLinks()).toEqual([
        ["alpha", `/.vantage/planning/alpha?${FILTERED}`],
        ["gamma", `/.vantage/planning/gamma?${FILTERED}`],
      ]);
      expect(screen.queryByText(/Choose a project/)).toBeNull();
      expect(router.location).toBe(
        `/.vantage/planning?${FILTERED}&space=${BETA}`,
      );
      expect(useRepoStore.getState().currentRepo).toBeNull();
    });

    // The daemon finds a new clone seconds after the agent in it printed the
    // link, so a link opened at once is answered none: the page asks again
    // as the projects change, and opens the project once it is found.
    it("opens the project once the daemon finds it, after saying no project held the space", async () => {
      useRepoStore.setState({ repos: [{ name: "alpha" }] as never });
      let found = false;
      serveSpaces(async () => ({ repo: found ? "beta" : null }));
      serveTree(TREE, "/api/r/beta");
      setLoad(readyOf(TREE), "beta");
      await renderPage(`/.vantage/planning?${FILTERED}&space=${BETA}`);
      expect(screen.getByTestId("space-not-found")).toHaveTextContent(
        PLANNING_SPACE_MESSAGES.notServed,
      );
      found = true;
      await act(async () => {
        useRepoStore.setState({
          repos: [{ name: "alpha" }, { name: "beta" }] as never,
        });
      });
      await settle();
      expect(router.location).toBe(`/.vantage/planning/beta?${FILTERED}`);
      expect(screen.queryByTestId("space-not-found")).toBeNull();
      expect(cardsIn("Needs you")).toHaveLength(2);
      expect(spaceGets()).toHaveLength(2);
    });

    // An answer that comes after the frame painted moves nothing painted
    // (planning-index.md §13.6): the sidebar's column and the header's
    // buttons are drawn while the page asks, whatever the answer turns out
    // to be, and kept by every answer, the ones that open no project too.
    describe("keeps what is painted where it is, whatever the answer", () => {
      /**
       * What decides where the main column and the header's crumbs sit: the
       * sidebar's column and the buttons before the crumbs.
       */
      const layoutNow = () => ({
        sidebar: screen.queryByTestId("sidebar") !== null,
        lead: Array.from(
          screen
            .getByTestId("planning-header")
            .querySelectorAll(".hdr-lead button"),
        )
          .filter((b) => b.closest(".hdr-crumbs") === null)
          .map((b) => b.getAttribute("aria-label")),
      });
      /**
       * Whether the crumbs, which name the project the answer gives, and the
       * toolbar, whose box starts where they end, are painted: not until it
       * is in, so a crumb renamed moves nothing painted.
       */
      const crumbsPainted = () =>
        [".hdr-crumbs", ".hdr-tools"].map(
          (part) =>
            !screen
              .getByTestId("planning-header")
              .querySelector(part)!
              .classList.contains("invisible"),
        );

      it.each([
        ["opens a project", { repo: "beta" }],
        ["no project holds it", { repo: null }],
        ["two do", { repo: null, repos: ["alpha", "beta"] }],
      ])("on a first load past the hold, when %s", async (_, reply) => {
        setPlanningLimitsForTests({ holdMs: 0 });
        const answer = deferred();
        serveSpaces(() => answer.promise);
        serveTree(TREE, "/api/r/beta");
        setLoad(readyOf(TREE), "beta");
        await renderPage(`/.vantage/planning?${FILTERED}&space=${BETA}`);
        const before = layoutNow();
        expect(before.sidebar).toBe(true);
        expect(crumbsPainted()).toEqual([false, false]);
        // No project is open yet, so the sidebar keeps its project row's
        // room unpainted, for the row the answer may bring.
        expect(screen.getByTestId("sidebar-project-room")).toBeTruthy();
        await act(async () => answer.resolve(reply));
        await settle();
        expect(layoutNow()).toEqual(before);
        expect(crumbsPainted()).toEqual([true, true]);
        expect(screen.queryByTestId("sidebar-project-room") === null).toBe(
          reply.repo === "beta",
        );
      });

      it.each([
        ["opens a project", { repo: "beta" }],
        ["no project holds it", { repo: null }],
      ])(
        "on a link followed from a project's page, when %s",
        async (_, reply) => {
          const answer = deferred();
          serveSpaces(() => answer.promise);
          serveTree(TREE, "/api/r/beta");
          setLoad(readyOf(TREE), "beta");
          useRepoStore.setState({ currentRepo: "alpha" });
          await renderPage("/alpha/notes.md");
          await act(async () => {
            router.navigate!(`/.vantage/planning?${FILTERED}&space=${BETA}`);
          });
          await settle();
          const before = layoutNow();
          expect(before.sidebar).toBe(true);
          expect(crumbsPainted()).toEqual([false, false]);
          await act(async () => answer.resolve(reply));
          await settle();
          expect(layoutNow()).toEqual(before);
          expect(crumbsPainted()).toEqual([true, true]);
        },
      );
    });

    it("asks nothing for a space= that is not a space id, and says so", async () => {
      serveSpaces(async () => ({ repo: "beta" }));
      await renderPage(`/.vantage/planning?${FILTERED}&space=Not-An-Id`);
      expect(spaceGets()).toEqual([]);
      expect(screen.getByTestId("space-not-found")).toHaveTextContent(
        PLANNING_SPACE_MESSAGES.notAnId,
      );
      expect(projectLinks()[0]).toEqual([
        "alpha",
        `/.vantage/planning/alpha?${FILTERED}`,
      ]);
    });

    it("ignores the space under a project segment, and the in-place rewrite drops it", async () => {
      serveSpaces(async () => ({ repo: "beta" }));
      serveTree(TREE, "/api/r/alpha");
      setLoad(readyOf(TREE), "alpha");
      const from = router.types.length;
      await renderPage(`/.vantage/planning/alpha?${FILTERED}&space=${BETA}`);
      expect(spaceGets()).toEqual([]);
      expect(router.location).toBe(`/.vantage/planning/alpha?${FILTERED}`);
      expect(
        router.types.slice(from + 1).every((type) => type === "REPLACE"),
      ).toBe(true);
      expect(cardsIn("Needs you")).toHaveLength(2);
    });

    it("lists the projects without the space on Repository not found", async () => {
      serveSpaces(async () => ({ repo: "beta" }));
      await renderPage(`/.vantage/planning/nope?${FILTERED}&space=${BETA}`);
      expect(spaceGets()).toEqual([]);
      expect(screen.getByText("Repository not found: nope")).toBeTruthy();
      expect(projectLinks()[1]).toEqual([
        "beta",
        `/.vantage/planning/beta?${FILTERED}`,
      ]);
    });

    describe("in single-project mode", () => {
      beforeEach(() => {
        useRepoStore.setState({
          isMultiRepo: false,
          currentRepo: null,
          repos: [{ name: "", path: "/repo" }] as never,
        });
      });
      const otherCheckout = () => screen.queryByTestId("other-checkout");

      it("drops a space this checkout holds, silently", async () => {
        serveSpaces(async () => ({ repo: "" }));
        await renderPage(`/.vantage/planning?${FILTERED}&space=${BETA}`);
        expect(router.location).toBe(`/.vantage/planning?${FILTERED}`);
        expect(otherCheckout()).toBeNull();
        expect(cardsIn("Needs you")).toHaveLength(2);
      });

      it("says in one notice line, painted with the frame, that the page shows the checkout this Vantage serves when the space is another's", async () => {
        setPlanningLimitsForTests({ holdMs: 60_000 });
        const answer = deferred();
        serveSpaces(() => answer.promise);
        await renderPage(`/.vantage/planning?${FILTERED}&space=${ELSEWHERE}`);
        // The frame waits for the answer, so the line moves nothing.
        expect(inPage().getByRole("status")).toBeTruthy();
        await act(async () => answer.resolve({ repo: null }));
        await settle();
        expect(inPage().queryByRole("status")).toBeNull();
        expect(otherCheckout()).toHaveTextContent(
          PLANNING_SPACE_MESSAGES.otherCheckout,
        );
        expect(
          otherCheckout()!.compareDocumentPosition(
            document.querySelector("[data-planning-sections]")!,
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(cardsIn("Needs you")).toHaveLength(2);
        // Kept in the URL, which still says where the link was made.
        expect(router.location).toBe(
          `/.vantage/planning?${FILTERED}&space=${ELSEWHERE}`,
        );
      });

      it("says nothing of an answer that comes after the frame painted", async () => {
        setPlanningLimitsForTests({ holdMs: 0 });
        const answer = deferred();
        serveSpaces(() => answer.promise);
        await renderPage(`/.vantage/planning?${FILTERED}&space=${ELSEWHERE}`);
        expect(inPage().queryByRole("status")).toBeNull();
        await act(async () => answer.resolve({ repo: null }));
        await settle();
        expect(otherCheckout()).toBeNull();
      });

      it("reads a pasted link's filter and asks nothing about its space", async () => {
        await renderPage();
        await paste(await checkerBlock());
        expect(router.location).toBe(
          "/.vantage/planning?filter=path:/plans/design.md+is:open",
        );
        expect(spaceGets()).toEqual([]);
        expect(cardsIn("Needs you")).toEqual([
          "OQ-D1: Question OQ-D1?",
          "OQ-D3: Question OQ-D3?",
        ]);
      });
    });
  });

  describe("Copy answers, and the visit's reviews (§6.7)", () => {
    const copyButton = () =>
      screen.getByTestId("pending-answers").closest("button")!;
    const pendingCount = () =>
      screen.getByTestId("pending-answers").textContent;

    /** A pending comment on the line `line`. */
    const pendingOn = (id: string, line: number): ReviewComment => ({
      id,
      comment: `Answer ${id}`,
      created_at: 0,
      reactions: [],
      anchor: {
        source_line: line,
        block_text_hash: "00000000",
        selection_offset: 0,
        selection_length: 0,
      },
    });
    const questionOf = (tree: Record<string, string>, id: string) =>
      readyOf(tree)
        .index.documents.flatMap((d) => d.questions)
        .find((x) => x.id === id)!;

    it("copies the answers on the questions it keeps, and says how many it leaves out", async () => {
      reviews["plans/design.md"] = [
        pendingOn("kept-0001", questionOf(TREE, "OQ-D1").line),
      ];
      reviews["plans/unrouted.md"] = [
        pendingOn("left-0001", questionOf(TREE, "OQ-U1").line),
        pendingOn("left-0002", questionOf(TREE, "OQ-U1").line),
      ];
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      expect(pendingCount()).toBe("1");
      fireEvent.click(screen.getByRole("button", { name: "Review answers" }));
      const pendingMenu = screen.getByRole("menu", {
        name: "Answers waiting on the agent",
      });
      expect(within(pendingMenu).getByText("Answer kept-0001")).toBeTruthy();
      expect(within(pendingMenu).queryByText("Answer left-0001")).toBeNull();
      expect(
        within(pendingMenu).getByText(/The filter leaves out 2 answers/),
      ).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(copyButton()).toHaveAccessibleName(
        "Copy answers 1, not counting 2 answers the filter leaves out",
      );
      expect(copyButton()).toHaveAttribute(
        "title",
        "Copy every answer waiting on the agent that the filter keeps, grouped by document, for one trip. It leaves out 2 answers: clear it to copy them too",
      );
      await act(async () => {
        fireEvent.click(copyButton());
      });
      const payload = writeText.mock.calls[0][0] as string;
      expect(payload).toContain("**Comment:** Answer kept-0001");
      expect(payload).not.toContain("plans/unrouted.md");
      // Cleared, it copies them all, and its name is its text again.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Clear the filter" }),
        );
      });
      await settle();
      expect(pendingCount()).toBe("3");
      expect(copyButton()).not.toHaveAttribute("aria-label");
    });

    it("leaves out a comment on a hidden question nested in a kept one, never crediting it to the kept one", async () => {
      const NEST: Record<string, string> = {
        "roadmap.md": "# Roadmap\n\n1. [Nested](plans/nested.md)\n",
        "plans/nested.md": doc(
          "stage: DESIGN",
          [
            `1. ${OPEN} **OQ-N1: Question OQ-N1?**`,
            "",
            `   ${questionDirective(OPEN, "OQ-N1", "Yes.")}`,
            "",
            "   _Leaning:_ Yes.",
            "",
            `   1. ${ANSWERED} **OQ-N2: Question OQ-N2?**`,
            "",
            `      ${questionDirective(ANSWERED, "OQ-N2")}`,
            "",
            "      Ruled.",
            "",
          ].join("\n"),
        ),
      };
      seed(NEST);
      reviews["plans/nested.md"] = [
        pendingOn("inner-0001", questionOf(NEST, "OQ-N2").unitLine),
      ];
      await renderPage("/.vantage/planning?filter=is:open");
      expect(cardsIn("Needs you")).toEqual(["OQ-N1: Question OQ-N1?"]);
      expect(pendingCount()).toBe("0");
      expect(copyButton()).toBeDisabled();
      expect(copyButton()).toHaveAccessibleName(
        "Copy answers 0, not counting 1 answer the filter leaves out",
      );
      expect(
        within(cardFor("OQ-N1")).queryByText("Answered — waiting on the agent"),
      ).toBeNull();
      cleanup();
      resetPlanningPageInputs();
      await renderPage();
      expect(pendingCount()).toBe("1");
    });

    it.each(["held", "failed"] as const)(
      "counts its answers once every listed question's document is read, with the rows' request %s",
      async (second) => {
        // The second request holds the rows' documents too, which hold no
        // question and so no answer: neither its wait nor its failure
        // leaves the count unknown (planning-index.md §6.7).
        const ROWS: Record<string, string> = { ...TREE };
        for (let i = 0; i < 6; i++) {
          ROWS[`plans/r${i}.md`] = doc(
            "status: accepted\nstage: DECIDED",
            "Decided.",
          );
        }
        seed(ROWS);
        setPlanningLimitsForTests({ pageRows: 2 });
        reviews["plans/design.md"] = [
          pendingOn("kept-0001", questionOf(TREE, "OQ-D1").line),
        ];
        const real = vi.mocked(axios.post).getMockImplementation()!;
        const asked: string[][] = [];
        vi.mocked(axios.post).mockImplementation((url, body, config) => {
          if (String(url).endsWith("/planning/reviews")) {
            asked.push((body as { paths: string[] }).paths);
            if (asked.length === 2) {
              return second === "held"
                ? new Promise(() => {})
                : Promise.reject(new Error("down"));
            }
          }
          return real(url, body, config);
        });
        await renderPage();
        expect(asked).toHaveLength(2);
        expect(asked[1]!.length).toBeGreaterThan(0);
        expect(
          asked[1]!.every((path) =>
            /^plans\/(r\d|ready|built|deps)\.md$/.test(path),
          ),
          asked[1]!.join(" "),
        ).toBe(true);
        expect(pendingCount()).toBe("1");
        expect(copyButton()).toBeEnabled();
        expect(screen.queryByTestId("reviews-failed")).toBeNull();
      },
    );

    it("reads every listed document in two requests, rows included, so clearing the filter asks for no third", async () => {
      const reviewRequests = () =>
        vi
          .mocked(axios.post)
          .mock.calls.filter(([url]) =>
            String(url).endsWith("/planning/reviews"),
          )
          .map(([, body]) => (body as { paths: string[] }).paths);
      await renderPage("/.vantage/planning?filter=path:plans/design.md");
      const [first, rest] = reviewRequests();
      expect(reviewRequests()).toHaveLength(2);
      // The second holds the rows' documents, which no question holds.
      expect(rest).toEqual(
        expect.arrayContaining([
          "plans/deps.md",
          "plans/ready.md",
          "plans/built.md",
        ]),
      );
      expect(new Set([...first!, ...rest!])).toEqual(
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
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Clear the filter" }),
        );
      });
      await settle();
      expect(documentsIn("Ready to build")).toEqual(["plans/ready.md"]);
      expect(reviewRequests()).toHaveLength(2);
      expect(reviewGets()).toEqual([]);
    });
  });

  it("draws no filter line in a static export", async () => {
    window.__VANTAGE_STATIC__ = true;
    try {
      await renderPage();
      expect(screen.queryByRole("search")).toBeNull();
    } finally {
      delete window.__VANTAGE_STATIC__;
    }
  });
});
