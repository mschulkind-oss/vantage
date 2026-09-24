import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProjectPicker } from "./ProjectPicker";

const hrefFor = (name: string) => `/${name}`;

function renderPicker() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <ProjectPicker
        isOpen
        onClose={onClose}
        onSelect={onSelect}
        hrefFor={hrefFor}
        repos={[{ name: "alpha" }, { name: "beta" }]}
      />
    </MemoryRouter>,
  );
  return { onSelect, onClose };
}

/** A name is split into per-character spans, so find its row by its text. */
function row(name: string): HTMLElement {
  const el = [
    ...document.querySelectorAll<HTMLElement>("[data-project-item]"),
  ].find((r) => r.textContent === name);
  if (!el) throw new Error(`no row for ${name}`);
  return el;
}

describe("ProjectPicker rows", () => {
  // Record whether the picker left the click to the browser, then cancel it so
  // jsdom does not attempt a real navigation.
  let defaultPrevented: boolean | undefined;
  const recordClick = (e: MouseEvent) => {
    defaultPrevented = e.defaultPrevented;
    e.preventDefault();
  };

  beforeEach(() => {
    defaultPrevented = undefined;
    document.addEventListener("click", recordClick);
  });
  afterEach(() => {
    document.removeEventListener("click", recordClick);
  });

  it("are links to hrefFor's route", () => {
    renderPicker();
    const a = row("alpha");
    expect(a.tagName).toBe("A");
    expect(a).toHaveAttribute("href", "/alpha");
    expect(row("beta")).toHaveAttribute("href", "/beta");
  });

  it("navigate through onSelect on a plain click, and close", () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(row("beta"));
    expect(onSelect).toHaveBeenCalledWith("beta");
    expect(onClose).toHaveBeenCalled();
    expect(defaultPrevented).toBe(true);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])(
    "leave a modified click (%o) to the browser",
    (modifier) => {
      const { onSelect, onClose } = renderPicker();
      fireEvent.click(row("beta"), modifier);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(defaultPrevented).toBe(false);
    },
  );

  it("still select on hover", () => {
    renderPicker();
    fireEvent.mouseEnter(row("beta"));
    expect(row("beta").className).toContain("bg-blue-50");
    expect(row("alpha").className).not.toContain("bg-blue-50");
  });
});
