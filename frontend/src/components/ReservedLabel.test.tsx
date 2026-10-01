import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RESERVED_ICON_SIZE, ReservedLabel } from "./ReservedLabel";

// jsdom lays nothing out, so what is tested here is what the stylesheet is
// given to lay out — the label drawn, and a ghost of each other label — and
// that the stylesheet stacks and centers them. That the icon and label end up
// centered, with the same room before as after, is measured in the header e2e
// spec (header_fit.spec.ts).

function renderButton(label: string, reserve: readonly string[]) {
  render(
    <button type="button">
      <ReservedLabel
        icon={<svg data-testid="icon" width={14} height={14} />}
        label={label}
        reserve={reserve}
        labelClassName="hdr-label"
      />
    </button>,
  );
  return screen.getByRole("button");
}

const ghosts = (button: HTMLElement) =>
  Array.from(button.querySelectorAll<HTMLElement>(".hdr-reserve-ghost"));

describe("ReservedLabel", () => {
  it("draws the icon and the label, and adds no text of its own", () => {
    const button = renderButton("Review", ["Review", "End review?"]);
    // Its name and its text are the label's alone: a ghost is drawn from an
    // attribute, so a selection copies nothing of it and nothing reads it.
    expect(button).toHaveAccessibleName("Review");
    expect(button.textContent).toBe("Review");
    const face = button.querySelector(".hdr-reserve-face")!;
    expect(face).toContainElement(screen.getByTestId("icon"));
    expect(screen.getByText("Review")).toHaveClass("hdr-label");
    expect(face.children).toHaveLength(2);
  });

  it("keeps the room of each other label in a ghost hidden from everyone", () => {
    const button = renderButton("Review", ["Review", "End review?"]);
    const [ghost, ...more] = ghosts(button);
    expect(more).toHaveLength(0);
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost.textContent).toBe("");
    expect(ghost.querySelector("button, a, input, [tabindex]")).toBeNull();
    const [space, label] = Array.from(ghost.children) as HTMLElement[];
    // An icon-wide space before the label, as the label has its icon.
    expect(space).toHaveClass("hdr-reserve-icon");
    expect(space.style.width).toBe(`${RESERVED_ICON_SIZE}px`);
    // The label's class, so the `labels` yield step takes the ghost's label
    // with the label and leaves the button its icon alone.
    expect(label).toHaveClass("hdr-label");
    expect(label).toHaveAttribute("data-reserve", "End review?");
  });

  it("keeps the room of the label it changed from once it changes", () => {
    const button = renderButton("End review?", ["Review", "End review?"]);
    expect(button.textContent).toBe("End review?");
    expect(
      ghosts(button).map((g) =>
        g.querySelector("[data-reserve]")!.getAttribute("data-reserve"),
      ),
    ).toEqual(["Review"]);
  });

  it("draws one ghost for each label it is not showing, and none twice", () => {
    const button = renderButton("Copy 3", ["Copy 3", "Copied!", "Copied!"]);
    expect(ghosts(button)).toHaveLength(1);
  });

  // Copy answers' count, after its label in either state. Outside the room it
  // was given all of the room between it and a shorter label; in the room,
  // each ghost has a copy, so the three are centered together.
  describe("with something drawn after the label", () => {
    const trailing = {
      text: "12",
      testId: "count",
      className: "tabular-nums",
      style: { minWidth: "4ch" },
    };
    const renderWithCount = (label: string) => {
      render(
        <button type="button">
          <ReservedLabel
            icon={<svg data-testid="icon" width={14} height={14} />}
            label={label}
            reserve={["Copy answers", "Copied"]}
            labelClassName="hdr-label"
            trailing={trailing}
          />
        </button>,
      );
      return screen.getByRole("button");
    };

    it("draws it last, after the label, and it is part of what the button says", () => {
      const button = renderWithCount("Copied");
      // The label, then the count, and nothing of a ghost's.
      expect(button.textContent).toBe("Copied12");
      const face = button.querySelector(".hdr-reserve-face")!;
      const count = screen.getByTestId("count");
      expect(face.lastElementChild).toBe(count);
      expect(count).toHaveTextContent("12");
      expect(count).toHaveClass("hdr-reserve-after", "tabular-nums");
      expect(count.style.minWidth).toBe("4ch");
    });

    it("keeps a copy of it in each ghost, as wide and found by no one", () => {
      const button = renderWithCount("Copied");
      const [ghost] = ghosts(button);
      expect(ghost.textContent).toBe("");
      const [, label, copy] = Array.from(ghost.children) as HTMLElement[];
      expect(label).toHaveAttribute("data-reserve", "Copy answers");
      // Its class and style, so its width; its text from the attribute, and
      // not the test id, which names the one drawn.
      expect(copy).toHaveClass("hdr-reserve-after", "tabular-nums");
      expect(copy.style.minWidth).toBe("4ch");
      expect(copy).toHaveAttribute("data-reserve", "12");
      expect(copy).not.toHaveAttribute("data-testid");
      expect(screen.getAllByTestId("count")).toHaveLength(1);
    });
  });
});

describe("the stylesheet's room for a changing label", () => {
  // A variable, not a literal: Vite rewrites a literal
  // `new URL("./x", import.meta.url)` into an asset URL `fs` cannot open.
  const stylesheet = "../index.css";
  const css = readFileSync(new URL(stylesheet, import.meta.url), "utf8");
  /** The declarations of the rule whose selector is exactly `selector`. */
  const rule = (selector: string) => {
    const found = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).find(
      (m) =>
        m[1]!
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\s+/g, " ")
          .trim() === selector,
    );
    expect(found, selector).toBeDefined();
    return found![2]!.replace(/\s+/g, " ").trim();
  };

  it("lays the label and every ghost out in one cell, centered in it", () => {
    expect(rule(".hdr-reserve")).toContain("display: inline-grid;");
    expect(rule(".hdr-reserve")).toContain("justify-items: center;");
    expect(rule(".hdr-reserve > *")).toContain("grid-area: 1 / 1;");
    // The icon and label together, spaced as the button spaces them.
    expect(rule(".hdr-reserve > *")).toContain("display: flex;");
    expect(rule(".hdr-reserve > *")).toContain("gap: inherit;");
    expect(rule(".hdr-reserve")).toContain("gap: inherit;");
    // Never started at the left of the room again.
    expect(rule(".hdr-reserve")).not.toContain("text-align");
    expect(rule(".hdr-reserve > *")).not.toContain("text-align");
  });

  it("draws a ghost's label invisibly, and with no text to announce", () => {
    expect(rule(".hdr-reserve-ghost")).toBe("visibility: hidden;");
    expect(rule(".hdr-reserve-ghost > [data-reserve]::after")).toContain(
      'content: attr(data-reserve) / "";',
    );
  });

  it("starts each row at the edge of the opened ⋯, as a menu's rows do", () => {
    // The face fills the room there, so what it draws starts at the room's
    // start, and what comes after the label ends the room in either state.
    expect(
      rule(
        '.viewer-header[data-yield~="actions"] .hdr-overflow[data-open] .hdr-reserve',
      ),
    ).toBe("justify-items: stretch;");
    expect(rule(".hdr-reserve-after")).toBe("margin-inline-start: auto;");
  });
});
