/**
 * The viewer's planning surfaces other than link badges
 * (`docs/design/planning-index.md`): the `next` link in the document's header
 * (§4), and what the index costs a document's render. Badges have their own
 * suite, `usePlanningLinkBadges.test.tsx`.
 *
 * Renders the app's real `MarkdownViewer` against a planning store seeded with
 * a ready index.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";
import type { PlanningIndex } from "vantage-md/planning";
import { MarkdownViewer } from "./MarkdownViewer";
import {
  resetPlanningTrackers,
  usePlanningStore,
} from "../stores/usePlanningStore";
import { useRepoStore } from "../stores/useRepoStore";
import { scrollToAnchor } from "../lib/anchorScroll";
import { indexOf } from "../test/planning";

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
