import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReviewPanel } from "./ReviewPanel";
import { isPendingForAgent, useReviewStore } from "../stores/useReviewStore";
import { useRepoStore } from "../stores/useRepoStore";
import type {
  CommentReaction,
  ReactionActor,
  ReactionKind,
  ReviewComment,
} from "../types";

// Store writes (reopen, delete, …) call saveReview, which PUTs to the API.
vi.mock("axios");

const reaction = (
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

  it("shows a Copy button for a fresh comment the agent has never seen", () => {
    setComments([baseComment({ reactions: [] })]);
    render(<ReviewPanel isOpen onClose={() => {}} />);
    // Copy is gated on "still owed to the agent", not on "the agent has
    // already replied" — a brand-new comment must be individually copyable.
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

describe("ReviewPanel — thread rendering", () => {
  beforeEach(() => {
    useReviewStore.setState({ comments: [], filePath: null });
    vi.clearAllMocks();
  });

  /** The badge rendered immediately before a turn's summary. */
  const actorLabelFor = (summary: string): string | null | undefined =>
    screen.getByText(summary).previousElementSibling?.textContent;

  it("renders every turn of a back-and-forth thread, in order, with actor labels", () => {
    setComments([
      baseComment({
        reactions: [
          reaction("agent", "addressed", "reworded the intro", 1),
          reaction("reviewer", "needs_clarification", "still ambiguous", 2),
          reaction("agent", "addressed", "split it in two", 3),
        ],
      }),
    ]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    // All three turns are present — the panel used to render only the last
    // agent reaction, so the reviewer's own follow-up vanished on submit.
    expect(screen.getByText("reworded the intro")).toBeTruthy();
    expect(screen.getByText("still ambiguous")).toBeTruthy();
    expect(screen.getByText("split it in two")).toBeTruthy();

    const rendered = document.body.textContent ?? "";
    expect(rendered.indexOf("reworded the intro")).toBeLessThan(
      rendered.indexOf("still ambiguous"),
    );
    expect(rendered.indexOf("still ambiguous")).toBeLessThan(
      rendered.indexOf("split it in two"),
    );

    expect(actorLabelFor("reworded the intro")).toBe("Agent");
    expect(actorLabelFor("still ambiguous")).toBe("You");
    expect(actorLabelFor("split it in two")).toBe("Agent");
  });

  it("labels a reviewer 'noted' turn as accepted rather than as a follow-up", () => {
    setComments([
      baseComment({
        resolved: true,
        reactions: [
          reaction("agent", "addressed", "renamed the field", 1),
          reaction("reviewer", "noted", "Accepted", 2),
        ],
      }),
    ]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    expect(actorLabelFor("Accepted")).toBe("You accepted");
    expect(actorLabelFor("renamed the field")).toBe("Agent");
  });
});

describe("ReviewPanel — filter tabs", () => {
  beforeEach(() => {
    useReviewStore.setState({ comments: [], filePath: null });
    vi.clearAllMocks();
  });

  const FRESH = "needs a first look";
  const ANSWERED = "the agent handled this";
  const FOLLOWUP = "the agent missed the point";
  const EDITED = "reworded after the agent replied";
  const ACCEPTED = "closed by accepting the fix";
  const DISMISSED = "closed without ever asking";
  const ALL_TEXTS = [FRESH, ANSWERED, FOLLOWUP, EDITED, ACCEPTED, DISMISSED];

  const seedMixedSet = () =>
    setComments([
      baseComment({ id: "fresh", comment: FRESH, reactions: [] }),
      baseComment({
        id: "answered",
        comment: ANSWERED,
        reactions: [agentAddressed],
      }),
      baseComment({
        id: "followup",
        comment: FOLLOWUP,
        reactions: [agentAddressed, reviewerFollowup],
      }),
      // Addressed at t=1 but reworded at t=5: the agent answered the old
      // wording, so this is owed back to the agent.
      baseComment({
        id: "edited",
        comment: EDITED,
        edited_at: 5,
        reactions: [agentAddressed],
      }),
      baseComment({
        id: "accepted",
        comment: ACCEPTED,
        resolved: true,
        reactions: [
          agentAddressed,
          reaction("reviewer", "noted", "Accepted", 3),
        ],
      }),
      baseComment({
        id: "dismissed",
        comment: DISMISSED,
        resolved: true,
        reactions: [],
      }),
    ]);

  const countIn = (label: string | RegExp): number => {
    const text = screen.getByRole("button", { name: label }).textContent ?? "";
    return Number(/\((\d+)\)/.exec(text)?.[1]);
  };

  const visibleComments = (): string[] =>
    ALL_TEXTS.filter((t) => screen.queryByText(t) !== null);

  it("gives the 'Needs agent' tab the same count as the footer Copy button", () => {
    seedMixedSet();
    render(<ReviewPanel isOpen onClose={() => {}} />);

    // Both must be the set of comments still owed to the agent. The old
    // "Awaiting reaction" tab counted only never-answered comments and so
    // contradicted the very payload Copy was about to send.
    expect(countIn(/^Needs agent/)).toBe(countIn(/^Copy \(/));
    expect(countIn(/^Needs agent/)).toBe(3);
  });

  it("shows exactly the right comments under each tab, leaving none unreachable", () => {
    seedMixedSet();
    render(<ReviewPanel isOpen onClose={() => {}} />);

    const expected: Array<[RegExp, string[]]> = [
      [/^All/, ALL_TEXTS],
      [/^Needs agent/, [FRESH, FOLLOWUP, EDITED]],
      [/^Answered/, [ANSWERED]],
      [/^Resolved/, [ACCEPTED, DISMISSED]],
    ];

    const reachable = new Set<string>();
    for (const [tab, want] of expected) {
      fireEvent.click(screen.getByRole("button", { name: tab }));
      const shown = visibleComments();
      expect(shown).toEqual(want);
      expect(countIn(tab)).toBe(want.length);
      if (!/^All/.test(tab.source)) shown.forEach((t) => reachable.add(t));
    }

    // Every state is selectable without falling back to the "All" tab.
    expect([...reachable].sort()).toEqual([...ALL_TEXTS].sort());
  });
});

describe("ReviewPanel — reopening a resolved comment", () => {
  beforeEach(() => {
    useReviewStore.setState({ comments: [], filePath: null });
    vi.clearAllMocks();
  });

  it("offers Reopen on a comment dismissed before the agent ever saw it", () => {
    // No agent reaction and resolved: this used to render no actions at all,
    // making a silent dismissal a permanent dead end on every surface.
    setComments([baseComment({ resolved: true, reactions: [] })]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    const reopened = useReviewStore.getState().comments[0];
    expect(reopened.resolved).toBeFalsy();
    expect(isPendingForAgent(reopened)).toBe(true);
    // Reopening records no reaction — it restores the first-round state.
    expect(reopened.reactions ?? []).toHaveLength(0);

    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
    expect(screen.getByTitle(/Copy this comment thread/i)).toBeTruthy();
  });
});

describe("ReviewPanel — reply box lifecycle", () => {
  beforeEach(() => {
    useReviewStore.setState({ comments: [], filePath: null });
    vi.clearAllMocks();
  });

  const replyBox = () =>
    screen.queryByPlaceholderText("Follow-up for the agent...");

  it("closes an open reply box when its comment is deleted from the store", () => {
    setComments([baseComment({ reactions: [agentAddressed] })]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const box = replyBox();
    expect(box).toBeTruthy();
    fireEvent.change(box!, { target: { value: "half-written follow-up" } });

    // The comment goes away underneath the open box (deleted here or on
    // another surface), then the review reloads and the comment comes back.
    act(() => useReviewStore.getState().deleteComment("c1"));
    act(() =>
      useReviewStore.setState({
        comments: [baseComment({ reactions: [agentAddressed] })],
      }),
    );

    // The box must not reappear against the restored comment carrying text
    // the reviewer wrote for a comment that had been removed.
    expect(replyBox()).toBeNull();
    expect(screen.getByRole("button", { name: "Reply" })).toBeTruthy();
  });
});

describe("ReviewPanel — closing disarms the destructive confirms", () => {
  beforeEach(() => {
    useReviewStore.setState({
      comments: [],
      filePath: null,
      outdatedCommentIds: new Set<string>(),
    });
    vi.clearAllMocks();
  });

  const dismissAllButton = () =>
    screen.queryByRole("button", { name: /^Dismiss All/ });
  const confirmDismissButton = () =>
    screen.queryByRole("button", { name: /^Confirm dismiss all\?$/ });

  it("re-arms the Dismiss All confirmation after a close/reopen cycle", () => {
    setComments([baseComment({ reactions: [] })]);
    const { rerender } = render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(dismissAllButton()!);
    expect(confirmDismissButton()).toBeTruthy();

    // Reopening inside the 3s confirm window used to leave the button armed,
    // so the reviewer's first click on a freshly opened panel wiped the review.
    rerender(<ReviewPanel isOpen={false} onClose={() => {}} />);
    rerender(<ReviewPanel isOpen onClose={() => {}} />);

    expect(confirmDismissButton()).toBeNull();
    expect(dismissAllButton()).toBeTruthy();

    // The next click must only arm it — nothing may be dismissed yet.
    fireEvent.click(dismissAllButton()!);
    expect(useReviewStore.getState().comments[0].resolved).toBeFalsy();
    expect(confirmDismissButton()).toBeTruthy();
  });

  it("closes the actions menu and re-arms End review after a close/reopen cycle", () => {
    setComments([baseComment({ reactions: [] })]);
    const { rerender } = render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByTitle("More actions"));
    fireEvent.click(
      screen.getByRole("button", { name: /^End review \(delete all data\)$/ }),
    );
    expect(
      screen.getByRole("button", { name: /^Confirm end & delete data\?$/ }),
    ).toBeTruthy();

    rerender(<ReviewPanel isOpen={false} onClose={() => {}} />);
    rerender(<ReviewPanel isOpen onClose={() => {}} />);

    // The menu is shut, so the armed item is not sitting under the cursor.
    expect(
      screen.queryByRole("button", { name: /^Confirm end & delete data\?$/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^End review/ })).toBeNull();

    // And reopening the menu offers the unarmed label — it asks again.
    fireEvent.click(screen.getByTitle("More actions"));
    expect(
      screen.getByRole("button", { name: /^End review \(delete all data\)$/ }),
    ).toBeTruthy();
    expect(useReviewStore.getState().comments).toHaveLength(1);
  });
});

describe("ReviewPanel — a reopened accepted comment", () => {
  beforeEach(() => {
    useReviewStore.setState({
      comments: [],
      filePath: null,
      outdatedCommentIds: new Set<string>(),
    });
    vi.clearAllMocks();
  });

  const REOPENED = "the heading is still wrong";

  /**
   * The reviewer accepted the agent's fix (agent/addressed + reviewer/noted)
   * and later reopened the thread.  The acceptance closed that round, so the
   * comment is NOT owed back to the agent — re-sending it would tell the agent
   * its earlier answer failed to satisfy a reviewer who explicitly accepted it.
   */
  const seedReopenedAccepted = () =>
    setComments([
      baseComment({
        comment: REOPENED,
        resolved: false,
        reactions: [
          reaction("agent", "addressed", "renamed the heading", 1),
          reaction("reviewer", "noted", "Accepted", 2),
        ],
      }),
    ]);

  it("counts under Answered rather than Needs agent, and is not copyable", () => {
    seedReopenedAccepted();
    render(<ReviewPanel isOpen onClose={() => {}} />);

    expect(
      screen.getByRole("button", { name: "Needs agent (0)" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Answered (1)" })).toBeTruthy();

    // The footer Copy button sends exactly the "Needs agent" set, so it has
    // nothing to send and is disabled.
    const footerCopy = screen.getByRole("button", { name: /^Copy \(\d+\)$/ });
    expect(footerCopy.textContent).toContain("Copy (0)");
    expect(footerCopy).toBeDisabled();

    // ...and the row offers no individual Copy either.
    expect(screen.queryByTitle(/Copy this comment thread/i)).toBeNull();
  });

  it("lands under Answered — not Needs agent — when reopened via the button", () => {
    // Drive the real path: an accepted, resolved comment that the reviewer
    // reopens.  Reopen only flips `resolved`, so the acceptance turn stays on
    // the thread and must keep the comment out of the agent's queue.
    setComments([
      baseComment({
        comment: REOPENED,
        resolved: true,
        reactions: [
          reaction("agent", "addressed", "renamed the heading", 1),
          reaction("reviewer", "noted", "Accepted", 2),
        ],
      }),
    ]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(useReviewStore.getState().comments[0].resolved).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Answered (1)" }));
    expect(screen.getByText(REOPENED)).toBeTruthy();
    expect(screen.queryByTitle(/Copy this comment thread/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Needs agent (0)" }));
    expect(screen.queryByText(REOPENED)).toBeNull();
    expect(screen.getByText("No comments in this view")).toBeTruthy();
  });
});

describe("ReviewPanel — clipboard write failure", () => {
  beforeEach(() => {
    useReviewStore.setState({
      comments: [],
      filePath: null,
      outdatedCommentIds: new Set<string>(),
    });
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A clipboard that rejects — no permission, or a non-secure context. */
  const rejectingClipboard = () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    return writeText;
  };

  it("labels the footer Copy button 'Copy failed', then restores it after 2s", async () => {
    const writeText = rejectingClipboard();
    setComments([baseComment({ reactions: [] })]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    const footerCopy = screen.getByRole("button", { name: /^Copy \(\d+\)$/ });
    await act(async () => {
      fireEvent.click(footerCopy);
    });

    // A rejected write used to fail completely silently — the reviewer walked
    // away believing the payload was on the clipboard.
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(footerCopy.textContent).toContain("Copy failed");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(footerCopy.textContent).toContain("Copy (1)");
  });

  it("labels the per-comment Copy button 'Copy failed', then restores it after 2s", async () => {
    const writeText = rejectingClipboard();
    setComments([baseComment({ reactions: [] })]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    const rowCopy = screen.getByTitle(/Copy this comment thread/i);
    await act(async () => {
      fireEvent.click(rowCopy);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(rowCopy.textContent).toContain("Copy failed");
    // Only the button that failed is relabelled.
    expect(
      screen.getByRole("button", { name: /^Copy \(\d+\)$/ }).textContent,
    ).toContain("Copy (1)");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(rowCopy.textContent).toContain("Copy");
    expect(rowCopy.textContent).not.toContain("failed");
  });
});

/**
 * Deleting a comment throws away the agent's replies with it and there is no
 * undo, so the sidebar's trash button is two-click like the panel's other
 * destructive actions: the first click only arms it.
 */
describe("ReviewPanel — two-click delete", () => {
  beforeEach(() => {
    useReviewStore.setState({
      comments: [],
      filePath: null,
      outdatedCommentIds: new Set<string>(),
    });
    vi.clearAllMocks();
  });

  const FIRST = "the first comment";
  const SECOND = "the second comment";

  const seedTwo = () =>
    setComments([
      baseComment({ id: "c1", comment: FIRST }),
      baseComment({ id: "c2", comment: SECOND }),
    ]);

  /**
   * The trash button inside the row showing `commentText`. Matched by title so
   * the query survives both states: unarmed it reads "Delete comment", armed it
   * reads "Click again to delete this comment and its replies".
   */
  const deleteButtonFor = (commentText: string): HTMLElement => {
    const row = screen.getByText(commentText).closest("div.group");
    expect(row).toBeTruthy();
    return within(row as HTMLElement).getByTitle(
      /Delete comment|Click again to delete/,
    );
  };

  const commentIds = (): string[] =>
    useReviewStore.getState().comments.map((c) => c.id);

  it("does not delete on the first click — it arms the button instead", () => {
    setComments([baseComment({ comment: FIRST })]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    const btn = deleteButtonFor(FIRST);
    expect(btn.textContent).toBe("");

    fireEvent.click(btn);

    // Nothing is gone, and the button now says what a second click will do.
    expect(commentIds()).toEqual(["c1"]);
    expect(screen.getByText(FIRST)).toBeTruthy();
    expect(btn.textContent).toBe("Delete?");
    expect(btn.getAttribute("title")).toMatch(/Click again to delete/);
  });

  // The delete confirm ignores a second click that lands within one gesture
  // (a physical double-click), so tests must let the clock move on.
  const settleConfirmGesture = () => {
    const base = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => base + 1000);
  };

  it("deletes exactly the armed comment on the second click", () => {
    seedTwo();
    render(<ReviewPanel isOpen onClose={() => {}} />);

    const btn = deleteButtonFor(FIRST);
    fireEvent.click(btn);
    settleConfirmGesture();
    fireEvent.click(btn);

    expect(commentIds()).toEqual(["c2"]);
    expect(screen.queryByText(FIRST)).toBeNull();
    expect(screen.getByText(SECOND)).toBeTruthy();
    // The surviving row's own button was never armed by its neighbour.
    expect(deleteButtonFor(SECOND).textContent).toBe("");
  });

  it("moves the arm to another comment's button instead of deleting either", () => {
    seedTwo();
    render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(deleteButtonFor(FIRST));
    expect(deleteButtonFor(FIRST).textContent).toBe("Delete?");

    // Only one button may be armed at a time: clicking the other one is a
    // first click for it, not a confirmation of the first row.
    settleConfirmGesture();
    fireEvent.click(deleteButtonFor(SECOND));

    expect(commentIds()).toEqual(["c1", "c2"]);
    expect(deleteButtonFor(FIRST).textContent).toBe("");
    expect(deleteButtonFor(SECOND).textContent).toBe("Delete?");

    settleConfirmGesture();
    // And the moved arm is live: the second row deletes on its next click.
    fireEvent.click(deleteButtonFor(SECOND));
    expect(commentIds()).toEqual(["c1"]);
  });

  it("disarms when the panel is closed, so reopening asks again", () => {
    setComments([baseComment({ comment: FIRST })]);
    const { rerender } = render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(deleteButtonFor(FIRST));
    expect(deleteButtonFor(FIRST).textContent).toBe("Delete?");

    rerender(<ReviewPanel isOpen={false} onClose={() => {}} />);
    rerender(<ReviewPanel isOpen onClose={() => {}} />);

    // Reopening inside the 3s window must not leave a single click destructive.
    expect(deleteButtonFor(FIRST).textContent).toBe("");
    fireEvent.click(deleteButtonFor(FIRST));
    expect(commentIds()).toEqual(["c1"]);
    expect(deleteButtonFor(FIRST).textContent).toBe("Delete?");
  });
});

describe("ReviewPanel — the delete arm expires", () => {
  beforeEach(() => {
    useReviewStore.setState({
      comments: [],
      filePath: null,
      outdatedCommentIds: new Set<string>(),
    });
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const deleteButton = (): HTMLElement =>
    screen.getByTitle(/Delete comment|Click again to delete/);

  it("disarms after 3s, so a later click only re-arms", () => {
    setComments([baseComment({ comment: "stale arm" })]);
    render(<ReviewPanel isOpen onClose={() => {}} />);

    fireEvent.click(deleteButton());
    expect(deleteButton().textContent).toBe("Delete?");

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // A reviewer who armed it and walked away must not lose the comment to a
    // stray click minutes later.
    expect(deleteButton().textContent).toBe("");
    expect(deleteButton().getAttribute("title")).toBe("Delete comment");

    fireEvent.click(deleteButton());
    expect(useReviewStore.getState().comments).toHaveLength(1);
    expect(deleteButton().textContent).toBe("Delete?");

    // ...and the fresh arm gets a full window of its own.
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(deleteButton().textContent).toBe("Delete?");
    fireEvent.click(deleteButton());
    expect(useReviewStore.getState().comments).toHaveLength(0);
  });
});
