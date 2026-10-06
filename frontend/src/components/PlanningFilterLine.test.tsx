import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { FILTER_HINT, PlanningFilterLine } from "./PlanningFilterLine";

// The filter line between the box's own Enter, ✕ or paste and the location
// it navigates to (docs/design/planning-filter.md §7). The router commits a
// location in a transition, so for that while the URL still holds the old
// text: here it holds it for good, since nothing navigates.
function renderLine(urlText: string, printText = "") {
  const onApply = vi.fn();
  const onLeave = vi.fn();
  const inputRef = createRef<HTMLInputElement>();
  render(
    <MemoryRouter>
      <PlanningFilterLine
        urlText={urlText}
        invalid={false}
        busyAfter={null}
        onApply={onApply}
        onLeave={onLeave}
        inputRef={inputRef}
        announcement=""
        printText={printText}
      />
    </MemoryRouter>,
  );
  const box = screen.getByRole("textbox", {
    name: "Filter",
  }) as HTMLInputElement;
  const hint = () => screen.getByTestId("planning-filter-hint").textContent;
  return { onApply, onLeave, box, hint };
}

describe("PlanningFilterLine, before the URL holds what it applied", () => {
  it("holds nothing unapplied after a paste, and Esc keeps the pasted filter", () => {
    const { onApply, onLeave, box, hint } = renderLine("path:plans/a.md");
    box.focus();
    act(() => {
      fireEvent.paste(box, {
        clipboardData: {
          getData: () => "/.vantage/planning?filter=path:plans/b.md",
        },
      });
    });
    expect(onApply).toHaveBeenCalledWith("path:plans/b.md", null);
    expect(box.value).toBe("path:plans/b.md");
    expect(hint()).toBe("");
    // Esc with nothing unapplied hands the focus back, and never puts the
    // old URL's text over the filter the page is switching to.
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("path:plans/b.md");
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("holds nothing unapplied after ✕ or Enter, and Esc puts back what it applied", () => {
    const { onApply, box, hint } = renderLine("path:plans/a.md");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Clear the filter" }));
    });
    expect(onApply).toHaveBeenLastCalledWith("", null);
    expect(box.value).toBe("");
    expect(hint()).toBe("");
    fireEvent.change(box, { target: { value: "path:./plans/c.md" } });
    expect(hint()).toBe(FILTER_HINT);
    act(() => {
      fireEvent.submit(box.form!);
    });
    expect(onApply).toHaveBeenLastCalledWith("path:./plans/c.md", null);
    expect(box.value).toBe("path:plans/c.md");
    expect(hint()).toBe("");
    // Typed over, the text is unapplied again, and Esc puts back the text
    // just applied rather than the old URL's.
    fireEvent.change(box, { target: { value: "path:plans/d.md" } });
    expect(hint()).toBe(FILTER_HINT);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("path:plans/c.md");
    expect(hint()).toBe("");
  });
});

describe("PlanningFilterLine in print", () => {
  it("takes no room with no filter, and says the filter it has", () => {
    renderLine("");
    const line = screen.getByRole("search", {
      name: "Filter the planning page",
    }).parentElement!;
    expect(line).toHaveClass("print:hidden");
    expect(screen.queryByTestId("planning-filter-print")).toBeNull();
  });

  it("prints the Filter line in place of the box when filtered", () => {
    renderLine("path:plans/a.md", "path:plans/a.md");
    const line = screen.getByRole("search", {
      name: "Filter the planning page",
    }).parentElement!;
    expect(line).not.toHaveClass("print:hidden");
    expect(screen.getByTestId("planning-filter-print")).toHaveTextContent(
      "Filter: path:plans/a.md",
    );
  });
});
