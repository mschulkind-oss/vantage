/**
 * The viewer's planning surfaces other than link badges
 * (`docs/reference/planning-index.md`): the `next` link in the document's header
 * (§3.4), Referenced by (§7), the embedded viewer the planning page renders each
 * question card with (§6.6), and what the index costs a document's render.
 * Badges have their own suite, `usePlanningLinkBadges.test.tsx`.
 *
 * Renders the app's real `MarkdownViewer` against a planning store seeded with
 * a ready index.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import type { PlanningIndex } from "vantage-md/planning";
import {
  resetPlanningTrackers,
  usePlanningStore,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { useReviewStore } from "../stores/useReviewStore";
import { PLANNING_BADGE_ATTR } from "./PlanningBadge";
import { REFERENCED_BY_ATTR } from "./ReferencedBy";
import { MarkdownViewer, REFERENCED_BY_RESERVED_ATTR } from "./MarkdownViewer";
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
          hashes: {},
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

describe("the `next` link (§3.4)", () => {
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

describe("an embedded viewer (§6.6's question card)", () => {
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
    // Its first link is Rule these first's, so the name opens the roadmap.
    expect(screen.getByRole("link", { name: "roadmap.md" })).toHaveAttribute(
      "href",
      "/roadmap.md",
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
            hashes: {},
          },
        },
      });
    });
    renderViewer(TARGET, "docs/design.md");
    fireEvent.click(toggle());
    expect(screen.getByRole("link", { name: "roadmap.md" })).toHaveAttribute(
      "href",
      "/alpha/roadmap.md",
    );
    expect(screen.getByRole("link", { name: "Later" })).toHaveAttribute(
      "href",
      "/alpha/roadmap.md#L11",
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
      /^1 open question not on the roadmap · its questions on the planning page$/,
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

  describe("its link to the filtered planning page (§7.1)", () => {
    const LINK = "its questions on the planning page";
    const planningLink = () => screen.queryByRole("link", { name: LINK });
    /** The line itself, without the list behind it, which is in the DOM, hidden. */
    const lineRow = () => surface()?.firstElementChild ?? null;
    const doc = (header: string, body: string) =>
      `---\n${header}\n---\n\n# A plan\n\n${body}`;

    afterEach(() => {
      delete window.__VANTAGE_STATIC__;
    });

    it("is drawn for a live document holding a question, to the page filtered to it", () => {
      seedReady(indexOf(TREE));
      renderViewer(TARGET, "docs/design.md");
      const link = planningLink()!;
      // `path:/docs/design.md`, its `/` pinning it to the path's start.
      expect(link).toHaveAttribute(
        "href",
        "/.vantage/planning?filter=path:/docs/design.md",
      );
      expect(toggle()).not.toContainElement(link);
      expect(lineRow()).toHaveTextContent(
        /^Referenced by 2 documents · on the roadmap under Rule these first · its questions on the planning page$/,
      );
      fireEvent.click(link);
      expect(navigate).toHaveBeenCalledWith(
        "/.vantage/planning?filter=path:/docs/design.md",
      );
    });

    it("keeps the `/` of a document at the root, and quotes a name holding a space", () => {
      const tree = {
        "roadmap.md":
          "# Roadmap\n\n## Now\n\n- [n](notes.md)\n- [s](my%20notes.md)\n",
        "notes.md": doc("status: draft", question("OQ-N1")),
        "my notes.md": doc("status: draft", question("OQ-S1")),
      };
      seedReady(indexOf(tree));
      const { unmount } = renderViewer(tree["notes.md"], "notes.md");
      expect(planningLink()).toHaveAttribute(
        "href",
        "/.vantage/planning?filter=path:/notes.md",
      );
      unmount();
      renderViewer(tree["my notes.md"], "my notes.md");
      expect(planningLink()).toHaveAttribute(
        "href",
        "/.vantage/planning?filter=path:%22/my+notes.md%22",
      );
    });

    it("carries the repository, encoded, in daemon mode", () => {
      const repo = "my repo#2";
      useRepoStore.setState({ isMultiRepo: true, currentRepo: repo });
      act(() => {
        usePlanningStore.setState({
          byRepo: {
            [repo]: {
              status: "ready",
              index: indexOf(TREE),
              version: ++version,
              rescanning: false,
              hashes: {},
            },
          },
        });
      });
      renderViewer(TARGET, "docs/design.md");
      expect(planningLink()).toHaveAttribute(
        "href",
        "/.vantage/planning/my%20repo%232?filter=path:/docs/design.md",
      );
    });

    it("is absent for a done stage, and for a document holding no question", () => {
      const tree = {
        "roadmap.md":
          "# Roadmap\n\n## Now\n\n- [d](docs/done.md)\n- [q](docs/quiet.md)\n",
        "docs/done.md": doc("stage: DONE", question("OQ-D1")),
        "docs/quiet.md": doc("stage: DESIGN", "Nothing to ask.\n"),
      };
      seedReady(indexOf(tree, { stages: { DESIGN: "open", DONE: "done" } }));
      // A done document is on no roadmap either (Plan Q11): the line keeps
      // only its count.
      const { unmount } = renderViewer(tree["docs/done.md"], "docs/done.md");
      expect(lineRow()).toHaveTextContent(/^Referenced by 1 document$/);
      expect(planningLink()).toBeNull();
      unmount();
      renderViewer(tree["docs/quiet.md"], "docs/quiet.md");
      expect(lineRow()).toHaveTextContent(
        /^Referenced by 1 document · on the roadmap under Now$/,
      );
      expect(planningLink()).toBeNull();
    });

    it("is absent in a static export, which has no planning page", () => {
      window.__VANTAGE_STATIC__ = true;
      // An export has no planning index either, so as it is today it draws
      // no Referenced by at all.
      const { unmount } = renderViewer(TARGET, "docs/design.md");
      expect(planningLink()).toBeNull();
      unmount();
      // And were an index in hand, the line would still have no page to
      // link: an index that lands after the store gave up on it.
      renderViewer(FORGOTTEN, "docs/forgotten.md");
      seedReady(indexOf(TREE));
      expect(surface()).toHaveTextContent(
        /^1 open question not on the roadmap$/,
      );
      expect(planningLink()).toBeNull();
    });

    it("is absent for a path no filter can name", () => {
      // A control character is not understood even quoted (§6.14).
      const path = "docs/bell\u0007.md";
      seedReady(indexOf({ ...TREE, [path]: FORGOTTEN }));
      renderViewer(FORGOTTEN, path);
      expect(surface()).toHaveTextContent(
        /^1 open question not on the roadmap$/,
      );
      expect(planningLink()).toBeNull();
    });

    it("is a line of its own when it is all the line would say", () => {
      // No roadmap, so nothing is unrouted, and nothing links here.
      const alone = doc("status: draft", question("OQ-A1"));
      seedReady(indexOf({ "docs/alone.md": alone }));
      renderViewer(alone, "docs/alone.md");
      expect(surface()).toHaveTextContent(
        /^its questions on the planning page$/,
      );
      expect(surface()?.querySelector("button")).toBeNull();
      expect(planningLink()).toHaveAttribute(
        "href",
        "/.vantage/planning?filter=path:/docs/alone.md",
      );
    });

    it("fills the line reserved at first paint on one line, the link kept whole", () => {
      const loading = () =>
        act(() => {
          usePlanningStore.setState({
            byRepo: { "": { status: "loading", warm: false, progress: null } },
          });
        });
      const reserved = () =>
        document.querySelector(`[${REFERENCED_BY_RESERVED_ATTR}]`);
      // Reserved by its frontmatter, and by its directives alone.
      for (const [content, path] of [
        [TARGET, "docs/design.md"],
        [BARE, "docs/bare.md"],
      ] as const) {
        loading();
        const { unmount } = renderViewer(content, path);
        expect(reserved()).not.toBeNull();
        seedReady(indexOf(TREE));
        expect(reserved()).toBeNull();
        // The link's part, the separator and the link, keeps its width.
        const part = planningLink()!.parentElement;
        expect(part).toHaveClass("shrink-0", "whitespace-nowrap");
        expect(part).not.toHaveClass("basis-full");
        expect(lineRow()).toHaveClass("flex-nowrap");
        expect(lineRow()).not.toHaveClass("flex-wrap");
        expect(toggle().querySelector("span.min-w-0")).toHaveClass("truncate");
        unmount();
      }
      // And a line holding only the link fills it too.
      const alone = doc("status: draft", question("OQ-A1"));
      loading();
      renderViewer(alone, "docs/alone.md");
      expect(reserved()).not.toBeNull();
      seedReady(indexOf({ "docs/alone.md": alone }));
      expect(reserved()).toBeNull();
      expect(surface()).toHaveTextContent(
        /^its questions on the planning page$/,
      );
      expect(planningLink()?.parentElement).toHaveClass(
        "shrink-0",
        "whitespace-nowrap",
      );
    });
  });

  describe("when the index lands after the first paint (§12.2)", () => {
    const reserved = () =>
      document.querySelector<HTMLElement>(`[${REFERENCED_BY_RESERVED_ATTR}]`);
    const view = (content: string, path: string) => (
      <BrowserRouter>
        <MarkdownViewer content={content} currentPath={path} />
      </BrowserRouter>
    );
    const loading = () =>
      act(() => {
        usePlanningStore.setState({
          byRepo: { "": { status: "loading", warm: false, progress: null } },
        });
      });

    it("reserves one line for a planning document by its frontmatter, and fills it", () => {
      loading();
      renderViewer(TARGET, "docs/design.md");
      const card = screen.getByText("Metadata").closest("div.mb-8");
      // Where the line goes, as tall as it, and nothing in it yet.
      expect(reserved()?.previousElementSibling).toBe(card);
      expect(reserved()).toHaveClass("mb-6", "text-[13px]", "leading-relaxed");
      expect(reserved()).toHaveAttribute("aria-hidden", "true");
      expect(reserved()?.textContent).toBe("\u00a0");
      expect(surface()).toBeNull();

      seedReady(indexOf(TREE));
      expect(reserved()).toBeNull();
      expect(surface()?.previousElementSibling).toBe(card);
      expect(surface()).toHaveClass("mb-6", "text-[13px]", "leading-relaxed");
      expect(toggle()).toHaveTextContent(
        "Referenced by 2 documents · on the roadmap under Rule these first",
      );
      // One line at every width, as the reservation is: below `sm` the line
      // otherwise wraps, and a phone's two lines moved the document down one.
      const words = toggle().querySelector("span.min-w-0");
      expect(words).toHaveClass("truncate");
      expect(words).not.toHaveClass("sm:truncate");
    });

    it("leaves the line empty when the index has nothing to say", () => {
      loading();
      renderViewer(TREE["docs/notes.md"], "docs/notes.md");
      seedReady(indexOf(TREE));
      expect(surface()).toBeNull();
      expect(reserved()).not.toBeNull();
    });

    it("lets the stylesheet reserve it for a planning document by its directives alone", () => {
      loading();
      const { container } = renderViewer(BARE, "docs/bare.md");
      const slot = reserved()?.parentElement;
      // `hidden` unless the prose holds an `oq` directive, which this one does.
      expect(slot).toHaveClass(
        "hidden",
        "group-has-[[data-vantage-oq]]/prose:contents",
      );
      expect(container.querySelector(".prose")).toHaveClass("group/prose");
      expect(
        slot?.closest(".prose")?.querySelector("[data-vantage-oq]"),
      ).not.toBeNull();

      seedReady(indexOf(TREE));
      expect(surface()?.parentElement).toBe(slot);
      expect(toggle()).toHaveTextContent(
        "Referenced by 1 document · on the roadmap under Rule these first",
      );
    });

    it("reserves nothing for a document with no sign of planning, and waits for the next visit", () => {
      const cited = {
        ...TREE,
        "docs/cites.md":
          "---\nstatus: draft\n---\n\n[The order](../roadmap.md)\n",
      };
      loading();
      const { rerender } = render(view(TREE["roadmap.md"], "roadmap.md"));
      expect(reserved()).toBeNull();
      seedReady(indexOf(cited));
      // The roadmap is a planning document, but nothing in its text said so
      // before the index did, so no line was reserved and none is drawn.
      expect(surface()).toBeNull();

      rerender(view(TARGET, "docs/design.md"));
      rerender(view(TREE["roadmap.md"], "roadmap.md"));
      expect(toggle()).toHaveTextContent(/^Referenced by 1 document$/);
    });

    it("is drawn at once, reserving nothing, when the index is ready first", () => {
      seedReady(indexOf(TREE));
      renderViewer(TARGET, "docs/design.md");
      expect(reserved()).toBeNull();
      expect(surface()).not.toBeNull();
      // Nothing was reserved, so a phone may wrap it, and there the link
      // takes a line of its own under the words.
      const words = toggle().querySelector("span.min-w-0");
      expect(words).toHaveClass("sm:truncate");
      expect(words).not.toHaveClass("truncate");
      const part = screen.getByRole("link", {
        name: "its questions on the planning page",
      }).parentElement;
      expect(part).toHaveClass("basis-full", "pl-[18px]", "sm:basis-auto");
    });

    it("follows the index live once the first paint had it", () => {
      seedReady(indexOf({ ...TREE, "roadmap.md": "# Roadmap\n" }));
      renderViewer(TARGET, "docs/design.md");
      expect(toggle()).toHaveTextContent(
        /^Referenced by 1 document · 1 open question not on the roadmap$/,
      );
      // A push that changes what links here is a change of data (L2).
      seedReady(indexOf(TREE));
      expect(toggle()).toHaveTextContent(
        "Referenced by 2 documents · on the roadmap under Rule these first",
      );
    });
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
      usePlanningStore.setState({
        byRepo: { "": { status: "loading", warm: false, progress: null } },
      });
    });
    seedReady(indexOf({ "docs/design.md": DOC }));
    seedReady(indexOf({ "docs/design.md": DOC, "docs/other.md": DOC }));

    expect(markdownRenders).toBe(first);
    // And yet the index did reach the page.
    expect(screen.getByRole("link", { name: "OQ-1" })).toBeInTheDocument();
  });
});
