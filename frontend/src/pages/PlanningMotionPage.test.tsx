import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PlanningMotionPage from "./PlanningMotionPage";

vi.mock("axios");

/** The Web Animations API as far as the components and the inspector use it. */
class FakeAnimation {
  playState: AnimationPlayState = "running";
  currentTime: number | null = 0;
  onfinish: (() => void) | null = null;
  effect: unknown;
  constructor(
    readonly target: Element,
    keyframes: Keyframe[],
    readonly duration: number,
  ) {
    this.effect = {
      target,
      getComputedTiming: () => ({ endTime: duration, duration }),
      getKeyframes: () =>
        keyframes.map((k, i) => ({
          ...k,
          computedOffset: k.offset ?? i / (keyframes.length - 1),
        })),
    };
  }
  pause() {
    this.playState = "paused";
  }
  finish() {
    this.playState = "finished";
    this.currentTime = this.duration;
    this.onfinish?.();
  }
}

let made: FakeAnimation[] = [];
const proto = Element.prototype as unknown as Record<string, unknown>;
let reduce = false;

beforeEach(() => {
  made = [];
  reduce = false;
  proto.animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: { duration: number },
  ) {
    const a = new FakeAnimation(this, keyframes, options.duration);
    made.push(a);
    return a;
  };
  proto.getAnimations = function (this: Element) {
    return made.filter(
      (a) => this.contains(a.target) && a.playState !== "finished",
    );
  };
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  delete proto.animate;
  delete proto.getAnimations;
});

function open(url = "/.vantage/planning-motion", strict = false) {
  const view = (
    <MemoryRouter initialEntries={[url]}>
      <PlanningMotionPage />
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{view}</StrictMode> : view);
}
const press = (name: string) =>
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
const readout = () => screen.getByTestId("motion-readout").textContent;
const stage = () => screen.getByTestId("motion-stage");
const live = () => made.filter((a) => a.playState !== "finished");

describe("PlanningMotionPage", () => {
  it("opens before the swap, with the real cards and nothing playing", () => {
    open();
    expect(readout()).toMatch(/Before the swap/);
    expect(made).toEqual([]);
    expect(
      stage().querySelectorAll("article[data-planning-item]"),
    ).toHaveLength(3);
    expect(stage().querySelector("[data-planning-row]")).toBeNull();
    expect(stage().hasAttribute("inert")).toBe(true);
  });

  it("swaps the answered card for the page's own row and a growing card, held at 0 ms", () => {
    open();
    press("0 ms");
    expect(stage().querySelector("[data-planning-row]")).not.toBeNull();
    expect(readout()).toMatch(/Frame 0 of 96 · 0\.00 ms of 1600 ms · held/);
    // The row's shrink and tint, and the arriving card's grow: made by the
    // components, not by the page.
    expect(made.map((a) => a.duration).sort((x, y) => x - y)).toEqual([
      320, 320, 1600,
    ]);
    expect(live().every((a) => a.playState === "paused")).toBe(true);
    expect(made.every((a) => a.currentTime === 0)).toBe(true);
    expect(screen.getAllByTestId("motion-effect")).toHaveLength(3);
  });

  it("holds exactly the three production effects through StrictMode setup replay and reverse seeking", () => {
    open("/.vantage/planning-motion", true);
    press("128 ms");
    expect(made).toHaveLength(3);
    expect(live().every((a) => a.playState === "paused")).toBe(true);
    press("1600 ms");
    const first = [...made];
    press("128 ms");
    const fresh = made.filter((a) => !first.includes(a));
    expect(fresh).toHaveLength(3);
    expect(
      fresh.every((a) => a.playState === "paused" && a.currentTime === 128),
    ).toBe(true);
    expect(
      stage().querySelector<HTMLElement>(
        '[data-motion-slot="arriving"] article',
      )?.style.height,
    ).toBe("0px");
  });

  it("also holds only three effects when StrictMode opens directly at a paused frame", () => {
    open("/.vantage/planning-motion?t=128", true);
    expect(made).toHaveLength(3);
    expect(live().every((a) => a.playState === "paused")).toBe(true);
  });

  it("holds each effect at the time asked and finishes the ones it has passed", () => {
    open();
    press("128 ms");
    expect(made.map((a) => a.currentTime)).toEqual([128, 128, 128]);
    press("320 ms");
    const [height, tint] = [
      made.find((a) => a.duration === 320)!,
      made.find((a) => a.duration === 1600)!,
    ];
    expect(height.playState).toBe("finished");
    expect(tint.currentTime).toBe(320);
    expect(readout()).toMatch(/Frame 19 of 96/);
    press("1600 ms");
    expect(made.every((a) => a.playState === "finished")).toBe(true);
    expect(readout()).toMatch(/Frame 96 of 96 · 1600\.00 ms/);
  });

  it("steps one 60 fps frame at a time, both ways, and to the first and last", () => {
    open();
    press("0 ms");
    press("Next frame");
    expect(readout()).toMatch(/Frame 1 of 96 · 16\.67 ms/);
    press("Next frame");
    press("Previous frame");
    expect(readout()).toMatch(/Frame 1 of 96/);
    press("Last frame");
    expect(readout()).toMatch(/Frame 96 of 96 · 1600\.00 ms/);
    press("First frame");
    expect(readout()).toMatch(/Frame 0 of 96 · 0\.00 ms/);
  });

  it("goes back to fresh effects, so an intermediate frame is restored after the effects finished", () => {
    open();
    press("1600 ms");
    const firstSet = [...made];
    expect(firstSet.every((a) => a.playState === "finished")).toBe(true);
    press("128 ms");
    const fresh = made.filter((a) => !firstSet.includes(a));
    expect(fresh).toHaveLength(3);
    expect(fresh.map((a) => a.currentTime)).toEqual([128, 128, 128]);
    expect(fresh.every((a) => a.playState === "paused")).toBe(true);
    // The arriving card is clipped again, as at that time on the page.
    const arriving = stage().querySelector<HTMLElement>(
      '[data-motion-slot="arriving"] article',
    );
    expect(arriving?.style.height).toBe("0px");
  });

  it("clamps the numeric time to the timeline", () => {
    open();
    press("0 ms");
    fireEvent.change(screen.getByLabelText("Time (ms)"), {
      target: { value: "9000" },
    });
    expect(readout()).toMatch(/1600\.00 ms of 1600/);
    fireEvent.change(screen.getByLabelText("Time (ms)"), {
      target: { value: "-4" },
    });
    expect(readout()).toMatch(/Frame 0 of 96 · 0\.00 ms/);
  });

  it("opens paused at the time a link names, and before the swap for 'before'", () => {
    open("/.vantage/planning-motion?t=128");
    expect(readout()).toMatch(/Frame 7 of 96 · 128\.00 ms/);
    expect(made.every((a) => a.playState === "paused")).toBe(true);
    cleanup();
    made = [];
    open("/.vantage/planning-motion?t=before");
    expect(readout()).toMatch(/Before the swap/);
    expect(made).toEqual([]);
  });

  it("returns to the cards before the swap", () => {
    open();
    press("128 ms");
    press("Before the swap");
    expect(stage().querySelector("[data-planning-row]")).toBeNull();
    expect(readout()).toMatch(/Before the swap/);
  });

  it("plays only when asked, forward from where it is held", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      frames.push(cb),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    open();
    press("128 ms");
    const before = frames.length;
    press("Play");
    expect(readout()).toMatch(/playing/);
    expect(frames.length).toBeGreaterThan(before);
    act(() => frames.at(-1)!(1000));
    act(() => frames.at(-1)!(1100));
    expect(readout()).toMatch(/228\.00 ms/);
    act(() => frames.at(-1)!(5000));
    expect(readout()).toMatch(/1600\.00 ms of 1600 ms · held/);
    vi.unstubAllGlobals();
  });

  it("files nothing and touches no network", async () => {
    const axios = (await import("axios")).default;
    open();
    press("320 ms");
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });

  it("explains reduced motion: the real path has no height effects, and the override restores them", () => {
    reduce = true;
    open();
    expect(screen.getByTestId("motion-reduced-note")).toHaveTextContent(
      /real path for you/,
    );
    press("0 ms");
    // Only the tint: no shrink, no grow.
    expect(made.map((a) => a.duration)).toEqual([1600]);
    fireEvent.click(
      screen.getByLabelText("Preview full motion on this page only"),
    );
    expect(screen.getByTestId("motion-reduced-note")).toHaveTextContent(
      /not\.?$/,
    );
    made = [];
    press("0 ms");
    expect(made.map((a) => a.duration).sort((x, y) => x - y)).toEqual([
      320, 320, 1600,
    ]);
  });

  it("says why when the browser cannot animate, and shows no frame", () => {
    delete proto.animate;
    delete proto.getAnimations;
    open();
    expect(screen.getByRole("alert")).toHaveTextContent(/Web Animations API/);
    expect(screen.getByRole("button", { name: "0 ms" })).toBeDisabled();
    expect(readout()).toMatch(/Before the swap/);
  });
});
