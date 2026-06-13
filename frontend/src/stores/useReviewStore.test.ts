import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isPendingForAgent, useReviewStore } from "./useReviewStore";
import { useRepoStore } from "./useRepoStore";
import axios from "axios";
import type {
  CommentReaction,
  ReviewComment,
  ReviewData,
  ReviewSnapshot,
} from "../types";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const resetStores = () => {
  useReviewStore.setState({
    isReviewMode: false,
    filePath: null,
    lastContent: null,
    comments: [],
    pendingSelection: null,
    snapshots: [],
    currentSnapshotIndex: null,
    isLoading: false,
  });
  useRepoStore.setState({
    currentRepo: null,
    isMultiRepo: false,
  });
};

describe("useReviewStore", () => {
  beforeEach(() => {
    resetStores();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("toggleReviewMode", () => {
    it("flips isReviewMode", () => {
      useReviewStore.setState({ filePath: "doc.md" });
      expect(useReviewStore.getState().isReviewMode).toBe(false);
      useReviewStore.getState().toggleReviewMode();
      expect(useReviewStore.getState().isReviewMode).toBe(true);
      useReviewStore.getState().toggleReviewMode();
      expect(useReviewStore.getState().isReviewMode).toBe(false);
    });

    it("persists 'on' state to localStorage (single repo)", () => {
      useReviewStore.setState({ filePath: "docs/guide.md" });
      useReviewStore.getState().toggleReviewMode();
      expect(localStorage.getItem("vantage.reviewMode:docs/guide.md")).toBe(
        "on",
      );
    });

    it("clears localStorage when toggling off", () => {
      useReviewStore.setState({ filePath: "doc.md" });
      useReviewStore.getState().toggleReviewMode();
      expect(localStorage.getItem("vantage.reviewMode:doc.md")).toBe("on");
      useReviewStore.getState().toggleReviewMode();
      expect(localStorage.getItem("vantage.reviewMode:doc.md")).toBeNull();
    });

    it("namespaces localStorage key by repo in multi-repo mode", () => {
      useRepoStore.setState({ isMultiRepo: true, currentRepo: "my-repo" });
      useReviewStore.setState({ filePath: "doc.md" });
      useReviewStore.getState().toggleReviewMode();
      expect(localStorage.getItem("vantage.reviewMode:my-repo:doc.md")).toBe(
        "on",
      );
      expect(localStorage.getItem("vantage.reviewMode:doc.md")).toBeNull();
    });

    it("skips persistence when no filePath", () => {
      useReviewStore.getState().toggleReviewMode();
      expect(useReviewStore.getState().isReviewMode).toBe(true);
      // Nothing should be written for a null path
      expect(localStorage.length).toBe(0);
    });

    it("clears pendingSelection on toggle", () => {
      useReviewStore.setState({
        filePath: "doc.md",
        pendingSelection: { text: "hi", rect: new DOMRect() },
      });
      useReviewStore.getState().toggleReviewMode();
      expect(useReviewStore.getState().pendingSelection).toBeNull();
    });
  });

  describe("loadReview — review-mode persistence", () => {
    it("enables review mode on refresh when localStorage has the toggle", async () => {
      // Simulate: user toggled review mode on before the refresh
      localStorage.setItem("vantage.reviewMode:doc.md", "on");
      // Server returns empty (no comments / snapshots yet)
      const emptyReview: ReviewData = {
        file_path: "doc.md",
        comments: [],
        snapshots: [],
      };
      mockedAxios.get.mockResolvedValueOnce({ data: emptyReview });

      await useReviewStore.getState().loadReview("doc.md");

      expect(useReviewStore.getState().isReviewMode).toBe(true);
    });

    it("enables review mode when server has saved comments", async () => {
      const comment: ReviewComment = {
        id: "c1",
        selected_text: "hello",
        comment: "note",
        created_at: 0,
      };
      const review: ReviewData = {
        file_path: "doc.md",
        comments: [comment],
        snapshots: [],
      };
      mockedAxios.get.mockResolvedValueOnce({ data: review });

      await useReviewStore.getState().loadReview("doc.md");

      expect(useReviewStore.getState().isReviewMode).toBe(true);
      expect(useReviewStore.getState().comments).toHaveLength(1);
    });

    it("keeps review mode off when neither storage nor server has state", async () => {
      const emptyReview: ReviewData = {
        file_path: "doc.md",
        comments: [],
        snapshots: [],
      };
      mockedAxios.get.mockResolvedValueOnce({ data: emptyReview });

      await useReviewStore.getState().loadReview("doc.md");

      expect(useReviewStore.getState().isReviewMode).toBe(false);
    });

    it("honors persisted toggle when server returns null", async () => {
      localStorage.setItem("vantage.reviewMode:doc.md", "on");
      mockedAxios.get.mockResolvedValueOnce({ data: null });

      await useReviewStore.getState().loadReview("doc.md");

      expect(useReviewStore.getState().isReviewMode).toBe(true);
    });

    it("honors persisted toggle when server request fails", async () => {
      localStorage.setItem("vantage.reviewMode:doc.md", "on");
      mockedAxios.get.mockRejectedValueOnce(new Error("404"));

      await useReviewStore.getState().loadReview("doc.md");

      expect(useReviewStore.getState().isReviewMode).toBe(true);
    });

    it("resets comments/snapshots when switching files", async () => {
      // Set up state as if the user had been reviewing doc-a
      useReviewStore.setState({
        filePath: "doc-a.md",
        comments: [
          {
            id: "c1",
            selected_text: "x",
            comment: "y",
            created_at: 0,
          },
        ],
        isReviewMode: true,
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: {
          file_path: "doc-b.md",
          comments: [],
          snapshots: [],
        },
      });

      await useReviewStore.getState().loadReview("doc-b.md");

      expect(useReviewStore.getState().comments).toEqual([]);
      expect(useReviewStore.getState().filePath).toBe("doc-b.md");
    });
  });

  describe("comment mutations", () => {
    const baseComment: ReviewComment = {
      id: "c1",
      selected_text: "selected",
      comment: "original",
      created_at: 0,
    };

    beforeEach(() => {
      useReviewStore.setState({
        filePath: "doc.md",
        comments: [baseComment],
      });
      mockedAxios.put.mockResolvedValue({ data: {} });
    });

    it("editComment updates the comment text", () => {
      useReviewStore.getState().editComment("c1", "revised");
      expect(useReviewStore.getState().comments[0].comment).toBe("revised");
    });

    it("editComment saves to the server", () => {
      useReviewStore.getState().editComment("c1", "revised");
      expect(mockedAxios.put).toHaveBeenCalledWith(
        "/api/review",
        expect.objectContaining({
          comments: expect.arrayContaining([
            expect.objectContaining({ id: "c1", comment: "revised" }),
          ]),
        }),
        { params: { path: "doc.md" } },
      );
    });

    it("editComment leaves other comments untouched", () => {
      useReviewStore.setState({
        comments: [baseComment, { ...baseComment, id: "c2", comment: "other" }],
      });
      useReviewStore.getState().editComment("c1", "revised");
      const [c1, c2] = useReviewStore.getState().comments;
      expect(c1.comment).toBe("revised");
      expect(c2.comment).toBe("other");
    });

    it("resolveComment marks the comment as resolved", () => {
      useReviewStore.getState().resolveComment("c1");
      expect(useReviewStore.getState().comments[0].resolved).toBe(true);
    });

    it("deleteComment removes the comment", () => {
      useReviewStore.getState().deleteComment("c1");
      expect(useReviewStore.getState().comments).toEqual([]);
    });
  });

  describe("endReview", () => {
    it("clears localStorage persistence for the file", async () => {
      localStorage.setItem("vantage.reviewMode:doc.md", "on");
      useReviewStore.setState({
        filePath: "doc.md",
        isReviewMode: true,
      });
      mockedAxios.delete.mockResolvedValueOnce({ data: {} });

      await useReviewStore.getState().endReview();

      expect(localStorage.getItem("vantage.reviewMode:doc.md")).toBeNull();
      expect(useReviewStore.getState().isReviewMode).toBe(false);
    });

    it("clears all review data (comments, snapshots)", async () => {
      const snap: ReviewSnapshot = {
        id: "s1",
        content: "old",
        timestamp: 0,
      };
      useReviewStore.setState({
        filePath: "doc.md",
        isReviewMode: true,
        comments: [
          { id: "c1", selected_text: "x", comment: "y", created_at: 0 },
        ],
        snapshots: [snap],
      });
      mockedAxios.delete.mockResolvedValueOnce({ data: {} });

      await useReviewStore.getState().endReview();

      const state = useReviewStore.getState();
      expect(state.comments).toEqual([]);
      expect(state.snapshots).toEqual([]);
    });

    it("still clears local state even if server delete fails", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        isReviewMode: true,
      });
      mockedAxios.delete.mockRejectedValueOnce(new Error("500"));

      await useReviewStore.getState().endReview();

      expect(useReviewStore.getState().isReviewMode).toBe(false);
    });
  });

  describe("hasReviewData", () => {
    it("returns false for empty state", () => {
      expect(useReviewStore.getState().hasReviewData()).toBe(false);
    });

    it("returns true when any comments exist", () => {
      useReviewStore.setState({
        comments: [
          { id: "c1", selected_text: "x", comment: "y", created_at: 0 },
        ],
      });
      expect(useReviewStore.getState().hasReviewData()).toBe(true);
    });

    it("returns true when any snapshots exist", () => {
      useReviewStore.setState({
        snapshots: [{ id: "s1", content: "x", timestamp: 0 }],
      });
      expect(useReviewStore.getState().hasReviewData()).toBe(true);
    });
  });

  describe("isPendingForAgent", () => {
    const mk = (
      reactions: CommentReaction[],
      resolved = false,
    ): ReviewComment => ({
      id: "c1",
      selected_text: "x",
      comment: "y",
      created_at: 0,
      resolved,
      reactions,
    });
    const agentAddressed: CommentReaction = {
      actor: "agent",
      kind: "addressed",
      summary: "fixed it",
      before_text: "",
      after_text: "",
      timestamp: 1,
    };
    const reviewerFollowup: CommentReaction = {
      actor: "reviewer",
      kind: "needs_clarification",
      summary: "still wrong",
      before_text: "",
      after_text: "",
      timestamp: 2,
    };

    it("is pending when there are no reactions yet", () => {
      expect(isPendingForAgent(mk([]))).toBe(true);
    });

    it("is not pending once the agent has addressed it", () => {
      expect(isPendingForAgent(mk([agentAddressed]))).toBe(false);
    });

    it("is pending again after a reviewer follow-up", () => {
      expect(isPendingForAgent(mk([agentAddressed, reviewerFollowup]))).toBe(
        true,
      );
    });

    it("is never pending when resolved", () => {
      expect(
        isPendingForAgent(mk([agentAddressed, reviewerFollowup], true)),
      ).toBe(false);
    });
  });

  describe("copyCommentToClipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
      writeText.mockClear();
      Object.assign(navigator, { clipboard: { writeText } });
    });

    it("includes the agent response and reviewer follow-up in the payload", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [
          {
            id: "abcdef12-0000",
            selected_text: "line two",
            fallback_text: "line two",
            comment: "please clarify",
            created_at: 0,
            anchor: {
              source_line: 2,
              block_text_hash: "",
              selection_offset: 0,
              selection_length: 0,
            },
            reactions: [
              {
                actor: "agent",
                kind: "addressed",
                summary: "I clarified it",
                before_text: "",
                after_text: "",
                timestamp: 1,
              },
              {
                actor: "reviewer",
                kind: "needs_clarification",
                summary: "not quite, expand more",
                before_text: "",
                after_text: "",
                timestamp: 2,
              },
            ],
          },
        ],
      });

      const ok = await useReviewStore
        .getState()
        .copyCommentToClipboard("abcdef12-0000");

      expect(ok).toBe(true);
      const payload = writeText.mock.calls[0][0] as string;
      expect(payload).toContain("please clarify");
      expect(payload).toContain("**Agent response:** I clarified it");
      expect(payload).toContain("**Follow-up:** not quite, expand more");
    });

    it("returns false for an unknown comment id", async () => {
      useReviewStore.setState({ filePath: "doc.md", comments: [] });
      const ok = await useReviewStore
        .getState()
        .copyCommentToClipboard("missing");
      expect(ok).toBe(false);
    });
  });
});
