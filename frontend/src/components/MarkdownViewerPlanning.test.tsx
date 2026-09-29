/**
 * The viewer's planning surfaces other than link badges
 * (`docs/design/planning-index.md`): the `next` link in the document's header
 * (§4), Referenced by (§7), the embedded viewer the planning page renders each
 * question card with (§6.3), and what the index costs a document's render.
 * Badges have their own suite, `usePlanningLinkBadges.test.tsx`.
 *
 * Renders the app's real `MarkdownViewer` against a planning store seeded with
 * a ready index.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import type { PlanningIndex } from "vantage-md/planning";
import { MarkdownViewer } from "./MarkdownViewer";
import {
  resetPlanningTrackers,
  usePlanningStore,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { useReviewStore } from "../stores/useReviewStore";
import { PLANNING_BADGE_ATTR } from "./PlanningBadge";
import { REFERENCED_BY_ATTR } from "./ReferencedBy";
import type { ReviewComment } from "../types";
import { scrollToAnchor } from "../lib/anchorScroll";
import { indexOf } from "../test/planning";
import { layout } from "../test/layout";
import { collectOutline } from "../hooks/useDocumentOutline";

vi.mock("axios");
vi.mock("../lib/anchorScroll", () => ({ scrollToAnchor: vi.fn() }));

/** How many times the Markdown pipeline has run, through a pass-through. */
let markdownRenders = 0;
vi.mock("react-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-markdown")>();
  const Actual = actual.default;
  return {
    ...actual,
    default: (props: Parameters<typeof Actual>[0]) => {
      markdownRenders++;
      return <Actual {...props} />;
    },
  };
});

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

const question = (id: string) =>
  [
    `1. \u{1F4AC} **${id}: A question?**`,
    "",
    `   <!-- vantage: oq id=${id} leaning="Yes." -->`,
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

const DOC = [
  "---",
  "status: in-review",
  'next: "Rule OQ-1, then compact OQ-9"',
  "---",
  "",
  "# Design",
  "",
  question("OQ-1"),
  "## Decision Ledger",
  "",
  "| OQ-9 | Ruled |",
  "",
].join("\n");

let version = 0;

function seedReady(index: PlanningIndex): void {
  act(() => {
    usePlanningStore.setState({
      byRepo: {
        "": {
          status: "ready",
          index,
          version: ++version,
          rescanning: false,
          sources: {},
        },
      },
    });
  });
}

const renderViewer = (content: string, currentPath: string) =>
  render(
    <BrowserRouter>
      <MarkdownViewer content={content} currentPath={currentPath} />
    </BrowserRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetPlanningTrackers();
  usePlanningStore.setState({ byRepo: {}, reviewEpoch: {} });
  // Every index here is seeded ready, so `ensure` has nothing to ask for.
  useRepoStore.setState({
    reposLoaded: true,
    isMultiRepo: false,
    currentRepo: null,
  });
});

describe("the `next` link (§4)", () => {
  it("is plain text until the index is ready", () => {
    renderViewer(DOC, "docs/design.md");
    expect(
      screen.getByText("Rule OQ-1, then compact OQ-9"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "OQ-1" })).toBeNull();
  });

  it("links an id one of the document's questions carries, and no other", () => {
    seedReady(indexOf({ "docs/design.md": DOC }));
    renderViewer(DOC, "docs/design.md");
    expect(screen.getByRole("link", { name: "OQ-1" })).toHaveAttribute(
      "href",
      "#OQ-1",
    );
    // OQ-9 is in the text — the ledger — but no question carries it.
    expect(screen.queryByRole("link", { name: "OQ-9" })).toBeNull();
  });

  it("links nothing in a document the index does not hold", () => {
    seedReady(indexOf({ "docs/other.md": DOC }));
    renderViewer(DOC, "docs/design.md");
    expect(screen.queryByRole("link", { name: "OQ-1" })).toBeNull();
  });

  it("scrolls to the question as an in-document link does", () => {
    seedReady(indexOf({ "docs/design.md": DOC }));
    renderViewer(DOC, "docs/design.md");
    const followed = fireEvent.click(
      screen.getByRole("link", { name: "OQ-1" }),
    );
    expect(followed).toBe(false); // default prevented
    expect(scrollToAnchor).toHaveBeenCalledWith("OQ-1");
  });

  it("leaves the document's own in-page links to their handler", () => {
    renderViewer("# Top\n\n[Back up](#top)\n", "x.md");
    fireEvent.click(screen.getByRole("link", { name: "Back up" }));
    expect(scrollToAnchor).toHaveBeenCalledTimes(1);
    expect(scrollToAnchor).toHaveBeenCalledWith("top");
  });
});

describe("sourceLineOffset", () => {
  it("adds to every source line, after the frontmatter's own offset", () => {
    const { container } = render(
      <BrowserRouter>
        <MarkdownViewer
          content={"---\ntitle: x\n---\n# Heading\n\nText.\n"}
          currentPath="x.md"
          sourceLineOffset={100}
        />
      </BrowserRouter>,
    );
    const lines = Array.from(
      container.querySelectorAll("[data-source-line]"),
      (el) => el.getAttribute("data-source-line"),
    );
    expect(lines).toEqual(["104", "106"]);
  });

  it("re-renders when it changes", () => {
    const view = (offset: number) => (
      <BrowserRouter>
        <MarkdownViewer
          content="Text.\n"
          currentPath="x.md"
          sourceLineOffset={offset}
        />
      </BrowserRouter>
    );
    const { container, rerender } = render(view(10));
    rerender(view(20));
    expect(container.querySelector("p")).toHaveAttribute(
      "data-source-line",
      "21",
    );
  });
});

describe("an embedded viewer (§6.3's question card)", () => {
  const CARD = [
    "---",
    "status: in-review",
    "---",
    "",
    "1. \u{1F4AC} **OQ-1: A question?** See [A](a.md).",
    "",
    '   <!-- vantage: oq id=OQ-1 leaning="Yes." -->',
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");

  const comment = (line: number): ReviewComment => ({
    id: "c1",
    comment: "On the real document",
    fallback_text: "leaning: yes.",
    created_at: 0,
    anchor: {
      source_line: line,
      block_text_hash: "00000000",
      selection_offset: 0,
      selection_length: 0,
    },
  });

  const renderEmbedded = (content = CARD) =>
    render(
      <BrowserRouter>
        <MarkdownViewer
          content={content}
          currentPath="docs/b.md"
          isReviewMode
          embedded
        />
      </BrowserRouter>,
    );

  beforeEach(() => {
    useReviewStore.setState({
      comments: [comment(9)],
      pendingSelection: null,
      commentsDrifted: true,
    });
  });

  it("draws no frontmatter card and no status chip", () => {
    renderEmbedded();
    expect(screen.queryByText("Metadata")).toBeNull();
    expect(document.querySelector("[data-vantage-status]")).toBeNull();
  });

  it("paints none of the review store's comments and leaves its drift flag alone", () => {
    const { container } = renderEmbedded();
    expect(container.querySelector("[data-review-inline-comment]")).toBeNull();
    expect(container.querySelector(".review-highlight-block")).toBeNull();
    // The page's own document set this; a card must not clear it.
    expect(useReviewStore.getState().commentsDrifted).toBe(true);
  });

  it("offers no Open Question button, even asked for review mode", () => {
    const { container } = renderEmbedded();
    expect(container.querySelector("[data-vantage-oq]")).not.toBeNull();
    expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
  });

  it("opens no comment popover on a click", () => {
    const { container } = renderEmbedded();
    layout(container, {
      "p[data-source-line]": { top: 0, bottom: 20, left: 0, right: 600 },
    });
    const prose = container.querySelector<HTMLElement>(".prose")!;
    act(() => {
      fireEvent.mouseMove(prose, { clientX: 300, clientY: 10 });
    });
    act(() => {
      fireEvent.click(container.querySelector("p")!, {
        clientX: 300,
        clientY: 10,
      });
    });
    expect(useReviewStore.getState().pendingSelection).toBeNull();
    expect(screen.queryByText("Add Comment")).toBeNull();
  });

  it("does not flash when its content changes", () => {
    const view = (content: string) => (
      <BrowserRouter>
        <MarkdownViewer content={content} currentPath="docs/b.md" embedded />
      </BrowserRouter>
    );
    const { container, rerender } = render(view("One.\n\nTwo.\n"));
    rerender(view("One.\n\nTwo, changed.\n"));
    expect(container.querySelector(".animate-flash-update")).toBeNull();
  });

  it("still draws link badges, which are how the text reads", () => {
    seedReady(
      indexOf({ "docs/a.md": "---\nstatus: draft\n---\n", "docs/b.md": CARD }),
    );
    const { container } = renderEmbedded();
    expect(container.querySelector(`[${PLANNING_BADGE_ATTR}]`)).not.toBeNull();
  });
});

describe("Referenced by (§7)", () => {
  const TARGET = DOC; // docs/design.md: frontmatter, OQ-1, a ledger
  const BARE = [
    "# No header",
    "",
    "1. \u{1F4AC} **OQ-3: Still a planning document?**",
    "",
    '   <!-- vantage: oq id=OQ-3 leaning="Yes." -->',
    "",
    "   _Leaning:_ yes.",
    "",
  ].join("\n");
  const FORGOTTEN = [
    "---",
    "status: draft",
    "---",
    "",
    "# Forgotten",
    "",
    "1. \u{1F4AC} **OQ-4: Does anyone know about this?**",
    "",
    '   <!-- vantage: oq id=OQ-4 leaning="No." -->',
    "",
    "   _Leaning:_ no.",
    "",
  ].join("\n");
  const TREE = {
    "docs/design.md": TARGET,
    "docs/bare.md": BARE,
    "docs/forgotten.md": FORGOTTEN,
    "docs/plain.md": "# Plain\n",
    "roadmap.md": [
      "# Roadmap",
      "",
      "## Rule these first",
      "",
      "1. [The design](docs/design.md)",
      "2. [Its question](docs/design.md#OQ-1)",
      "3. [The bare one](docs/bare.md)",
      "",
      "## Later",
      "",
      "- [The design again](docs/design.md#decision-ledger)",
      "- [Plain](docs/plain.md)",
      "",
    ].join("\n"),
    "docs/notes.md": [
      "---",
      "status: draft",
      "---",
      "",
      "Before any heading, [the design](design.md).",
      "",
    ].join("\n"),
  };

  const surface = () =>
    document.querySelector<HTMLElement>(`[${REFERENCED_BY_ATTR}]`);
  const toggle = () => screen.getByRole("button", { name: /Referenced by/ });
  const entries = () =>
    within(screen.getByRole("navigation", { name: "Referenced by" }))
      .getAllByRole("listitem")
      .map((e) => e.textContent?.replace(/\s+/g, " ").trim());

  it("is one collapsed line, directly below the card", () => {
    seedReady(indexOf(TREE));
    const { container } = renderViewer(TARGET, "docs/design.md");
    expect(toggle()).toHaveTextContent(
      "Referenced by 2 documents · on the roadmap under Rule these first",
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("navigation", { name: "Referenced by" }),
    ).toBeNull();
    const card = screen.getByText("Metadata").closest("div.mb-8");
    expect(surface()?.previousElementSibling).toBe(card);
    expect(container.querySelector(".prose")).toContainElement(surface());
  });

  it("opens to one row per linking document, the roadmap first", () => {
    seedReady(indexOf(TREE));
    renderViewer(TARGET, "docs/design.md");
    fireEvent.click(toggle());
    expect(entries()).toEqual([
      "roadmap.md · Rule these first · Later",
      "notes.md",
    ]);
  });

  it("links each heading to the first line under it that links here", () => {
    seedReady(indexOf(TREE));
    renderViewer(TARGET, "docs/design.md");
    fireEvent.click(toggle());
    expect(screen.getByRole("link", { name: "roadmap.md" })).toHaveAttribute(
      "href",
      "/roadmap.md#L5",
    );
    expect(screen.getByRole("link", { name: "Later" })).toHaveAttribute(
      "href",
      "/roadmap.md#L11",
    );
    fireEvent.click(screen.getByRole("link", { name: "Rule these first" }));
    expect(navigate).toHaveBeenCalledWith("/roadmap.md#L5");
  });

  it("carries the repository in daemon mode", () => {
    useRepoStore.setState({ isMultiRepo: true, currentRepo: "alpha" });
    act(() => {
      usePlanningStore.setState({
        byRepo: {
          alpha: {
            status: "ready",
            index: indexOf(TREE),
            version: ++version,
            rescanning: false,
            sources: {},
          },
        },
      });
    });
    renderViewer(TARGET, "docs/design.md");
    fireEvent.click(toggle());
    expect(screen.getByRole("link", { name: "roadmap.md" })).toHaveAttribute(
      "href",
      "/alpha/roadmap.md#L5",
    );
  });

  it("comes first in the prose container for a planning document with no frontmatter", () => {
    seedReady(indexOf(TREE));
    const { container } = renderViewer(BARE, "docs/bare.md");
    expect(toggle()).toHaveTextContent(
      "Referenced by 1 document · on the roadmap under Rule these first",
    );
    expect(container.querySelector(".prose")?.firstElementChild).toBe(
      surface(),
    );
  });

  it("counts a document's unrouted questions when nothing links to it", () => {
    seedReady(indexOf(TREE));
    renderViewer(FORGOTTEN, "docs/forgotten.md");
    expect(surface()).toHaveTextContent(
      /^1 open question not routed by the roadmap$/,
    );
    expect(screen.queryByRole("button", { name: /roadmap/ })).toBeNull();
  });

  it("is absent when nothing links to the document and nothing in it is unrouted", () => {
    seedReady(indexOf(TREE));
    renderViewer(TREE["docs/notes.md"], "docs/notes.md");
    expect(surface()).toBeNull();
  });

  it("is absent for a document that is not a planning document", () => {
    seedReady(indexOf(TREE));
    renderViewer(TREE["docs/plain.md"], "docs/plain.md");
    expect(surface()).toBeNull();
  });

  it("is absent until the index is ready, and in an embedded viewer", () => {
    const { unmount } = renderViewer(TARGET, "docs/design.md");
    expect(surface()).toBeNull();
    unmount();
    seedReady(indexOf(TREE));
    render(
      <BrowserRouter>
        <MarkdownViewer
          content={TARGET}
          currentPath="docs/design.md"
          embedded
        />
      </BrowserRouter>,
    );
    expect(surface()).toBeNull();
  });

  it("stays open for the visit, and is collapsed again on the next document", () => {
    seedReady(indexOf(TREE));
    const { rerender } = renderViewer(TARGET, "docs/design.md");
    fireEvent.click(toggle());
    // A live reload of the same document is the same visit.
    rerender(
      <BrowserRouter>
        <MarkdownViewer
          content={`${TARGET}\nOne more line.\n`}
          currentPath="docs/design.md"
        />
      </BrowserRouter>,
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    rerender(
      <BrowserRouter>
        <MarkdownViewer content={BARE} currentPath="docs/bare.md" />
      </BrowserRouter>,
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    rerender(
      <BrowserRouter>
        <MarkdownViewer content={TARGET} currentPath="docs/design.md" />
      </BrowserRouter>,
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("stays out of the contents column and offers no review anchor, open or not", () => {
    seedReady(indexOf(TREE));
    const { container } = renderViewer(TARGET, "docs/design.md");
    const prose = container.querySelector<HTMLElement>(".prose")!;
    // Collapsed, then open.
    for (let pass = 0; pass < 2; pass++) {
      expect(
        collectOutline(prose).some((e) => e.text.includes("Referenced by")),
      ).toBe(false);
      expect(
        surface()?.querySelector("h1, h2, h3, h4, h5, h6, p, li"),
      ).toBeNull();
      expect(
        surface()?.querySelector("[data-source-line], [data-vantage-oq]"),
      ).toBeNull();
      fireEvent.click(toggle());
    }
  });

  it("opens without opening a comment in review mode", () => {
    seedReady(indexOf(TREE));
    useReviewStore.setState({ pendingSelection: null });
    const { container } = render(
      <BrowserRouter>
        <MarkdownViewer
          content={TARGET}
          currentPath="docs/design.md"
          isReviewMode
        />
      </BrowserRouter>,
    );
    // A block is under the pointer, so a click the handler does not step
    // around would open the comment popover on it.
    layout(container, {
      "li[data-source-line]": { top: 0, bottom: 20, left: 0, right: 600 },
    });
    act(() => {
      fireEvent.mouseMove(container.querySelector(".prose")!, {
        clientX: 300,
        clientY: 10,
      });
    });
    act(() => {
      fireEvent.click(toggle(), { clientX: 300, clientY: 10 });
    });
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(useReviewStore.getState().pendingSelection).toBeNull();
  });
});

describe("the cost of the index to a document", () => {
  // No first render waits for the index (§5.3), and none should be repeated
  // for it either: the pipeline re-parses the whole document on every render.
  it("does not run the pipeline again as the index loads and changes", () => {
    markdownRenders = 0;
    renderViewer(DOC, "docs/design.md");
    const first = markdownRenders;
    expect(first).toBeGreaterThan(0);

    act(() => {
      usePlanningStore.setState({ byRepo: { "": { status: "loading" } } });
    });
    seedReady(indexOf({ "docs/design.md": DOC }));
    seedReady(indexOf({ "docs/design.md": DOC, "docs/other.md": DOC }));

    expect(markdownRenders).toBe(first);
    // And yet the index did reach the page.
    expect(screen.getByRole("link", { name: "OQ-1" })).toBeInTheDocument();
  });
});
