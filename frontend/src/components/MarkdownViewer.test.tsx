import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import axios from "axios";
import { MarkdownViewer } from "./MarkdownViewer";
import { BrowserRouter } from "react-router-dom";
import { useReviewStore } from "../stores/useReviewStore";
import { useRepoStore } from "../stores/useRepoStore";
import { blockVisibleText, hashBlockText } from "../lib/reviewAnchor";
import type { CommentReaction, ReviewComment } from "../types";

// Store writes (resolve, dismiss, reply, …) fire command requests via axios.
vi.mock("axios");

// Mock MermaidDiagram (imported from vantage-md/react by MarkdownViewer)
vi.mock("vantage-md/react", async () => {
  const actual = await vi.importActual("vantage-md/react");
  return {
    ...actual,
    MermaidDiagram: ({ code }: { code: string }) => (
      <div data-testid="mermaid-diagram">{code}</div>
    ),
  };
});

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("MarkdownViewer", () => {
  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  it("renders markdown content", () => {
    const content = "# Hello World\nThis is a test.";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="test.md" />,
    );

    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(screen.getByText("This is a test.")).toBeInTheDocument();
  });

  it("renders mermaid diagrams", () => {
    const content = "```mermaid\ngraph TD;\nA-->B;\n```";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="test.md" />,
    );

    expect(screen.getByTestId("mermaid-diagram")).toBeInTheDocument();
    // The content might have whitespace or newlines altered
    expect(screen.getByTestId("mermaid-diagram").textContent).toContain(
      "graph TD;\nA-->B;",
    );
  });

  // remark-math runs with singleDollarTextMath: false. These two tests pin the
  // delimiter contract the style guide and user guide describe, so flipping the
  // option can't silently make that documentation wrong again.
  it("renders double-dollar math inline and as a display block", () => {
    const content = "Mass-energy $$E = mc^2$$ inline.\n\n$$\n\\int_0^1 x\n$$";
    const { container } = renderWithRouter(
      <MarkdownViewer content={content} currentPath="test.md" />,
    );

    expect(container.querySelectorAll(".katex").length).toBe(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("leaves single-dollar spans literal so shell vars and prices survive", () => {
    const content = "Set $HOME, pay $100, and note $E = mc^2$ stays text.";
    const { container } = renderWithRouter(
      <MarkdownViewer content={content} currentPath="test.md" />,
    );

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$HOME");
    expect(container.textContent).toContain("$100");
    expect(container.textContent).toContain("$E = mc^2$");
  });

  it("handles relative links", () => {
    const content = "[Relative Link](other.md)";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="folder/current.md" />,
    );

    const link = screen.getByText("Relative Link");
    fireEvent.click(link);

    expect(mockNavigate).toHaveBeenCalledWith("/folder/other.md");
  });

  it("does not intercept external links", () => {
    const content = "[External Link](http://example.com)";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="test.md" />,
    );

    const link = screen.getByText("External Link");
    // We can't easily test navigation prevention in JSDOM unless we mock window.location or similar,
    // but we can check that navigate was NOT called with the external URL or at all for internal logic
    fireEvent.click(link);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("transforms image urls", () => {
    const content = "![Image](image.png)";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="folder/current.md" />,
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/api/content?path=folder%2Fimage.png");
  });

  it("does not intercept Ctrl+click on internal links (allows new tab)", () => {
    const content = "[Internal Link](other.md)";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="folder/current.md" />,
    );

    const link = screen.getByText("Internal Link");
    fireEvent.click(link, { ctrlKey: true });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept Meta/Cmd+click on internal links (allows new tab on Mac)", () => {
    const content = "[Internal Link](other.md)";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="folder/current.md" />,
    );

    const link = screen.getByText("Internal Link");
    fireEvent.click(link, { metaKey: true });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not intercept middle mouse button click on internal links", () => {
    const content = "[Internal Link](other.md)";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="folder/current.md" />,
    );

    const link = screen.getByText("Internal Link");
    fireEvent.click(link, { button: 1 });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("parses and displays frontmatter", () => {
    const content = `---
title: My Article
author: John Doe
tags:
  - react
  - testing
---

# Content

This is the body.`;

    renderWithRouter(
      <MarkdownViewer content={content} currentPath="test.md" />,
    );

    // Check frontmatter is displayed
    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("My Article")).toBeInTheDocument();
    expect(screen.getByText("author")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("tags")).toBeInTheDocument();
    expect(screen.getByText("react")).toBeInTheDocument();
    expect(screen.getByText("testing")).toBeInTheDocument();

    // Check body content is still rendered
    expect(screen.getByText("Content")).toBeInTheDocument();
    expect(screen.getByText("This is the body.")).toBeInTheDocument();
  });

  it("does not show frontmatter section when there is none", () => {
    const content = "# Hello World\nNo frontmatter here.";
    renderWithRouter(
      <MarkdownViewer content={content} currentPath="test.md" />,
    );

    expect(screen.queryByText("Metadata")).not.toBeInTheDocument();
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("promotes `status:` to a chip above the card when asked, and hides the key", () => {
    // End to end through the viewer: the real `parseFrontmatter`, the real
    // reader, the real shared card. `status-chip: true` inherits — the form that
    // cannot disagree with `status:` — and the vocabulary comment on the line is
    // the case a source-line scrape would get wrong.
    const content = `---
title: My Article
status: in-review # draft | in-review | accepted | deprecated
vantage:
  status-chip: true
---

# Content

This is the body.`;

    renderWithRouter(
      <MarkdownViewer content={content} currentPath="test.md" />,
    );

    // By title, not by text: `status:` is still a row in the card, so
    // "in-review" appears twice — which is the honest outcome. The chip promotes
    // the value, it does not move it.
    const chip = screen.getByTitle("Document status: in-review");
    expect(chip).toHaveAttribute("data-vantage-status", "in-review");
    expect(chip).toHaveTextContent("in-review");
    expect(chip.closest(".vantage-chrome")).not.toBeNull();

    // And the row is still there: the chip promotes the value, it does not
    // consume the key, so "in-review" is on the page exactly twice. Asserted
    // rather than implied — §4.5 records the duplication as the settled outcome,
    // and a future `status`-filtering "cleanup" has to fail here.
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getAllByText("in-review")).toHaveLength(2);

    // The card is untouched apart from the reserved key, which never appears.
    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("My Article")).toBeInTheDocument();
    expect(screen.queryByText("vantage")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("status-chip");

    expect(screen.getByText("This is the body.")).toBeInTheDocument();
  });
});

/**
 * A `#slug` that lands inside a `collapsed=true` section has to open it before
 * anything measures the target, or the scroll reads a zero-height
 * `display: none` box and puts the reader somewhere unrelated with the target
 * still hidden and no cue that the link did anything (P1/D8).
 *
 * `collapseSections.ts` names all three callers that must force a section open —
 * "a `#L42` link, a heading anchor or a review comment". These two cases are the
 * heading-anchor one, in both of the shapes `MarkdownViewer` owns: an
 * in-document link in the prose, and a heading's own `#` anchor. jsdom cannot
 * measure the geometry, so what is asserted is the attribute flip that makes the
 * geometry right.
 */
describe("MarkdownViewer — a `#slug` link into a collapsed section", () => {
  const COLLAPSED_DOC = [
    "See [the appendix](#appendix-b1).",
    "",
    "<!-- vantage: section collapsed=true -->",
    "",
    "## Appendix B",
    "",
    "### Appendix B.1",
    "",
    "Hidden prose.",
    "",
  ].join("\n");

  /**
   * Rendered inside a `[data-content-scroll]` ancestor, because that is what the
   * scroll math resolves against — and with a `scrollTo` stub, which jsdom does
   * not implement on elements at all.
   */
  function renderInScroller(content: string) {
    const scroller = document.createElement("div");
    scroller.setAttribute("data-content-scroll", "");
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as HTMLElement["scrollTo"];
    document.body.append(scroller);
    const result = render(
      <BrowserRouter>
        <MarkdownViewer content={content} currentPath="test.md" />
      </BrowserRouter>,
      { container: scroller },
    );
    return { ...result, scrollTo };
  }

  it("opens the section before measuring, for a link in the prose", () => {
    const { container, scrollTo } = renderInScroller(COLLAPSED_DOC);

    const target = container.querySelector<HTMLElement>("#appendix-b1")!;
    expect(target.getAttribute("data-vantage-collapsed")).toBe("true");
    // The gate the hiding CSS rests on: without it nothing was hidden and the
    // test would prove nothing.
    expect(target.closest("[data-vantage-collapse-ready]")).not.toBeNull();

    const link = Array.from(container.querySelectorAll("a")).find(
      (a) =>
        a.getAttribute("href") === "#appendix-b1" &&
        !a.classList.contains("heading-anchor"),
    )!;
    fireEvent.click(link);

    expect(target.getAttribute("data-vantage-collapsed")).toBe("false");
    expect(scrollTo).toHaveBeenCalled();
  });

  it("opens the section before measuring, for a heading's own `#` anchor", () => {
    const { container, scrollTo } = renderInScroller(COLLAPSED_DOC);

    const target = container.querySelector<HTMLElement>("#appendix-b1")!;
    const anchor = target.querySelector<HTMLElement>("a.heading-anchor")!;
    fireEvent.click(anchor);

    expect(target.getAttribute("data-vantage-collapsed")).toBe("false");
    expect(scrollTo).toHaveBeenCalled();
  });
});

/**
 * The `reviewActions` memo is the only thing connecting the inline document
 * surface to the store — the inline hook's own tests inject `vi.fn()`s, so a
 * swapped or dropped binding here breaks nothing else.  These tests drive the
 * REAL store through the REAL inline buttons and assert on resulting store
 * state, so a mis-wire (Dismiss→resolve, Reopen→dismiss, …) shows up as the
 * wrong comment state rather than as a passing mock.
 */
describe("MarkdownViewer — inline review actions wiring", () => {
  const REVIEW_DOC = "First paragraph about anchors.\n\nSecond paragraph.\n";

  const agentAddressed: CommentReaction = {
    actor: "agent",
    kind: "addressed",
    summary: "I reworded it",
    before_text: "",
    after_text: "",
    timestamp: 10,
  };

  const baseComment = (overrides: Partial<ReviewComment>): ReviewComment => ({
    id: "c1",
    comment: "please change this",
    fallback_text: "First paragraph about anchors.",
    created_at: 0,
    reactions: [],
    ...overrides,
  });

  const comment = (): ReviewComment => useReviewStore.getState().comments[0];

  /**
   * Render the doc in review mode, then attach `c` to its first paragraph
   * using an anchor hashed from the live DOM (as a real comment would be).
   */
  const renderWithComment = (c: ReviewComment) => {
    renderWithRouter(
      <MarkdownViewer content={REVIEW_DOC} currentPath="doc.md" isReviewMode />,
    );
    const block = document.querySelector<HTMLElement>("p[data-source-line]")!;
    const anchor = {
      source_line: Number.parseInt(block.getAttribute("data-source-line")!, 10),
      block_text_hash: hashBlockText(blockVisibleText(block)),
      selection_offset: 0,
      selection_length: 0,
    };
    act(() => {
      useReviewStore.setState({ comments: [{ ...c, anchor }] });
    });
  };

  /** A button inside the inline block rendered for comment `id`. */
  const inlineButton = (id: string, cls: string): HTMLElement => {
    const block = document.querySelector<HTMLElement>(
      `[data-review-inline-comment="${id}"]`,
    );
    expect(block, `no inline block rendered for ${id}`).not.toBeNull();
    const btn = block!.querySelector<HTMLElement>(cls);
    expect(btn, `no ${cls} button in the inline block`).not.toBeNull();
    return btn!;
  };

  const renderWithRouter = (ui: React.ReactElement) =>
    render(<BrowserRouter>{ui}</BrowserRouter>);

  beforeEach(() => {
    useReviewStore.setState({
      comments: [],
      filePath: "doc.md",
      lastContent: REVIEW_DOC,
      pendingSelection: null,
    });
    useRepoStore.setState({ currentRepo: null, isMultiRepo: false });
    vi.clearAllMocks();
  });

  it("wires the inline × to deleteComment, on the second click", () => {
    renderWithComment(baseComment({}));

    // Delete is two-click: it discards the agent's replies too, with no undo.
    const btn = inlineButton("c1", ".review-inline-comment-delete");
    fireEvent.click(btn);
    expect(useReviewStore.getState().comments).toHaveLength(1);
    expect(btn.textContent).toBe("Delete?");

    // The confirm ignores a second click inside one gesture (a physical
    // double-click), so move the clock past that window.
    const base = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => base + 1000);
    fireEvent.click(btn);
    expect(useReviewStore.getState().comments).toHaveLength(0);
  });

  it("wires inline Dismiss on an addressed comment to dismissComment (no turn recorded)", () => {
    renderWithComment(baseComment({ reactions: [agentAddressed] }));

    // One Dismiss button, one action. There used to be two, both labelled
    // "Dismiss": the answered branch quietly meant *accept* and appended a
    // reviewer turn, which reopening never retracted.
    const block = document.querySelector('[data-review-inline-comment="c1"]')!;
    expect(block.querySelector(".review-inline-comment-resolve")).toBeNull();

    fireEvent.click(inlineButton("c1", ".review-inline-comment-dismiss"));

    expect(comment().resolved).toBe(true);
    expect(comment().reactions).toHaveLength(1);
    expect(comment().reactions![0].actor).toBe("agent");
  });

  it("wires inline Dismiss on an unanswered comment to dismissComment (no reaction recorded)", () => {
    renderWithComment(baseComment({}));

    fireEvent.click(inlineButton("c1", ".review-inline-comment-dismiss"));

    // The two Dismiss buttons look identical but are semantically opposite:
    // this one closes the thread WITHOUT crediting the agent with a fix.
    expect(comment().resolved).toBe(true);
    expect(comment().reactions).toEqual([]);
  });

  it("wires inline Reopen to unresolveComment (reopens without replying)", () => {
    renderWithComment(
      baseComment({ resolved: true, reactions: [agentAddressed] }),
    );

    fireEvent.click(inlineButton("c1", ".review-inline-comment-reopen"));

    expect(comment().resolved).toBe(false);
    // Plain reopen: no follow-up turn is appended.
    expect(comment().reactions).toHaveLength(1);
  });

  it("wires the inline edit box to editComment (new text + edited_at stamp)", () => {
    renderWithComment(baseComment({}));

    fireEvent.click(inlineButton("c1", ".review-inline-comment-edit"));
    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".review-inline-edit-area",
    )!;
    fireEvent.input(textarea, { target: { value: "please change this MORE" } });
    fireEvent.click(
      document.querySelector<HTMLElement>(".review-inline-edit-save")!,
    );

    expect(comment().comment).toBe("please change this MORE");
    // editComment stamps edited_at, which is what re-queues the comment.
    expect(comment().edited_at).toBeGreaterThan(0);
  });

  it("wires inline Copy to copyCommentToClipboard (single-comment payload)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithComment(baseComment({}));

    fireEvent.click(inlineButton("c1", ".review-inline-comment-copy"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const payload = writeText.mock.calls[0][0] as string;
    // The singular heading is copyCommentToClipboard's, not copyAllToClipboard's.
    expect(payload).toContain("## Review Comment for `doc.md`");
    expect(payload).toContain("please change this");
  });

  it("routes inline Reply on an UNRESOLVED comment to replyToComment", () => {
    const real = useReviewStore.getState();
    const replyToComment = vi.fn(real.replyToComment);
    const reopenAndReply = vi.fn(real.reopenAndReply);
    useReviewStore.setState({ replyToComment, reopenAndReply });

    renderWithComment(baseComment({ reactions: [agentAddressed] }));

    fireEvent.click(inlineButton("c1", ".review-inline-comment-reply"));
    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".review-inline-reply-area",
    )!;
    fireEvent.input(textarea, { target: { value: "still not right" } });
    fireEvent.click(
      document.querySelector<HTMLElement>(".review-inline-edit-save")!,
    );

    expect(replyToComment).toHaveBeenCalledWith("c1", "still not right");
    expect(reopenAndReply).not.toHaveBeenCalled();
    expect(comment().resolved).toBeFalsy();
    expect(comment().reactions![1]).toMatchObject({
      actor: "reviewer",
      kind: "needs_clarification",
      summary: "still not right",
    });

    useReviewStore.setState({
      replyToComment: real.replyToComment,
      reopenAndReply: real.reopenAndReply,
    });
  });

  it("routes inline Reply on a RESOLVED comment to reopenAndReply (reopens it)", () => {
    renderWithComment(
      baseComment({ resolved: true, reactions: [agentAddressed] }),
    );

    fireEvent.click(inlineButton("c1", ".review-inline-comment-reply"));
    const textarea = document.querySelector<HTMLTextAreaElement>(
      ".review-inline-reply-area",
    )!;
    fireEvent.input(textarea, {
      target: { value: "actually, one more thing" },
    });
    fireEvent.click(
      document.querySelector<HTMLElement>(".review-inline-edit-save")!,
    );

    // Without the resolved branch the reply lands but the comment stays
    // closed, so the agent never sees it again.
    expect(comment().resolved).toBe(false);
    expect(comment().reactions![1]).toMatchObject({
      actor: "reviewer",
      kind: "needs_clarification",
      summary: "actually, one more thing",
    });
  });
});

describe("MarkdownViewer — the one-click Open Question answer", () => {
  // The design's §5.2 form, at column 0 before an ordinary paragraph.
  const OQ_DOC =
    '<!-- vantage: oq id=OQ-9 leaning="Back of the queue." -->\n\nWhere does the ticket go on re-entry?\n\nAn ordinary paragraph.\n';

  // The documented placement for a real Open Questions list: indented inside
  // the item, so the directive attaches to the `_Leaning:_` paragraph and the
  // list is neither split nor renumbered.
  const OQ_LIST_DOC =
    '1. **OQ-9: Queue position.** Where?\n\n   <!-- vantage: oq id=OQ-9 leaning="Back of the queue." -->\n\n   _Leaning:_ back of the queue.\n';

  const renderWithRouter = (ui: React.ReactElement) =>
    render(<BrowserRouter>{ui}</BrowserRouter>);

  const renderDoc = (content: string, isReviewMode = true) =>
    renderWithRouter(
      <MarkdownViewer
        content={content}
        currentPath="doc.md"
        isReviewMode={isReviewMode}
      />,
    );

  const takeButton = () =>
    screen.queryByRole("button", { name: "Take this leaning" });

  beforeEach(() => {
    useReviewStore.setState({
      comments: [],
      filePath: "doc.md",
      lastContent: OQ_DOC,
      pendingSelection: null,
      commentsDrifted: false,
    });
    useRepoStore.setState({ currentRepo: null, isMultiRepo: false });
    vi.clearAllMocks();
  });

  it("renders one button for a parsed directive, on the block it attached to", () => {
    const { container } = renderDoc(OQ_DOC);

    expect(takeButton()).not.toBeNull();
    expect(container.querySelectorAll(".review-oq-take")).toHaveLength(1);
    expect(
      container
        .querySelector('p[data-source-line="3"]')!
        .querySelector(".review-oq-take"),
    ).not.toBeNull();
  });

  it("lands on the _Leaning:_ paragraph for a directive indented inside a list item", () => {
    const { container } = renderDoc(OQ_LIST_DOC);

    // The whole reason the plugin recurses: at column 0 between items the
    // directive would split the list instead.
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(
      container
        .querySelector('p[data-source-line="5"]')!
        .querySelector(".review-oq-take"),
    ).not.toBeNull();
  });

  it("posts exactly one comment carrying the leaning, and renders it anchored", () => {
    const { container } = renderDoc(OQ_DOC);

    act(() => {
      fireEvent.click(takeButton()!);
    });

    const comments = useReviewStore.getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0].comment).toBe("Back of the queue.");
    // Byte-identical to what the typed path stores for this block (asserted
    // against the same literal below): `fallback_text` is quoted back to the
    // reviewer and to the agent, so the two paths must not disagree.
    expect(comments[0].fallback_text).toBe(
      "where does the ticket go on re-entry?",
    );
    expect(comments[0].anchor).toMatchObject({
      source_line: 3,
      selection_offset: 0,
      selection_length: 0,
    });
    expect(vi.mocked(axios.post)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(axios.post).mock.calls[0][0]).toContain(
      "/review/comments",
    );

    // The comment the reviewer just created must not read as drift: the button
    // sits inside the block it anchors, so its text has to be excluded from the
    // block hash on both sides.
    const block = container.querySelector('p[data-source-line="3"]')!;
    expect(block.classList.contains("review-highlight-block")).toBe(true);
    expect(block.classList.contains("review-highlight-block-divergent")).toBe(
      false,
    );
    expect(useReviewStore.getState().commentsDrifted).toBe(false);

    // Taken: the button retires rather than offering a second identical comment.
    expect(takeButton()).toBeNull();
    expect(container.querySelector(".review-oq-taken")!.textContent).toBe(
      "Leaning taken",
    );
  });

  it("routes a hostile leaning through the comment sanitiser, not into the article", () => {
    // The button is what makes this sink reachable from document content, so the
    // seam is worth pinning here and not only in commentMarkdown's own tests.
    const hostile =
      '<!-- vantage: oq leaning="<img src=x onerror=alert(1)> and more" -->\n\nWhere does it go?\n';
    const { container } = renderDoc(hostile);

    act(() => {
      fireEvent.click(takeButton()!);
    });

    expect(useReviewStore.getState().comments[0].comment).toBe(
      "<img src=x onerror=alert(1)> and more",
    );
    // The payload reaches the DOM exactly once, as an inert escaped attribute
    // value — never as an element, and never as a handler.
    expect(
      container
        .querySelector('p[data-source-line="3"]')!
        .getAttribute("data-vantage-leaning"),
    ).toBe("<img src=x onerror=alert(1)> and more");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(
      container.querySelector(".review-inline-comment-body")!.innerHTML,
    ).not.toContain("<img");
  });

  it("renders no button with review mode off", () => {
    const { container } = renderDoc(OQ_DOC, false);

    expect(takeButton()).toBeNull();
    expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
  });

  it("renders no button in a static export", () => {
    window.__VANTAGE_STATIC__ = true;
    try {
      const { container } = renderDoc(OQ_DOC);
      expect(container.querySelector("[data-vantage-oq-button]")).toBeNull();
    } finally {
      delete window.__VANTAGE_STATIC__;
    }
  });

  it("renders no button for a malformed directive, and the prose is untouched", () => {
    const malformed = [
      '<!-- vantage: oq leaning="Back of the queue -->', // unterminated quote
      "<!-- vantage: oq ID=OQ-9 -->", // uppercase key
      "<!-- vantage: -->", // no name
      "<!-- vantage: callout tone=warning -->", // unknown name
    ];
    for (const directive of malformed) {
      const { container, unmount } = renderDoc(
        `${directive}\n\nWhere does the ticket go?\n`,
      );
      expect(
        container.querySelector("[data-vantage-oq-button]"),
        directive,
      ).toBeNull();
      expect(screen.getByText("Where does the ticket go?")).toBeInTheDocument();
      unmount();
    }
  });

  it("still lets the reviewer type an answer on the very block that carries a button", () => {
    // D4(b): the button adds a path and removes none. This is also the case that
    // pins the hash strip — the popover hashes the block with the button already
    // in the DOM, so an unstripped button would make the typed comment drift.
    const { container } = renderDoc(OQ_DOC);
    const block = container.querySelector<HTMLElement>(
      'p[data-source-line="3"]',
    )!;
    const scroller = container.querySelector<HTMLElement>(".prose")!;

    fireEvent.mouseMove(scroller, { clientY: 0 });
    fireEvent.click(block);

    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Your comment..."]',
    )!;
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea, { target: { value: "front of the queue" } });
    act(() => {
      fireEvent.click(screen.getByText("Save"));
    });

    const comments = useReviewStore.getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0].comment).toBe("front of the queue");
    expect(comments[0].fallback_text).toBe(
      "where does the ticket go on re-entry?",
    );
    expect(block.classList.contains("review-highlight-block-divergent")).toBe(
      false,
    );
    expect(useReviewStore.getState().commentsDrifted).toBe(false);
    // And the button is still there: a typed answer is not this leaning.
    expect(takeButton()).not.toBeNull();
  });
});
