/**
 * The flows the scale targets are read from (`docs/reference/planning-index.md`
 * §18), each in a browser context of its own, which is a new browser profile:
 * its IndexedDB, and with it the scan cache, starts empty.
 *
 * - **The main flow** opens the start document, waits for its index, and
 *   presses `g p` three times: **cold** (this first visit), **revisit** (Back
 *   to the document in the same tab, then `g p` again) and **warm** (Back,
 *   reload the document, so its index is built from the scan cache, then
 *   `g p`). Then it loads each of the hold's documents, warm.
 * - **The building flow** holds the planning stream at the network until `g p`
 *   has painted, so the index is still building when the page opens (D5).
 * - **The first build** is the cold load alone (D7 cold, on this repository).
 * - **The typing flow** opens the planning page with `g p`, waits for its
 *   first pages and the visit's review requests, presses `/`, and types a
 *   query into the Filter box one key at a time (T1 to T4 of §18).
 */
import type { Browser, CDPSession, Page, Request } from "@playwright/test";
import { appliedBy } from "./filterText.ts";
import { installProbe, type ProbeState } from "./probe.ts";

export interface FlowOptions {
  /** Ms between the `g` and the `p` of `g p`: the usual gap a reader leaves. */
  gapMs: number;
  /** Ms to let a page settle after it is ready, and after `g p` paints. */
  settleMs: number;
  /** Chromium's CPU throttling rate; 1 is none. */
  cpuSlowdown: number;
  /** The longest any one wait may take before the run fails. */
  timeoutMs: number;
  /**
   * The planning page's page size, seeded into each profile's storage
   * before the app's scripts run (`docs/reference/planning-index.md`
   * §6.4); `null` leaves the default.
   */
  pageSize: number | null;
}

/** A served repository: where, and the document every flow starts from. */
export interface Served {
  base: string;
  start: string;
}

/**
 * A long task inside a window where planning code runs (D6), with the scripts
 * that started inside it, as the long animation frames report them.
 */
export interface AttributedTask {
  /**
   * `build`: the index's first build of the page session, from its first need
   * to ready. `page`: from the `p` of `g p` until the page has settled.
   * `typing`: from a typed query's first keydown until the last results it
   * made painted (T3). `after`: from then until the typing flow's wait ends,
   * which holds the URL's write after the idle pause.
   */
  window: "build" | "page" | "typing" | "after";
  /**
   * Whether planning code ran it. In `page`, every task: the planning page's
   * render, from the frame's commit to the sections'. In `build`, a task that
   * handled the scan worker's messages (`Worker.onmessage`), which is where the
   * index is assembled, with whatever React renders from it in the same task;
   * or any task when the scan ran on the main thread (the inline client). A
   * document's own rendering overlapping the build is listed, and not counted.
   */
  planning: boolean;
  /** Ms after the window opened; negative when it began before. */
  at: number;
  duration: number;
  scripts: { invoker: string; source: string; fn: string; duration: number }[];
}

/** A page load's planning index (D7). */
export interface IndexLoad {
  /** From the first need to ready, as the store logs it. */
  readyMs: number | null;
  documents: number | null;
  candidates: number | null;
  /** Every worker the load started, by script URL. */
  workers: string[];
  /** Workers beyond the scan worker running its chunk: a cold build's helpers. */
  helpers: number;
  /** No worker at all: the scan ran on the main thread (the inline client). */
  inlineClient: boolean;
  longTasks: AttributedTask[];
}

/** One `g p` (D1, D2, D4, D9, D10, and D6's page window). */
export interface GpResult {
  frameMs: number | null;
  cardsMs: number | null;
  /** Layout shift after the keypress, as the browser scores it. */
  cls: number;
  longTasks: AttributedTask[];
  heapMB: number | null;
  domElements: number | null;
}

/**
 * One warm load, for the hold (§12.3): when each datum the hold waits for
 * arrived, in ms after the document's content did, and whether it was in hand
 * by then. `null` for a datum this load never asked for.
 */
export interface HoldLoad {
  path: string;
  /** The planning index set ready (the store's line), not its response. */
  index: number | null;
  status: number | null;
  history: number | null;
  recent: number | null;
  info: number | null;
  /** Every datum asked for was in hand when the content arrived. */
  allInHand: boolean;
  /** The latest datum's arrival after the content, at least 0. */
  lastAfterContentMs: number;
  /** From the content's arrival to the document's first paint. */
  paintAfterContentMs: number | null;
}

export interface MainRun {
  cold: { load: IndexLoad; gp: GpResult };
  revisit: { gp: GpResult };
  warm: { load: IndexLoad; gp: GpResult };
  /** The start document's warm reload, then each of the hold's documents. */
  hold: HoldLoad[];
  /** The hold's documents' loads, warm, for D6 and D7 alike. */
  holdLoads: IndexLoad[];
}

export interface BuildingRun {
  /** Ms after `p` that the progress line painted. */
  progressMs: number | null;
  /** The index was still building when `g p` was pressed, as the flow needs. */
  building: boolean;
  longTasks: AttributedTask[];
}

const round = (n: number) => Math.round(n * 10) / 10;

async function newPage(browser: Browser, options: FlowOptions) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(installProbe);
  if (options.pageSize !== null) {
    await context.addInitScript((size: number) => {
      try {
        // The browser profile's storage, seeded before the app runs, as a
        // reader's earlier choice would leave it: no preference of the app's.
        // eslint-disable-next-line no-restricted-syntax
        localStorage.setItem("vantage:planningPageSize", String(size));
      } catch {
        // A page with no storage keeps the default size.
      }
    }, options.pageSize);
  }
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (options.cpuSlowdown > 1) {
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: options.cpuSlowdown,
    });
  }
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  return { context, page, cdp, workers };
}

function probe(page: Page): Promise<ProbeState> {
  return page.evaluate(() => {
    const state = window.__planningPerf;
    if (state === undefined) throw new Error("the probe is not installed");
    return state;
  });
}

const urlOf = (served: Served, file: string) =>
  `${served.base}/${file.split("/").map(encodeURIComponent).join("/")}`;

/** Wait until `file` is the document on screen, header and content painted. */
async function documentShown(page: Page, file: string, options: FlowOptions) {
  await page.waitForFunction(
    (file) =>
      decodeURIComponent(location.pathname) === `/${file}` &&
      document.querySelector('[data-testid="viewer-header"]') !== null &&
      document.querySelector("[data-content-scroll] .prose > *") !== null,
    file,
    { timeout: options.timeoutMs, polling: 50 },
  );
}

/** Wait until this page session's planning index is ready. */
async function indexReady(page: Page, options: FlowOptions) {
  await page.waitForFunction(() => window.__planningPerf?.index != null, null, {
    timeout: options.timeoutMs,
    polling: 50,
  });
}

/** The long tasks inside `windows`, each with the scripts that ran in it. */
function attribute(
  state: ProbeState,
  windows: { name: AttributedTask["window"]; start: number; end: number }[],
  inlineClient = false,
): AttributedTask[] {
  return state.longTasks.flatMap((task) => {
    const end = task.start + task.duration;
    const window = windows.find((w) => task.start < w.end && end > w.start);
    if (window === undefined) return [];
    // A task is one entry point and what it queued as microtasks; the
    // timeline's clock is coarse, so a script may start a hair before it.
    const scripts = state.frames
      .flatMap((f) => f.scripts)
      .filter((s) => s.start >= task.start - 1 && s.start < end)
      .map((s) => ({
        invoker: s.invoker,
        source: s.source,
        fn: s.fn,
        duration: round(s.duration),
      }));
    const planning =
      window.name !== "build" ||
      inlineClient ||
      scripts.some((s) => s.invoker.startsWith("Worker."));
    return [
      {
        window: window.name,
        planning,
        at: round(task.start - window.start),
        duration: round(task.duration),
        scripts,
      },
    ];
  });
}

function indexLoad(state: ProbeState, workers: string[]): IndexLoad {
  const index = state.index;
  const scan = workers[0];
  return {
    readyMs: index?.ms ?? null,
    documents: index?.documents ?? null,
    candidates: index?.candidates ?? null,
    workers: [...workers],
    helpers: Math.max(0, workers.filter((url) => url === scan).length - 1),
    inlineClient: workers.length === 0,
    longTasks:
      index === null
        ? []
        : attribute(
            state,
            [{ name: "build", start: index.at - index.ms, end: index.at }],
            workers.length === 0,
          ),
  };
}

/** A load of `file`, ready: shown, its index built, settled. */
async function load(
  page: Page,
  workers: string[],
  go: () => Promise<unknown>,
  file: string,
  options: FlowOptions,
): Promise<{ load: IndexLoad; state: ProbeState }> {
  workers.length = 0;
  await go();
  await documentShown(page, file, options);
  await indexReady(page, options);
  await page.waitForTimeout(options.settleMs);
  const state = await probe(page);
  return { load: indexLoad(state, workers), state };
}

async function heapAfterGC(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  return round(usedSize / 1048576);
}

/** Press `g p` from the document on screen and read what painted when. */
async function gp(
  page: Page,
  cdp: CDPSession,
  options: FlowOptions,
  measureHeap: boolean,
): Promise<GpResult> {
  await page.locator("[data-content-scroll]").first().focus();
  await page.keyboard.press("g");
  await page.waitForTimeout(options.gapMs);
  await page.keyboard.press("p");
  await page.waitForFunction(
    () => {
      const state = window.__planningPerf;
      return (
        state !== undefined && state.frame !== null && state.cards !== null
      );
    },
    null,
    { timeout: options.timeoutMs, polling: 50 },
  );
  await page.waitForTimeout(options.settleMs);
  const state = await probe(page);
  const key = state.key ?? 0;
  const result: GpResult = {
    frameMs: state.frame === null ? null : round(state.frame),
    cardsMs: state.cards === null ? null : round(state.cards),
    cls:
      round(
        state.shifts
          .filter((s) => s.start >= key && !s.input)
          .reduce((sum, s) => sum + s.value, 0) * 1000,
      ) / 1000,
    longTasks: attribute(state, [
      { name: "page", start: key, end: Number.POSITIVE_INFINITY },
    ]),
    heapMB: null,
    domElements: null,
  };
  if (measureHeap) {
    result.heapMB = await heapAfterGC(cdp);
    result.domElements = await page.evaluate(
      () => document.getElementsByTagName("*").length,
    );
  }
  return result;
}

/** The hold's data on the load just made of `file`. */
async function holdOf(page: Page, file: string): Promise<HoldLoad> {
  const times = await page.evaluate((file) => {
    const entries = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];
    const end = (test: (url: URL) => boolean) => {
      const entry = entries.find((e) => test(new URL(e.name)));
      return entry === undefined ? null : entry.responseEnd;
    };
    const state = window.__planningPerf;
    return {
      content: end(
        (u) =>
          u.pathname.endsWith("/content") &&
          u.searchParams.get("path") === file,
      ),
      status: end(
        (u) =>
          u.pathname.endsWith("/git/status") &&
          u.searchParams.get("path") === file,
      ),
      history: end(
        (u) =>
          u.pathname.endsWith("/git/history") &&
          u.searchParams.get("path") === file,
      ),
      recent: end((u) => u.pathname.endsWith("/git/recent")),
      info: end((u) => u.pathname.endsWith("/info")),
      index: state?.index?.at ?? null,
      painted: state?.documentPainted ?? null,
    };
  }, file);
  const content = times.content;
  if (content === null) throw new Error(`no content request for ${file}`);
  const after = (at: number | null) =>
    at === null ? null : round(at - content);
  const data = {
    index: after(times.index),
    status: after(times.status),
    history: after(times.history),
    recent: after(times.recent),
    info: after(times.info),
  };
  const asked = Object.values(data).filter((v): v is number => v !== null);
  return {
    path: file,
    ...data,
    allInHand: data.index !== null && asked.every((v) => v <= 0),
    lastAfterContentMs: Math.max(0, ...asked),
    paintAfterContentMs: after(times.painted),
  };
}

/** One run of the main flow; `holdDocs` are loaded warm after it. */
export async function mainRun(
  browser: Browser,
  served: Served,
  options: FlowOptions,
  what: { heap: boolean; hold: boolean; holdDocs: string[] },
): Promise<MainRun> {
  const { context, page, cdp, workers } = await newPage(browser, options);
  try {
    const start = urlOf(served, served.start);
    const cold = await load(
      page,
      workers,
      () => page.goto(start),
      served.start,
      options,
    );
    const coldGp = await gp(page, cdp, options, what.heap);

    await page.goBack();
    await documentShown(page, served.start, options);
    await page.waitForTimeout(options.settleMs);
    const revisitGp = await gp(page, cdp, options, what.heap);

    await page.goBack();
    await documentShown(page, served.start, options);
    const warm = await load(
      page,
      workers,
      () => page.reload(),
      served.start,
      options,
    );
    const hold: HoldLoad[] = [];
    if (what.hold) hold.push(await holdOf(page, served.start));
    const warmGp = await gp(page, cdp, options, what.heap);

    const holdLoads: IndexLoad[] = [];
    if (what.hold) {
      for (const file of what.holdDocs) {
        const loaded = await load(
          page,
          workers,
          () => page.goto(urlOf(served, file)),
          file,
          { ...options, settleMs: Math.min(options.settleMs, 300) },
        );
        holdLoads.push(loaded.load);
        hold.push(await holdOf(page, file));
      }
    }
    return {
      cold: { load: cold.load, gp: coldGp },
      revisit: { gp: revisitGp },
      warm: { load: warm.load, gp: warmGp },
      hold,
      holdLoads,
    };
  } finally {
    await context.close();
  }
}

/**
 * One run of the building flow (D5): a new profile, the planning stream held
 * at the network so the index is still building, `g p` from the document, the
 * progress line's paint, and then the stream let go.
 */
export async function buildingRun(
  browser: Browser,
  served: Served,
  options: FlowOptions,
): Promise<BuildingRun> {
  const { context, page } = await newPage(browser, options);
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  try {
    await page.route("**/planning/stream", async (route) => {
      await Promise.race([
        released,
        new Promise((resolve) => setTimeout(resolve, options.timeoutMs)),
      ]);
      await route.continue().catch(() => {});
    });
    await page.goto(urlOf(served, served.start));
    await documentShown(page, served.start, options);
    const building = await page.evaluate(
      () => window.__planningPerf?.index === null,
    );
    await page.locator("[data-content-scroll]").first().focus();
    await page.keyboard.press("g");
    await page.waitForTimeout(options.gapMs);
    await page.keyboard.press("p");
    await page.waitForFunction(
      () => {
        const state = window.__planningPerf;
        return state !== undefined && (state.progress ?? state.frame) !== null;
      },
      null,
      { timeout: options.timeoutMs, polling: 50 },
    );
    release();
    await indexReady(page, options);
    await page.waitForFunction(
      () => window.__planningPerf?.cards != null,
      null,
      {
        timeout: options.timeoutMs,
        polling: 50,
      },
    );
    await page.waitForTimeout(options.settleMs);
    const state = await probe(page);
    const key = state.key ?? 0;
    return {
      progressMs: state.progress === null ? null : round(state.progress),
      building: building && state.progress !== null,
      longTasks: attribute(state, [
        { name: "page", start: key, end: Number.POSITIVE_INFINITY },
      ]),
    };
  } finally {
    release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
  }
}

/** One cold load in a new profile: the first build (D7 cold). */
export async function firstBuildRun(
  browser: Browser,
  served: Served,
  options: FlowOptions,
): Promise<IndexLoad> {
  const { context, page, workers } = await newPage(browser, options);
  try {
    const cold = await load(
      page,
      workers,
      () => page.goto(urlOf(served, served.start)),
      served.start,
      options,
    );
    return cold.load;
  } finally {
    await context.close();
  }
}

/** One load to nothing, so the first measured run meets warm server caches. */
export async function warmUp(
  browser: Browser,
  served: Served,
  options: FlowOptions,
): Promise<void> {
  await firstBuildRun(browser, served, options);
}

/** What the typing flow types, and how fast. */
export interface TypingPass {
  /** Typed one key at a time into the Filter box of an unfiltered page. */
  query: string;
  /** Ms from one keydown to the next, kept to a schedule from the first. */
  gapMs: number;
}

/** One key of a typed query (T1, T2). */
export interface Keystroke {
  key: string;
  /** The keydown's `timeStamp`, on the page's clock. */
  at: number;
  /** The box's text after it. */
  text: string;
  /**
   * T1: the longest Event Timing duration of the events this key caused
   * (keydown, keypress, beforeinput, input, keyup), from the keydown to the
   * next paint after its handlers. `null` when each was under 16 ms, the
   * lowest threshold the browser reports.
   */
  interactionMs: number | null;
  /** Each of those events' own duration, `null` under 16 ms. */
  events: Record<string, number | null>;
  /** From the keydown to the frame that drew the box's new text, painted. */
  echoMs: number | null;
  /**
   * The canonical text this key makes the applied filter, or `null` when it
   * changes nothing: the same canonical text, a text not understood, or one
   * the page holds back (`held`).
   */
  applies: string | null;
  /**
   * Its text keeps no entry, so the page holds it back until the idle pause
   * (§6.16): typed on, it changes nothing, and T2 does not
   * count it.
   */
  held: boolean;
  /** From the keydown to the sections being swapped for `applies`, in the DOM. */
  committedMs: number | null;
  /** T2: from the keydown to the frame that painted those sections. */
  resultsMs: number | null;
  /**
   * Its results never painted: a later key's came first, or none came. T2
   * counts it as over its target.
   */
  superseded: boolean;
}

export interface TypingRun extends TypingPass {
  keys: Keystroke[];
  /**
   * Every filter the sections were swapped to from the first key on, in
   * order, in ms after the first keydown: committed, and painted (`null`
   * when a later one came before a frame did).
   */
  shown: { filter: string; committed: number; painted: number | null }[];
  /** The whole query's results painted, in ms after the last keydown. */
  settledMs: number | null;
  /**
   * Sections committed under a text the reader had typed past, after the page
   * had handled the last key's input: a backlog, which the newest text winning
   * leaves at 0.
   */
  staleAfterLast: number;
  /** The painted texts never went back to an earlier key's. */
  inOrder: boolean;
  /** T3: every long task from the first keydown on, by window. */
  longTasks: AttributedTask[];
  /** Long animation frames, 50 ms or more, from the first keydown to the last results painted. */
  longFrames: { at: number; duration: number; blocking: number }[];
  /** T4: layout shift from the first keydown on, as the browser scores it. */
  cls: number;
  /** The same, counting the shifts it forgives within 500 ms of an input. */
  clsAll: number;
  /** History entries the typing added: 0, as §6.16 requires. */
  historyAdded: number;
  /** The URL's `filter` once the flow's wait was over. */
  urlFilter: string | null;
  /** POSTs to the planning reviews endpoint in the visit (D11: at most 2). */
  reviews: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** The events one key press causes, as Event Timing names them. */
const KEY_EVENTS = ["keydown", "keypress", "beforeinput", "input", "keyup"];

/**
 * One run of the typing flow: a new profile, the start document, `g p`, the
 * first pages painted and the visit's review requests answered, then `/` and
 * `pass.query` into the Filter box one key at a time, every `pass.gapMs` ms,
 * and a wait of `settleMs` once the whole query's results have painted.
 * `held` are the texts the query makes that keep no entry on the tree served
 * (`keepingNothing`), which the page holds back while the reader types.
 */
export async function typingRun(
  browser: Browser,
  served: Served,
  options: FlowOptions,
  pass: TypingPass,
  held: readonly string[] = [],
): Promise<TypingRun> {
  const chars = [...pass.query];
  const texts = chars.map((_, i) => chars.slice(0, i + 1).join(""));
  const makes = texts.map(appliedBy);
  let applied = "";
  const applies = makes.map((made) => {
    if (made === null || made === applied || held.includes(made)) return null;
    applied = made;
    return made;
  });
  const final = appliedBy(pass.query);
  if (final === null || final === "") {
    throw new Error(
      `the typing query ${JSON.stringify(pass.query)} is not a filter`,
    );
  }

  const { context, page, cdp } = await newPage(browser, options);
  const isReview = (request: Request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname.endsWith("/planning/reviews");
  const reviews = { sent: 0, done: 0, last: Date.now() };
  page.on("request", (request) => {
    if (!isReview(request)) return;
    reviews.sent += 1;
    reviews.last = Date.now();
  });
  const answered = (request: Request) => {
    if (!isReview(request)) return;
    reviews.done += 1;
    reviews.last = Date.now();
  };
  page.on("requestfinished", answered);
  page.on("requestfailed", answered);
  try {
    await page.goto(urlOf(served, served.start));
    await documentShown(page, served.start, options);
    await indexReady(page, options);
    await gp(page, cdp, options, false);
    // The visit's second review request answered (§6.5), or none out for
    // a settle's time when the first page's request covered every document.
    const deadline = Date.now() + options.timeoutMs;
    while (
      reviews.done < reviews.sent ||
      (reviews.done < 2 && Date.now() - reviews.last < options.settleMs)
    ) {
      if (Date.now() > deadline) {
        throw new Error("the visit's review requests never settled");
      }
      await sleep(50);
    }
    await page.waitForTimeout(options.settleMs);

    await page.keyboard.press("/");
    await page.waitForFunction(
      () =>
        document.activeElement?.matches(
          '[data-testid="planning-filter"] input',
        ) === true,
      null,
      { timeout: options.timeoutMs, polling: 50 },
    );
    const entries = await page.evaluate(() => history.length);
    await page.waitForTimeout(300);
    const from = await page.evaluate(() => performance.now());
    const t0 = Date.now();
    for (const [i, char] of chars.entries()) {
      await sleep(t0 + i * pass.gapMs - Date.now());
      await page.keyboard.type(char);
    }
    await page
      .waitForFunction(
        ([filter, from]) =>
          window.__planningPerf?.shown.some(
            (s) => s.filter === filter && s.committed >= from && s.painted,
          ) === true,
        [final, from] as const,
        { timeout: 10_000, polling: 50 },
      )
      .catch(() => {});
    await page.waitForTimeout(options.settleMs);
    const state = await probe(page);
    const historyAdded = (await page.evaluate(() => history.length)) - entries;
    const urlFilter = new URL(page.url()).searchParams.get("filter");
    return {
      ...pass,
      ...readTyping(state, from, chars, texts, applies, makes, held, final),
      historyAdded,
      urlFilter,
      reviews: reviews.sent,
    };
  } finally {
    await context.close();
  }
}

/** The typing flow's clocks, read from the probe. */
function readTyping(
  state: ProbeState,
  from: number,
  chars: string[],
  texts: string[],
  applies: (string | null)[],
  makes: (string | null)[],
  held: readonly string[],
  final: string,
) {
  const downs = state.keys.filter((k) => k.at >= from);
  if (downs.length !== chars.length) {
    throw new Error(
      `typed ${chars.length} keys, and the page saw ${downs.length} keydowns`,
    );
  }
  const shown = state.shown
    .filter((s) => s.committed >= from)
    .sort((a, b) => a.committed - b.committed);
  // The key whose text a painted filter is: the last that made it, held
  // back or not, since a held text the idle pause applies is painted too.
  const keyOf = (filter: string) => makes.lastIndexOf(filter);
  const keys: Keystroke[] = downs.map((down, i) => {
    const at = down.at;
    const next = downs[i + 1]?.at ?? Number.POSITIVE_INFINITY;
    const mine = state.events.filter(
      (e) => KEY_EVENTS.includes(e.name) && e.start >= at - 1 && e.start < next,
    );
    const events = Object.fromEntries(
      KEY_EVENTS.map((name) => {
        const longest = mine
          .filter((e) => e.name === name)
          .reduce<number | null>((m, e) => Math.max(m ?? 0, e.duration), null);
        return [name, longest];
      }),
    );
    const durations = mine.map((e) => e.duration);
    const input = state.inputs.find((x) => x.at >= at - 1 && x.at < next);
    const wanted = applies[i];
    let committedMs: number | null = null;
    let resultsMs: number | null = null;
    let superseded = false;
    if (wanted !== null) {
      superseded = true;
      for (const s of shown) {
        if (s.committed < at) continue;
        if (s.filter === wanted) {
          committedMs = round(s.committed - at);
          if (s.painted !== null) {
            resultsMs = round(s.painted - at);
            superseded = false;
          }
          break;
        }
        // A later key's results came first: this key's never will.
        if (keyOf(s.filter) > i) break;
      }
    }
    return {
      key: down.key,
      at: round(at),
      text: texts[i],
      interactionMs: durations.length === 0 ? null : Math.max(...durations),
      events,
      echoMs: input?.painted == null ? null : round(input.painted - at),
      applies: wanted,
      held: makes[i] !== null && held.includes(makes[i]),
      committedMs,
      resultsMs,
      superseded,
    };
  });
  const first = downs[0].at;
  const last = downs[downs.length - 1].at;
  // When the page had seen the whole query: its last input handled.
  const seen =
    state.inputs.filter((x) => x.at >= last - 1).at(0)?.handled ?? last;
  const settled = shown.find(
    (s) => s.filter === final && s.committed >= last && s.painted !== null,
  );
  const order = shown
    .filter((s) => s.painted !== null)
    .map((s) => keyOf(s.filter));
  const end =
    settled?.painted ??
    Math.max(from, ...shown.map((s) => s.painted ?? s.committed));
  const shifts = state.shifts.filter((s) => s.start >= first);
  const sum = (values: number[]) =>
    Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000;
  return {
    keys,
    shown: shown.map((s) => ({
      filter: s.filter,
      committed: round(s.committed - first),
      painted: s.painted === null ? null : round(s.painted - first),
    })),
    settledMs: settled?.painted == null ? null : round(settled.painted - last),
    staleAfterLast: shown.filter(
      (s) => s.committed > seen && s.filter !== final,
    ).length,
    inOrder: order.every((k, i) => i === 0 || k >= order[i - 1]),
    longTasks: attribute(state, [
      { name: "typing", start: first, end },
      { name: "after", start: end, end: Number.POSITIVE_INFINITY },
    ]),
    longFrames: state.frames
      .filter((f) => f.start + f.duration > first && f.start < end)
      .map((f) => ({
        at: round(f.start - first),
        duration: round(f.duration),
        blocking: round(f.blocking),
      })),
    cls: sum(shifts.filter((s) => !s.input).map((s) => s.value)),
    clsAll: sum(shifts.map((s) => s.value)),
  };
}
