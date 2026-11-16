import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanningReload, PlanningUpdates } from "./PlanningUpdates";

describe("planning toolbar labels", () => {
  it("names Apply updates visibly and keeps its label stable when the count changes", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <PlanningUpdates count={1} title="1 new reply" onRefresh={onRefresh} />,
    );
    const label = screen.getByText("Apply updates");
    expect(label).toHaveClass("hdr-label");
    expect(label).not.toHaveClass("hdr-label-minor");
    fireEvent.click(screen.getByRole("button", { name: /Apply updates:/ }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(
      <PlanningUpdates count={2} title="2 new replies" onRefresh={onRefresh} />,
    );
    expect(screen.getByText("Apply updates")).toBe(label);
    expect(screen.getByTestId("planning-updates-count")).toHaveTextContent("2");
    expect(screen.getByRole("button")).toHaveAccessibleName(
      /Apply updates: 2 updates/,
    );
  });

  it("does not drop Reload from server with the minor toolbar labels", () => {
    const onReload = vi.fn();
    render(
      <PlanningReload
        status={{
          running: false,
          lastSuccessAt: null,
          lastFailureAt: null,
          sampleChanged: false,
        }}
        onReload={onReload}
      />,
    );
    const label = screen.getByText("Reload from server");
    expect(label).toHaveClass("hdr-label");
    expect(label).not.toHaveClass("hdr-label-minor");
    fireEvent.click(screen.getByRole("button", { name: "Reload from server" }));
    expect(onReload).toHaveBeenCalledOnce();
  });
});
