import { describe, expect, it, vi } from "vitest";
import {
  FRAME_MS,
  clampMs,
  frameIndex,
  frameStart,
  readEffect,
  seekAll,
  stepFrame,
  timelineEnd,
} from "./planningMotionTimeline";

/** An animation as far as the timeline reads one. */
function fake(
  duration: number,
  keyframes: Keyframe[] = [{ height: "0px" }, { height: "9px" }],
) {
  const animation = {
    playState: "running" as AnimationPlayState,
    currentTime: 0 as CSSNumberish | null,
    pause: vi.fn(() => {
      animation.playState = "paused";
    }),
    finish: vi.fn(() => {
      animation.playState = "finished";
    }),
    effect: {
      target: null,
      getComputedTiming: () => ({ endTime: duration, duration }),
      getKeyframes: () =>
        keyframes.map((k, i) => ({
          ...k,
          computedOffset: k.offset ?? i / (keyframes.length - 1),
        })),
    },
  };
  return animation as unknown as Animation & typeof animation;
}

describe("the 60 fps clock", () => {
  it("steps by one frame and clamps to the timeline", () => {
    expect(FRAME_MS).toBeCloseTo(16.6667, 4);
    expect(stepFrame(0, 1, 1600)).toBeCloseTo(FRAME_MS);
    expect(stepFrame(FRAME_MS * 3, 1, 1600)).toBeCloseTo(FRAME_MS * 4);
    expect(stepFrame(FRAME_MS * 3, -1, 1600)).toBeCloseTo(FRAME_MS * 2);
    expect(stepFrame(0, -1, 1600)).toBe(0);
    expect(stepFrame(1600, 1, 1600)).toBe(1600);
  });

  it("steps from between frames to the next boundary, and to the end as the last frame", () => {
    expect(stepFrame(128, 1, 1600)).toBeCloseTo(8 * FRAME_MS);
    expect(stepFrame(128, -1, 1600)).toBeCloseTo(7 * FRAME_MS);
    expect(stepFrame(1595, 1, 1600)).toBe(1600);
    expect(stepFrame(1600, -1, 1600)).toBeCloseTo(95 * FRAME_MS);
  });

  it("names the frame a time falls in", () => {
    expect(frameIndex(0)).toBe(0);
    expect(frameIndex(128)).toBe(7);
    expect(frameIndex(1600)).toBe(96);
    expect(frameStart(7, 1600)).toBeCloseTo(116.667, 2);
    expect(frameStart(500, 1600)).toBe(1600);
    expect(clampMs(-5, 320)).toBe(0);
    expect(clampMs(900, 320)).toBe(320);
  });
});

describe("seekAll", () => {
  it("holds an animation still inside its time at the time asked", () => {
    const a = fake(320);
    seekAll([a], 128);
    expect(a.pause).toHaveBeenCalled();
    expect(a.currentTime).toBe(128);
    expect(a.finish).not.toHaveBeenCalled();
  });

  it("finishes, rather than pauses, one that has run its course, once", () => {
    const a = fake(320);
    seekAll([a], 320);
    seekAll([a], 900);
    expect(a.finish).toHaveBeenCalledTimes(1);
    expect(a.pause).not.toHaveBeenCalled();
  });

  it("moves each animation by its own duration", () => {
    const short = fake(320);
    const long = fake(1600);
    seekAll([short, long], 500);
    expect(short.playState).toBe("finished");
    expect(long.currentTime).toBe(500);
    expect(timelineEnd([short, long])).toBe(1600);
    expect(timelineEnd([])).toBe(0);
  });
});

describe("readEffect", () => {
  it("reads the keyframe pair and the state from the effect itself", () => {
    const a = fake(1600, [
      { boxShadow: "none", offset: 0 },
      { boxShadow: "x", offset: 0.08 },
      { boxShadow: "none", offset: 1 },
    ]);
    expect(readEffect(a, 0)).toMatchObject({
      properties: ["boxShadow"],
      state: "running",
      segment: "0.00 → 0.08",
    });
    expect(readEffect(a, 128).segment).toBe("0.08 → 1.00");
    expect(readEffect(a, 1600)).toMatchObject({
      state: "finished",
      progress: 1,
    });
  });
});
