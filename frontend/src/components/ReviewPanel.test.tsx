import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReviewPanel } from "./ReviewPanel";
import { useReviewStore } from "../stores/useReviewStore";
import { useRepoStore } from "../stores/useRepoStore";
import type { CommentReaction, ReviewComment } from "../types";

const agentAddressed: CommentReaction = {
  actor: "agent",
  kind: "addressed",
  summary: "I fixed it",
  before_text: "",
  after_text: "",
  timestamp: 1,
};

const reviewerFollowup: CommentReaction = {
  actor: "reviewer",
  kind: "needs_clarification",
  summary: "still not right",
  before_text: "",
  after_text: "",
  timestamp: 2,
};

const baseComment = (overrides: Partial<ReviewComment>): ReviewComment => ({
  id: "c1",
  selected_text: "the text",
  fallback_text: "the text",
  comment: "please change this",
  created_at: 0,
  ...overrides,
});

const setComments = (comments: ReviewComment[]) => {
  useReviewStore.setState({ filePath: "doc.md", lastContent: "x", comments });
  useRepoStore.setState({ currentRepo: null, isMultiRepo: false });
};

describe("ReviewPanel — per-comment Copy", () => {
  beforeEach(() => {
    useReviewStore.setState({ comments: [], filePath: null });
    vi.clearAllMocks();
  });

  it("shows a Copy button for a comment with a reviewer follow-up after the agent response", () => {
    setComments([
      baseComment({ reactions: [agentAddressed, reviewerFollowup] }),
    ]);
    render(<ReviewPanel isOpen onClose={() => {}} />);
    // The thread is pending again, so it can be copied back to the agent.
    expect(screen.getByTitle(/Copy this comment thread/i)).toBeTruthy();
  });

  it("does NOT show a per-comment Copy button when the agent response is the latest reaction", () => {
    setComments([baseComment({ reactions: [agentAddressed] })]);
    render(<ReviewPanel isOpen onClose={() => {}} />);
    expect(screen.queryByTitle(/Copy this comment thread/i)).toBeNull();
  });

  it("copies the comment thread to the clipboard when clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    setComments([
      baseComment({ reactions: [agentAddressed, reviewerFollowup] }),
    ]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByTitle(/Copy this comment thread/i));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toContain("please change this");
    expect(payload).toContain("**Follow-up:** still not right");
  });
});
