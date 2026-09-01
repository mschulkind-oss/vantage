import { describe, it, expect } from "vitest";
import {
  anchoredMenuPosition,
  popoverPosition,
  fitsToTheRight,
  sideAnchoredPosition,
} from "./popoverPosition";

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

describe("sideAnchoredPosition", () => {
  const CARD_W = 320;
  const CARD_H = 180;
  const side = (
    a: { left: number; right: number; top: number },
    vw = DESKTOP_W,
  ) => sideAnchoredPosition(a, CARD_W, CARD_H, vw, DESKTOP_H);

  it("sits to the right of the anchor when there is room", () => {
    const { left, flipped } = side({ left: 100, right: 260, top: 200 });
    expect(flipped).toBe(false);
    expect(left).toBe(268);
  });

  it("flips to the left when the right would overflow", () => {
    const { left, flipped } = side({
      left: DESKTOP_W - 200,
      right: DESKTOP_W - 40,
      top: 200,
    });
    expect(flipped).toBe(true);
    expect(left + CARD_W).toBeLessThanOrEqual(DESKTOP_W - 8);
  });

  it("clamps the flip instead of pushing the card off the left edge", () => {
    // The bug: an anchor near the left edge on a narrow viewport flipped to
    // left - 320 - 8, which is negative, so the fix for one edge broke the other.
    const { left } = side({ left: 200, right: 360, top: 200 }, 380);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it("keeps a tall card inside the bottom of the viewport", () => {
    const { top } = side({ left: 100, right: 260, top: DESKTOP_H - 20 });
    expect(top + CARD_H).toBeLessThanOrEqual(DESKTOP_H - 8);
  });

  it("never returns a negative top for an anchor above the viewport", () => {
    const { top } = side({ left: 100, right: 260, top: -50 });
    expect(top).toBeGreaterThanOrEqual(8);
  });
});

describe("fitsToTheRight", () => {
  it("is true with room to spare", () => {
    expect(fitsToTheRight(1000, 220, DESKTOP_W)).toBe(true);
  });

  it("is false when the card would cross the right gutter", () => {
    // The review stripe's case: the track sits at the pane's right edge, so
    // its tooltip's default side is the one that runs off screen.
    expect(fitsToTheRight(DESKTOP_W - 100, 220, DESKTOP_W)).toBe(false);
  });

  it("counts the gutter, not just the viewport edge", () => {
    // Exactly flush with the edge still fails: the 8px margin is the point.
    expect(fitsToTheRight(DESKTOP_W - 228, 220, DESKTOP_W)).toBe(false);
    expect(fitsToTheRight(DESKTOP_W - 236, 220, DESKTOP_W)).toBe(true);
  });
});
