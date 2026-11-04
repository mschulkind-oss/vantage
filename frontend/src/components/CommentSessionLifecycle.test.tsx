/**
 * The popover's editing session (`lib/commentSession.ts`) through the real
 * components against the in-memory review server: the stale begin buffer, a
 * restore that outlives its popover, the browser's leave prompt, the words in
 * Copy answers, and the 404/409 comparison views.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewCommentPopover } from "./ReviewCommentPopover";
import { UnsavedComments } from "./UnsavedComments";
import { hasUnsavedText, resetBoxesForTest } from "../lib/commentAutosave";
import { resetSessionsForTest } from "../lib/commentSession";
import { editCommentBox } from "../lib/reviewBoxes";
import { installReviewServer } from "../test/reviewServer";
import { replyCoverageLabel } from "../lib/replyCoverage";
import { useReviewStore } from "../stores/useReviewStore";
import type { ReviewComment } from "../types";

vi.mock("axios");

const target = { base: "/api", path: "doc.md" };
const rect = new DOMRect(0, 0, 10, 10);
const existing: ReviewComment = {
  id: "c1",
  comment: "opened text",
  created_at: 1,
  reactions: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  resetBoxesForTest();
  resetSessionsForTest();
});
afterEach(() => {
  vi.useRealTimers();
  resetBoxesForTest();
  resetSessionsForTest();
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

function popover(comment: ReviewComment) {
  return (
    <ReviewCommentPopover
      selectedText="quote"
      rect={rect}
      makeBox={() => editCommentBox(target, comment)}
      onClose={() => {}}
    />
  );
}

/** Dispatch a real `beforeunload`; `returnValue` is what the page set on it. */
const leavePrompt = () => {
  const e = new Event("beforeunload", { cancelable: true });
  let returnValue: unknown;
  Object.defineProperty(e, "returnValue", {
    get: () => returnValue,
    set: (v) => {
      returnValue = v;
    },
  });
  window.dispatchEvent(e);
  return e as BeforeUnloadEvent;
};

describe("a begin acknowledgement that says the answer changed", () => {
  it("sets the typed text apart, and Insert puts it in the box", async () => {
    const server = installReviewServer([existing]);
    // Another writer got there first: the server holds a newer wording.
    server.comments[0].comment = "their newer text";
    server.comments[0].root_text_version = "v-theirs";
    render(popover(existing));
    // Typed before the begin is acknowledged.
    fireEvent.change(screen.getByDisplayValue("opened text"), {
      target: { value: "typed before the ack" },
    });
    await flush();

    expect(
      screen.getByText(/changed before the box opened/).textContent,
    ).toBeTruthy();
    expect(screen.getAllByText("typed before the ack").length).toBeGreaterThan(
      0,
    );
    // Nothing of it was written over their wording.
    expect(server.comments[0].comment).toBe("their newer text");

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(screen.getByDisplayValue("typed before the ack")).toBeTruthy();
  });

  it("Copy puts the kept-apart text on the clipboard", async () => {
    const server = installReviewServer([existing]);
    server.comments[0].root_text_version = "v-theirs";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(popover(existing));
    fireEvent.change(screen.getByDisplayValue("opened text"), {
      target: { value: "mine, kept apart" },
    });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await flush();
    expect(writeText).toHaveBeenCalledWith("mine, kept apart");
  });
});

describe("a restore that outlives its popover", () => {
  it("retries from the app shell's list after the popover unmounts", async () => {
    const server = installReviewServer([existing]);
    const shell = render(<UnsavedComments />);
    const pop = render(popover(existing));
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "typed" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    server.sessionsDown = true;
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await flush();
    expect(screen.getByText(/Restore failed — retrying in/)).toBeTruthy();

    pop.unmount();
    expect(screen.queryByDisplayValue("typed")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry now" })).toBeTruthy();

    server.sessionsDown = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    await flush();
    expect(server.comments[0].comment).toBe("opened text");
    expect(screen.queryByRole("button", { name: "Retry now" })).toBeNull();
    shell.unmount();
  });
});

describe("the browser's leave prompt", () => {
  it("asks while a restore is pending and lets go once it is done", async () => {
    const server = installReviewServer([existing]);
    render(
      <>
        <UnsavedComments />
        {popover(existing)}
      </>,
    );
    await flush();
    // An open, untouched box holds nothing to lose.
    expect(leavePrompt().defaultPrevented).toBe(false);

    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "typed" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    server.sessionsDown = true;
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await flush();

    const asked = leavePrompt();
    expect(asked.defaultPrevented).toBe(true);
    expect(asked.returnValue).toBe("");

    server.sessionsDown = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    await flush();
    expect(hasUnsavedText()).toBe(false);
    const quiet = leavePrompt();
    expect(quiet.defaultPrevented).toBe(false);
  });

  it("asks while typed text is still inside the save pause", async () => {
    installReviewServer([existing]);
    render(
      <>
        <UnsavedComments />
        {popover(existing)}
      </>,
    );
    await flush();
    fireEvent.change(screen.getByDisplayValue("opened text"), {
      target: { value: "typing" },
    });
    expect(leavePrompt().defaultPrevented).toBe(true);
  });
});

describe("Copy answers beside the wording's version", () => {
  const copied = async (c: ReviewComment): Promise<string> => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    useReviewStore.setState({
      filePath: "doc.md",
      lastContent: "x",
      comments: [c],
    });
    await useReviewStore.getState().copyCommentToClipboard(c.id);
    return writeText.mock.calls[0][0] as string;
  };

  it("prints root_text_version beside the comment id", async () => {
    const out = await copied({ ...existing, root_text_version: "v7" });
    expect(out).toMatch(/`\[c1\]` `round:0` `root_text_version:v7`/);
  });

  it("a legacy root with no version prints none, and its replies read coverage unknown", async () => {
    const legacy: ReviewComment = {
      ...existing,
      reactions: [
        {
          actor: "agent",
          kind: "addressed",
          summary: "done",
          before_text: "",
          after_text: "",
          timestamp: 2,
        },
      ],
    };
    const out = await copied(legacy);
    expect(out).not.toContain("root_text_version:");
    expect(replyCoverageLabel(legacy, 0)).toBe("coverage unknown");
  });
});

describe("a restore refused by the server", () => {
  it("404: the answer is gone, the text is kept and Copy is offered", async () => {
    const server = installReviewServer([existing]);
    render(
      <>
        <UnsavedComments />
        {popover(existing)}
      </>,
    );
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "mine" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    // Another client deleted the answer.
    server.comments = [];
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await flush();
    expect(screen.getByRole("button", { name: "Copy text" })).toBeTruthy();
    expect(hasUnsavedText()).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry now" })).toBeNull();
  });

  it("409: shows theirs / yours / opened; Replace with mine needs the comparison box and writes mine", async () => {
    const server = installReviewServer([existing]);
    render(
      <>
        <UnsavedComments />
        {popover(existing)}
      </>,
    );
    await flush();
    const box = screen.getByDisplayValue("opened text");
    fireEvent.change(box, { target: { value: "mine" } });
    await act(() => vi.advanceTimersByTimeAsync(1100));
    await act(async () => {
      await axios.patch(
        "/api/review/comments/c1",
        { comment: "theirs" },
        { params: { path: "doc.md" } },
      );
    });
    vi.mocked(axios.get).mockResolvedValue({
      data: { file_path: "doc.md", comments: structuredClone(server.comments) },
    });
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await flush();

    expect(screen.getByText("Changed outside this box")).toBeTruthy();
    const replace = screen.getByRole("button", { name: "Replace with mine" });
    expect(replace).toHaveProperty("disabled", true);
    expect(server.comments[0].comment).toBe("theirs");
    fireEvent.click(screen.getByLabelText(/compared/));
    fireEvent.click(replace);
    await flush();
    expect(server.comments[0].comment).toBe("mine");
    expect(screen.queryByText("Changed outside this box")).toBeNull();
    expect(hasUnsavedText()).toBe(false);
  });
});
