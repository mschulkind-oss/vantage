/**
 * Link badges in the viewer (`docs/design/planning-index.md` §5): which links
 * get one, where it goes, and every text it must stay out of — review anchors
 * above all (§13's first risk), the contents column, the delta flash and a
 * click in review mode.
 *
 * Renders the app's real `MarkdownViewer` against a planning store seeded with
 * a ready index, so what is asserted is what a reader sees.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import axios from "axios";
import {
  badgeFor,
  badgeSpeech,
  type PlanningConfig,
  type PlanningIndex,
} from "vantage-md/planning";
import { MarkdownViewer } from "../components/MarkdownViewer";
import {
  inlineScannerClient,
  setPlanningScannerForTests,
} from "../planningScan/client";
import { PLANNING_BADGE_ATTR } from "../components/PlanningBadge";
import {
  PLANNING_IDLE,
  resetPlanningTrackers,
  usePlanningStore,
  type PlanningLoad,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { useReviewStore } from "../stores/useReviewStore";
import { blockVisibleText, hashBlockText } from "../lib/reviewAnchor";
import { collectOutline } from "./useDocumentOutline";
import { LINK_FRAGMENT_ATTR, LINK_TARGET_ATTR } from "./usePlanningLinkBadges";
import { indexOf } from "../test/planning";
import { layout } from "../test/layout";
import type { ReviewComment } from "../types";

vi.mock("axios");

vi.mock("vantage-md/react", async () => {
  const actual = await vi.importActual("vantage-md/react");
  return {
    ...actual,
    MermaidDiagram: ({ code }: { code: string }) => <pre>{code}</pre>,
  };
});

/**
 * Stable, as the router's is while the location holds. `freshNavigate` makes it
 * a new function on every render, which remounts every rendered link.
 */
const navigate = vi.fn();
let freshNavigate = false;
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => (freshNavigate ? vi.fn() : navigate),
  };
});

/* ------------------------------------------------------------------ *
 * The corpus
 * ------------------------------------------------------------------ */

const question = (id: string, marker: string) =>
  [
    `1. ${marker} **${id}: A question?**`,
    "",
    `   <!-- vantage: oq id=${id} leaning="Yes." -->`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const designDoc = (open: string) =>
  [
    "---",
    "status: in-review",
    "stage: DESIGN",
    "---",
    "",
    "# A",
    "",
    question("OQ-1", open),
    question("OQ-2", "\u{1F512}"),
    "## Decision Ledger",
    "",
    "| OQ-9 | Ruled |",
    "",
  ].join("\n");

const ROADMAP = [
  "# Roadmap",
  "",
  "1. [A](docs/design/a.md) goes first.",
  "2. [A's question](docs/design/a.md#OQ-1)",
  "3. [A's ruled one](docs/design/a.md#OQ-9)",
  "4. [A's missing one](docs/design/a.md#OQ-7)",
  "5. [A's heading](docs/design/a.md#decision-ledger)",
  "6. [Plain](docs/plain.md)",
  "7. [Answered](docs/answered.md)",
  "8. [External](https://example.com/docs/design/a.md)",
  "9. [Here](#roadmap)",
  "10. [Typo](docs/design/typo.md)",
  "",
  "See [x](docs/design/a.md).",
  "",
].join("\n");

const TREE: Record<string, string> = {
  "roadmap.md": ROADMAP,
  "docs/design/a.md": designDoc("\u{1F4AC}"),
  "docs/design/typo.md": "---\nstatus: accepted\nstage: DECIEDD\n---\n",
  "docs/answered.md": `# Settled\n\n${question("OQ-1", "✅")}`,
  "docs/plain.md": "# Plain\n",
};

const STAGES: Partial<PlanningConfig> = {
  stages: { DESIGN: "open", DECIDED: "ready" },
};

let version = 0;

function readyLoad(index: PlanningIndex): PlanningLoad {
  return {
    status: "ready",
    index,
    version: ++version,
    rescanning: false,
    hashes: {},
  };
}

function seed(load: PlanningLoad, repo = ""): void {
  act(() => {
    usePlanningStore.setState((state) => ({
      byRepo: { ...state.byRepo, [repo]: load },
    }));
  });
}

const renderViewer = (
  content: string,
  currentPath = "roadmap.md",
  isReviewMode = false,
) =>
  render(
    <BrowserRouter>
      <MarkdownViewer
        content={content}
        currentPath={currentPath}
        isReviewMode={isReviewMode}
      />
    </BrowserRouter>,
  );

const linkNamed = (name: string) =>
  screen.getByRole("link", { name }) as HTMLAnchorElement;

const badgeAfter = (link: Element) => {
  const next = link.nextElementSibling;
  return next?.hasAttribute(PLANNING_BADGE_ATTR) ? next : null;
};

beforeEach(() => {
  resetPlanningTrackers();
  usePlanningStore.setState({ byRepo: {}, reviewEpoch: {} });
  useRepoStore.setState({
    reposLoaded: true,
    isMultiRepo: false,
    currentRepo: null,
  });
  useReviewStore.setState({
    comments: [],
    pendingSelection: null,
    commentsDrifted: false,
  });
  vi.mocked(axios.get).mockReset();
  // Nothing here should reach the network: every index is seeded.
  vi.mocked(axios.get).mockRejectedValue(new Error("no network in this test"));
});

afterEach(() => {
  freshNavigate = false;
  vi.clearAllMocks();
  setPlanningScannerForTests(null);
});

/* ------------------------------------------------------------------ *
 * Which links, and where
 * ------------------------------------------------------------------ */

describe("which links get a badge (§5.1)", () => {
  beforeEach(() => seed(readyLoad(indexOf(TREE, STAGES))));

  it("puts it after the link, as a sibling, never inside", () => {
    renderViewer(ROADMAP);
    const link = linkNamed("A");
    const badge = badgeAfter(link);
    expect(badge).not.toBeNull();
    expect(link.contains(badge)).toBe(false);
    expect(badge).toHaveAccessibleName(
      "in review, design, 1 open question, 1 blocked question",
    );
  });

  it("finds each badge by its spoken name", () => {
    const index = indexOf(TREE, STAGES);
    renderViewer(ROADMAP);
    for (const [path, fragment] of [
      ["docs/design/a.md", null],
      ["docs/design/a.md", "OQ-1"],
      ["docs/design/a.md", "OQ-9"],
      ["docs/design/a.md", "OQ-7"],
    ] as const) {
      const badge = badgeFor(index, "roadmap.md", { path, fragment })!;
      expect(
        screen.getAllByRole("img", { name: badgeSpeech(badge) }).length,
      ).toBeGreaterThan(0);
    }
    expect(badgeAfter(linkNamed("A's question"))).toHaveTextContent(
      "\u{1F4AC} open",
    );
    expect(badgeAfter(linkNamed("A's ruled one"))).toHaveTextContent(
      "✅ ruled",
    );
    expect(badgeAfter(linkNamed("A's missing one"))).toHaveTextContent(
      "⚠ not found",
    );
  });

  it("gives a heading link the document's badge", () => {
    renderViewer(ROADMAP);
    expect(badgeAfter(linkNamed("A's heading"))?.outerHTML).toBe(
      badgeAfter(linkNamed("A"))?.outerHTML,
    );
  });

  it("gives none to a non-planning target, a target with nothing to show, an external link or a link within the document", () => {
    renderViewer(ROADMAP);
    expect(badgeAfter(linkNamed("Plain"))).toBeNull();
    expect(badgeAfter(linkNamed("Answered"))).toBeNull();
    expect(badgeAfter(linkNamed("External"))).toBeNull();
    expect(badgeAfter(linkNamed("Here"))).toBeNull();
    expect(linkNamed("External")).not.toHaveAttribute(LINK_TARGET_ATTR);
  });

  it("draws an off-vocabulary stage in the warning tone", () => {
    renderViewer(ROADMAP);
    expect(
      badgeAfter(linkNamed("Typo"))?.querySelector(
        ".vantage-planning-badge__part--warning",
      ),
    ).toHaveTextContent("DECIEDD");
  });

  it("stamps the link's repository path, not the rendered href", () => {
    renderViewer(
      "[Up](../plain.md) and [down](./a.md#OQ-1)\n",
      "docs/design/b.md",
    );
    expect(linkNamed("Up")).toHaveAttribute(LINK_TARGET_ATTR, "docs/plain.md");
    expect(linkNamed("Up")).not.toHaveAttribute(LINK_FRAGMENT_ATTR);
    expect(linkNamed("down")).toHaveAttribute(
      LINK_TARGET_ATTR,
      "docs/design/a.md",
    );
    expect(linkNamed("down")).toHaveAttribute(LINK_FRAGMENT_ATTR, "OQ-1");
  });

  it("never badges a link that leaves the repository", () => {
    renderViewer("[Other repo](../other/docs/design/a.md)\n", "x.md");
    expect(linkNamed("Other repo")).not.toHaveAttribute(LINK_TARGET_ATTR);
    expect(document.querySelector(`[${PLANNING_BADGE_ATTR}]`)).toBeNull();
  });

  // §5.1 badges a rendered Markdown link, and the index counts only those
  // (§3.2): a raw `<a href>` is in neither Referenced by nor the CLI's
  // brackets, so a badge on it would be the page alone saying something.
  it("gives none to a raw HTML anchor, only to the Markdown link beside it", () => {
    renderViewer(
      [
        'See <a href="docs/design/a.md">raw A</a> and [A](docs/design/a.md).',
        "",
        '<p><a href="docs/design/a.md#OQ-1">raw question</a></p>',
        "",
      ].join("\n"),
    );
    for (const name of ["raw A", "raw question"]) {
      expect(linkNamed(name)).not.toHaveAttribute(LINK_TARGET_ATTR);
      expect(badgeAfter(linkNamed(name))).toBeNull();
    }
    expect(badgeAfter(linkNamed("A"))).not.toBeNull();
    expect(linkNamed("A").className).toBe("");
  });

  // Inline SVG admits `<a href>`. A badge is an HTML `<span>`, which draws
  // nothing inside an `<svg>` and is not part of the drawing, so a link there
  // gets none; and an inline SVG is raw HTML, so its link is not stamped.
  it("gives none to a link inside an inline SVG", () => {
    const { container } = renderViewer(
      [
        '<svg viewBox="0 0 100 20"><a href="docs/design/a.md"><text x="0" y="10">A in a drawing</text></a></svg>',
        "",
        "And [A](docs/design/a.md) in prose.",
        "",
      ].join("\n"),
    );
    const svg = container.querySelector("svg")!;
    const drawn = svg.querySelector("a")!;
    expect(drawn).not.toHaveAttribute(LINK_TARGET_ATTR);
    expect(svg.querySelector(`[${PLANNING_BADGE_ATTR}]`)).toBeNull();
    expect(drawn.nextSibling).toBeNull();
    expect(badgeAfter(linkNamed("A"))).not.toBeNull();
  });
});

describe("in daemon mode", () => {
  it("reads the current repository's index, against repo-relative paths", () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: "alpha" });
    seed(readyLoad(indexOf(TREE, STAGES)), "alpha");
    renderViewer(ROADMAP);
    const link = linkNamed("A");
    expect(link.getAttribute("href")).toBe("/alpha/docs/design/a.md");
    expect(link).toHaveAttribute(LINK_TARGET_ATTR, "docs/design/a.md");
    expect(badgeAfter(link)).not.toBeNull();
  });
});

describe("when the badges appear and change (§5.3)", () => {
  it("renders none until the index is ready, then adds them without a new render of the document", () => {
    const { container } = renderViewer(ROADMAP);
    expect(container.querySelector(`[${PLANNING_BADGE_ATTR}]`)).toBeNull();
    seed(readyLoad(indexOf(TREE, STAGES)));
    expect(badgeAfter(linkNamed("A"))).not.toBeNull();
  });

  it("follows the index as it changes", () => {
    seed(readyLoad(indexOf(TREE, STAGES)));
    renderViewer(ROADMAP);
    seed(
      readyLoad(
        indexOf({ ...TREE, "docs/design/a.md": designDoc("✅") }, STAGES),
      ),
    );
    expect(badgeAfter(linkNamed("A"))).toHaveAccessibleName(
      "in review, design, 1 blocked question",
    );
    expect(badgeAfter(linkNamed("A's question"))).toHaveTextContent(
      "✅ answered",
    );
    expect(document.querySelectorAll(`[${PLANNING_BADGE_ATTR}]`)).toHaveLength(
      7,
    );
  });

  it("leaves the document exactly as it renders today when the build fails (§3.6)", async () => {
    const plain = renderViewer(ROADMAP);
    const today = plain.container.innerHTML;
    plain.unmount();

    // The real store and scanner, against a failing endpoint.
    const asked: string[] = [];
    setPlanningScannerForTests(
      inlineScannerClient({
        store: null,
        scannerId: "",
        fetch: async (input) => {
          asked.push(String(input));
          throw new Error("no network in this test");
        },
      }),
    );
    usePlanningStore.setState({ byRepo: {} });
    const { container } = renderViewer(ROADMAP);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(asked).toEqual(["/api/planning/stream"]);
    expect(usePlanningStore.getState().byRepo[""]?.status).toBe("error");
    expect(container.innerHTML).toBe(today);
  });

  it("keeps each badge after its link when the links themselves re-render", () => {
    // A new `a` component remounts every link: React inserts the new element
    // before the next node it owns, which is after the old badge. Nothing about
    // the document or the index changed, so only re-running on the components
    // puts each badge back after its link.
    freshNavigate = true;
    seed(readyLoad(indexOf(TREE, STAGES)));
    const { rerender } = renderViewer(ROADMAP);
    rerender(
      <BrowserRouter>
        <MarkdownViewer content={ROADMAP} currentPath="roadmap.md" />
      </BrowserRouter>,
    );
    const link = linkNamed("A");
    expect(badgeAfter(link)).not.toBeNull();
    expect(link.previousElementSibling).toBeNull();
    expect(document.querySelectorAll(`[${PLANNING_BADGE_ATTR}]`)).toHaveLength(
      7,
    );
  });

  it("sweeps its badges when the index goes away", () => {
    seed(readyLoad(indexOf(TREE, STAGES)));
    const { container } = renderViewer(ROADMAP);
    expect(container.querySelector(`[${PLANNING_BADGE_ATTR}]`)).not.toBeNull();
    seed(PLANNING_IDLE);
    expect(container.querySelector(`[${PLANNING_BADGE_ATTR}]`)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * What a badge must stay out of
 * ------------------------------------------------------------------ */

describe("review anchors ignore badges (§5.3, §13)", () => {
  const blockOf = (name: string) =>
    linkNamed(name).closest<HTMLElement>("[data-source-line]")!;

  it("hashes a block the same with no badge and with one", () => {
    const plain = renderViewer(ROADMAP);
    const hashes = () =>
      ["A", "x"].map((name) => hashBlockText(blockVisibleText(blockOf(name))));
    const without = hashes();
    plain.unmount();

    seed(readyLoad(indexOf(TREE, STAGES)));
    renderViewer(ROADMAP);
    expect(badgeAfter(linkNamed("x"))).not.toBeNull();
    // `[x](docs/design/a.md).`: the link is followed directly by punctuation,
    // which is where a space beside the badge would have shown.
    expect(blockVisibleText(blockOf("x")).trim()).toBe("See x.");
    expect(hashes()).toEqual(without);
  });

  it("keeps a comment on a badged block anchored when the badge's count changes", () => {
    seed(readyLoad(indexOf(TREE, STAGES)));
    renderViewer(ROADMAP, "roadmap.md", true);
    const block = blockOf("A");
    const hash = hashBlockText(blockVisibleText(block));
    const comment: ReviewComment = {
      id: "c1",
      comment: "Why first?",
      fallback_text: "a goes first.",
      created_at: 0,
      anchor: {
        source_line: Number(block.getAttribute("data-source-line")),
        block_text_hash: hash,
        selection_offset: 0,
        selection_length: 0,
      },
    };
    act(() => useReviewStore.setState({ comments: [comment] }));
    expect(block).toHaveClass("review-highlight-block");

    // An agent answers OQ-1 elsewhere: the count in this block's badge changes.
    seed(
      readyLoad(
        indexOf({ ...TREE, "docs/design/a.md": designDoc("✅") }, STAGES),
      ),
    );
    // And the next store write re-runs the highlighter over the new badge.
    act(() => useReviewStore.setState({ comments: [{ ...comment }] }));

    const after = blockOf("A");
    expect(badgeAfter(linkNamed("A"))).toHaveAccessibleName(
      "in review, design, 1 blocked question",
    );
    expect(hashBlockText(blockVisibleText(after))).toBe(hash);
    expect(after).toHaveClass("review-highlight-block");
    expect(after).not.toHaveClass("review-highlight-block-divergent");
    expect(useReviewStore.getState().commentsDrifted).toBe(false);
  });

  it("is inert to a click in review mode: no comment popover", () => {
    seed(readyLoad(indexOf(TREE, STAGES)));
    const { container } = renderViewer(ROADMAP, "roadmap.md", true);
    layout(container, {
      "li[data-source-line]": { top: 0, bottom: 20, left: 0, right: 600 },
    });
    const badge = badgeAfter(linkNamed("A"))!;
    const prose = container.querySelector<HTMLElement>(".prose")!;
    act(() => {
      fireEvent.mouseMove(prose, { clientX: 300, clientY: 10 });
    });
    expect(container.querySelector(".review-block-hovered")).not.toBeNull();
    act(() => {
      fireEvent.click(badge.firstElementChild!);
    });
    expect(useReviewStore.getState().pendingSelection).toBeNull();
    expect(screen.queryByText("Add Comment")).toBeNull();

    // The same click on the block's own text does open it.
    act(() => {
      fireEvent.click(linkNamed("A").parentElement!);
    });
    expect(useReviewStore.getState().pendingSelection).not.toBeNull();
  });
});

describe("the contents column ignores badges", () => {
  const DOC = [
    "---",
    "status: draft",
    "---",
    "",
    "# Plan",
    "",
    "## After [A](a.md)",
    "",
    "1. \u{1F4AC} **OQ-5: Follow [A](a.md)?**",
    "",
    '   <!-- vantage: oq id=OQ-5 leaning="Yes." -->',
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

  it("lists headings and question titles in the document's own words", () => {
    seed(readyLoad(indexOf({ ...TREE, "docs/design/b.md": DOC }, STAGES)));
    const { container } = renderViewer(DOC, "docs/design/b.md");
    expect(container.querySelectorAll(`[${PLANNING_BADGE_ATTR}]`)).toHaveLength(
      2,
    );
    const prose = container.querySelector<HTMLElement>(".prose")!;
    const entries = collectOutline(prose).map((e) => [
      e.kind,
      e.text,
      e.marker,
    ]);
    expect(entries).toEqual([
      ["heading", "Plan", ""],
      ["heading", "After A", ""],
      ["question", "OQ-5: Follow A?", "\u{1F4AC}"],
    ]);
  });
});

describe("the delta flash ignores badges", () => {
  const BEFORE = "See [A](docs/design/a.md).\n\nSecond paragraph.\n";
  const AFTER = "See [A](docs/design/a.md).\n\nSecond paragraph, edited.\n";

  // The badge pass runs after the snapshot is taken, so the last snapshot of a
  // badged block can be missing its badge — the first render's always is — or
  // hold a count that has since changed.
  it("flashes only the block whose text changed, not the badged one beside it", () => {
    seed(readyLoad(indexOf(TREE, STAGES)));
    const { rerender, container } = renderViewer(BEFORE);
    expect(badgeAfter(linkNamed("A"))).not.toBeNull();

    rerender(
      <BrowserRouter>
        <MarkdownViewer content={AFTER} currentPath="roadmap.md" />
      </BrowserRouter>,
    );
    const [badged, edited] =
      container.querySelectorAll<HTMLElement>(".prose > p");
    expect(edited).toHaveClass("animate-flash-update");
    expect(badged).not.toHaveClass("animate-flash-update");
  });

  it("does not flash a block whose badge changed since the last snapshot", () => {
    seed(readyLoad(indexOf(TREE, STAGES)));
    const { rerender, container } = renderViewer(BEFORE);
    // The index moves: this render's snapshot holds the old count, and the
    // badge pass then draws the new one.
    seed(
      readyLoad(
        indexOf({ ...TREE, "docs/design/a.md": designDoc("✅") }, STAGES),
      ),
    );
    rerender(
      <BrowserRouter>
        <MarkdownViewer content={AFTER} currentPath="roadmap.md" />
      </BrowserRouter>,
    );
    const [badged] = container.querySelectorAll<HTMLElement>(".prose > p");
    expect(badged).not.toHaveClass("animate-flash-update");
  });

  it("does not flash on a badge-only change", () => {
    seed(readyLoad(indexOf(TREE, STAGES)));
    const { container } = renderViewer(BEFORE);
    seed(
      readyLoad(
        indexOf({ ...TREE, "docs/design/a.md": designDoc("✅") }, STAGES),
      ),
    );
    expect(container.querySelector(".animate-flash-update")).toBeNull();
  });
});
