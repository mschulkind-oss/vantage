/**
 * The planning motion inspector (`/.vantage/planning-motion`): what happens on
 * the planning page when the reader answers a card, shown a frame at a time.
 *
 * The cards are the page's own `PlanningQuestionCard` and `AnsweredRow`, cut
 * from questions the shared scanner read, and the swap is the page's: the card
 * becomes its row, and the next question joins the end. Their effects are not
 * copied. They are the `Animation` objects the components made as they
 * mounted, taken off the stage in the same layout effect, before the first
 * paint, and held with `pause()` and `currentTime`. The inspector only seeks
 * them. It reads nothing and writes nothing outside the page: the stage is
 * `inert`, every callback is a no-op, and no review is filed.
 *
 * The frames are a *simulation* at 60 fps: a virtual clock stepped by 1/60 s
 * and applied to the real effects. They are not a recording of the GPU's
 * output, and a browser may paint what the effect says a little differently.
 * Seeking backwards mounts the swapped items again, so the effects start from
 * the state they started from rather than from the one they finished in.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { AnsweredRow } from "../components/PlanningNeedsYou";
import { PlanningQuestionCard } from "../components/PlanningQuestionCard";
import { OQ_DEFAULT_LEANING } from "../hooks/useOpenQuestionButtons";
import { ForcedMotion } from "../lib/forcedMotion";
import { rowAnswers } from "../lib/planningLayout";
import {
  motionFixture,
  type MotionQuestion,
} from "../lib/planningMotionFixture";
import {
  FRAME_MS,
  clampMs,
  frameIndex,
  frameStart,
  productionAnimations,
  readEffect,
  seekAll,
  stepFrame,
  timelineEnd,
  type EffectReadout,
} from "../lib/planningMotionTimeline";
import { reducedMotion } from "../lib/reducedMotion";
import type { ReviewComment } from "../types";

/** The preset times the page offers, in milliseconds. */
const PRESETS = [0, 128, 320, 1600] as const;

const FIXTURE_ANSWER: ReviewComment = {
  id: "motion-fixture-answer",
  comment: "Per profile, narrowed before it crosses.",
  created_at: 0,
  reactions: [],
  fallback_text: "",
};

const noop = () => {};
const noopAsync = async () => {};

/** What is measured on the stage at one time. */
interface Measured {
  rowHeight: number | null;
  rowShadow: string | null;
  arrivalHeight: number | null;
  belowTop: number | null;
  arrivalTop: number | null;
}

const px = (n: number | null) => (n === null ? "-" : `${n.toFixed(2)} px`);

function measure(stage: HTMLElement): Measured {
  const at = (key: string) =>
    stage.querySelector<HTMLElement>(`[data-motion-slot="${key}"] > *`);
  const row = at("answered");
  const arrival = at("arriving");
  const below = at("below");
  const top = stage.getBoundingClientRect().top;
  return {
    rowHeight: row?.matches("[data-planning-row]")
      ? row.getBoundingClientRect().height
      : null,
    rowShadow: row?.matches("[data-planning-row]")
      ? getComputedStyle(row).boxShadow
      : null,
    arrivalHeight: arrival?.getBoundingClientRect().height ?? null,
    belowTop: below === null ? null : below.getBoundingClientRect().top - top,
    arrivalTop:
      arrival === null ? null : arrival.getBoundingClientRect().top - top,
  };
}

/** The deep link for a time: it opens paused at that frame. */
const linkFor = (ms: number | "before") =>
  `?t=${ms === "before" ? "before" : String(Math.round(ms * 1000) / 1000)}`;

export default function PlanningMotionPage() {
  const fixture = useMemo(() => motionFixture(), []);
  const [params] = useSearchParams();
  const supported =
    typeof Element.prototype.animate === "function" &&
    typeof Element.prototype.getAnimations === "function";
  const asked = params.get("t");
  const [forced, setForced] = useState(false);
  // Before the swap, or the swap with its key and the time it is held at.
  const [swap, setSwap] = useState<{
    key: number;
    from: number;
  } | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [effects, setEffects] = useState<EffectReadout[]>([]);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [end, setEnd] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const animations = useRef<Animation[]>([]);
  const wanted = useRef(0);
  const timeRef = useRef(0);
  const keyRef = useRef(0);
  const measuring = useRef(0);
  useEffect(() => () => cancelAnimationFrame(measuring.current), []);

  // The stage is inert: nothing in it takes a press, a focus or a keystroke.
  useLayoutEffect(() => {
    stageRef.current?.setAttribute("inert", "");
  }, []);

  const heightOfCard = (): number =>
    stageRef.current
      ?.querySelector<HTMLElement>('[data-motion-slot="answered"] > *')
      ?.getBoundingClientRect().height ?? 0;

  /** Swap the answered card for its row, held at `ms` as it mounts. */
  const mountSwap = useCallback((ms: number, from: number) => {
    wanted.current = ms;
    setPlaying(false);
    setSwap({ key: ++keyRef.current, from });
  }, []);

  const publish = useCallback((ms: number) => {
    timeRef.current = ms;
    setTime(ms);
    setEffects(animations.current.map((a) => readEffect(a, ms)));
    // Measured after the page has caught up with the seek: the components
    // clear their own state in the effects' `finish` event, which comes with
    // the next frame, and a layout effect measures before React re-renders.
    cancelAnimationFrame(measuring.current);
    measuring.current = requestAnimationFrame(() => {
      measuring.current = requestAnimationFrame(() => {
        const stage = stageRef.current;
        if (stage !== null) setMeasured(measure(stage));
      });
    });
  }, []);

  // The production effects of the swap that just mounted: running and not yet
  // painted, so they are held at the time wanted before anyone sees a frame.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (swap === null || stage === null) {
      animations.current = [];
      return;
    }
    animations.current = productionAnimations(stage);
    const last = timelineEnd(animations.current);
    setEnd(last);
    const ms = clampMs(wanted.current, last);
    seekAll(animations.current, ms);
    publish(ms);
  }, [swap, publish]);

  /** Hold the effects at `ms`: forward on the same ones, back on fresh ones. */
  const seek = useCallback(
    (ms: number) => {
      if (swap === null) return;
      const to = clampMs(ms, end);
      if (to < timeRef.current) {
        mountSwap(to, swap.from);
        return;
      }
      seekAll(animations.current, to);
      publish(to);
    },
    [swap, end, mountSwap, publish],
  );

  // Play: the virtual clock advances with the screen's, and each tick seeks
  // the effects to it. Forward only.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let origin: number | null = null;
    const base = timeRef.current;
    const tick = (now: number) => {
      origin ??= now;
      const to = clampMs(base + (now - origin), end);
      seekAll(animations.current, to);
      publish(to);
      if (to >= end) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, end, publish]);

  // A deep link opens swapped and paused at its time, with nothing playing.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !supported) return;
    opened.current = true;
    if (asked === null || asked === "before") return;
    const ms = Number(asked);
    // The card it replaces has to be on screen to be measured first.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(ms)) mountSwap(ms, heightOfCard());
  }, [asked, supported, mountSwap]);

  const frame = frameIndex(time);
  const lastFrame = frameIndex(end);
  const swapped = swap !== null;

  const card = (slot: string, item: MotionQuestion, growing = false) => (
    <div data-motion-slot={slot}>
      <PlanningQuestionCard
        question={item.question}
        card={item.card}
        badge={null}
        comments={[]}
        lifecycle="Open"
        href={`/${item.question.path}`}
        onFile={noopAsync}
        cardKey={`${slot}`}
        growing={growing}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-lg font-semibold">Planning motion inspector</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          The page&apos;s own cards and answered row, answered at a moment you
          choose. The frames are a simulation at 60 fps: the effects the
          components made, held at the time shown, not a recording of the
          screen. Nothing here plays until you press Play, and nothing is saved.
        </p>
        {!supported && (
          <p
            role="alert"
            className="mt-3 rounded border-2 border-red-700 bg-white p-2 text-sm text-slate-800 dark:border-red-400 dark:bg-slate-800 dark:text-slate-100"
          >
            This browser does not support the Web Animations API (
            <code>Element.animate</code> and <code>getAnimations</code>), which
            the answer&apos;s motion is made with. No frame can be shown.
          </p>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={forced}
            onChange={(e) => {
              setForced(e.target.checked);
              setSwap(null);
              setPlaying(false);
            }}
          />
          Preview full motion on this page only
        </label>
        {reducedMotion() && (
          <p
            data-testid="motion-reduced-note"
            className="mt-1 text-sm text-slate-700 dark:text-slate-200"
          >
            {forced
              ? "Your system asks for less motion; this page is playing the full motion anyway. The planning page is not."
              : "Your system asks for less motion, so this is the real path for you: the row appears at its final height at once and the arriving card is not grown, and only the green tint animates."}
          </p>
        )}

        <div
          role="group"
          aria-label="Inspector controls"
          className="sticky top-0 z-10 mt-4 space-y-2 rounded border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={!supported}
              onClick={() => {
                setSwap(null);
                setPlaying(false);
                animations.current = [];
              }}
            >
              Before the swap
            </button>
            {PRESETS.map((ms) => (
              <button
                key={ms}
                type="button"
                className="rounded border px-2 py-1 tabular-nums"
                disabled={!supported}
                onClick={() =>
                  swapped ? seek(ms) : mountSwap(ms, heightOfCard())
                }
              >
                {ms} ms
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={!swapped}
              onClick={() => seek(0)}
            >
              First frame
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={!swapped}
              onClick={() => seek(stepFrame(time, -1, end))}
            >
              Previous frame
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={!swapped}
              onClick={() => seek(stepFrame(time, 1, end))}
            >
              Next frame
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={!swapped}
              onClick={() => seek(end)}
            >
              Last frame
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={!swapped || time >= end}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={!supported}
              onClick={() => {
                if (swapped) {
                  mountSwap(0, swap.from);
                } else mountSwap(0, heightOfCard());
                setPlaying(true);
              }}
            >
              Replay
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              Time
              <input
                type="range"
                aria-label="Time in milliseconds"
                min={0}
                max={end || 1600}
                step={FRAME_MS}
                value={time}
                disabled={!swapped}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-1">
              <input
                type="number"
                aria-label="Time (ms)"
                className="w-24 rounded border px-1 tabular-nums dark:bg-slate-900"
                min={0}
                max={end || 1600}
                step="any"
                disabled={!swapped}
                value={Number(time.toFixed(3))}
                onChange={(e) => {
                  const ms = Number(e.target.value);
                  if (Number.isFinite(ms)) seek(ms);
                }}
              />
              ms
            </label>
          </div>
          <p data-testid="motion-readout" className="tabular-nums">
            {swapped
              ? `Frame ${frame} of ${lastFrame} · ${time.toFixed(2)} ms of ${end} ms · ${playing ? "playing" : "held"}`
              : "Before the swap: the cards as the reader sees them before answering."}
          </p>
          {swapped && (
            <p className="text-xs">
              Link to this frame:{" "}
              <a className="underline" href={linkFor(time)}>
                {linkFor(time)}
              </a>{" "}
              · before the swap:{" "}
              <a className="underline" href={linkFor("before")}>
                {linkFor("before")}
              </a>
            </p>
          )}
          {swapped && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Frame times fall at {FRAME_MS.toFixed(3)} ms steps;{" "}
              {frameStart(frame, end).toFixed(3)} ms is this frame&apos;s start.
            </p>
          )}
        </div>

        <ForcedMotion.Provider value={forced}>
          <div
            ref={stageRef}
            data-testid="motion-stage"
            className="mt-4 space-y-3"
          >
            {card("above", fixture.above)}
            <div data-motion-slot="answered">
              {swap === null ? (
                <PlanningQuestionCard
                  question={fixture.answered.question}
                  card={fixture.answered.card}
                  badge={null}
                  comments={[]}
                  lifecycle="Open"
                  href={`/${fixture.answered.question.path}`}
                  onFile={noopAsync}
                  cardKey="answered"
                />
              ) : (
                <AnsweredRow
                  key={swap.key}
                  question={fixture.answered.question}
                  itemKey="answered"
                  href={`/${fixture.answered.question.path}`}
                  answers={rowAnswers([FIXTURE_ANSWER], OQ_DEFAULT_LEANING)}
                  marks={[]}
                  newReply={false}
                  opening={false}
                  onShow={noop}
                  onNewReply={noop}
                  shrinkFrom={swap.from}
                />
              )}
            </div>
            {card("below", fixture.below)}
            {swap !== null && (
              <div data-motion-slot="arriving" key={swap.key}>
                <PlanningQuestionCard
                  question={fixture.arriving.question}
                  card={fixture.arriving.card}
                  badge={null}
                  comments={[]}
                  lifecycle="Open"
                  href={`/${fixture.arriving.question.path}`}
                  onFile={noopAsync}
                  cardKey="arriving"
                  growing
                />
              </div>
            )}
          </div>
        </ForcedMotion.Provider>

        {swapped && (
          <section className="mt-6 text-sm" aria-label="Effects">
            <h2 className="font-semibold">
              Production effects captured: {effects.length}
            </h2>
            {effects.length === 0 && (
              <p role="alert" className="text-red-700 dark:text-red-300">
                No animation was made by the components for this swap, so no
                effect is shown. (Nothing is faked in its place.)
              </p>
            )}
            <ul className="mt-1 space-y-1">
              {effects.map((e, i) => (
                <li
                  key={i}
                  data-testid="motion-effect"
                  className="tabular-nums"
                >
                  {e.target} · {e.properties.join(", ")} · {e.durationMs} ms ·{" "}
                  {e.state} · {(e.progress * 100).toFixed(1)}% · keyframes{" "}
                  {e.segment}
                  {e.keyframeValues.map((value) => (
                    <div
                      key={value}
                      className="break-words font-mono text-[11px]"
                    >
                      {value}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
            {measured !== null && (
              <dl
                data-testid="motion-measured"
                className="mt-3 grid grid-cols-2 gap-x-4 tabular-nums"
              >
                <dt>Answered row height</dt>
                <dd>{px(measured.rowHeight)}</dd>
                <dt>Answered row box-shadow</dt>
                <dd className="break-all">{measured.rowShadow ?? "-"}</dd>
                <dt>Neighbour below, top</dt>
                <dd>{px(measured.belowTop)}</dd>
                <dt>Arriving card height</dt>
                <dd>{px(measured.arrivalHeight)}</dd>
                <dt>Arriving card, top</dt>
                <dd>{px(measured.arrivalTop)}</dd>
              </dl>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
