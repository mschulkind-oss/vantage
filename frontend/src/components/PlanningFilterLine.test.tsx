import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { FILTER_HINT, PlanningFilterLine } from "./PlanningFilterLine";

// The filter line on its own (docs/reference/planning-index.md §6.17): what it
// hands the page as the reader types, and between the box's own Enter, ✕ or
// paste and the location it navigates to. The router commits a location in
// a transition, so for that while the URL still holds the old text: here it
// holds it for good, since nothing navigates.
function renderLine(urlText: string, printText = "", appliedText = urlText) {
  const onType = vi.fn();
  const onApply = vi.fn();
  const onFlush = vi.fn();
  const onLeave = vi.fn();
  const inputRef = createRef<HTMLInputElement>();
  render(
    <MemoryRouter>
      <PlanningFilterLine
        urlText={urlText}
        appliedText={appliedText}
        invalid={false}
        busyAfter={null}
        onType={onType}
        onApply={onApply}
        onFlush={onFlush}
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
  return { onType, onApply, onFlush, onLeave, box, hint };
}

describe("PlanningFilterLine, as the reader types", () => {
  it("hands the page every change, text it cannot read included, and applies nothing itself", () => {
    const { onType, onApply, box } = renderLine("");
    for (const text of ["g", "ge", 'ge "', 'ge "x"']) {
      fireEvent.change(box, { target: { value: text } });
    }
    expect(onType.mock.calls).toEqual([
      ["g", false],
      ["ge", false],
      ['ge "', false],
      ['ge "x"', false],
    ]);
    expect(box.value).toBe('ge "x"');
    expect(onApply).not.toHaveBeenCalled();
  });

  it("hands over nothing while an input method composes, and the composed text when it ends", () => {
    const { onType, box } = renderLine("");
    fireEvent.compositionStart(box);
    fireEvent.change(box, { target: { value: "ｋ" } });
    fireEvent.change(box, { target: { value: "か" } });
    expect(box.value).toBe("か");
    expect(onType).not.toHaveBeenCalled();
    fireEvent.compositionEnd(box);
    expect(onType.mock.calls).toEqual([["か", false]]);
    // After it, a keystroke is handed over again.
    fireEvent.change(box, { target: { value: "かx" } });
    expect(onType).toHaveBeenLastCalledWith("かx", false);
  });

  it("says a text it cannot read is not applied, and nothing of one it can", () => {
    const { box, hint } = renderLine("");
    fireEvent.change(box, { target: { value: "generator" } });
    expect(hint()).toBe("");
    fireEvent.change(box, { target: { value: 'generator "is' } });
    expect(hint()).toBe(FILTER_HINT);
    expect(FILTER_HINT).toMatch(/^Not applied: Enter says why$/);
    fireEvent.change(box, { target: { value: 'generator "is"' } });
    expect(hint()).toBe("");
    // The amber ring is the page's, for an applied filter alone: typing
    // never marks the box invalid.
    fireEvent.change(box, { target: { value: "is:" } });
    expect(hint()).toBe(FILTER_HINT);
    expect(box).not.toHaveAttribute("aria-invalid");
  });

  it("names the hint in the box's description while it shows, and draws its icon for a narrow width, where the words give way", () => {
    const { box } = renderLine("");
    const icon = () => screen.getByTestId("planning-filter-hint-icon");
    expect(box).not.toHaveAttribute("aria-describedby");
    expect(icon().querySelector("svg")).toBeNull();
    fireEvent.change(box, { target: { value: 'generator "is' } });
    expect(box).toHaveAccessibleDescription(FILTER_HINT);
    expect(icon().querySelector("svg")).not.toBeNull();
    expect(icon()).toHaveAttribute("title", FILTER_HINT);
    fireEvent.change(box, { target: { value: 'generator "is"' } });
    expect(box).not.toHaveAttribute("aria-describedby");
    expect(icon().querySelector("svg")).toBeNull();
    expect(icon()).not.toHaveAttribute("title");
  });

  it("says nothing of a text it cannot read that the URL holds, which is applied", () => {
    const { box, hint } = renderLine('a"');
    expect(box.value).toBe('a"');
    expect(hint()).toBe("");
  });

  it("puts the applied filter's text back on Esc over a text that is not applied, and otherwise hands the focus back", () => {
    const { box, hint, onLeave, onType } = renderLine("", "", "generator");
    box.focus();
    fireEvent.change(box, { target: { value: 'generator "is' } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("generator");
    expect(hint()).toBe("");
    expect(onLeave).not.toHaveBeenCalled();
    // An understood text is applied: Esc leaves it, and the box.
    fireEvent.change(box, { target: { value: "generator is:open" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("generator is:open");
    expect(onLeave).toHaveBeenCalledTimes(1);
    // Esc never hands the page a change of its own.
    expect(onType.mock.calls.map(([text]) => text)).toEqual([
      'generator "is',
      "generator is:open",
    ]);
  });

  it("asks the page to write when the focus leaves the box", () => {
    const { box, onFlush } = renderLine("");
    box.focus();
    fireEvent.change(box, { target: { value: "generator" } });
    expect(onFlush).not.toHaveBeenCalled();
    act(() => box.blur());
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("keeps the focus in the box as ✕ is pressed, so pressing it is not leaving", () => {
    const { box, onFlush } = renderLine("generator");
    box.focus();
    const clear = screen.getByRole("button", { name: "Clear the filter" });
    // A pointer press moves the focus on mousedown, unless it is prevented.
    expect(fireEvent.mouseDown(clear)).toBe(false);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("hands over a paste that is no planning link as typing written at once", () => {
    const { box, onType, onApply } = renderLine("");
    act(() => {
      fireEvent.paste(box, { clipboardData: { getData: () => "generator" } });
      // jsdom inserts nothing on a paste: the browser's own input follows.
      fireEvent.change(box, { target: { value: "generator" } });
    });
    expect(onType.mock.calls).toEqual([["generator", true]]);
    expect(onApply).not.toHaveBeenCalled();
    // The keystroke after it waits for the idle pause again.
    fireEvent.change(box, { target: { value: "generators" } });
    expect(onType).toHaveBeenLastCalledWith("generators", false);
  });
});

describe("PlanningFilterLine, before the URL holds what it applied", () => {
  it("holds nothing unapplied after a paste, and Esc keeps the pasted filter", () => {
    const { onApply, onLeave, onType, box, hint } =
      renderLine("path:plans/a.md");
    box.focus();
    act(() => {
      fireEvent.paste(box, {
        clipboardData: {
          getData: () => "/.vantage/planning?filter=path:plans/b.md",
        },
      });
    });
    expect(onApply).toHaveBeenCalledWith("path:plans/b.md", null);
    expect(onType).not.toHaveBeenCalled();
    expect(box.value).toBe("path:plans/b.md");
    expect(hint()).toBe("");
    // Esc with nothing unapplied hands the focus back, and never puts the
    // old URL's text over the filter the page is switching to.
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("path:plans/b.md");
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("holds nothing unapplied after ✕ or an Enter, a text it cannot read included", () => {
    const { onApply, box, hint } = renderLine("path:plans/a.md");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Clear the filter" }));
    });
    expect(onApply).toHaveBeenLastCalledWith("", null);
    expect(box.value).toBe("");
    expect(hint()).toBe("");
    fireEvent.change(box, { target: { value: "path:./plans/c.md" } });
    expect(hint()).toBe("");
    act(() => {
      fireEvent.submit(box.form!);
    });
    expect(onApply).toHaveBeenLastCalledWith("path:./plans/c.md", null);
    // Enter shows the canonical text.
    expect(box.value).toBe("path:/plans/c.md");
    // Entered, a text it cannot read is applied as written, and so is not
    // "not applied" while the URL takes it.
    fireEvent.change(box, { target: { value: 'path:plans/c.md "is' } });
    expect(hint()).toBe(FILTER_HINT);
    act(() => {
      fireEvent.submit(box.form!);
    });
    expect(onApply).toHaveBeenLastCalledWith('path:plans/c.md "is', null);
    expect(box.value).toBe('path:plans/c.md "is');
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
