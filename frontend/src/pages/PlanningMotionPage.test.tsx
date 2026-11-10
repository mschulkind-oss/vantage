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
import { FRAME_MS } from "../lib/planningMotionTimeline";
import { answerPreviews } from "../lib/planningAnswerPreview";

vi.mock("axios");

let clock = 0;
/** The real components' Web Animations API, including its native play clock. */
class FakeAnimation {
  playState: AnimationPlayState = "running";
  onfinish: (() => void) | null = null;
  effect: unknown;
  pauseCount = 0;
  private held = 0;
  private started = clock;
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
  get currentTime() {
    const time =
      this.held + (this.playState === "running" ? clock - this.started : 0);
    if (this.playState === "running" && time >= this.duration) this.finish();
    return this.playState === "finished" ? this.duration : time;
  }
  set currentTime(time: number) {
    this.held = time;
    this.started = clock;
  }
  pause() {
    this.held = this.currentTime;
    this.playState = "paused";
    this.pauseCount++;
  }
  play() {
    this.started = clock;
    this.playState = "running";
  }
  cancel() {
    this.playState = "idle";
    this.held = 0;
  }
  finish() {
    this.playState = "finished";
    this.held = this.duration;
    this.onfinish?.();
  }
}

let made: FakeAnimation[] = [];
const proto = Element.prototype as unknown as Record<string, unknown>;
let reduce = false;
beforeEach(() => {
  made = [];
  clock = 0;
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
      (a) =>
        this.contains(a.target) && !["finished", "idle"].includes(a.playState),
    );
  };
  vi.stubGlobal("matchMedia", ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia);
});
afterEach(() => {
  cleanup();
  delete proto.animate;
  delete proto.getAnimations;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  act(() => fireEvent.click(screen.getByRole("button", { name })));
const readout = () => screen.getByTestId("motion-readout").textContent;
const stage = () => screen.getByTestId("motion-stage");
const live = () =>
  made.filter(
    (a) =>
      stage().contains(a.target) && !["finished", "idle"].includes(a.playState),
  );
const seekTime = (ms: number) =>
  fireEvent.change(screen.getByLabelText("Time (ms)"), {
    target: { value: String(ms) },
  });
const seekEffect = (ms: number) => seekTime(ms + FRAME_MS);

function playbackClock() {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  return (now: number) =>
    act(() => {
      clock = now;
      const due = [...frames.values()];
      frames.clear();
      due.forEach((cb) => cb(now));
    });
}

describe("PlanningMotionPage", () => {
  it("opens on frame zero with real cards, no playback, and no separate mode", () => {
    open();
    expect(readout()).toMatch(/Frame 0 · 0\.00 ms · paused/);
    expect(made).toEqual([]);
    expect(
      stage().querySelectorAll("article[data-planning-item]"),
    ).toHaveLength(3);
    expect(stage().querySelector("[data-planning-row]")).toBeNull();
    expect(stage().hasAttribute("inert")).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Before the swap" }),
    ).toBeNull();
    expect(
      screen.queryByLabelText("Preview full motion on this page only"),
    ).toBeNull();
  });

  it("offers five experimental handoffs plus the unchanged production baseline", () => {
    open();
    const select = screen.getByRole("combobox", { name: "Text handoff" });
    expect(select).toHaveValue("current");
    expect(screen.getAllByRole("option")).toHaveLength(6);
    expect(
      screen.getByRole("option", { name: "Title glide" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/experimental.*not used on the planning page/i),
    ).toBeInTheDocument();
  });

  it.each([
    "crossfade-roll",
    "crossfade-after",
    "slide-up",
    "title-glide",
    "shrink-dissolve",
  ])(
    "plays, finishes, and reverse-seeks the %s preview using the real card and row",
    (effect) => {
      open();
      fireEvent.change(screen.getByRole("combobox", { name: "Text handoff" }), {
        target: { value: effect },
      });
      expect(readout()).toMatch(/Frame 0.*paused/);
      press("Next frame");
      expect(live().length).toBeGreaterThan(3);
      expect(live().every((a) => a.playState === "paused")).toBe(true);
      expect(
        stage().querySelector("[data-planning-departing-card]"),
      ).not.toBeNull();
      const compact = stage().querySelector<HTMLElement>(
        "[data-planning-row-content]",
      )!;
      expect(compact).not.toHaveStyle({ visibility: "hidden" });
      expect(made.some((a) => a.target === compact)).toBe(true);
      press("Last frame");
      expect(
        stage().querySelector("[data-planning-departing-card]"),
      ).toBeNull();
      seekEffect(128);
      expect(
        stage().querySelector("[data-planning-departing-card]"),
      ).not.toBeNull();
      expect(live().every((a) => a.playState === "paused")).toBe(true);
    },
  );

  it("changing the handoff during playback pauses and resets to the original question", () => {
    const tick = playbackClock();
    open();
    press("Play from start");
    tick(0);
    tick(20);
    tick(120);
    const old = [...made];
    fireEvent.change(screen.getByRole("combobox", { name: "Text handoff" }), {
      target: { value: "crossfade-after" },
    });
    expect(readout()).toMatch(/Frame 0.*paused/);
    expect(stage().querySelector("[data-planning-row]")).toBeNull();
    expect(old.every((a) => a.playState === "idle")).toBe(true);
    tick(1000);
    expect(readout()).toMatch(/Frame 0.*paused/);
    press("Next frame");
    seekEffect(320);
    expect(
      stage().querySelector("[data-planning-departing-card]"),
    ).not.toBeNull();
    seekEffect(500);
    expect(stage().querySelector("[data-planning-departing-card]")).toBeNull();
  });

  it("links retain the chosen preview and open paused, with invalid effects falling back to production", () => {
    open("/.vantage/planning-motion?effect=slide-up&t=128");
    expect(screen.getByRole("combobox", { name: "Text handoff" })).toHaveValue(
      "slide-up",
    );
    expect(readout()).toMatch(/128.00 ms.*paused/);
    expect(
      screen.getByRole("link", { name: "?effect=slide-up&t=128" }),
    ).toHaveAttribute("href", "?effect=slide-up&t=128");
    cleanup();
    open("/.vantage/planning-motion?effect=not-real");
    expect(screen.getByRole("combobox", { name: "Text handoff" })).toHaveValue(
      "current",
    );
    press("Next frame");
    expect(live()).toHaveLength(3);
  });

  it("starts stepping immediately; first always returns to the initial question", () => {
    open();
    expect(screen.getByRole("button", { name: "Next frame" })).toBeEnabled();
    press("Next frame");
    expect(readout()).toMatch(/Frame 1 of 97 · 16\.67 ms · paused/);
    expect(stage().querySelector("[data-planning-row]")).not.toBeNull();
    expect(made.map((a) => a.duration).sort((a, b) => a - b)).toEqual([
      320, 320, 1600,
    ]);
    expect(
      live().every((a) => a.playState === "paused" && a.currentTime === 0),
    ).toBe(true);
    expect(screen.getAllByTestId("motion-effect")).toHaveLength(3);
    press("First frame");
    expect(readout()).toMatch(/Frame 0 of 97 · 0\.00 ms · paused/);
    expect(stage().querySelector("[data-planning-row]")).toBeNull();
    expect(live()).toEqual([]);
    press("First frame");
    press("Next frame");
    expect(readout()).toMatch(/Frame 1 of 97/);
  });

  it("keeps the original question text through the collapse and reveals the compact row at its end", () => {
    open();
    const answered = () =>
      stage().querySelector<HTMLElement>('[data-motion-slot="answered"]')!;
    const originalText = answered().querySelector(
      ".planning-card-body",
    )?.textContent;
    expect(originalText).toBeTruthy();
    press("Next frame");
    const copy = answered().querySelector<HTMLElement>(
      "[data-planning-departing-card]",
    );
    expect(copy).not.toBeNull();
    expect(copy!.querySelector(".planning-card-body")?.textContent).toBe(
      originalText,
    );
    expect(copy).toHaveAttribute("inert");
    expect(copy).toHaveAttribute("aria-hidden", "true");
    const compact = answered().querySelector<HTMLElement>(
      "[data-planning-row-content]",
    );
    expect(compact).not.toBeNull();
    expect(compact).toHaveStyle({ visibility: "hidden" });
    seekEffect(300);
    expect(
      answered().querySelector("[data-planning-departing-card]"),
    ).not.toBeNull();
    seekEffect(320);
    expect(
      answered().querySelector("[data-planning-departing-card]"),
    ).toBeNull();
    expect(compact).not.toHaveStyle({ visibility: "hidden" });
    press("First frame");
    press("Next frame");
    expect(
      answered().querySelector("[data-planning-departing-card]"),
    ).not.toBeNull();
  });

  it("holds exactly three real effects through StrictMode replay and reverse seeking", () => {
    open("/.vantage/planning-motion", true);
    seekEffect(128);
    expect(made).toHaveLength(3);
    expect(live().every((a) => a.playState === "paused")).toBe(true);
    press("Last frame");
    const first = [...made];
    seekEffect(128);
    const fresh = made.filter((a) => !first.includes(a));
    expect(fresh).toHaveLength(3);
    expect(fresh.every((a) => a.playState === "paused")).toBe(true);
    fresh.forEach((a) => expect(a.currentTime).toBeCloseTo(128));
    expect(
      stage().querySelector<HTMLElement>(
        '[data-motion-slot="arriving"] article',
      )?.style.height,
    ).toBe("0px");
  });

  it("holds only three effects when StrictMode opens directly at a paused time", () => {
    open("/.vantage/planning-motion?t=128", true);
    expect(made).toHaveLength(3);
    expect(live().every((a) => a.playState === "paused")).toBe(true);
    expect(readout()).toMatch(/Frame 7 of 97 · 128\.00 ms/);
  });

  it("finishes each effect at its own end, including the production finish callbacks", () => {
    open();
    seekEffect(128);
    made.forEach((a) => expect(a.currentTime).toBeCloseTo(128));
    seekEffect(320);
    expect(
      made
        .filter((a) => a.duration === 320)
        .every((a) => a.playState === "finished"),
    ).toBe(true);
    expect(made.find((a) => a.duration === 1600)?.currentTime).toBeCloseTo(320);
    press("Last frame");
    expect(made.every((a) => a.playState === "finished")).toBe(true);
    expect(readout()).toMatch(/Frame 97 of 97 · 1616\.67 ms · paused/);
  });

  it("previous always changes the displayed frame after an exact-time seek", () => {
    open("/.vantage/planning-motion?t=128");
    expect(readout()).toMatch(/Frame 7 /);
    press("Previous frame");
    expect(readout()).toMatch(/Frame 6 of 97 · 100\.00 ms/);
    press("Next frame");
    expect(readout()).toMatch(/Frame 7 /);
    press("First frame");
    expect(
      screen.getByRole("button", { name: "Previous frame" }),
    ).toBeDisabled();
    press("Last frame");
    expect(screen.getByRole("button", { name: "Next frame" })).toBeDisabled();
    press("Previous frame");
    expect(readout()).toMatch(/Frame 96 /);
  });

  it("can go directly from the initial question to the last frame", () => {
    open();
    press("Last frame");
    expect(readout()).toMatch(/Frame 97 of 97/);
    press("First frame");
    expect(readout()).toMatch(/Frame 0 of 97/);
  });

  it("clamps exact times and preserves old initial-view links", () => {
    open();
    seekTime(9000);
    expect(readout()).toMatch(/1616\.67 ms/);
    seekTime(-4);
    expect(readout()).toMatch(/Frame 0 of 97 · 0\.00 ms/);
    cleanup();
    made = [];
    open("/.vantage/planning-motion?t=before");
    expect(readout()).toMatch(/Frame 0/);
    expect(made).toEqual([]);
  });

  it("plays natively without pausing and seeking the effects every screen frame", () => {
    const tick = playbackClock();
    open();
    press("Play from start");
    tick(1000);
    tick(1017);
    expect(readout()).toMatch(/playing/);
    expect(live().every((a) => a.playState === "running")).toBe(true);
    const pauses = made.map((a) => a.pauseCount);
    tick(1117);
    expect(readout()).toMatch(/116\.67 ms · playing/);
    tick(1217);
    expect(made.map((a) => a.pauseCount)).toEqual(pauses);
    tick(3017);
    expect(readout()).toMatch(/Frame 97 of 97 · 1616\.67 ms · paused/);
  });

  it("a forward frame step pauses playback and cannot be overwritten by a pending tick", () => {
    const tick = playbackClock();
    open();
    press("Play from start");
    tick(1000);
    tick(1017);
    tick(1117);
    press("Next frame");
    expect(readout()).toMatch(/Frame 8 of 97 · 133\.33 ms · paused/);
    const held = readout();
    tick(2000);
    expect(readout()).toBe(held);
    expect(live().every((a) => a.playState === "paused")).toBe(true);
  });

  it("restarts while playing and after finishing, with a fresh clock every time", () => {
    const tick = playbackClock();
    open();
    press("Play from start");
    tick(1000);
    tick(1017);
    tick(1117);
    const first = [...made];
    press("Play from start");
    expect(first.every((a) => a.playState === "idle")).toBe(true);
    tick(2000);
    expect(readout()).toMatch(/Frame 0 of 97 · 0\.00 ms · playing/);
    tick(2017);
    tick(2117);
    expect(readout()).toMatch(/116\.67 ms · playing/);
    tick(5000);
    expect(readout()).toMatch(/paused/);
    press("Play from start");
    tick(6000);
    tick(6017);
    tick(6117);
    expect(readout()).toMatch(/116\.67 ms · playing/);
  });

  it("pause/resume retains the position, and first frame pauses an active run", () => {
    const tick = playbackClock();
    open();
    press("Play from start");
    tick(1000);
    tick(1017);
    tick(1117);
    press("Pause");
    const held = readout();
    tick(2000);
    expect(readout()).toBe(held);
    press("Resume");
    tick(2100);
    expect(readout()).toMatch(/216\.67 ms · playing/);
    press("First frame");
    tick(3000);
    expect(readout()).toMatch(/Frame 0 of 97 · 0\.00 ms · paused/);
    expect(stage().querySelector("[data-planning-row]")).toBeNull();
  });

  it("full preview is explicitly played, even with reduced motion, without changing that preference", () => {
    reduce = true;
    const tick = playbackClock();
    open();
    expect(screen.getByTestId("motion-reduced-note")).toHaveTextContent(
      /stays paused/,
    );
    expect(made).toEqual([]);
    press("Play from start");
    tick(1000);
    tick(1017);
    expect(made.map((a) => a.duration).sort((a, b) => a - b)).toEqual([
      320, 320, 1600,
    ]);
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(
      true,
    );
  });

  it("files nothing and touches no network", async () => {
    const axios = (await import("axios")).default;
    open();
    seekEffect(320);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });

  it.each(answerPreviews)(
    "$label falls back safely if native animation support disappears",
    ({ value }) => {
      open();
      fireEvent.change(screen.getByRole("combobox", { name: "Text handoff" }), {
        target: { value },
      });
      delete proto.animate;
      expect(() => press("Next frame")).not.toThrow();
      expect(
        stage().querySelector("[data-planning-departing-card]"),
      ).toBeNull();
      expect(
        screen
          .getAllByRole("alert")
          .some((a) => a.textContent?.includes("Chrome, Firefox, or Safari")),
      ).toBe(true);
    },
  );

  it("unsupported browsers get an actionable explanation and disabled controls", () => {
    delete proto.animate;
    delete proto.getAnimations;
    open();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Chrome, Firefox, or Safari/,
    );
    for (const name of [
      "Play from start",
      "First frame",
      "Previous frame",
      "Next frame",
      "Last frame",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(readout()).toMatch(/Frame 0/);
  });
});
