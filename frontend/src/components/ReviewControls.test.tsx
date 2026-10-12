import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewControls, type ReviewControlsProps } from "./ReviewControls";

function renderControls(overrides: Partial<ReviewControlsProps> = {}) {
  const props: ReviewControlsProps = {
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
  render(<ReviewControls {...props} />);
  return props;
}

/** The comments menu's trigger, by the name its count gives it. */
const trigger = () => screen.getByTestId("review-comments-menu");

describe("ReviewControls", () => {
  it("offers the Review toggle with the title the page gave it", () => {
    const { onToggle } = renderControls();
    const toggle = screen.getByRole("button", { name: "Review" });
    expect(toggle).toHaveAttribute("title", "Enter review mode");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("leaves the Review toggle out where reviewing cannot work", () => {
    // Raw view, or a static export: the page says so, and the comments menu
    // stays, since a reviewer holding pending comments still needs it.
    renderControls({ visible: false });
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(trigger()).toBeInTheDocument();
  });

  it("says how many comments there are, and opens nothing until asked", () => {
    renderControls();
    expect(trigger()).toHaveAccessibleName("3 comments");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps Dismiss, Copy and Manage behind the menu, with their counts", () => {
    renderControls();
    fireEvent.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toHaveAccessibleName("Comments");
    expect(
      screen.getByRole("menuitem", { name: "Dismiss 2 answered" }),
    ).toHaveAttribute("title", "Dismiss the 2 comments the agent has answered");
    expect(screen.getByRole("menuitem", { name: "Copy 1" })).toHaveAttribute(
      "title",
      "Copy 1 comment to clipboard",
    );
    expect(
      screen.getByRole("menuitem", { name: "Manage comments" }),
    ).toHaveAttribute("title", "Manage comments");
  });

  it("dismisses what the agent has answered in one click, naming the count", () => {
    const { onDismiss } = renderControls();
    fireEvent.click(trigger());

    const dismiss = screen.getByRole("menuitem", {
      name: "Dismiss 2 answered",
    });
    expect(dismiss).toHaveAttribute(
      "title",
      "Dismiss the 2 comments the agent has answered",
    );
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("asks before sweeping comments nobody has answered, by name and by count", () => {
    // The confirm is the page's state, not this component's: what is pinned
    // here is the label and the title the click arms. That the menu stays open
    // under the pointer is `ViewerPage.test.tsx`'s.
    const { onDismiss } = renderControls({
      answeredCount: 0,
      dismissConfirm: true,
    });
    fireEvent.click(trigger());

    const confirm = screen.getByRole("menuitem", { name: "Confirm?" });
    expect(confirm).toHaveAttribute("title", "Click again to dismiss all");
    fireEvent.click(confirm);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("names the sweep by what it takes and asks first when nothing was answered", () => {
    renderControls({ answeredCount: 0, activeCount: 1 });
    fireEvent.click(trigger());

    const dismiss = screen.getByRole("menuitem", { name: "Dismiss 1" });
    expect(dismiss).toHaveAttribute("title", "Dismiss 1 comment");
  });

  it("says the copy landed where it was clicked", () => {
    const { onCopy } = renderControls({ copied: true });
    fireEvent.click(trigger());

    const copy = screen.getByRole("menuitem", { name: "Copied!" });
    fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("holds only Manage comments when there is nothing to dismiss or copy", () => {
    renderControls({ activeCount: 0, answeredCount: 0, pendingCount: 0 });
    expect(trigger()).toHaveAccessibleName("0 comments");
    fireEvent.click(trigger());

    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(
      screen.getByRole("menuitem", { name: "Manage comments" }),
    ).toBeInTheDocument();
  });

  it("opens the comments panel and closes the menu to get out of its way", () => {
    const { onManage } = renderControls();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage comments" }));

    expect(onManage).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and puts focus back on its trigger", () => {
    renderControls();
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("draws the document-changed warning where the row can still see it", () => {
    renderControls({ drifted: true });
    expect(
      screen.getByLabelText(
        "The document changed under comments awaiting a response",
      ),
    ).toBeInTheDocument();

    // The menu is not carrying it: the warning is not a destination.
    fireEvent.click(trigger());
    expect(
      screen.getByLabelText(
        "The document changed under comments awaiting a response",
      ),
    ).toBeInTheDocument();
  });
});
