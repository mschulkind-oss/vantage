import { describe, it, expect } from "vitest";
import { anchoredMenuPosition, popoverPosition } from "./popoverPosition";

/** A selection rect, carrying only the fields the positioner reads. */
function sel(left: number, top: number, width = 120, height = 20) {
  return { left, top, width, bottom: top + height };
}

// iPhone-class viewport: narrower than the popover's nominal 440px width.
const PHONE_W = 393;
const PHONE_H = 852;
const DESKTOP_W = 1440;
const DESKTOP_H = 900;
/** What the element's max-w-[calc(100vw-32px)] leaves on a phone. */
const PHONE_POPOVER_W = PHONE_W - 32;

describe("popoverPosition", () => {
  it("keeps the popover on screen when the viewport is narrower than it", () => {
    const { left } = popoverPosition(sel(40, 200), PHONE_W, PHONE_H);
    // The regression: the right-edge limit used to be viewportWidth - 440,
    // which goes negative on a phone and dragged the popover off the left edge.
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + PHONE_POPOVER_W).toBeLessThanOrEqual(PHONE_W - 16);
  });

  it("clamps a selection at the right edge back inside the viewport", () => {
    const { left } = popoverPosition(sel(PHONE_W - 60, 200), PHONE_W, PHONE_H);
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + PHONE_POPOVER_W).toBeLessThanOrEqual(PHONE_W - 16);
  });

  it("clamps a selection at the left edge back inside the viewport", () => {
    expect(popoverPosition(sel(0, 200), PHONE_W, PHONE_H).left).toBe(16);
  });

  it("centers on the selection when there is room", () => {
    // 600 + 120/2 - 440/2
    expect(popoverPosition(sel(600, 300), DESKTOP_W, DESKTOP_H).left).toBe(440);
  });

  it("keeps a wide-viewport popover inside the right edge", () => {
    const { left } = popoverPosition(
      sel(DESKTOP_W - 100, 300),
      DESKTOP_W,
      DESKTOP_H,
    );
    expect(left + 440).toBeLessThanOrEqual(DESKTOP_W - 16);
  });

  it("places the popover below the selection when it fits", () => {
    expect(popoverPosition(sel(100, 100), DESKTOP_W, DESKTOP_H).top).toBe(128);
  });

  it("flips above the selection when it would run off the bottom", () => {
    expect(popoverPosition(sel(100, 700), PHONE_W, PHONE_H).top).toBe(
      700 - 360 - 8,
    );
  });

  it("never positions above the top of the viewport", () => {
    // Short viewport: neither below nor above fits, so the flip is clamped.
    expect(
      popoverPosition(sel(100, 40), PHONE_W, 300).top,
    ).toBeGreaterThanOrEqual(8);
  });
});

/** A trigger button's rect. */
function anchor(left: number, top: number, width = 28, height = 28) {
  return { left, top, right: left + width, bottom: top + height };
}

const MENU_W = 224; // w-56, the width both menus use
const MENU_H = 200;

describe("anchoredMenuPosition", () => {
  it("right-aligns to the trigger when there is room", () => {
    const a = anchor(1200, 100);
    const { left, top } = anchoredMenuPosition(
      a,
      MENU_W,
      MENU_H,
      DESKTOP_W,
      DESKTOP_H,
    );
    expect(left).toBe(a.right - MENU_W);
    expect(top).toBe(a.bottom + 4);
  });

  it("keeps the menu on screen when the trigger sits near the left edge", () => {
    // The bug: the settings gear in a 200px sidebar, right-aligned, put the
    // menu's left edge at roughly -40px — and an overflow-hidden ancestor
    // clipped it rather than letting it hang over the content.
    const a = anchor(200 - 16 - 28, 60);
    const { left } = anchoredMenuPosition(
      a,
      MENU_W,
      MENU_H,
      DESKTOP_W,
      DESKTOP_H,
    );
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + MENU_W).toBeLessThanOrEqual(DESKTOP_W - 16);
  });

  it("clamps a trigger at the right edge back inside the viewport", () => {
    const { left } = anchoredMenuPosition(
      anchor(DESKTOP_W - 10, 60),
      MENU_W,
      MENU_H,
      DESKTOP_W,
      DESKTOP_H,
    );
    expect(left + MENU_W).toBeLessThanOrEqual(DESKTOP_W - 16);
  });

  it("survives a viewport narrower than the menu", () => {
    const { left } = anchoredMenuPosition(
      anchor(20, 60),
      MENU_W,
      MENU_H,
      PHONE_W,
      PHONE_H,
    );
    expect(left).toBeGreaterThanOrEqual(16);
  });

  it("flips above the trigger when there is no room below", () => {
    const a = anchor(1200, DESKTOP_H - 40);
    const { top } = anchoredMenuPosition(
      a,
      MENU_W,
      MENU_H,
      DESKTOP_W,
      DESKTOP_H,
    );
    expect(top).toBeLessThan(a.top);
    expect(top).toBeGreaterThanOrEqual(16);
  });

  it("stays below when it fits, even if above is roomier", () => {
    // Otherwise a menu near the middle of a tall page jumps sides as it grows.
    const a = anchor(1200, 600);
    const { top } = anchoredMenuPosition(a, MENU_W, 100, DESKTOP_W, DESKTOP_H);
    expect(top).toBe(a.bottom + 4);
  });

  it("reports a maxHeight so a too-tall menu scrolls instead of overflowing", () => {
    const a = anchor(1200, 100);
    const { top, maxHeight } = anchoredMenuPosition(
      a,
      MENU_W,
      5000,
      DESKTOP_W,
      DESKTOP_H,
    );
    expect(maxHeight).toBeGreaterThan(0);
    expect(top + maxHeight).toBeLessThanOrEqual(DESKTOP_H - 16);
  });
});
