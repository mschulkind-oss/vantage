/**
 * The planning motion inspector (`/.vantage/planning-motion`): what happens on
 * the planning page when the reader answers a card, shown a frame at a time.
 *
 * The cards are the page's own `PlanningQuestionCard` and `AnsweredRow`, cut
 * from questions the shared scanner read, and the swap is the page's: the card
 * becomes its row, and the next question joins the end. Their effects are not
 * copied. They are the `Animation` objects the components made as they
 * mounted, taken off the stage in the same layout effect, before the first
 * paint, and held with `pause()` and `currentTime` when stepping. Playback
 * runs those same effects normally. It reads nothing and writes nothing
 * outside the page: the stage is
 * `inert`, every callback is a no-op, and no review is filed. A dropdown can
 * add five experimental text handoffs over the unchanged production collapse;
 * those effects are preview-only and run on the same captured native clock.
 *
 * The frames are a *simulation* at 60 fps: a virtual clock stepped by 1/60 s
 * and applied to the real effects. They are not a recording of the GPU's
 * output, and a browser may paint what the effect says a little differently.
 * Frame zero is the original question; the effects begin one frame later.
 * Playback uses the browser's native animation clock, not per-frame seeks.
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
import {
  PlanningAnswerPreview,
  answerPreviewOf,
  answerPreviews,
  PRODUCTION_ANSWER_MOTION,
  ANSWER_HANDOFF_MS,
  type AnswerPreview,
} from "../lib/planningAnswerMotion";
import { copyCardForCollapse } from "../lib/copyCardForCollapse";
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

/** Links open paused; the old `?t=before` link still opens frame zero. */
const linkFor = (ms: number, preview: AnswerPreview | null) =>
  `?${preview === null ? "" : `effect=${preview}&`}t=${Math.round(ms * 1000) / 1000}`;

export default function PlanningMotionPage() {
  const fixture = useMemo(() => motionFixture(), []);
  const [params] = useSearchParams();
  const supported =
    typeof Element.prototype.animate === "function" &&
    typeof Element.prototype.getAnimations === "function";
  const asked = params.get("t");
  const [textPreview, setTextPreview] = useState(() =>
    answerPreviewOf(params.get("effect")),
  );
  const [swap, setSwap] = useState<{
    key: number;
    from: number;
    paintedCard: HTMLElement | null;
  } | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playRun, setPlayRun] = useState(0);
  const [effects, setEffects] = useState<EffectReadout[]>([]);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [end, setEnd] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingSwap = useRef<MutationObserver | null>(null);
  const pendingTime = useRef(0);
  const opened = useRef(false);
  const animations = useRef<Animation[]>([]);
  const wanted = useRef(0);
  const timeRef = useRef(0);
  const endRef = useRef(0);
  const swapRef = useRef<typeof swap>(null);
  const playingRef = useRef(false);
  const keyRef = useRef(0);
  const measuring = useRef(0);
  useEffect(
    () => () => {
      cancelAnimationFrame(measuring.current);
      if (pendingSwap.current !== null) {
        pendingSwap.current.disconnect();
        pendingSwap.current = null;
        // StrictMode rehearses cleanup before a cold card has rendered.
        opened.current = false;
      }
      animations.current.forEach((animation) => {
        if (animation.playState === "running") animation.pause();
      });
    },
    [],
  );

  useLayoutEffect(() => {
    stageRef.current?.setAttribute("inert", "");
  }, []);

  const heightOfCard = useCallback(
    (): number =>
      stageRef.current
        ?.querySelector<HTMLElement>('[data-motion-slot="answered"] > *')
        ?.getBoundingClientRect().height ?? 0,
    [],
  );

  const publish = useCallback((ms: number) => {
    timeRef.current = ms;
    setTime(ms);
    setEffects(animations.current.map((a) => readEffect(a, ms - FRAME_MS)));
    // Do not cancel the measurement every playback tick: that used to keep
    // postponing it forever. Paused seeks replace any outstanding reading.
    if (playingRef.current && measuring.current !== 0) return;
    cancelAnimationFrame(measuring.current);
    measuring.current = requestAnimationFrame(() => {
      measuring.current = requestAnimationFrame(() => {
        measuring.current = 0;
        const stage = stageRef.current;
        if (stage !== null) setMeasured(measure(stage));
      });
    });
  }, []);

  const clearAnimations = useCallback(() => {
    pendingSwap.current?.disconnect();
    pendingSwap.current = null;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
  }, []);

  const reset = useCallback(
    (ms = 0) => {
      clearAnimations();
      swapRef.current = null;
      setSwap(null);
      setMeasured(null);
      publish(ms);
    },
    [clearAnimations, publish],
  );

  /** Frame zero is the question; frame one begins the production effects. */
  const mountSwap = useCallback(
    function mountAt(ms: number, from: number) {
      const stage = stageRef.current;
      if (
        swapRef.current === null &&
        stage !== null &&
        !stage.querySelector(
          '[data-motion-slot="answered"] > article [data-planning-card-headline]',
        )
      ) {
        // The fixture's real Markdown card renders asynchronously. Capturing
        // its loading shell would lose the production title motion on cold
        // links or an immediate Play. Queue the latest request until painted.
        pendingTime.current = ms;
        if (pendingSwap.current !== null) return;
        const observer = new MutationObserver(() => {
          if (pendingSwap.current !== observer) return;
          if (
            !stage.querySelector(
              '[data-motion-slot="answered"] > article [data-planning-card-headline]',
            )
          )
            return;
          observer.disconnect();
          pendingSwap.current = null;
          mountAt(pendingTime.current, heightOfCard());
        });
        pendingSwap.current = observer;
        observer.observe(stage, { childList: true, subtree: true });
        return;
      }
      const paintedCard =
        swapRef.current?.paintedCard ??
        copyCardForCollapse(
          stageRef.current?.querySelector<HTMLElement>(
            '[data-motion-slot="answered"] > article',
          ) ?? null,
        );
      clearAnimations();
      wanted.current = ms;
      const next = { key: ++keyRef.current, from, paintedCard };
      swapRef.current = next;
      setSwap(next);
    },
    [clearAnimations, heightOfCard],
  );

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (swap === null || stage === null) return;
    animations.current = productionAnimations(stage);
    const last = FRAME_MS + timelineEnd(animations.current);
    endRef.current = last;
    setEnd(last);
    const ms = clampMs(wanted.current, last);
    seekAll(animations.current, ms - FRAME_MS);
    publish(ms);
    if (playingRef.current) {
      animations.current.forEach((a) => {
        if (a.playState !== "finished") a.play();
      });
    }
  }, [swap, publish]);

  /** Every manual seek pauses; backward seeks rebuild the real effects. */
  const seek = useCallback(
    (ms: number) => {
      playingRef.current = false;
      setPlaying(false);
      if (ms < FRAME_MS) {
        reset(Math.max(0, ms));
        return;
      }
      const current = swapRef.current;
      if (current === null) {
        mountSwap(ms, heightOfCard());
        return;
      }
      const to = clampMs(ms, endRef.current);
      if (to < timeRef.current) mountSwap(to, current.from);
      else {
        seekAll(animations.current, to - FRAME_MS);
        publish(to);
      }
    },
    [mountSwap, publish, reset, heightOfCard],
  );

  const start = () => {
    reset();
    playingRef.current = true;
    setPlaying(true);
    // Restart even when another run is already playing.
    setPlayRun((run) => run + 1);
  };

  // Native playback, not repeatedly pausing/seeking each animation on every
  // paint. The stage stays mounted while only the readout follows its clock.
  useEffect(() => {
    if (!playing) return;
    animations.current.forEach((a) => {
      if (a.playState !== "finished") a.play();
    });
    let frame = 0;
    let origin: number | null = null;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      if (swapRef.current === null) {
        origin ??= now;
        if (now - origin >= FRAME_MS) mountSwap(FRAME_MS, heightOfCard());
      } else if (animations.current.length > 0) {
        const elapsed = Math.max(
          ...animations.current.map((a) => Number(a.currentTime ?? 0)),
        );
        const to = clampMs(FRAME_MS + elapsed, endRef.current);
        publish(to);
        if (to >= endRef.current) {
          playingRef.current = false;
          setPlaying(false);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      animations.current.forEach((a) => {
        if (a.playState === "running") a.pause();
      });
    };
  }, [playing, playRun, mountSwap, publish, heightOfCard]);

  useEffect(() => {
    if (opened.current || !supported) return;
    opened.current = true;
    if (asked === null || asked === "before") return;
    const ms = Number(asked);
    if (Number.isFinite(ms)) seek(ms);
  }, [asked, supported, seek]);

  const frame = frameIndex(time);
  const lastFrame = frameIndex(end);
  const swapped = swap !== null;

  // Clock updates must not render/reparse the production cards each frame.
  const stage = useMemo(() => {
    const card = (slot: string, item: MotionQuestion) => (
      <div data-motion-slot={slot}>
        <PlanningQuestionCard
          question={item.question}
          card={item.card}
          badge={null}
          comments={[]}
          lifecycle="Open"
          href={`/${item.question.path}`}
          onFile={noopAsync}
          cardKey={slot}
        />
      </div>
    );
    return (
      <ForcedMotion.Provider value={true}>
        <PlanningAnswerPreview.Provider value={textPreview}>
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
                  cardBeforeShrink={swap.paintedCard}
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
        </PlanningAnswerPreview.Provider>
      </ForcedMotion.Provider>
    );
  }, [fixture, swap, textPreview]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-lg font-semibold">Planning answer animation</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Play the whole answer animation as often as you like, or pause and
          step through it at 60 frames per second. The cards and roll-up are the
          planning page&apos;s real components. The menu includes the production
          title glide and four read-only alternatives. Sample cards are
          display-only; no reviews are changed.
        </p>
        {!supported && (
          <p
            role="alert"
            className="mt-3 rounded border-2 border-red-700 p-2 text-sm"
          >
            This browser cannot show the animation because it does not support
            the Web Animations API. Open this page in a current version of
            Chrome, Firefox, or Safari to play and step through it.
          </p>
        )}
        {reducedMotion() && (
          <p data-testid="motion-reduced-note" className="mt-2 text-sm">
            Your device asks for less motion. This player stays paused until you
            press Play from start; your preference still applies elsewhere.
          </p>
        )}
        <div
          role="group"
          aria-label="Player controls"
          className="sticky top-0 z-10 mt-4 space-y-2 rounded border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <label className="flex flex-wrap items-center gap-2">
            Text handoff
            <select
              className="min-w-0 max-w-full rounded border bg-white px-2 py-1 dark:bg-slate-800"
              value={textPreview ?? PRODUCTION_ANSWER_MOTION}
              onChange={(event) => {
                seek(0);
                setTextPreview(answerPreviewOf(event.target.value));
              }}
            >
              {answerPreviews.map((preview) => (
                <option key={preview.value} value={preview.value}>
                  {preview.label}
                </option>
              ))}
            </select>
          </label>
          <p className="min-h-10 text-xs text-slate-600 dark:text-slate-300">
            {
              answerPreviews.find(
                (preview) =>
                  preview.value === (textPreview ?? PRODUCTION_ANSWER_MOTION),
              )?.description
            }{" "}
            Choose an effect, then press Play from start. Changing the effect
            pauses and returns to frame 0.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1.5 disabled:opacity-40"
              disabled={!supported}
              onClick={start}
            >
              Play from start
            </button>
            {(playing || (swapped && time < end)) && (
              <button
                type="button"
                className="rounded border px-2 py-1 disabled:opacity-40"
                disabled={!supported}
                onClick={() => {
                  if (playing) {
                    const elapsed =
                      animations.current.length === 0
                        ? null
                        : Math.max(
                            ...animations.current.map((a) =>
                              Number(a.currentTime ?? 0),
                            ),
                          );
                    seek(
                      elapsed === null ? timeRef.current : FRAME_MS + elapsed,
                    );
                  } else {
                    playingRef.current = true;
                    setPlaying(true);
                    setPlayRun((run) => run + 1);
                  }
                }}
              >
                {playing ? "Pause" : "Resume"}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-40"
              disabled={!supported}
              onClick={() => seek(0)}
            >
              First frame
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-40"
              disabled={!supported || frame === 0}
              onClick={() => seek(stepFrame(time, -1, end || Infinity))}
            >
              Previous frame
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-40"
              disabled={!supported || (end > 0 && time >= end)}
              onClick={() => seek(stepFrame(time, 1, end || Infinity))}
            >
              Next frame
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-40"
              disabled={!supported}
              onClick={() => seek(Infinity)}
            >
              Last frame
            </button>
          </div>
          <p data-testid="motion-readout" className="tabular-nums">
            {`Frame ${frame}${end > 0 ? ` of ${lastFrame}` : ""} · ${time.toFixed(2)} ms · ${playing ? "playing" : "paused"}`}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Frame 0 shows the question before answering. Next frame begins the
            transition. Stepping always pauses playback.
          </p>
          <details>
            <summary className="cursor-pointer">Exact timing</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                Time
                <input
                  type="range"
                  aria-label="Time in milliseconds"
                  min={0}
                  max={end || ANSWER_HANDOFF_MS + FRAME_MS}
                  step={FRAME_MS}
                  value={time}
                  disabled={!supported}
                  onChange={(e) => seek(Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="number"
                  aria-label="Time (ms)"
                  className="w-24 rounded border px-1 tabular-nums dark:bg-slate-900"
                  min={0}
                  max={end || ANSWER_HANDOFF_MS + FRAME_MS}
                  step="any"
                  disabled={!supported}
                  value={Number(time.toFixed(3))}
                  onChange={(e) => {
                    const ms = Number(e.target.value);
                    if (Number.isFinite(ms)) seek(ms);
                  }}
                />{" "}
                ms
              </label>
            </div>
            <p className="mt-2 text-xs">
              Link to this frame:{" "}
              <a className="underline" href={linkFor(time, textPreview)}>
                {linkFor(time, textPreview)}
              </a>
            </p>
            <p className="text-xs">
              Frames are {FRAME_MS.toFixed(3)} ms apart; this frame starts at{" "}
              {frameStart(frame, end || Infinity).toFixed(3)} ms. The original
              card occupies the first frame; effect time starts on the next.
            </p>
          </details>
        </div>
        {stage}

        {swapped && effects.length === 0 && (
          <p
            role="alert"
            className="mt-3 text-sm text-red-700 dark:text-red-300"
          >
            The browser did not expose the animation. Press First frame, then
            Play from start to retry, or open this page in a current Chrome,
            Firefox, or Safari.
          </p>
        )}
        {swapped && (
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer">Animation details</summary>
            <section aria-label="Effects">
              <h2 className="mt-2 font-semibold">
                Captured effects: {effects.length}
              </h2>
              <ul className="mt-1 space-y-1">
                {effects.map((e, i) => (
                  <li
                    key={i}
                    data-testid="motion-effect"
                    className="tabular-nums"
                  >
                    {e.target} · {e.properties.join(", ")} · {e.durationMs} ms ·{" "}
                    {e.state === "running" ? "active at this time" : e.state} ·{" "}
                    {(e.progress * 100).toFixed(1)}% · keyframes {e.segment}
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
          </details>
        )}
      </div>
    </div>
  );
}
