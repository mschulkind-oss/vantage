/**
 * The header's freshness slot (`docs/reference/planning-ownership.md`
 * §8): Update · N, its refusal while an answer is open, and the offline
 * line with Retry now.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanningUpdates, UPDATE_BLOCKED } from "./PlanningUpdates";

describe("PlanningUpdates", () => {
  it("reads Update · N, keeps its label element when the count changes, and lists the updates in its title", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <PlanningUpdates count={1} title="1 new reply" onRefresh={onRefresh} />,
    );
    const button = screen.getByRole("button", { name: /^Update: 1 update/ });
    expect(button).toHaveTextContent(/^Update·1$/);
    expect(button.querySelector(".lucide-list-checks")).not.toBeNull();
    expect(button).toHaveAttribute(
      "data-tip",
      "Lay out what has changed, and check the server for anything newer: 1 new reply",
    );
    const label = screen.getByText("Update");
    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(
      <PlanningUpdates count={2} title="2 new replies" onRefresh={onRefresh} />,
    );
    expect(screen.getByText("Update")).toBe(label);
    expect(screen.getByTestId("planning-updates-count")).toHaveTextContent("2");
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Update: 2 updates (2 new replies)",
    );
  });

  it("keeps its room, invisible and out of reach, with nothing to lay out", () => {
    render(<PlanningUpdates count={0} title="" onRefresh={vi.fn()} />);
    const button = document.querySelector("[data-planning-updates]")!;
    expect(button).toHaveClass("invisible");
    expect(button).toHaveAttribute("aria-hidden", "true");
    expect(button).toHaveAttribute("tabindex", "-1");
  });

  it("is refused while an answer is open, in words that match the box, and never presses through", () => {
    const onRefresh = vi.fn();
    render(
      <PlanningUpdates
        count={3}
        title="3 new replies"
        onRefresh={onRefresh}
        blockedReason={UPDATE_BLOCKED}
      />,
    );
    const button = screen.getByRole("button", { name: /^Update: 3 updates/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "data-tip",
      "Close the open answer first — what you typed is saved",
    );
    fireEvent.click(button);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("says offline since when, in the same slot, with Retry now", () => {
    const onRetry = vi.fn();
    const since = new Date(2026, 10, 20, 9, 5).getTime();
    render(
      <PlanningUpdates
        count={2}
        title="2 new replies"
        onRefresh={vi.fn()}
        offlineSince={since}
        onRetry={onRetry}
      />,
    );
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent(
      new RegExp(
        `^Offline since ${new Date(since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · retrying`,
      ),
    );
    expect(document.querySelector("[data-planning-updates]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
