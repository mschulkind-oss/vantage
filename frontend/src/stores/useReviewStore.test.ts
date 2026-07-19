import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import {
  hasAgentReaction,
  isAnsweredByAgent,
  isAwaitingFirstResponse,
  isPendingForAgent,
  latestAgentReaction,
  useReviewStore,
} from "./useReviewStore";
import { useRepoStore } from "./useRepoStore";
import axios from "axios";
import type {
  CommentReaction,
  ReactionActor,
  ReactionKind,
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

const mkReaction = (
  actor: ReactionActor,
  kind: ReactionKind,
  summary: string,
  timestamp: number,
): CommentReaction => ({
  actor,
  kind,
  summary,
  before_text: "",
  after_text: "",
  timestamp,
});

// One back-and-forth: the agent answers, the reviewer pushes back, twice over.
// Timestamps are tiny so any real `Date.now()` stamp is unambiguously later.
const agentAddressed = mkReaction("agent", "addressed", "fixed it", 1);
const reviewerFollowup = mkReaction(
  "reviewer",
  "needs_clarification",
  "still wrong",
  2,
);
const agentAddressed2 = mkReaction(
  "agent",
  "addressed",
  "fixed it properly",
  3,
);
const reviewerFollowup2 = mkReaction(
  "reviewer",
  "needs_clarification",
  "closer, but no",
  4,
);
const reviewerAccepted = mkReaction("reviewer", "noted", "Accepted", 5);

const mk = (reactions: CommentReaction[], resolved = false): ReviewComment => ({
  id: "c1",
  selected_text: "x",
  comment: "y",
  created_at: 0,
  resolved,
  reactions,
});

const commentAnchor = {
  source_line: 2,
  block_text_hash: "",
  selection_offset: 0,
  selection_length: 0,
};

const mkThreadComment = (
  id: string,
  comment: string,
  reactions: CommentReaction[],
): ReviewComment => ({
  id,
  selected_text: "line two",
  fallback_text: "line two",
  comment,
  created_at: 0,
  anchor: commentAnchor,
  reactions,
});

/**
 * A thread that has been through every kind of turn: two agent responses, two
 * reviewer follow-ups, and a reviewer "accepted" in the middle (the reviewer
 * accepted, then reopened with one more request).
 */
const multiRoundThread: CommentReaction[] = [
  mkReaction("agent", "addressed", "Split the paragraph", 1),
  mkReaction("reviewer", "needs_clarification", "Still ambiguous", 2),
  mkReaction("agent", "addressed", "Rewrote the second half", 3),
  mkReaction("reviewer", "noted", "Accepted", 4),
  mkReaction("reviewer", "needs_clarification", "One more thing", 5),
];

const multiRoundTurns = [
  "**Agent response:** Split the paragraph",
  "**Follow-up:** Still ambiguous",
  "**Agent response:** Rewrote the second half",
  "**Reviewer accepted:** Accepted",
  "**Follow-up:** One more thing",
];

/** The blockquote the payload prepends when a batch contains follow-up rounds. */
const FOLLOWUP_NOTE = /^> \*\*[^*]*follow-up rounds?\.\*\*/m;

const expectTurnsInOrder = (payload: string, turns: string[]): void => {
  let cursor = -1;
  for (const turn of turns) {
    const at = payload.indexOf(turn);
    expect(at, `turn missing from payload: ${turn}`).toBeGreaterThan(-1);
    expect(at, `turn out of order: ${turn}`).toBeGreaterThan(cursor);
    cursor = at;
  }
};

/** A promise whose settlement the test controls, for racing two requests. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

    it("editComment stamps edited_at", () => {
      const before = Date.now() / 1000;
      useReviewStore.getState().editComment("c1", "revised");
      const editedAt = useReviewStore.getState().comments[0].edited_at;
      expect(editedAt).toBeDefined();
      expect(editedAt as number).toBeGreaterThanOrEqual(before);
    });

    it("editComment persists edited_at to the server", () => {
      useReviewStore.getState().editComment("c1", "revised");
      expect(mockedAxios.put).toHaveBeenCalledWith(
        "/api/review",
        expect.objectContaining({
          comments: expect.arrayContaining([
            expect.objectContaining({
              id: "c1",
              edited_at: expect.any(Number),
            }),
          ]),
        }),
        { params: { path: "doc.md" } },
      );
    });

    it("editComment re-queues a comment the agent had already addressed", () => {
      useReviewStore.setState({
        comments: [{ ...baseComment, reactions: [agentAddressed] }],
      });
      expect(isPendingForAgent(useReviewStore.getState().comments[0])).toBe(
        false,
      );

      useReviewStore.getState().editComment("c1", "actually, also mention X");

      const edited = useReviewStore.getState().comments[0];
      expect(edited.comment).toBe("actually, also mention X");
      expect(isPendingForAgent(edited)).toBe(true);
      expect(isAnsweredByAgent(edited)).toBe(false);
      // The agent's answer stays in the thread — it answered the old wording.
      expect(edited.reactions).toEqual([agentAddressed]);
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

  describe("unresolveComment", () => {
    beforeEach(() => {
      mockedAxios.put.mockResolvedValue({ data: {} });
    });

    it("reopens an accepted comment without adding a reaction", () => {
      useReviewStore.setState({
        filePath: "doc.md",
        comments: [
          { ...mk([agentAddressed, reviewerAccepted], true), id: "c1" },
        ],
      });

      useReviewStore.getState().unresolveComment("c1");

      const c = useReviewStore.getState().comments[0];
      expect(c.resolved).toBe(false);
      // Reopening records no turn of its own — the thread is exactly as the
      // reviewer left it, so the agent sees no phantom follow-up.
      expect(c.reactions).toEqual([agentAddressed, reviewerAccepted]);
      expect(hasAgentReaction(c)).toBe(true);
    });

    it("makes a comment dismissed before the agent saw it pending again", () => {
      useReviewStore.setState({
        filePath: "doc.md",
        comments: [{ ...mk([], true), id: "c1" }],
      });
      expect(isPendingForAgent(useReviewStore.getState().comments[0])).toBe(
        false,
      );

      useReviewStore.getState().unresolveComment("c1");

      const c = useReviewStore.getState().comments[0];
      expect(c.resolved).toBe(false);
      expect(c.reactions).toEqual([]);
      expect(isPendingForAgent(c)).toBe(true);
      expect(isAwaitingFirstResponse(c)).toBe(true);
    });

    it("persists the reopen to the server", () => {
      useReviewStore.setState({
        filePath: "doc.md",
        comments: [{ ...mk([], true), id: "c1" }],
      });

      useReviewStore.getState().unresolveComment("c1");

      expect(mockedAxios.put).toHaveBeenCalledWith(
        "/api/review",
        expect.objectContaining({
          comments: expect.arrayContaining([
            expect.objectContaining({ id: "c1", resolved: false }),
          ]),
        }),
        { params: { path: "doc.md" } },
      );
    });

    it("leaves other comments alone", () => {
      useReviewStore.setState({
        filePath: "doc.md",
        comments: [
          { ...mk([], true), id: "c1" },
          { ...mk([], true), id: "c2" },
        ],
      });

      useReviewStore.getState().unresolveComment("c1");

      const [c1, c2] = useReviewStore.getState().comments;
      expect(c1.resolved).toBe(false);
      expect(c2.resolved).toBe(true);
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

  describe("comment-state predicates over the full thread table", () => {
    // Expectations are written out per shape rather than derived, so a broken
    // predicate cannot quietly agree with a broken expectation.
    const shapes: Array<{
      name: string;
      reactions: CommentReaction[];
      pending: boolean;
      hasAgent: boolean;
      awaitingFirst: boolean;
      answered: boolean;
    }> = [
      {
        name: "no reactions yet",
        reactions: [],
        pending: true,
        hasAgent: false,
        awaitingFirst: true,
        answered: false,
      },
      {
        name: "agent addressed",
        reactions: [agentAddressed],
        pending: false,
        hasAgent: true,
        awaitingFirst: false,
        answered: true,
      },
      {
        name: "agent addressed then reviewer follow-up",
        reactions: [agentAddressed, reviewerFollowup],
        pending: true,
        hasAgent: true,
        awaitingFirst: false,
        answered: false,
      },
      {
        name: "two rounds ending with the agent",
        reactions: [agentAddressed, reviewerFollowup, agentAddressed2],
        pending: false,
        hasAgent: true,
        awaitingFirst: false,
        answered: true,
      },
      {
        name: "two rounds ending with the reviewer",
        reactions: [
          agentAddressed,
          reviewerFollowup,
          agentAddressed2,
          reviewerFollowup2,
        ],
        pending: true,
        hasAgent: true,
        awaitingFirst: false,
        answered: false,
      },
    ];

    for (const shape of shapes) {
      it(`unresolved — ${shape.name}`, () => {
        const c = mk(shape.reactions);
        expect(isPendingForAgent(c)).toBe(shape.pending);
        expect(hasAgentReaction(c)).toBe(shape.hasAgent);
        expect(isAwaitingFirstResponse(c)).toBe(shape.awaitingFirst);
        expect(isAnsweredByAgent(c)).toBe(shape.answered);
        // Whose turn it is must be unambiguous: an unresolved comment is owed
        // either by the agent or by the reviewer, never by both or neither.
        expect(
          [isPendingForAgent(c), isAnsweredByAgent(c)].filter(Boolean),
        ).toHaveLength(1);
        // "Never answered" is always a case of "still owed to the agent".
        if (shape.awaitingFirst) expect(isPendingForAgent(c)).toBe(true);
      });

      it(`resolved — ${shape.name}`, () => {
        const c = mk(shape.reactions, true);
        expect(isPendingForAgent(c)).toBe(false);
        expect(isAwaitingFirstResponse(c)).toBe(false);
        expect(isAnsweredByAgent(c)).toBe(false);
        // hasAgentReaction is a fact about history, not about whose turn it is.
        expect(hasAgentReaction(c)).toBe(shape.hasAgent);
      });
    }

    it("re-queues an addressed comment edited after the agent's response", () => {
      const c: ReviewComment = {
        ...mk([agentAddressed]),
        edited_at: agentAddressed.timestamp + 1,
      };
      expect(isPendingForAgent(c)).toBe(true);
      expect(isAnsweredByAgent(c)).toBe(false);
      expect(hasAgentReaction(c)).toBe(true);
    });

    it("stays answered when the edit predates the agent's response", () => {
      const c: ReviewComment = {
        ...mk([agentAddressed]),
        edited_at: agentAddressed.timestamp - 0.5,
      };
      expect(isPendingForAgent(c)).toBe(false);
      expect(isAnsweredByAgent(c)).toBe(true);
    });

    it("an edit does not re-queue a resolved comment", () => {
      const c: ReviewComment = {
        ...mk([agentAddressed], true),
        edited_at: agentAddressed.timestamp + 1,
      };
      expect(isPendingForAgent(c)).toBe(false);
    });

    it("a declined (wont_fix) response answers the comment", () => {
      // Declining is a response: the agent has spoken, so the ball is back
      // with the reviewer. Counting it as pending re-sent the comment on
      // every Copy forever, with no exit but dismissing it.
      const c = mk([mkReaction("agent", "wont_fix", "out of scope", 1)]);
      expect(hasAgentReaction(c)).toBe(true);
      expect(isPendingForAgent(c)).toBe(false);
      expect(isAnsweredByAgent(c)).toBe(true);
    });

    it("a follow-up after a declined response re-queues the comment", () => {
      const c = mk([
        mkReaction("agent", "wont_fix", "out of scope", 1),
        mkReaction("reviewer", "needs_clarification", "please reconsider", 2),
      ]);
      expect(isPendingForAgent(c)).toBe(true);
      expect(isAnsweredByAgent(c)).toBe(false);
    });

    it("an edit after a declined response re-queues the comment", () => {
      const c = {
        ...mk([mkReaction("agent", "wont_fix", "out of scope", 10)]),
        edited_at: 20,
      };
      expect(isPendingForAgent(c)).toBe(true);
    });

    it("latestAgentReaction returns the agent's most recent turn", () => {
      const c = mk([
        agentAddressed,
        reviewerFollowup,
        agentAddressed2,
        reviewerFollowup2,
      ]);
      expect(latestAgentReaction(c)).toBe(agentAddressed2);
    });

    it("treats a comment with no reactions field as a first round", () => {
      const legacy: ReviewComment = { id: "c1", comment: "y", created_at: 0 };
      expect(isPendingForAgent(legacy)).toBe(true);
      expect(hasAgentReaction(legacy)).toBe(false);
      expect(isAwaitingFirstResponse(legacy)).toBe(true);
      expect(isAnsweredByAgent(legacy)).toBe(false);
      expect(latestAgentReaction(legacy)).toBeUndefined();
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

    it("renders every turn of a multi-round thread in order", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [
          mkThreadComment("abcdef12-0000", "please clarify", multiRoundThread),
        ],
      });

      const ok = await useReviewStore
        .getState()
        .copyCommentToClipboard("abcdef12-0000");

      expect(ok).toBe(true);
      expectTurnsInOrder(writeText.mock.calls[0][0] as string, multiRoundTurns);
    });

    it("renders an agent's declined turn", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [
          mkThreadComment("abcdef12-0000", "please clarify", [
            mkReaction("agent", "wont_fix", "intentional, leaving as is", 1),
          ]),
        ],
      });

      await useReviewStore.getState().copyCommentToClipboard("abcdef12-0000");

      expect(writeText.mock.calls[0][0]).toContain(
        "**Agent declined:** intentional, leaving as is",
      );
    });

    it("notes that the reviewer edited the comment", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [
          {
            ...mkThreadComment("abcdef12-0000", "please clarify", [
              agentAddressed,
            ]),
            edited_at: agentAddressed.timestamp + 1,
          },
        ],
      });

      await useReviewStore.getState().copyCommentToClipboard("abcdef12-0000");

      expect(writeText.mock.calls[0][0]).toContain(
        "_(the reviewer edited this comment)_",
      );
    });

    it("adds the follow-up-round note once the agent has responded", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [
          mkThreadComment("abcdef12-0000", "please clarify", multiRoundThread),
        ],
      });

      await useReviewStore.getState().copyCommentToClipboard("abcdef12-0000");

      expect(writeText.mock.calls[0][0]).toMatch(FOLLOWUP_NOTE);
    });

    it("omits the follow-up-round note on a first round", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [mkThreadComment("abcdef12-0000", "please clarify", [])],
      });

      await useReviewStore.getState().copyCommentToClipboard("abcdef12-0000");

      expect(writeText.mock.calls[0][0]).not.toMatch(FOLLOWUP_NOTE);
    });
  });

  describe("copyAllToClipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    const seedBatch = () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [
          mkThreadComment("aaaaaaaa-0001", "please clarify", multiRoundThread),
          mkThreadComment("bbbbbbbb-0002", "typo in this line", []),
          mkThreadComment("cccccccc-0003", "already handled", [agentAddressed]),
        ],
      });
    };

    beforeEach(() => {
      writeText.mockClear();
      Object.assign(navigator, { clipboard: { writeText } });
    });

    it("renders every turn of each pending thread, skipping answered ones", async () => {
      seedBatch();

      const ok = await useReviewStore.getState().copyAllToClipboard();

      expect(ok).toBe(true);
      const payload = writeText.mock.calls[0][0] as string;
      expectTurnsInOrder(payload, multiRoundTurns);
      expect(payload).toContain("typo in this line");
      expect(payload).not.toContain("already handled");
    });

    it("reports how many of the batch are follow-up rounds", async () => {
      seedBatch();

      await useReviewStore.getState().copyAllToClipboard();

      const payload = writeText.mock.calls[0][0] as string;
      expect(payload).toMatch(FOLLOWUP_NOTE);
      expect(payload).toContain("1 of these are");
    });

    it("omits the follow-up-round note when every comment is a first round", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [mkThreadComment("bbbbbbbb-0002", "typo in this line", [])],
      });

      await useReviewStore.getState().copyAllToClipboard();

      expect(writeText.mock.calls[0][0]).not.toMatch(FOLLOWUP_NOTE);
    });

    it("writes nothing when no comment is owed to the agent", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        lastContent: "line one\nline two\n",
        comments: [
          mkThreadComment("cccccccc-0003", "already handled", [agentAddressed]),
          {
            ...mkThreadComment("dddddddd-0004", "dismissed", []),
            resolved: true,
          },
        ],
      });

      const ok = await useReviewStore.getState().copyAllToClipboard();

      expect(ok).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe("loadReview — race guards", () => {
    it("ignores a response that lands after the user moved to another file", async () => {
      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.get.mockReturnValueOnce(slow.promise);
      const inFlight = useReviewStore.getState().loadReview("doc-a.md");

      // The user navigates to another document before doc-a's GET comes back.
      mockedAxios.get.mockResolvedValueOnce({
        data: { file_path: "doc-b.md", comments: [], snapshots: [] },
      });
      await useReviewStore.getState().loadReview("doc-b.md");

      slow.resolve({
        data: {
          file_path: "doc-a.md",
          comments: [mkThreadComment("aaaaaaaa-0001", "doc-a comment", [])],
          snapshots: [],
        },
      });
      await inFlight;

      const state = useReviewStore.getState();
      expect(state.filePath).toBe("doc-b.md");
      expect(state.comments).toEqual([]);
    });

    it("does not revert a reply the reviewer made while the reload was in flight", async () => {
      const seeded = mkThreadComment("aaaaaaaa-0001", "please clarify", [
        agentAddressed,
      ]);
      useReviewStore.setState({
        filePath: "doc.md",
        isReviewMode: true,
        comments: [seeded],
      });
      mockedAxios.put.mockResolvedValue({ data: {} });

      // A websocket file-change event triggers a reload...
      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.get.mockReturnValueOnce(slow.promise);
      const inFlight = useReviewStore.getState().loadReview("doc.md");

      // ...and the reviewer replies before it comes back.
      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "expand on it");

      // The response was rendered server-side before the reply was saved.
      slow.resolve({
        data: { file_path: "doc.md", comments: [seeded], snapshots: [] },
      });
      await inFlight;

      const c = useReviewStore.getState().comments[0];
      expect(c.reactions).toHaveLength(2);
      expect(c.reactions?.[1].summary).toBe("expand on it");
      expect(isPendingForAgent(c)).toBe(true);
    });
  });

  describe("saveReview — adopting what the server persisted", () => {
    // The watcher can record an agent reaction between this browser's last
    // load and its next write. The server merges that reaction back into the
    // saved copy and echoes it; loadReview's staleness guard would discard the
    // reload that could otherwise teach the client about it, so the write's own
    // response is the only thing that keeps the two in agreement.
    const seeded = () => mkThreadComment("aaaaaaaa-0001", "please clarify", []);

    const serverCopy = (comments: ReviewComment[]): { data: ReviewData } => ({
      data: { file_path: "doc.md", snapshots: [], comments },
    });

    // saveReview swallows its own failures, so "ignored" and "blew up and was
    // caught" look identical from the store. The log tells them apart.
    let consoleError: MockInstance;
    beforeEach(() => {
      consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      consoleError.mockRestore();
    });

    it("adopts an agent reaction the merge restored, so the comment stops being pending", async () => {
      const local = seeded();
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });
      expect(isPendingForAgent(useReviewStore.getState().comments[0])).toBe(
        true,
      );

      mockedAxios.put.mockResolvedValueOnce(
        serverCopy([{ ...local, reactions: [agentAddressed] }]),
      );

      await useReviewStore.getState().saveReview();

      const c = useReviewStore.getState().comments[0];
      expect(c.reactions).toEqual([agentAddressed]);
      expect(isPendingForAgent(c)).toBe(false);
      expect(isAnsweredByAgent(c)).toBe(true);
    });

    it("ignores a response overtaken by a write the reviewer made meanwhile", async () => {
      const local = seeded();
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });

      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.put.mockReturnValueOnce(slow.promise);
      const inFlight = useReviewStore.getState().saveReview();

      // The reviewer replies before that PUT comes back. Their reply is newer
      // than anything the in-flight response can carry, so adopting the
      // response would silently swallow it.
      mockedAxios.put.mockResolvedValueOnce({ data: null });
      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "expand on it");

      slow.resolve(serverCopy([{ ...local, reactions: [agentAddressed] }]));
      await inFlight;

      const c = useReviewStore.getState().comments[0];
      expect(c.reactions).toHaveLength(1);
      expect(c.reactions?.[0]).toMatchObject({
        actor: "reviewer",
        summary: "expand on it",
      });
      expect(isPendingForAgent(c)).toBe(true);
    });

    it("ignores a response overtaken by a reload of the same file", async () => {
      // A reload that finished after this PUT was sent carries the server's own
      // newer state — including anything the agent wrote meanwhile. Adopting a
      // response that predates it would undo that.
      const local = mkThreadComment("aaaaaaaa-0001", "please clarify", []);
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });

      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.put.mockReturnValueOnce(slow.promise);
      const inFlight = useReviewStore.getState().saveReview();

      // Same file, reloaded while the PUT is still out.
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          file_path: "doc.md",
          snapshots: [],
          comments: [{ ...local, comment: "reloaded from the server" }],
        },
      });
      await useReviewStore.getState().loadReview("doc.md");

      slow.resolve({
        data: {
          file_path: "doc.md",
          snapshots: [],
          comments: [{ ...local, comment: "stale echo" }],
        },
      });
      await inFlight;

      expect(useReviewStore.getState().comments[0].comment).toBe(
        "reloaded from the server",
      );
    });

    it("ignores a response for a file the reviewer has already left", async () => {
      const local = mkThreadComment("aaaaaaaa-0001", "doc-a comment", []);
      useReviewStore.setState({ filePath: "doc-a.md", comments: [local] });

      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.put.mockReturnValueOnce(slow.promise);
      const inFlight = useReviewStore.getState().saveReview();

      // The reviewer opens another document before doc-a's PUT comes back.
      mockedAxios.get.mockResolvedValueOnce({
        data: { file_path: "doc-b.md", comments: [], snapshots: [] },
      });
      await useReviewStore.getState().loadReview("doc-b.md");

      slow.resolve({
        data: {
          file_path: "doc-a.md",
          snapshots: [],
          comments: [{ ...local, reactions: [agentAddressed] }],
        },
      });
      await inFlight;

      const state = useReviewStore.getState();
      expect(state.filePath).toBe("doc-b.md");
      // doc-a's thread must not reappear under doc-b.
      expect(state.comments).toEqual([]);
    });

    it("leaves the local copy alone when the response has no body", async () => {
      const local = seeded();
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });
      mockedAxios.put.mockResolvedValueOnce({ data: null });

      await expect(
        useReviewStore.getState().saveReview(),
      ).resolves.toBeUndefined();

      expect(useReviewStore.getState().comments).toEqual([local]);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it("leaves the local copy alone when the response carries no comments", async () => {
      // An older server answers the write with an acknowledgement rather than
      // the saved review; that must read as "nothing to adopt", not as "the
      // server has no comments".
      const local = seeded();
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });
      mockedAxios.put.mockResolvedValueOnce({ data: { status: "ok" } });

      await expect(
        useReviewStore.getState().saveReview(),
      ).resolves.toBeUndefined();

      expect(useReviewStore.getState().comments).toEqual([local]);
      expect(consoleError).not.toHaveBeenCalled();
    });
  });
});
