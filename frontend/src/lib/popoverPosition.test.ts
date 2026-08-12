import { describe, it, expect } from "vitest";
import { popoverPosition } from "./popoverPosition";

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
