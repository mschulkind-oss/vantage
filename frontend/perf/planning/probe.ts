/**
 * The probe: what the harness installs in every page before any of the app's
 * scripts run, and the clocks the scale targets of
 * `docs/reference/planning-index.md` §18 are read from. It changes nothing the
 * app does; it watches the DOM, the performance timeline and one console line.
 *
 * Every time here is on the page's own clock (`performance.now()`), and a
 * "painted" time is taken the way the earlier runs took it: an element present
 * in an animation-frame callback is drawn in that frame, and the time is read
 * in a task queued from that callback, which runs once the frame's rendering
 * is done.
 *
 * `installProbe` is handed to `addInitScript`, which serializes it, so it may
 * use nothing from this module's scope but types.
 */

/**
 * The store's one line per page session, `[planning] index ready in %d ms: %d
 * planning documents of %d candidates` (`usePlanningStore`'s `finish`): the
 * index's first build, from its first need to the index being set ready.
 */
export interface IndexReady {
  /** When the line was logged, which is when the index was set ready. */
  at: number;
  /** From the first need (the first build sent) to ready, as logged. */
  ms: number;
  documents: number;
  candidates: number;
}

export interface LongTask {
  start: number;
  duration: number;
}

/** One script of a long animation frame: what ran, and from where. */
export interface FrameScript {
  invoker: string;
  invokerType: string;
  source: string;
  fn: string;
  start: number;
  duration: number;
  forcedLayout: number;
}

/** A long animation frame (50 ms or more), with its scripts. */
export interface LongFrame {
  start: number;
  duration: number;
  blocking: number;
  scripts: FrameScript[];
}

export interface Shift {
  start: number;
  value: number;
  input: boolean;
}

export interface ProbeState {
  /** The last `p` keydown's `timeStamp`: the moment `g p` is measured from. */
  key: number | null;
  /** Ms after `key` that the section bar painted: the frame, index ready. */
  frame: number | null;
  /** Ms after `key` that the progress line painted: the frame while building. */
  progress: number | null;
  /** Ms after `key` that the first section's entries painted. */
  cards: number | null;
  /** When a document's header and content first painted in this session. */
  documentPainted: number | null;
  index: IndexReady | null;
  longTasks: LongTask[];
  frames: LongFrame[];
  shifts: Shift[];
}

declare global {
  interface Window {
    __planningPerf?: ProbeState;
  }
}

export function installProbe(): void {
  // The Long Animation Frames and Layout Instability entries, which the DOM
  // library this compiles against does not declare.
  interface ScriptTiming extends PerformanceEntry {
    invoker: string;
    invokerType: string;
    sourceURL: string;
    sourceFunctionName: string;
    forcedStyleAndLayoutDuration: number;
  }
  interface FrameTiming extends PerformanceEntry {
    blockingDuration: number;
    scripts: ScriptTiming[];
  }
  interface ShiftEntry extends PerformanceEntry {
    value: number;
    hadRecentInput: boolean;
  }

  const state: ProbeState = {
    key: null,
    frame: null,
    progress: null,
    cards: null,
    documentPainted: null,
    index: null,
    longTasks: [],
    frames: [],
    shifts: [],
  };
  window.__planningPerf = state;
  // The hold reads every request a load makes; the default buffer is 250.
  performance.setResourceTimingBufferSize(10_000);

  const info = console.info;
  console.info = function (this: Console, ...args: unknown[]) {
    const line = args[0];
    if (
      state.index === null &&
      typeof line === "string" &&
      line.startsWith("[planning] index ready")
    ) {
      state.index = {
        at: performance.now(),
        ms: Number(args[1]),
        documents: Number(args[2]),
        candidates: Number(args[3]),
      };
    }
    return info.apply(this, args);
  };

  const has = (selector: string) => document.querySelector(selector) !== null;
  // The planning page (`PlanningPage.tsx`): the section bar, the progress
  // line that stands in its place while the index builds, and the sections.
  const SECTION_BAR = '[data-content-scroll] main nav[aria-label="Sections"]';
  const PROGRESS_LINE = '[data-content-scroll] main p[role="status"]';
  const firstSectionFilled = () => {
    const first = document.querySelector("[data-planning-sections] section");
    return (
      first !== null &&
      first.querySelector(
        "article[data-planning-question], [data-planning-document], li",
      ) !== null
    );
  };

  let watching = 0;
  const watch = (token: number, key: number) => {
    requestAnimationFrame(() => {
      if (token !== watching) return;
      const frame = state.frame === null && has(SECTION_BAR);
      const progress = state.progress === null && has(PROGRESS_LINE);
      const cards = state.cards === null && firstSectionFilled();
      if (frame || progress || cards) {
        setTimeout(() => {
          if (token !== watching) return;
          const at = performance.now() - key;
          if (frame) state.frame ??= at;
          if (progress) state.progress ??= at;
          if (cards) state.cards ??= at;
        }, 0);
      }
      // The section bar paints with or before the sections, so a frame that
      // shows the first section's entries has shown everything watched for.
      if (!cards && state.cards === null && performance.now() - key < 30_000) {
        watch(token, key);
      }
    });
  };
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "p") return;
      state.key = event.timeStamp;
      state.frame = null;
      state.progress = null;
      state.cards = null;
      watching += 1;
      watch(watching, event.timeStamp);
    },
    { capture: true },
  );

  // A document's first paint: its header and its rendered Markdown. While the
  // hold holds a first load, the app's shell is up instead, without either.
  const watchDocument = () => {
    requestAnimationFrame(() => {
      if (
        has('[data-testid="viewer-header"]') &&
        has("[data-content-scroll] .prose > *")
      ) {
        setTimeout(() => {
          state.documentPainted ??= performance.now();
        }, 0);
        return;
      }
      if (performance.now() < 60_000) watchDocument();
    });
  };
  watchDocument();

  const observe = (
    type: string,
    take: (entries: PerformanceEntryList) => void,
  ) => {
    try {
      new PerformanceObserver((list) => take(list.getEntries())).observe({
        type,
        buffered: true,
      });
    } catch {
      // An entry type this browser does not report: nothing is recorded.
    }
  };
  observe("longtask", (entries) => {
    for (const entry of entries) {
      state.longTasks.push({
        start: entry.startTime,
        duration: entry.duration,
      });
    }
  });
  observe("long-animation-frame", (entries) => {
    for (const entry of entries as FrameTiming[]) {
      state.frames.push({
        start: entry.startTime,
        duration: entry.duration,
        blocking: entry.blockingDuration,
        scripts: entry.scripts.map((script) => ({
          invoker: script.invoker,
          invokerType: script.invokerType,
          source: script.sourceURL,
          fn: script.sourceFunctionName,
          start: script.startTime,
          duration: script.duration,
          forcedLayout: script.forcedStyleAndLayoutDuration,
        })),
      });
    }
  });
  observe("layout-shift", (entries) => {
    for (const entry of entries as ShiftEntry[]) {
      state.shifts.push({
        start: entry.startTime,
        value: entry.value,
        input: entry.hadRecentInput,
      });
    }
  });
}
