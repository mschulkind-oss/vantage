/**
 * Which part of the planning page the outline marks as the reader scrolls:
 * the arithmetic, apart from the measuring, which jsdom cannot do.
 */
import { describe, expect, it } from "vitest";
import { activeTarget, type OutlineTarget } from "./usePlanningOutlineActive";

const heading = (section: OutlineTarget["section"]): OutlineTarget => ({
  section,
  path: null,
  id: section,
});
const row = (section: OutlineTarget["section"], path: string) => ({
  section,
  path,
  id: `${section}:${path}`,
});

const NEEDS_YOU = heading("needs-you");
const DESIGN = row("needs-you", "design.md");
const READY = heading("ready");
const SHIPPED = row("ready", "shipped.md");

describe("activeTarget", () => {
  it("is nothing when nothing is on screen", () => {
    expect(activeTarget([])).toBeNull();
  });

  it("is the first target while the reader is above them all", () => {
    expect(
      activeTarget([
        { target: NEEDS_YOU, top: 200 },
        { target: DESIGN, top: 400 },
      ]),
    ).toBe(NEEDS_YOU);
  });

  it("is the last target at or above the band", () => {
    const offsets = [
      { target: NEEDS_YOU, top: -600 },
      { target: DESIGN, top: 40 },
      { target: READY, top: 300 },
    ];
    expect(activeTarget(offsets)).toBe(DESIGN);
  });

  it("is the last target on screen once the page is scrolled to its end", () => {
    const offsets = [
      { target: NEEDS_YOU, top: -600 },
      { target: DESIGN, top: 40 },
      { target: READY, top: 500 },
      { target: SHIPPED, top: 560 },
    ];
    // A pane 700px tall: the last section never reaches the band.
    expect(activeTarget(offsets, 700)).toBe(SHIPPED);
    expect(activeTarget(offsets, 520)).toBe(READY);
  });
});
