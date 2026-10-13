import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewControls, type ReviewControlsProps } from "./ReviewControls";

function propsOf(
  overrides: Partial<ReviewControlsProps> = {},
): ReviewControlsProps {
  return {
    visible: true,
    isReviewMode: true,
    activeCount: 3,
    answeredCount: 2,
    pendingCount: 1,
    drifted: false,
    exitConfirm: false,
    dismissConfirm: false,
    copied: false,
    toggleTitle: "Enter review mode",
    onToggle: vi.fn(),
    onDismiss: vi.fn(),
    onCopy: vi.fn(),
    onManage: vi.fn(),
    ...overrides,
  };
}

function renderControls(overrides: Partial<ReviewControlsProps> = {}) {
  const props = propsOf(overrides);
  render(<ReviewControls {...props} />);
  return props;
}

describe("ReviewControls", () => {
  it("offers the Review toggle with the title the page gave it", () => {
    const { onToggle } = renderControls();
    const toggle = screen.getByRole("button", { name: "Review" });
    expect(toggle).toHaveAttribute("data-tip", "Enter review mode");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("leaves the Review toggle out where reviewing cannot work", () => {
    // Raw view, or a static export: the page says so, and the actions stay,
    // since a reviewer holding pending comments still needs them.
    renderControls({ visible: false });
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy 1" })).toBeInTheDocument();
  });

  it("keeps the actions out of a menu, in the row with their counts", () => {
    renderControls();

    // No menu: every action is a button of the row itself. It used to be one
    // click into a disclosure behind the comment count, which is where Copy
    // was at every width.
    expect(screen.queryByTestId("review-comments-menu")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();

    expect(
      screen.getByRole("button", { name: "Dismiss 2 answered" }),
    ).toHaveAttribute(
      "data-tip",
      "Dismiss the 2 comments the agent has answered",
    );
    expect(screen.getByRole("button", { name: "Copy 1" })).toHaveAttribute(
      "data-tip",
      "Copy 1 comment to clipboard",
    );
    expect(
      screen.getByRole("button", { name: "Manage comments" }),
    ).toHaveAttribute("data-tip", "Manage comments");
  });

  it("keeps the room of both of Copy's labels, so the click moves nothing", () => {
    // The label the click draws is longer than the one it replaces, and the
    // button is in the row the header measures: the ghost of the other label
    // is what holds its width (`components/ReservedLabel.tsx`).
    const { rerender } = render(<ReviewControls {...propsOf()} />);
    const room = () =>
      [
        ...screen
          .getByRole("button", { name: /Copy|Copied/ })
          .querySelectorAll("[data-reserve]"),
      ].map((ghost) => ghost.getAttribute("data-reserve"));
    expect(room()).toEqual(["Copied!"]);
    rerender(<ReviewControls {...propsOf({ copied: true })} />);
    expect(room()).toEqual(["Copy 1"]);
  });

  it("dismisses what the agent has answered in one click, naming the count", () => {
    const { onDismiss } = renderControls();

    const dismiss = screen.getByRole("button", { name: "Dismiss 2 answered" });
    expect(dismiss).toHaveAttribute(
      "data-tip",
      "Dismiss the 2 comments the agent has answered",
    );
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("asks before sweeping comments nobody has answered, by name and by count", () => {
    // The confirm is the page's state, not this component's: what is pinned
    // here is the label and the title the click arms.
    const { onDismiss } = renderControls({
      answeredCount: 0,
      dismissConfirm: true,
    });

    const confirm = screen.getByRole("button", { name: "Confirm?" });
    expect(confirm).toHaveAttribute("data-tip", "Click again to dismiss all");
    fireEvent.click(confirm);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("names the sweep by what it takes and asks first when nothing was answered", () => {
    renderControls({ answeredCount: 0, activeCount: 1 });

    const dismiss = screen.getByRole("button", { name: "Dismiss 1" });
    expect(dismiss).toHaveAttribute("data-tip", "Dismiss 1 comment");
  });

  it("says the copy landed where it was clicked", () => {
    const { onCopy } = renderControls({ copied: true });

    const copy = screen.getByRole("button", { name: "Copied!" });
    expect(copy).toHaveAttribute("data-tip", "Copied!");
    fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("holds only Manage comments when there is nothing to dismiss or copy", () => {
    renderControls({ activeCount: 0, answeredCount: 0, pendingCount: 0 });

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Manage comments" }),
    ).toBeInTheDocument();
  });

  it("opens the comments panel from the icon-only Manage button", () => {
    const { onManage } = renderControls();
    fireEvent.click(screen.getByRole("button", { name: "Manage comments" }));
    expect(onManage).toHaveBeenCalledOnce();
  });

  it("draws the document-changed warning where the row can still see it", () => {
    renderControls({ drifted: true });
    expect(
      screen.getByLabelText(
        "The document changed under comments awaiting a response",
      ),
    ).toBeInTheDocument();
  });
});
