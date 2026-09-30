/**
 * `afterNextPaint` (`docs/design/planning-index-at-scale.md` §10.1): work that
 * must not take the main thread from a frame waits for the frame's animation
 * frame, and then for a task queued from there, which runs once it has
 * painted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterNextPaint } from "./afterPaint";

describe("afterNextPaint", () => {
  let frame: FrameRequestCallback | null;
  let cancelled: number[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    frame = null;
    cancelled = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frame = cb;
      return 7;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      cancelled.push(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs in a task after the next animation frame, not in the frame itself", () => {
    const then = vi.fn();
    afterNextPaint(then);
    vi.runAllTimers();
    expect(then).not.toHaveBeenCalled();
    frame?.(0);
    // The frame's callbacks run before its paint: not yet.
    expect(then).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("runs in the next task in a tab that is not shown, which paints nothing", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const then = vi.fn();
    afterNextPaint(then);
    expect(frame).toBeNull();
    vi.runAllTimers();
    expect(then).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    afterNextPaint(cancelled)();
    vi.runAllTimers();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("runs nothing once cancelled, before the frame or after it", () => {
    const early = vi.fn();
    afterNextPaint(early)();
    expect(cancelled).toEqual([7]);

    const late = vi.fn();
    const cancel = afterNextPaint(late);
    frame?.(0);
    cancel();
    vi.runAllTimers();
    expect(early).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
  });
});
