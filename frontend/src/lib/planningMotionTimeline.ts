/**
 * The time arithmetic and the animation handling of the planning motion
 * inspector (`pages/PlanningMotionPage.tsx`): which of the page's animations
 * are the production effects of an answer, where a virtual 60 fps frame falls
 * on them, and what each is doing there. Nothing here knows what an effect
 * looks like: the keyframes, durations and easings are read back from the
 * `Animation` objects `AnsweredRow` and `PlanningQuestionCard` made.
 */

/** One frame of the 60 fps clock the inspector steps by, in milliseconds. */
export const FRAME_MS = 1000 / 60;

/** `ms` held to the timeline `0..end`. */
export const clampMs = (ms: number, end: number): number =>
  Math.min(Math.max(ms, 0), end);

/** The index of the last frame boundary at or before `ms`. */
export const frameIndex = (ms: number): number =>
  Math.floor(ms / FRAME_MS + 1e-9);

/** Where frame `index` falls, held to the timeline. */
export const frameStart = (index: number, end: number): number =>
  clampMs(index * FRAME_MS, end);

/**
 * The time one frame after (`direction` 1) or before (-1) `ms`: the next
 * frame boundary, and the timeline's end as the last frame when it falls
 * between boundaries.
 */
export function stepFrame(ms: number, direction: 1 | -1, end: number): number {
  const at = ms / FRAME_MS;
  const boundary = Math.abs(at - Math.round(at)) < 1e-9;
  const index = boundary
    ? Math.round(at) + direction
    : direction > 0
      ? Math.ceil(at)
      : Math.floor(at);
  return frameStart(index, end);
}

/** The animations of `stage` that production code made: not CSS ones. */
export function productionAnimations(stage: Element): Animation[] {
  return stage.getAnimations({ subtree: true }).filter((a) => {
    const css =
      (typeof CSSAnimation !== "undefined" && a instanceof CSSAnimation) ||
      (typeof CSSTransition !== "undefined" && a instanceof CSSTransition);
    return !css;
  });
}

/**
 * Hold every animation at `ms`, as the clock reads it. One that has run its
 * course by then is *finished*, not paused past its end: a paused animation
 * never reaches the `finish` event, and the components clear what the effect
 * was holding up (the arriving card's clip) in that event, so only finishing
 * leaves the page as it would be at that time. Animations only move forward;
 * going back is a fresh set (`PlanningMotionPage`).
 */
export function seekAll(animations: readonly Animation[], ms: number): void {
  for (const animation of animations) {
    const duration = Number(animation.effect?.getComputedTiming().endTime ?? 0);
    if (ms >= duration) {
      if (animation.playState !== "finished") animation.finish();
    } else {
      animation.pause();
      animation.currentTime = ms;
    }
  }
}

/** The end of the timeline: the longest of the animations' end times. */
export function timelineEnd(animations: readonly Animation[]): number {
  return animations.reduce(
    (end, a) =>
      Math.max(end, Number(a.effect?.getComputedTiming().endTime ?? 0)),
    0,
  );
}

/** What one animation is, and what it is doing at `ms`. */
export interface EffectReadout {
  /** The element it runs on, as `tag#id` or the closest named ancestor. */
  target: string;
  /** The CSS properties its keyframes set. */
  properties: string[];
  durationMs: number;
  /** `before`, `running` or `finished`: a finished effect is no longer applied. */
  state: "before" | "running" | "finished";
  /** The share of the effect elapsed, 0..1, before easing. */
  progress: number;
  /** The keyframe pair it is between, as their offsets. */
  segment: string;
}

/** Read `animation` at `ms` on the timeline. */
export function readEffect(animation: Animation, ms: number): EffectReadout {
  const effect = animation.effect as KeyframeEffect;
  const timing = effect.getComputedTiming();
  const duration = Number(timing.duration ?? 0);
  const keyframes = effect.getKeyframes();
  const properties = [
    ...new Set(
      keyframes.flatMap((k) =>
        Object.keys(k).filter(
          (key) =>
            !["offset", "easing", "composite", "computedOffset"].includes(key),
        ),
      ),
    ),
  ];
  const progress = duration === 0 ? 1 : Math.min(Math.max(ms / duration, 0), 1);
  const offsets = keyframes.map((k) => Number(k.computedOffset));
  let at = 0;
  while (at < offsets.length - 2 && progress >= offsets[at + 1]) at++;
  const element = effect.target;
  const named = element?.closest("[id], [data-planning-item]") ?? element;
  return {
    target: `${element?.tagName.toLowerCase() ?? "?"}${
      named !== null && named !== undefined && named !== element
        ? ` in ${named.getAttribute("data-planning-item") ?? named.id}`
        : ""
    }`,
    properties,
    durationMs: duration,
    state: ms < 0 ? "before" : ms >= duration ? "finished" : "running",
    progress,
    segment:
      offsets.length < 2
        ? "-"
        : `${offsets[at].toFixed(2)} → ${offsets[at + 1].toFixed(2)}`,
  };
}
