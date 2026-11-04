/**
 * The unresolved-ownership menu (`docs/design/planning-question-state.md` §4):
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
      known
      questionsOf={questionsOf}
      onAttach={onAttach}
      refusals={refusals}
    />,
  );
  fireEvent.click(screen.getByTestId("unresolved-ownership"));
  return onAttach;
}

describe("PlanningUnresolved", () => {
  it("draws nothing when every comment is owned and nothing was refused", () => {
    const { container } = render(
      <PlanningUnresolved groups={groupsOf([])} known />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the unresolved comments and says Unknown while the reviews are not all read", () => {
    const { rerender } = render(
      <PlanningUnresolved groups={groupsOf([legacy])} known />,
    );
    expect(screen.getByTestId("unresolved-ownership")).toHaveTextContent(
      "1 with unresolved ownership",
    );
    rerender(<PlanningUnresolved groups={groupsOf([legacy])} known={false} />);
    expect(screen.getByTestId("unresolved-ownership")).toHaveTextContent(
      "Unknown with unresolved ownership",
    );
  });

  it("lists each group with the original quote, and the Compacted and Ambiguous kinds apart", () => {
    const groups = groupsOf([
      legacy,
      { ...legacy, id: "c2", question_id: "OQ-GONE9" },
    ]);
    render(<PlanningUnresolved groups={groups} known />);
    fireEvent.click(screen.getByTestId("unresolved-ownership"));
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
      ownershipMap(
        index,
        { "a.md": [{ ...legacy, question_id: "OQ-A1" }] },
        { evidence: {}, hashes: { "a.md": "h" } },
      ),
      new Set(),
    );
    render(
      <PlanningUnresolved
        groups={groups}
        known
        questionsOf={questionsOf}
        onAttach={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("unresolved-ownership"));
    const unknown = screen.getByTestId("unresolved-unknown");
    expect(
      within(unknown).queryByRole("button", { name: "Attach to question…" }),
    ).toBeNull();
  });

  it("lists refused automatic binds on their own, even when no comment is unresolved", () => {
    render(
      <PlanningUnresolved
        groups={groupsOf([])}
        known
        refusals={{
          "a.md\nc1": "Not attached: the comments changed since this was read.",
        }}
      />,
    );
    expect(screen.getByTestId("unresolved-ownership")).toHaveTextContent(
      "1 not attached",
    );
    fireEvent.click(screen.getByTestId("unresolved-ownership"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "the comments changed since this was read",
    );
  });
});
