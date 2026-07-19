import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
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
      outdatedCommentIds: new Set(),
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

  it("wires inline Dismiss on an addressed comment to resolveComment (records an acceptance)", () => {
    renderWithComment(baseComment({ reactions: [agentAddressed] }));

    fireEvent.click(inlineButton("c1", ".review-inline-comment-resolve"));

    // resolveComment, not dismissComment: it resolves AND appends the
    // reviewer "noted" turn the thread renders as "You accepted".
    expect(comment().resolved).toBe(true);
    expect(comment().reactions).toHaveLength(2);
    expect(comment().reactions![1]).toMatchObject({
      actor: "reviewer",
      kind: "noted",
    });
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
