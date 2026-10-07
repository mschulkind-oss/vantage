import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PlanningPendingAnswers } from "./PlanningPendingAnswers";
import { HeaderOverflow } from "./HeaderOverflow";
import type { PendingGroup } from "../lib/planningAnswers";

const groups: PendingGroup[] = [
  {
    path: "plans/decision.md",
    comments: [
      {
        id: "answer-0001",
        comment: "Use bounded retention.",
        created_at: 0,
        selected_text: "How long should files stay?",
        anchor: {
          source_line: 12,
          block_text_hash: "hash",
          selection_offset: 0,
          selection_length: 0,
        },
        reactions: [
          {
            actor: "reviewer",
            kind: "reply",
            summary: "Also add cleanup commands.",
            before_text: "",
            after_text: "",
            timestamp: 1,
          },
        ],
      },
    ],
  },
];
const onOpenDocument = vi.fn();
const props = {
  groups,
  known: true,
  leftOut: 0,
  hrefOf: (path: string) => `/alpha/${path}`,
  onOpenDocument,
};
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "Review answers" }));
const menu = () =>
  screen.getByRole("menu", { name: "Answers waiting on the agent" });
function view(overrides: Partial<typeof props> = {}) {
  return render(
    <MemoryRouter>
      <PlanningPendingAnswers {...props} {...overrides} />
    </MemoryRouter>,
  );
}

describe("PlanningPendingAnswers", () => {
  it("shows source paths, original answers and reviewer follow-ups without delivering anything", () => {
    onOpenDocument.mockClear();
    view();
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    expect(within(menu()).getByText("plans/decision.md")).toBeTruthy();
    expect(within(menu()).getByText("Use bounded retention.")).toBeTruthy();
    expect(
      within(menu()).getByText("Follow-up: Also add cleanup commands."),
    ).toBeTruthy();
    const link = within(menu()).getByRole("menuitem", {
      name: "Open plans/decision.md at line 12",
    });
    expect(link).toHaveAttribute("href", "/alpha/plans/decision.md#L12");
    expect(link).toHaveFocus();
    expect(onOpenDocument).not.toHaveBeenCalled();
    // Browser navigation is covered by Playwright; cancel native defaults in
    // jsdom while still exercising AppLink's modified/plain click handling.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link, { ctrlKey: true });
    expect(onOpenDocument).not.toHaveBeenCalled();
    expect(menu()).toBeTruthy();
    fireEvent.click(link);
    expect(onOpenDocument).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables inspection when the count is unknown or empty", () => {
    const { rerender } = view({ known: false });
    expect(
      screen.getByRole("button", { name: "Review answers" }),
    ).toBeDisabled();
    rerender(
      <MemoryRouter>
        <PlanningPendingAnswers {...props} groups={[]} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: "Review answers" }),
    ).toBeDisabled();
  });

  it("reports excluded answers and falls back to a document link with no line", () => {
    view({
      leftOut: 2,
      groups: [
        {
          path: "old.md",
          comments: [{ id: "old", comment: "An old answer", created_at: 0 }],
        },
      ],
    });
    open();
    expect(
      within(menu()).getByText(/The filter leaves out 2 answers/),
    ).toBeTruthy();
    expect(
      within(menu()).getByRole("menuitem", { name: "Open old.md" }),
    ).toHaveAttribute("href", "/alpha/old.md");
  });

  it("keeps the preview bounded, pages to every answer, and clamps after updates", () => {
    const many: PendingGroup[] = [
      {
        path: "many.md",
        comments: Array.from({ length: 21 }, (_, n) => ({
          id: String(n),
          comment: `Answer ${n}`,
          created_at: 0,
        })),
      },
    ];
    const { rerender } = view({ groups: many });
    open();
    expect(
      within(menu()).getAllByRole("menuitem", { name: "Open many.md" }),
    ).toHaveLength(20);
    expect(within(menu()).queryByText("Answer 20")).toBeNull();
    fireEvent.click(
      within(menu()).getByRole("menuitem", { name: "Next answers" }),
    );
    expect(within(menu()).getByText("Answer 20")).toBeTruthy();
    expect(
      within(menu()).getByRole("menuitem", { name: "Open many.md" }),
    ).toHaveFocus();
    expect(within(menu()).getByText("21–21 of 21")).toBeTruthy();
    rerender(
      <MemoryRouter>
        <PlanningPendingAnswers {...props} />
      </MemoryRouter>,
    );
    expect(within(menu()).getByText("Use bounded retention.")).toBeTruthy();
    expect(within(menu()).queryByText("Answer 20")).toBeNull();
  });

  it("uses the persistent toolbar trigger when its actions are folded", () => {
    render(
      <MemoryRouter>
        <HeaderOverflow>
          <PlanningPendingAnswers {...props} />
        </HeaderOverflow>
      </MemoryRouter>,
    );
    const toolbar = screen.getByRole("button", { name: "Toolbar actions" });
    fireEvent.click(toolbar);
    expect(toolbar).toHaveAttribute("aria-expanded", "true");
    open();
    expect(toolbar).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(toolbar).toHaveFocus();
  });

  it("closes with Escape and returns focus to its trigger", () => {
    view();
    open();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review answers" }),
    ).toHaveFocus();
  });
});
