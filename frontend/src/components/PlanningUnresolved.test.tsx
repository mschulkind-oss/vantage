/**
 * Comments without a question (`docs/design/planning-page-freshness.md` §4.3):
 * groups with the quote each comment was filed on, counted apart, and
 * Attach to question… with proof, no preselection and a confirm.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { indexOf, questionDirective } from "../test/planning";
import { PlanningUnresolved } from "./PlanningUnresolved";
import {
  ownershipMap,
  unresolvedGroups,
  type CommentOwnership,
} from "../lib/questionOwnership";
import type { ReviewComment } from "../types";

const OPEN = "\u{1F4AC}";
const item = (id: string) =>
  [
    `1. ${OPEN} **${id}: Question ${id}?**`,
    "",
    `   ${questionDirective(OPEN, id, "Yes.")}`,
    "",
    `   Words of ${id}.`,
    "",
  ].join("\n");
const index = indexOf(
  {
    "a.md": [
      "---",
      "stage: DESIGN",
      "---",
      "",
      item("OQ-A1"),
      item("OQ-B1"),
    ].join("\n"),
  },
  { stages: { DESIGN: "open" as const } },
);
const reading = {
  boot_id: "b",
  document_generation: 1,
  content_hash: "h",
  mutation_revision: 1,
  sample_changed: false,
};
const legacy: ReviewComment = {
  id: "c1",
  comment: "My old answer",
  fallback_text: "the words it was filed on",
  created_at: 0,
  reactions: [],
};
const groupsOf = (comments: ReviewComment[]) =>
  unresolvedGroups(
    ownershipMap(
      index,
      { "a.md": comments },
      { evidence: { "a.md": reading }, hashes: { "a.md": "h" } },
    ),
    new Set(),
  );
const questionsOf = () => index.documents[0].questions;

function open(onAttach = vi.fn().mockResolvedValue(null), refusals = {}) {
  render(
    <PlanningUnresolved
      groups={groupsOf([legacy])}
      questionsOf={questionsOf}
      onAttach={onAttach}
      refusals={refusals}
      open
      onToggle={vi.fn()}
    />,
  );
  return onAttach;
}

describe("PlanningUnresolved", () => {
  it("is a section group, Comments without a question (N), that opens and closes from its heading", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <PlanningUnresolved
        groups={groupsOf([legacy])}
        open={false}
        onToggle={onToggle}
      />,
    );
    const group = screen.getByRole("region", {
      name: /Comments without a question/,
    });
    const heading = within(group).getByRole("button", {
      name: /Comments without a question/,
    });
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("unattached-count")).toHaveTextContent("1");
    expect(screen.queryByTestId("unresolved-item")).toBeNull();
    fireEvent.click(heading);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(
      <PlanningUnresolved
        groups={groupsOf([legacy])}
        open
        onToggle={onToggle}
      />,
    );
    expect(screen.getByTestId("unresolved-item")).toHaveTextContent(
      "My old answer",
    );
    expect(
      screen.getByRole("button", { name: "Copy requests" }),
    ).toBeInTheDocument();
  });

  it("calls notes outside every question notes, with nothing to attach", () => {
    render(
      <PlanningUnresolved
        groups={groupsOf([{ ...legacy, ownership: "unowned" }])}
        questionsOf={questionsOf}
        onAttach={vi.fn()}
        open
        onToggle={vi.fn()}
      />,
    );
    const notes = screen.getByTestId("unresolved-note");
    expect(notes).toHaveTextContent("Notes (1)");
    expect(notes).not.toHaveTextContent(/unresolved|error/i);
    expect(
      within(notes).queryByRole("button", { name: "Attach to question…" }),
    ).toBeNull();
  });

  it("explains that a ledger-recorded ID is not a new unanswered question or proof of a reply", () => {
    const groups = groupsOf([]);
    const compacted: CommentOwnership = {
      path: "a.md",
      comment: { ...legacy, question_id: "OQ-C1" },
      kind: "compacted",
      reason: "id OQ-C1 is in the Decision Ledger and has no question left",
    };
    render(
      <PlanningUnresolved
        groups={{ ...groups, compacted: [compacted] }}
        open
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByTestId("unresolved-compacted")).toHaveTextContent(
      "The question ID is recorded in the Decision Ledger, not newly unanswered. Its review comment still awaits an agent reply; the ledger entry is not a delivery receipt.",
    );
  });

  it("lists each group with the original quote, and the Compacted and Ambiguous kinds apart", () => {
    const groups = groupsOf([
      legacy,
      { ...legacy, id: "c2", question_id: "OQ-GONE9" },
    ]);
    render(<PlanningUnresolved groups={groups} open onToggle={vi.fn()} />);
    expect(screen.getByTestId("unresolved-unassigned")).toHaveTextContent(
      "the words it was filed on",
    );
    expect(screen.getByTestId("unresolved-removed")).toHaveTextContent(
      "no longer in the document",
    );
  });

  it("offers Attach to question… with proof, preselects no target, and attaches only after confirm", async () => {
    const onAttach = open();
    fireEvent.click(
      screen.getByRole("button", { name: "Attach to question…" }),
    );
    const select =
      screen.getByLabelText<HTMLSelectElement>("Attach to question");
    expect(select.value).toBe("");
    expect(screen.queryByTestId("attach-proof")).toBeNull();
    const confirm = screen.getByRole("button", { name: "Confirm attach" });
    expect(confirm).toBeDisabled();

    fireEvent.change(select, { target: { value: "OQ-B1" } });
    const proof = screen.getByTestId("attach-proof");
    expect(proof).toHaveTextContent("the words it was filed on");
    expect(proof).toHaveTextContent("Words of OQ-B1.");
    expect(proof).not.toHaveTextContent("Words of OQ-A1.");
    expect(onAttach).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach.mock.calls[0][1].id).toBe("OQ-B1");
    expect((onAttach.mock.calls[0][0] as CommentOwnership).comment.id).toBe(
      "c1",
    );
  });

  it("shows a refused attach in plain words and stays open for another try", async () => {
    const onAttach = vi
      .fn()
      .mockResolvedValue(
        "Not attached: the document changed since this was read.",
      );
    open(onAttach);
    fireEvent.click(
      screen.getByRole("button", { name: "Attach to question…" }),
    );
    fireEvent.change(screen.getByLabelText("Attach to question"), {
      target: { value: "OQ-A1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm attach" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not attached: the document changed since this was read.",
    );
    expect(screen.getByTestId("attach-panel")).toBeTruthy();
  });

  it("offers no Attach for a comment whose ownership is Unknown", () => {
    const groups = unresolvedGroups(
      // A document the scan does not hold: what became of the id is unread.
      ownershipMap(index, {
        "elsewhere.md": [{ ...legacy, question_id: "OQ-A1" }],
      }),
      new Set(),
    );
    render(
      <PlanningUnresolved
        groups={groups}
        questionsOf={questionsOf}
        onAttach={vi.fn()}
        open
        onToggle={vi.fn()}
      />,
    );
    const unknown = screen.getByTestId("unresolved-unknown");
    expect(
      within(unknown).queryByRole("button", { name: "Attach to question…" }),
    ).toBeNull();
  });

  it("lists refused automatic binds on their own, even when no comment is unresolved", () => {
    render(
      <PlanningUnresolved
        groups={groupsOf([])}
        open
        onToggle={vi.fn()}
        refusals={{
          "a.md\nc1": "Not attached: the comments changed since this was read.",
        }}
      />,
    );
    expect(screen.getByTestId("unattached-count")).toHaveTextContent("1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "the comments changed since this was read",
    );
  });
});
