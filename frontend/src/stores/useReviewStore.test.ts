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
    staleProtocolWarning: null,
    commandError: null,
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
// Carries a legacy "noted" turn on purpose: review files written before
// dismissal stopped being a conversation turn still contain them, and they must
// not reach the agent as something the reviewer said.
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
      // Server returns empty (no comments yet)
      const emptyReview: ReviewData = {
        file_path: "doc.md",
        comments: [],
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

    it("resets comments when switching files", async () => {
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
      mockedAxios.post.mockResolvedValue({ data: null });
      mockedAxios.patch.mockResolvedValue({ data: null });
      mockedAxios.delete.mockResolvedValue({ data: null });
    });

    it("editComment updates the comment text", () => {
      useReviewStore.getState().editComment("c1", "revised");
      expect(useReviewStore.getState().comments[0].comment).toBe("revised");
    });

    it("editComment saves to the server", () => {
      useReviewStore.getState().editComment("c1", "revised");
      expect(mockedAxios.patch).toHaveBeenCalledWith(
        "/api/review/comments/c1",
        { comment: "revised" },
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

    it("editComment sends only the new text — the server stamps edited_at", () => {
      useReviewStore.getState().editComment("c1", "revised");
      const body = mockedAxios.patch.mock.calls[0][1];
      expect(body).toEqual({ comment: "revised" });
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

    it("deleteComment removes the comment", () => {
      useReviewStore.getState().deleteComment("c1");
      expect(useReviewStore.getState().comments).toEqual([]);
    });
  });

  describe("unresolveComment", () => {
    beforeEach(() => {
      mockedAxios.patch.mockResolvedValue({ data: null });
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

      expect(mockedAxios.patch).toHaveBeenCalledWith(
        "/api/review/comments/c1",
        { resolved: false },
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

    it("clears all review data (comments)", async () => {
      useReviewStore.setState({
        filePath: "doc.md",
        isReviewMode: true,
        comments: [
          { id: "c1", selected_text: "x", comment: "y", created_at: 0 },
        ],
      });
      mockedAxios.delete.mockResolvedValueOnce({ data: {} });

      await useReviewStore.getState().endReview();

      expect(useReviewStore.getState().comments).toEqual([]);
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
  });

  describe("staleProtocolWarning", () => {
    it("warnStaleProtocol sets the flag and dismiss clears it", () => {
      expect(useReviewStore.getState().staleProtocolWarning).toBeNull();

      useReviewStore.getState().warnStaleProtocol("docs/a.md");
      expect(useReviewStore.getState().staleProtocolWarning).toEqual({
        path: "docs/a.md",
      });

      useReviewStore.getState().dismissStaleProtocolWarning();
      expect(useReviewStore.getState().staleProtocolWarning).toBeNull();
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

    it("does not send a legacy 'noted' turn to the agent", async () => {
      // multiRoundThread carries one. It recorded a dismissal, not something
      // the reviewer said — relabelling it "Follow-up" would put a question in
      // their mouth that the agent would then try to answer.
      seedBatch();

      await useReviewStore.getState().copyAllToClipboard();

      const payload = writeText.mock.calls[0][0] as string;
      expect(payload).not.toContain("Accepted");
      expect(payload).not.toContain("Reviewer accepted");
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

  describe("clipboard payload — inbox delivery protocol", () => {
    // These pin the agent-facing contract: the payload must teach the inbox
    // line protocol (design §6.2) and must no longer teach the retired
    // changelog protocol — a stale instruction here would send agents back to
    // writing response blocks into the reviewed document.
    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
      writeText.mockClear();
      Object.assign(navigator, { clipboard: { writeText } });
    });

    // A nested path proves the separator flattening, not just interpolation.
    const seedNested = () =>
      useReviewStore.setState({
        filePath: "docs/design/guide.md",
        lastContent: "line one\nline two\n",
        comments: [mkThreadComment("abcdef12-0000", "please clarify", [])],
      });

    const copiedPayload = async (): Promise<string> => {
      const ok = await useReviewStore.getState().copyAllToClipboard();
      expect(ok).toBe(true);
      return writeText.mock.calls[0][0] as string;
    };

    it("names this document's exact inbox file, separators flattened to __", async () => {
      seedNested();
      const payload = await copiedPayload();
      expect(payload).toContain(
        "`.vantage/inbox/docs__design__guide.md.jsonl`",
      );
      expect(payload).toContain("at the root of this document's repository");
    });

    it("spells out the JSON line format with this document's path embedded", async () => {
      seedNested();
      const payload = await copiedPayload();
      expect(payload).toContain(
        '{"path":"docs/design/guide.md","id":"<short-id>","round":<round>,"summary":"<one sentence: what you changed>","nonce":"<fresh random string>"}',
      );
    });

    it("shows an example line using a real short id from the batch", async () => {
      seedNested();
      const payload = await copiedPayload();
      expect(payload).toContain('"id":"abcdef12"');
    });

    it("instructs saving the document before delivering", async () => {
      seedNested();
      const payload = await copiedPayload();
      expect(payload).toContain("**save the document first**");
      expect(payload).toContain("Save the document before appending");
    });

    it("requires a fresh nonce per line and forbids re-appending", async () => {
      seedNested();
      const payload = await copiedPayload();
      expect(payload).toContain("fresh random nonce for every line");
      expect(payload).toContain(
        "never re-append a line you have already written",
      );
    });

    it("keeps one line per comment acted on, skipping the rest", async () => {
      seedNested();
      const payload = await copiedPayload();
      expect(payload).toContain("One line per comment you acted on");
    });

    it("offers the fenced bullet fallback for agents that cannot write files", async () => {
      seedNested();
      const payload = await copiedPayload();
      expect(payload).toContain("### If you cannot write files");
      // The fallback block itself, fenced so the reviewer can paste it whole.
      expect(payload).toContain(
        "```\n- [<short-id>] <one sentence: what you changed>\n```",
      );
      expect(payload).toContain("paste it into the Review panel");
    });

    it("no longer teaches the changelog protocol", async () => {
      seedNested();
      const payload = await copiedPayload();
      expect(payload).not.toContain("<!-- changelog -->");
      expect(payload.toLowerCase()).not.toContain("changelog");
      expect(payload).not.toContain("no-op entry");
      expect(payload).not.toContain("END of this document");
    });

    it("copyCommentToClipboard carries the same delivery instructions", async () => {
      seedNested();
      const ok = await useReviewStore
        .getState()
        .copyCommentToClipboard("abcdef12-0000");
      expect(ok).toBe(true);
      const payload = writeText.mock.calls[0][0] as string;
      expect(payload).toContain(
        "`.vantage/inbox/docs__design__guide.md.jsonl`",
      );
      expect(payload).toContain('"id":"abcdef12"');
      expect(payload.toLowerCase()).not.toContain("changelog");
    });
  });

  describe("loadReview — race guards", () => {
    it("ignores a response that lands after the user moved to another file", async () => {
      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.get.mockReturnValueOnce(slow.promise);
      const inFlight = useReviewStore.getState().loadReview("doc-a.md");

      // The user navigates to another document before doc-a's GET comes back.
      mockedAxios.get.mockResolvedValueOnce({
        data: { file_path: "doc-b.md", comments: [] },
      });
      await useReviewStore.getState().loadReview("doc-b.md");

      slow.resolve({
        data: {
          file_path: "doc-a.md",
          comments: [mkThreadComment("aaaaaaaa-0001", "doc-a comment", [])],
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
      mockedAxios.post.mockResolvedValue({ data: null });

      // A websocket file-change event triggers a reload...
      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.get.mockReturnValueOnce(slow.promise);
      const inFlight = useReviewStore.getState().loadReview("doc.md");

      // ...and the reviewer replies before it comes back.
      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "expand on it");

      // The response was rendered server-side before the reply was saved.
      slow.resolve({
        data: { file_path: "doc.md", comments: [seeded] },
      });
      await inFlight;

      const c = useReviewStore.getState().comments[0];
      expect(c.reactions).toHaveLength(2);
      expect(c.reactions?.[1].summary).toBe("expand on it");
      expect(isPendingForAgent(c)).toBe(true);
    });
  });

  describe("command endpoints", () => {
    const baseComment: ReviewComment = {
      id: "c1",
      comment: "original",
      created_at: 0,
      anchor: commentAnchor,
      fallback_text: "line two",
      reactions: [],
    };

    beforeEach(() => {
      useReviewStore.setState({
        filePath: "doc.md",
        comments: [baseComment],
      });
      mockedAxios.post.mockResolvedValue({ data: null });
      mockedAxios.patch.mockResolvedValue({ data: null });
      mockedAxios.delete.mockResolvedValue({ data: null });
    });

    it("addComment POSTs the new comment with its client-side id and stamp", () => {
      useReviewStore.getState().addComment(commentAnchor, "new note", "quoted");

      const created = useReviewStore.getState().comments.at(-1)!;
      expect(created.comment).toBe("new note");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/review/comments",
        {
          id: created.id,
          comment: "new note",
          anchor: commentAnchor,
          fallback_text: "quoted",
          created_at: created.created_at,
        },
        { params: { path: "doc.md" } },
      );
    });

    it("dismissing an answered comment records no turn", () => {
      // Regression: dismissing used to post to /accept and append a reviewer
      // "noted" turn, which reopening did not retract — so dismiss/reopen/
      // dismiss stacked up "Accepted" rows the reviewer never wrote.
      const answered = {
        ...baseComment,
        reactions: [
          {
            actor: "agent" as const,
            kind: "addressed" as const,
            summary: "Fixed it.",
            before_text: "",
            after_text: "",
            timestamp: 100,
          },
        ],
      };
      useReviewStore.setState({ comments: [answered] });

      useReviewStore.getState().dismissComment("c1");

      const c = useReviewStore.getState().comments[0];
      expect(c.resolved).toBe(true);
      expect(c.reactions).toHaveLength(1);
      expect(c.reactions?.[0].actor).toBe("agent");
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("dismissComment PATCHes resolved:true", () => {
      useReviewStore.getState().dismissComment("c1");

      expect(useReviewStore.getState().comments[0].resolved).toBe(true);
      expect(mockedAxios.patch).toHaveBeenCalledWith(
        "/api/review/comments/c1",
        { resolved: true },
        { params: { path: "doc.md" } },
      );
    });

    it("replyToComment POSTs the reply text", () => {
      useReviewStore.getState().replyToComment("c1", "expand on it");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/review/comments/c1/replies",
        { text: "expand on it" },
        { params: { path: "doc.md" } },
      );
    });

    it("reopenAndReply POSTs through reopen-reply", () => {
      useReviewStore.setState({
        comments: [{ ...baseComment, resolved: true }],
      });

      useReviewStore.getState().reopenAndReply("c1", "one more thing");

      const c = useReviewStore.getState().comments[0];
      expect(c.resolved).toBe(false);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/review/comments/c1/reopen-reply",
        { text: "one more thing" },
        { params: { path: "doc.md" } },
      );
    });

    it("deleteComment DELETEs the comment", () => {
      useReviewStore.getState().deleteComment("c1");

      expect(useReviewStore.getState().comments).toEqual([]);
      expect(mockedAxios.delete).toHaveBeenCalledWith(
        "/api/review/comments/c1",
        { params: { path: "doc.md" } },
      );
    });

    it("dismissAll POSTs a single scope:all dismissal", () => {
      useReviewStore.setState({
        comments: [baseComment, { ...baseComment, id: "c2" }],
      });

      useReviewStore.getState().dismissAll();

      expect(useReviewStore.getState().comments.every((c) => c.resolved)).toBe(
        true,
      );
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/review/dismissals",
        { scope: "all" },
        { params: { path: "doc.md" } },
      );
    });

    it("dismissAnswered POSTs only the ids the agent has answered", () => {
      // The bulk action targets *answered* comments, not orphaned ones. It used
      // to dismiss by anchor state, which grouped comments by "the text this
      // was written against is gone" — a fact nobody is thinking about when
      // they reach for a bulk dismiss.
      const agentTurn = {
        actor: "agent" as const,
        kind: "addressed" as const,
        summary: "Fixed it.",
        before_text: "",
        after_text: "",
        timestamp: 100,
      };
      useReviewStore.setState({
        comments: [
          { ...baseComment, reactions: [agentTurn] }, // answered → dismissed
          { ...baseComment, id: "c2", resolved: true, reactions: [agentTurn] }, // already dismissed → skipped
          { ...baseComment, id: "c3" }, // never answered → untouched
        ],
      });

      useReviewStore.getState().dismissAnswered();

      const [c1, , c3] = useReviewStore.getState().comments;
      expect(c1.resolved).toBe(true);
      expect(c3.resolved).toBeFalsy();
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/review/dismissals",
        { scope: "ids", ids: ["c1"] },
        { params: { path: "doc.md" } },
      );
    });

    it("dismissAnswered skips a comment re-queued by a follow-up", () => {
      // Answered *then replied to* is pending again, so a bulk dismiss must
      // not sweep away a question the agent has not come back to.
      useReviewStore.setState({
        comments: [
          {
            ...baseComment,
            reactions: [
              {
                actor: "agent" as const,
                kind: "addressed" as const,
                summary: "Fixed it.",
                before_text: "",
                after_text: "",
                timestamp: 100,
              },
              {
                actor: "reviewer" as const,
                kind: "needs_clarification" as const,
                summary: "Not quite — what about X?",
                before_text: "",
                after_text: "",
                timestamp: 200,
              },
            ],
          },
        ],
      });

      useReviewStore.getState().dismissAnswered();

      expect(useReviewStore.getState().comments[0].resolved).toBeFalsy();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("dismissAnswered sends nothing when nothing is answered", () => {
      useReviewStore.setState({ comments: [{ ...baseComment }] });

      useReviewStore.getState().dismissAnswered();

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("routes through the repo base in multi-repo mode", () => {
      useRepoStore.setState({ isMultiRepo: true, currentRepo: "my-repo" });

      useReviewStore.getState().replyToComment("c1", "more");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "/api/r/my-repo/review/comments/c1/replies",
        { text: "more" },
        { params: { path: "doc.md" } },
      );
    });

    it("keeps the optimistic mutation but skips the request before a repo is selected", () => {
      useRepoStore.setState({ isMultiRepo: true, currentRepo: null });

      useReviewStore.getState().dismissComment("c1");

      expect(useReviewStore.getState().comments[0].resolved).toBe(true);
      expect(mockedAxios.patch).not.toHaveBeenCalled();
    });
  });

  describe("review commands — echo adoption and error resync", () => {
    const seeded = () => mkThreadComment("aaaaaaaa-0001", "please clarify", []);

    const serverCopy = (comments: ReviewComment[]): { data: ReviewData } => ({
      data: { file_path: "doc.md", comments },
    });

    /** Lets a fire-and-forget command's await chain drain. */
    const flushCommands = () => new Promise((r) => setTimeout(r, 0));

    let consoleError: MockInstance;
    beforeEach(() => {
      consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      consoleError.mockRestore();
    });

    it("adopts the persisted copy when nothing newer landed meanwhile", async () => {
      const local = seeded();
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });

      // The server re-captured the anchored block and stamped the reply.
      mockedAxios.post.mockResolvedValueOnce(
        serverCopy([
          {
            ...local,
            captured_block: "line two",
            reactions: [reviewerFollowup],
          },
        ]),
      );

      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "still wrong");
      await flushCommands();

      const c = useReviewStore.getState().comments[0];
      expect(c.captured_block).toBe("line two");
      expect(c.reactions).toEqual([reviewerFollowup]);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it("discards an echo overtaken by a newer write", async () => {
      const local = seeded();
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });

      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.post.mockReturnValueOnce(slow.promise);
      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "first");

      // A second reply lands before the first echo returns; adopting the
      // stale echo would swallow it.
      mockedAxios.post.mockResolvedValueOnce({ data: null });
      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "second");

      slow.resolve(serverCopy([{ ...local, reactions: [reviewerFollowup] }]));
      await flushCommands();

      const c = useReviewStore.getState().comments[0];
      expect(c.reactions?.map((r) => r.summary)).toEqual(["first", "second"]);
    });

    it("discards an echo for a file the reviewer has already left", async () => {
      const local = seeded();
      useReviewStore.setState({ filePath: "doc-a.md", comments: [local] });

      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.post.mockReturnValueOnce(slow.promise);
      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "for doc-a");

      mockedAxios.get.mockResolvedValueOnce({
        data: { file_path: "doc-b.md", comments: [] },
      });
      await useReviewStore.getState().loadReview("doc-b.md");

      slow.resolve(serverCopy([{ ...local, reactions: [reviewerFollowup] }]));
      await flushCommands();

      const state = useReviewStore.getState();
      expect(state.filePath).toBe("doc-b.md");
      // doc-a's thread must not reappear under doc-b.
      expect(state.comments).toEqual([]);
    });

    it("discards an echo overtaken by a reload of the same file", async () => {
      const local = seeded();
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });

      const slow = deferred<{ data: ReviewData }>();
      mockedAxios.post.mockReturnValueOnce(slow.promise);
      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "mine");

      // Same file, reloaded while the command is still out — the reload
      // carries the server's own newer state.
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          file_path: "doc.md",
          comments: [{ ...local, comment: "reloaded from the server" }],
        },
      });
      await useReviewStore.getState().loadReview("doc.md");

      slow.resolve(serverCopy([{ ...local, comment: "stale echo" }]));
      await flushCommands();

      expect(useReviewStore.getState().comments[0].comment).toBe(
        "reloaded from the server",
      );
    });

    it("resyncs from the server when a command fails", async () => {
      const local = seeded();
      useReviewStore.setState({ filePath: "doc.md", comments: [local] });

      mockedAxios.post.mockRejectedValueOnce(new Error("500"));
      // The resync GET returns server truth: the reply never landed.
      mockedAxios.get.mockResolvedValueOnce(serverCopy([local]));

      useReviewStore.getState().replyToComment("aaaaaaaa-0001", "lost reply");
      await flushCommands();

      expect(consoleError).toHaveBeenCalled();
      expect(mockedAxios.get).toHaveBeenCalledWith("/api/review", {
        params: { path: "doc.md" },
      });
      // The optimistic reply is rolled back to what the server actually has.
      expect(useReviewStore.getState().comments).toEqual([local]);
    });
  });
});

describe("loadReview null-at-200 clears local comments", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });
  afterEach(() => localStorage.clear());

  // Null at 200 means specifically "no review file": deleting every comment
  // still persists an empty review. So it is proof the review is gone, and
  // holding on to local comments leaves the UI showing reviewer state the
  // server does not have — with every later command 404ing and no way back.
  it("drops comments when the server reports no review for this file", async () => {
    useReviewStore.setState({
      filePath: "doc.md",
      comments: [mkThreadComment("abcdef12-0000", "please clarify", [])],
    });
    mockedAxios.get.mockResolvedValueOnce({ data: null });

    await useReviewStore.getState().loadReview("doc.md");

    expect(useReviewStore.getState().comments).toEqual([]);
  });

  it("keeps review mode on so the reviewer is not ejected mid-session", async () => {
    localStorage.setItem("vantage.reviewMode:doc.md", "on");
    useReviewStore.setState({
      filePath: "doc.md",
      comments: [mkThreadComment("abcdef12-0000", "please clarify", [])],
    });
    mockedAxios.get.mockResolvedValueOnce({ data: null });

    await useReviewStore.getState().loadReview("doc.md");

    expect(useReviewStore.getState().comments).toEqual([]);
    expect(useReviewStore.getState().isReviewMode).toBe(true);
  });

  it("keeps comments when the GET itself fails", async () => {
    // A transport failure is not evidence the review is gone.
    useReviewStore.setState({
      filePath: "doc.md",
      comments: [mkThreadComment("abcdef12-0000", "please clarify", [])],
    });
    mockedAxios.get.mockRejectedValueOnce(new Error("network down"));

    await useReviewStore.getState().loadReview("doc.md");

    expect(useReviewStore.getState().comments).toHaveLength(1);
  });

  it("undoes the optimistic mutation when a command 404s into a deleted review", async () => {
    useReviewStore.setState({
      filePath: "doc.md",
      comments: [mkThreadComment("abcdef12-0000", "please clarify", [])],
    });
    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 404, data: { error: "No comment found" } },
    });
    mockedAxios.get.mockResolvedValueOnce({ data: null });

    useReviewStore.getState().dismissAll();
    // dismissAll fires runCommand without awaiting the resync it queues.
    await new Promise((r) => setTimeout(r, 0));

    const state = useReviewStore.getState();
    expect(state.comments).toEqual([]);
    expect(state.commandError?.message).toBe("No comment found");
  });
});

describe("command failures are surfaced, not swallowed", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  // A failed command is that operation lost — no later write retransmits it.
  // Resyncing silently just deletes the reviewer's turn from the screen.
  it("records the failure and the text the reviewer typed", async () => {
    useReviewStore.setState({
      filePath: "doc.md",
      comments: [
        mkThreadComment("abcdef12-0000", "please clarify", [agentAddressed]),
      ],
    });
    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 404, data: { error: "No comment found" } },
    });
    mockedAxios.get.mockResolvedValueOnce({ data: null });

    await useReviewStore
      .getState()
      .replyToComment("abcdef12-0000", "you missed the point");

    const err = useReviewStore.getState().commandError;
    expect(err?.message).toBe("No comment found");
    expect(err?.draft).toBe("you missed the point");
  });

  it("clears the error when the next command succeeds", async () => {
    useReviewStore.setState({
      filePath: "doc.md",
      comments: [mkThreadComment("abcdef12-0000", "x", [])],
      commandError: { message: "stale", draft: "old" },
    });
    mockedAxios.patch.mockResolvedValueOnce({
      data: { file_path: "doc.md", comments: [] },
    });

    await useReviewStore.getState().editComment("abcdef12-0000", "reworded");

    expect(useReviewStore.getState().commandError).toBeNull();
  });
});

describe("isPendingForAgent and the round a delivery answered", () => {
  const withRound = (r: CommentReaction, round: number): CommentReaction => ({
    ...r,
    answers_round: round,
  });

  // The agent read the payload when the thread was empty, worked, and the
  // reviewer posted a follow-up meanwhile. Its answer lands last and reads as
  // "agent had the last word", so the follow-up it never saw drops out of the
  // agent queue: a reviewer turn silently marked answered.
  it("re-queues when the agent answered a round older than the reviewer's follow-up", () => {
    const c = mk([
      mkReaction("agent", "addressed", "done", 1),
      mkReaction("reviewer", "needs_clarification", "not quite, also X", 2),
      withRound(mkReaction("agent", "addressed", "also fixed spelling", 3), 0),
    ]);
    expect(isPendingForAgent(c)).toBe(true);
    expect(isAnsweredByAgent(c)).toBe(false);
  });

  it("stays answered when the agent answered the current round", () => {
    const c = mk([
      mkReaction("agent", "addressed", "done", 1),
      mkReaction("reviewer", "needs_clarification", "not quite", 2),
      withRound(mkReaction("agent", "addressed", "fixed that too", 3), 2),
    ]);
    expect(isPendingForAgent(c)).toBe(false);
  });

  it("is unchanged for a delivery that names no round", () => {
    // The paste door and any payload predating the field.
    const c = mk([
      mkReaction("agent", "addressed", "done", 1),
      mkReaction("reviewer", "needs_clarification", "not quite", 2),
      mkReaction("agent", "addressed", "also fixed spelling", 3),
    ]);
    expect(isPendingForAgent(c)).toBe(false);
  });

  it("does not re-queue on a reviewer acceptance at or after the round", () => {
    // Accepting closes a round; it is not an unanswered follow-up.
    const c = mk([
      withRound(mkReaction("agent", "addressed", "done", 1), 0),
      mkReaction("reviewer", "noted", "Accepted", 2),
    ]);
    expect(isPendingForAgent(c)).toBe(false);
  });
});

describe("the follow-up note matches the turns actually in the payload", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  /** Re-queued by a bare edit: an agent answer, then a reviewer edit, no reply. */
  const editRequeued = (): ReviewComment => ({
    ...mkThreadComment("abcdef12-0000", "please tighten (edited wording)", [
      mkReaction("agent", "addressed", "Tightened the paragraph", 100),
    ]),
    edited_at: 500,
  });

  beforeEach(() => {
    resetStores();
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  const payloadFor = async (comments: ReviewComment[]): Promise<string> => {
    useReviewStore.setState({
      filePath: "doc.md",
      lastContent: "line one\nline two\n",
      comments,
    });
    await useReviewStore.getState().copyAllToClipboard();
    return writeText.mock.calls[0][0] as string;
  };

  // An edit re-queues a comment without appending any reviewer reaction, so
  // the thread has no turn labelled "Follow-up". Sending the agent to read one
  // points it at text that is not there.
  it("does not send the agent to a Follow-up turn that does not exist", async () => {
    const payload = await payloadFor([editRequeued()]);

    // No turn in the thread carries the "Follow-up" label...
    expect(payload).not.toContain("**Follow-up:**");
    // ...so the note must not tell the agent to go read one.
    expect(payload).not.toMatch(/followed by a \*\*Follow-up\*\*/);
    expect(payload).toContain("_(the reviewer edited this comment)_");
    expect(payload).toMatch(/rewrote the request itself/);
  });

  it("sends the agent to the Follow-up turn when the thread has one", async () => {
    const payload = await payloadFor([
      mkThreadComment("aaaaaaaa-0001", "please clarify", multiRoundThread),
    ]);

    expect(payload).toContain("**Follow-up:**");
    expect(payload).toMatch(/followed by a \*\*Follow-up\*\*/);
    expect(payload).not.toMatch(/rewrote the request itself/);
  });

  // A batch draws from both categories, so gating on either one alone drops
  // the guidance the other half needs.
  it("explains both reasons when the batch mixes them", async () => {
    const payload = await payloadFor([
      mkThreadComment("aaaaaaaa-0001", "please clarify", multiRoundThread),
      editRequeued(),
      mkThreadComment("bbbbbbbb-0002", "typo in this line", []),
    ]);

    expect(payload).toMatch(/followed by a \*\*Follow-up\*\*/);
    expect(payload).toMatch(/rewrote the request itself/);
    // Both returning threads are counted, not just the replied-to one.
    expect(payload).toContain("2 of these are follow-up rounds.");
  });
});
