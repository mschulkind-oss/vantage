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

/** A keydown, wherever it went: its key and its `timeStamp`. */
export interface KeyDown {
  key: string;
  at: number;
}

/**
 * One Event Timing entry (T1): an event the page handled, from its
 * `timeStamp` to the next paint after its handlers, rounded to 8 ms. The
 * browser reports none under 16 ms, the lowest threshold it takes.
 */
export interface EventTiming {
  name: string;
  start: number;
  duration: number;
  processingStart: number;
  processingEnd: number;
  /** Shared by the events of one key press; 0 for an event of none. */
  interactionId: number;
}

/** A change to the Filter box's text: when, the text, and its paint. */
export interface BoxInput {
  /** The `input` event's `timeStamp`. */
  at: number;
  /** When the page's main thread got to the event. */
  handled: number;
  text: string;
  /** When the frame after it, which draws the text, painted. */
  painted: number | null;
}

/**
 * The filter the sections' box is laid out under (`data-planning-filter`,
 * the shown layout's canonical text) changed: when the change was committed
 * to the DOM, and when a frame painted it. `painted` stays `null` when a later
 * change came before any frame did, so this one was never drawn.
 */
export interface ShownFilter {
  filter: string;
  committed: number;
  painted: number | null;
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
  /** Every keydown of the page session. */
  keys: KeyDown[];
  /** Every change to the Filter box's text. */
  inputs: BoxInput[];
  /** Every Event Timing entry of 16 ms or more. */
  events: EventTiming[];
  /** Every change of the filter the sections are laid out under. */
  shown: ShownFilter[];
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
  interface EventEntry extends PerformanceEntry {
    processingStart: number;
    processingEnd: number;
    interactionId: number;
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
    keys: [],
    inputs: [],
    events: [],
    shown: [],
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
      state.keys.push({ key: event.key, at: event.timeStamp });
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

  // The Filter box's echo (T1): the frame after a change to its text draws
  // the text, since the box is the page's own render of each keystroke.
  const FILTER_BOX = '[data-testid="planning-filter"] input';
  window.addEventListener(
    "input",
    (event) => {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || !box.matches(FILTER_BOX)) {
        return;
      }
      const input: BoxInput = {
        at: event.timeStamp,
        handled: performance.now(),
        text: box.value,
        painted: null,
      };
      state.inputs.push(input);
      requestAnimationFrame(() => {
        setTimeout(() => {
          input.painted = performance.now();
        }, 0);
      });
    },
    { capture: true },
  );

  // The results (T2): the sections' box carries the filter its layout was
  // made under, set in the commit that swaps the sections in. A change is
  // seen when it is committed, and painted in the next frame unless a later
  // change came first.
  const SECTIONS = "[data-planning-sections]";
  const shownNow = () =>
    document.querySelector(SECTIONS)?.getAttribute("data-planning-filter") ??
    null;
  let latest: ShownFilter | null = null;
  new MutationObserver(() => {
    const filter = shownNow();
    if (filter === null || filter === latest?.filter) return;
    const shown: ShownFilter = {
      filter,
      committed: performance.now(),
      painted: null,
    };
    latest = shown;
    state.shown.push(shown);
    requestAnimationFrame(() => {
      if (latest !== shown) return;
      setTimeout(() => {
        shown.painted = performance.now();
      }, 0);
    });
  }).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-planning-filter"],
  });

  const observe = (
    type: string,
    take: (entries: PerformanceEntryList) => void,
    options: { durationThreshold?: number } = {},
  ) => {
    try {
      new PerformanceObserver((list) => take(list.getEntries())).observe({
        type,
        buffered: true,
        ...options,
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
  observe(
    "event",
    (entries) => {
      for (const entry of entries as EventEntry[]) {
        state.events.push({
          name: entry.name,
          start: entry.startTime,
          duration: entry.duration,
          processingStart: entry.processingStart,
          processingEnd: entry.processingEnd,
          interactionId: entry.interactionId,
        });
      }
    },
    { durationThreshold: 16 },
  );
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
