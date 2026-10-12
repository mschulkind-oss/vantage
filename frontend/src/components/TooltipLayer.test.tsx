import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipLayer } from "./TooltipLayer";

/**
 * The layer, which finds its controls by `data-tip` rather than being wrapped
 * around them. Every test drives it with the events a browser sends, so what is
 * pinned here is what a reader gets.
 */
function draw() {
  render(
    <>
      <TooltipLayer />
      <button data-tip="Toolbar actions">⋯</button>
      <button data-tip="Copy N comments to clipboard">Copy</button>
      <button data-tip={"Line one\nLine two"}>two lines</button>
      <button aria-expanded="true" data-tip="Toolbar actions">
        open
      </button>
      <button aria-label="no tip">none</button>
    </>,
  );
  return {
    more: screen.getByText("⋯"),
    copy: screen.getByText("Copy"),
    two: screen.getByText("two lines"),
    open: screen.getByText("open"),
    none: screen.getByText("none"),
  };
}

/** The panel, once it is up. */
const panel = () => screen.queryByRole("tooltip");

/** What a browser sends when the pointer arrives at `el`. */
const enter = (el: HTMLElement) =>
  fireEvent.pointerOver(el, { clientX: 5, clientY: 5 });
/** ...and when it leaves, for `to`. */
const leave = (el: HTMLElement, to: Element | null = null) =>
  fireEvent.pointerOut(el, { clientX: 5, clientY: 5, relatedTarget: to });

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no layout, so there is no hit test to be had: the layer falls
  // back to the events' own targets, which is what these tests drive.
  vi.stubGlobal("elementFromPoint", undefined);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: undefined,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TooltipLayer", () => {
  it("says nothing until the pointer has rested on a control", () => {
    const { more } = draw();
    expect(panel()).toBeNull();

    enter(more);
    expect(panel()).toBeNull();
    act(() => vi.advanceTimersByTime(399));
    expect(panel()).toBeNull();

    act(() => vi.advanceTimersByTime(2));
    expect(panel()).toHaveTextContent("Toolbar actions");
  });

  it("places the panel under the control, against the window", () => {
    const { more } = draw();
    enter(more);
    act(() => vi.advanceTimersByTime(500));
    // jsdom measures every box at zero, so what is pinned is that it was
    // placed at all — off its hidden start and inside the window.
    expect(panel()).toHaveStyle({ visibility: "visible" });
  });

  it("shows what a control's `data-tip` says, line breaks and all", () => {
    const { two } = draw();
    enter(two);
    act(() => vi.advanceTimersByTime(500));
    expect(panel()).toHaveTextContent("Line one");
    expect(panel()?.className).toContain("whitespace-pre-line");
  });

  it("describes the control while the tip is up, and stops after", () => {
    const { more } = draw();
    expect(more).not.toHaveAttribute("aria-describedby");
    enter(more);
    act(() => vi.advanceTimersByTime(500));
    const described = more.getAttribute("aria-describedby");
    expect(described).toBe(panel()?.id);

    leave(more);
    expect(more).not.toHaveAttribute("aria-describedby");
    expect(panel()).toBeNull();
  });

  it("moves to the control the pointer is on next, after its own wait", () => {
    const { more, copy } = draw();
    enter(more);
    act(() => vi.advanceTimersByTime(500));
    expect(panel()).toHaveTextContent("Toolbar actions");

    leave(more, copy);
    enter(copy);
    // The first tip is gone at once; the next waits its turn.
    expect(panel()).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(panel()).toHaveTextContent("Copy N comments to clipboard");
  });

  it("says nothing for a control whose own panel is open", () => {
    const { open } = draw();
    enter(open);
    act(() => vi.advanceTimersByTime(500));
    expect(panel()).toBeNull();
  });

  it("says nothing for a control with no `data-tip`", () => {
    const { none } = draw();
    enter(none);
    act(() => vi.advanceTimersByTime(500));
    expect(panel()).toBeNull();
  });

  it("lets a pointer dawdling on the way past take it down", () => {
    const { more, none } = draw();
    enter(more);
    act(() => vi.advanceTimersByTime(500));
    enter(none);
    expect(panel()).toBeNull();
    leave(more, none);
    act(() => vi.advanceTimersByTime(500));
    expect(panel()).toBeNull();
  });

  it("puts the keyboard's tip up at once, and hands it to the next control", () => {
    const { more, copy } = draw();
    // A real focus, and the event a browser sends with it: jsdom's own
    // `focus()` moves `activeElement` without announcing it.
    more.focus();
    fireEvent.focusIn(more);
    expect(panel()).toHaveTextContent("Toolbar actions");

    fireEvent.focusOut(more, { relatedTarget: copy });
    copy.focus();
    fireEvent.focusIn(copy);
    expect(panel()).toHaveTextContent("Copy N comments to clipboard");

    // Off every control: it goes.
    fireEvent.focusOut(copy, { relatedTarget: null });
    expect(panel()).toBeNull();
  });

  it("goes on a click, a scroll, and Escape", () => {
    const { more } = draw();
    for (const dismiss of [
      () => fireEvent.pointerDown(more),
      () => fireEvent.scroll(window),
      () => fireEvent.keyDown(document, { key: "Escape" }),
    ]) {
      enter(more);
      act(() => vi.advanceTimersByTime(500));
      expect(panel()).not.toBeNull();
      dismiss();
      expect(panel()).toBeNull();
    }
  });
});
