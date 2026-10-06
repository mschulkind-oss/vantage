/**
 * The planning index's measurement harness (`docs/reference/planning-index.md`
 * §18): the production bundle in headless Chromium at 1440×900, three runs per
 * cell, on the scale fixture or on a repository given. `just planning-perf`
 * runs it; `--help` says how, and README.md beside it what each target reads.
 *
 * Every subject's server is started first, and each run then takes the
 * subjects in turn, in an order reversed from one run to the next, so the
 * machine's drift falls on every size alike rather than on whichever was
 * measured last (D3 is a difference between two sizes). D4's dev server
 * comes after, one subject at a time.
 *
 * It prints each cell's runs and median and writes every raw run as JSON.
 * It judges nothing: §18 holds the targets, and a person compares. The typing
 * targets, T1 to T4, are `docs/design/planning-filter.md` §16's, read as
 * percentiles over every run's keystrokes pooled.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "@playwright/test";
import {
  FIXTURE_SIZES,
  REPO_ROOT,
  describeFixture,
  filterKeeps,
  writeFixture,
  type FixtureReport,
} from "./fixture.ts";
import {
  buildingRun,
  firstBuildRun,
  mainRun,
  typingRun,
  warmUp,
  type BuildingRun,
  type FlowOptions,
  type GpResult,
  type IndexLoad,
  type MainRun,
  type Served,
  type TypingPass,
  type TypingRun,
} from "./scenarios.ts";
import {
  buildBinary,
  startDevServer,
  startServer,
  stopAll,
  treeCommit,
  type Running,
} from "./servers.ts";

const TARGETS = [
  "D1",
  "D2",
  "D3",
  "D4",
  "D5",
  "D6",
  "D7",
  "D9",
  "D10",
  "hold",
  "first-build",
  "T1",
  "T2",
  "T3",
  "T4",
] as const;
type Target = (typeof TARGETS)[number];

/** The typing targets, which `--targets typing` names together. */
const TYPING: readonly Target[] = ["T1", "T2", "T3", "T4"];

/** The targets the main flow is read for. */
const MAIN: readonly Target[] = ["D1", "D2", "D3", "D6", "D7", "hold"];

/**
 * The targets the heap flow is read for: the main flow again, in a profile of
 * its own, with D9's garbage collection after each `g p`. None of its times
 * are reported, because the collection slows every later `g p` of the page.
 */
const HEAP: readonly Target[] = ["D9", "D10"];

const USAGE = `Usage: just planning-perf [options]

Measures the planning index's scale targets (docs/reference/planning-index.md
§18) on the production bundle in headless Chromium at 1440x900.

  --size <n>[,<n>…]     scale fixture sizes: 15, 30, 45, 60 (default: all four)
  --repo <path>         measure this repository instead of the fixture, or
                        beside it when --size is given too
  --start <file>        the document every flow starts from (default: roadmap.md)
  --targets <t>[,<t>…]  D1 D2 D3 D4 D5 D6 D7 D9 D10 hold first-build T1 T2 T3 T4,
                        or typing for T1 to T4 (default: all)
  --runs <n>            runs per cell (default: 3)
  --out <file>          where the raw JSON goes (default: the OS temp directory)
  --gap <ms>            between the g and the p of g p (default: 200)
  --settle <ms>         to let a page settle before and after g p (default: 1000)
  --cpu-slowdown <n>    Chromium's CPU throttling rate (default: 1, none)
  --query <text>        what the typing flow types (default: generator is:open)
  --type-gap <ms>       between its keys (default: 150)
  --burst-gap <ms>      between its keys in a burst, typed again in a visit of
                        its own; 0 types none (default: 30)
  --no-build            reuse web/dist rather than rebuilding it (just web-sync)
  --keep                keep the fixture and the servers' scratch directory
  --help                print this

first-build is this repository's first build (or --repo's), whatever --size
says. T1 to T4 are docs/design/planning-filter.md §16's typing targets, and
their percentiles pool every run's keystrokes; §16 asks for ten runs or more. D3 is the slope of D2 between the two largest sizes run; §18 defines it
from 45 to 60, and three runs cannot resolve it (the README says how many
can). Nothing here judges a result: compare with §18's table.`;

interface Args {
  sizes: number[];
  /** `--size` was given, so its sizes are measured beside `--repo`. */
  sized: boolean;
  repo: string | null;
  start: string;
  targets: Set<Target>;
  runs: number;
  out: string | null;
  build: boolean;
  keep: boolean;
  flow: FlowOptions;
  typing: TypingPass;
  burst: TypingPass | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    sizes: [...FIXTURE_SIZES],
    sized: false,
    repo: null,
    start: "roadmap.md",
    targets: new Set(TARGETS),
    runs: 3,
    out: null,
    build: true,
    keep: false,
    flow: { gapMs: 200, settleMs: 1000, cpuSlowdown: 1, timeoutMs: 60_000 },
    typing: { query: "generator is:open", gapMs: 150 },
    burst: { query: "generator is:open", gapMs: 30 },
  };
  let burstGap = 30;
  const list = (value: string) => value.split(",").filter((v) => v !== "");
  const number = (flag: string, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} takes a number`);
    return n;
  };
  let sizes: number[] | null = null;
  let targets: Target[] | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
      return next;
    };
    switch (flag) {
      case "--size":
        sizes = [
          ...(sizes ?? []),
          ...list(value()).map((v) => number(flag, v)),
        ];
        break;
      case "--repo":
        args.repo = path.resolve(value());
        break;
      case "--start":
        args.start = value();
        break;
      case "--targets":
        targets = [
          ...(targets ?? []),
          ...list(value()).flatMap((t) => {
            if (t.toLowerCase() === "typing") return TYPING;
            const found = TARGETS.find(
              (k) => k.toLowerCase() === t.toLowerCase(),
            );
            if (found === undefined) throw new Error(`unknown target ${t}`);
            return [found];
          }),
        ];
        break;
      case "--runs":
        args.runs = Math.max(1, Math.round(number(flag, value())));
        break;
      case "--out":
        args.out = path.resolve(value());
        break;
      case "--gap":
        args.flow.gapMs = number(flag, value());
        break;
      case "--settle":
        args.flow.settleMs = number(flag, value());
        break;
      case "--cpu-slowdown":
        args.flow.cpuSlowdown = Math.max(1, number(flag, value()));
        break;
      case "--query":
        args.typing.query = value();
        break;
      case "--type-gap":
        args.typing.gapMs = number(flag, value());
        break;
      case "--burst-gap":
        burstGap = number(flag, value());
        break;
      case "--no-build":
        args.build = false;
        break;
      case "--keep":
        args.keep = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option ${flag}\n\n${USAGE}`);
    }
  }
  if (sizes !== null) {
    for (const size of sizes) {
      if (!(FIXTURE_SIZES as readonly number[]).includes(size)) {
        throw new Error(
          `--size is one of ${FIXTURE_SIZES.join(", ")}, not ${size}`,
        );
      }
    }
    args.sizes = [...new Set(sizes)].sort((a, b) => a - b);
    args.sized = true;
  }
  if (targets !== null) args.targets = new Set(targets);
  args.burst =
    burstGap > 0 ? { query: args.typing.query, gapMs: burstGap } : null;
  return args;
}

/** One served repository and what was measured on it. */
interface SubjectResult {
  subject:
    | { kind: "fixture"; size: number; fixture: FixtureReport }
    | { kind: "repo"; path: string };
  start: string;
  main: MainRun[];
  /** The heap flow's runs: D9 and D10 only. */
  heap: MainRun[];
  building: BuildingRun[];
  dev: MainRun[];
  firstBuild: IndexLoad[];
  /** The typing flow's runs at the typing pace, then in a burst. */
  typing: TypingRun[];
  burst: TypingRun[];
  /** The entries the typed query keeps, of all the page lists. */
  narrows: { shown: number; of: number } | null;
  summary: Record<string, unknown>;
}

const median = (values: (number | null)[]): number | null => {
  const sorted = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const m =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
};

/** A cell: every run's value, and their median. */
const cell = (values: (number | null)[]) => ({
  runs: values,
  median: median(values),
});

const SCENARIOS = ["cold", "revisit", "warm"] as const;

/**
 * Runs a size that, alternating 45 and 60 on 2026-10-01, resolved D3's warm
 * slope against 0.5 ms per document and nearly its revisit slope (README.md).
 */
const D3_RUNS = 40;

function gpOf(run: MainRun, scenario: (typeof SCENARIOS)[number]): GpResult {
  return run[scenario].gp;
}

function summarize(result: SubjectResult, targets: Set<Target>) {
  const out: Record<string, unknown> = {};
  const byScenario = (runs: MainRun[], read: (gp: GpResult) => number | null) =>
    Object.fromEntries(
      SCENARIOS.map((s) => [s, cell(runs.map((run) => read(gpOf(run, s))))]),
    );
  const { main, heap, dev } = result;
  if (main.length > 0) {
    if (targets.has("D1")) out.D1 = byScenario(main, (gp) => gp.frameMs);
    if (targets.has("D2") || targets.has("D3")) {
      out.D2 = byScenario(main, (gp) => gp.cardsMs);
    }
    if (targets.has("D7")) {
      const loads = (pick: (run: MainRun) => IndexLoad) => ({
        ...cell(main.map((run) => pick(run).readyMs)),
        helpers: main.map((run) => pick(run).helpers),
        inlineClient: main.some((run) => pick(run).inlineClient),
      });
      out.D7 = {
        cold: loads((r) => r.cold.load),
        warm: loads((r) => r.warm.load),
      };
    }
    if (targets.has("hold")) {
      const loads = main.flatMap((run) => run.hold);
      const inHand = (
        key: "index" | "status" | "history" | "recent" | "info",
      ) => {
        const asked = loads.filter((l) => l[key] !== null);
        return `${asked.filter((l) => (l[key] ?? 1) <= 0).length} of ${asked.length}`;
      };
      out.hold = {
        loads: loads.length,
        allInHand: loads.filter((l) => l.allInHand).length,
        index: inHand("index"),
        status: inHand("status"),
        history: inHand("history"),
        recent: inHand("recent"),
        info: inHand("info"),
        lastAfterContentMs: cell(loads.map((l) => l.lastAfterContentMs)),
      };
    }
  }
  if (heap.length > 0) {
    if (targets.has("D9")) out.D9 = byScenario(heap, (gp) => gp.heapMB);
    if (targets.has("D10")) out.D10 = byScenario(heap, (gp) => gp.domElements);
  }
  if (targets.has("D6") && (main.length > 0 || result.building.length > 0)) {
    const tasks = [
      ...main.flatMap((run) => [
        ...run.cold.load.longTasks,
        ...run.warm.load.longTasks,
        ...run.holdLoads.flatMap((load) => load.longTasks),
        ...SCENARIOS.flatMap((s) => gpOf(run, s).longTasks),
      ]),
      ...result.building.flatMap((run) => run.longTasks),
    ];
    const planning = tasks.filter((t) => t.planning);
    out.D6 = {
      planning: planning.length,
      build: planning.filter((t) => t.window === "build").length,
      page: planning.filter((t) => t.window === "page").length,
      longestMs:
        planning.length === 0
          ? null
          : Math.max(...planning.map((t) => t.duration)),
      notPlanning: tasks.length - planning.length,
    };
  }
  if (targets.has("D5") && result.building.length > 0) {
    out.D5 = {
      ...cell(result.building.map((run) => run.progressMs)),
      building: result.building.map((run) => run.building),
    };
  }
  if (targets.has("D4") && dev.length > 0) {
    out.D4 = {
      frame: byScenario(dev, (gp) => gp.frameMs),
      cards: byScenario(dev, (gp) => gp.cardsMs),
    };
  }
  if (result.typing.length > 0) out.typing = typingSummary(result.typing);
  if (result.burst.length > 0) out.burst = burstSummary(result.burst);
  if (result.firstBuild.length > 0) {
    out.firstBuild = {
      ...cell(result.firstBuild.map((load) => load.readyMs)),
      documents: result.firstBuild[0]?.documents,
      candidates: result.firstBuild[0]?.candidates,
      helpers: result.firstBuild.map((load) => load.helpers),
      inlineClient: result.firstBuild.some((load) => load.inlineClient),
    };
  }
  return out;
}

/**
 * The nearest-rank percentile `p` of `values`, so a p95 is a value some
 * keystroke took; `Infinity` stands for one whose results never painted.
 */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/**
 * p50, p95 and the largest of a pooled measure. Event Timing reports nothing
 * under its 16 ms threshold, so such a keystroke stands as 0 and a
 * percentile below 16 prints as "<16".
 */
function spread(values: number[], floor = 0) {
  const show = (v: number | null) =>
    v === null
      ? null
      : v === Number.POSITIVE_INFINITY
        ? "never painted"
        : v < floor
          ? `<${floor}`
          : Math.round(v * 10) / 10;
  return {
    n: values.length,
    p50: show(percentile(values, 50)),
    p95: show(percentile(values, 95)),
    max: show(values.length === 0 ? null : Math.max(...values)),
  };
}

/** T1 and the box's echo over every keystroke of `runs`, pooled. */
function echoSummary(runs: TypingRun[]) {
  const keys = runs.flatMap((run) => run.keys);
  const t1 = keys.map((k) => k.interactionMs ?? 0);
  return {
    T1: {
      ...spread(t1, 16),
      over50: t1.filter((v) => v > 50).length,
      under16: keys.filter((k) => k.interactionMs === null).length,
    },
    echo: spread(keys.flatMap((k) => (k.echoMs === null ? [] : [k.echoMs]))),
  };
}

/** T3 and T4 over `runs`. */
function quietSummary(runs: TypingRun[]) {
  const tasks = runs.flatMap((run) => run.longTasks);
  const typing = tasks.filter((t) => t.window === "typing");
  const after = tasks.filter((t) => t.window === "after");
  const frames = runs.flatMap((run) => run.longFrames);
  const longest = (values: number[]) =>
    values.length === 0 ? null : Math.max(...values);
  return {
    T3: {
      longTasks: typing.length,
      longestMs: longest(typing.map((t) => t.duration)),
      longFrames: frames.length,
      longestFrameMs: longest(frames.map((f) => f.duration)),
      afterTyping: after.length,
      afterLongestMs: longest(after.map((t) => t.duration)),
    },
    T4: {
      cls: longest(runs.map((run) => run.cls)),
      clsAll: longest(runs.map((run) => run.clsAll)),
      runsShifted: runs.filter((run) => run.clsAll > 0).length,
    },
  };
}

/** The typing flow at its pace: T1 to T4, and what the design also holds. */
function typingSummary(runs: TypingRun[]) {
  const counted = runs.flatMap((run) =>
    run.keys.filter((k) => k.applies !== null),
  );
  const final = runs[0].query;
  return {
    query: final,
    gapMs: runs[0].gapMs,
    ...echoSummary(runs),
    T2: {
      ...spread(
        counted.map((k) => (k.superseded ? Infinity : (k.resultsMs ?? 0))),
      ),
      over100: counted.filter((k) => k.superseded || (k.resultsMs ?? 0) > 100)
        .length,
      superseded: counted.filter((k) => k.superseded).length,
      committed: spread(
        counted.flatMap((k) => (k.committedMs === null ? [] : [k.committedMs])),
      ),
    },
    ...quietSummary(runs),
    historyAdded: Math.max(...runs.map((run) => run.historyAdded)),
    urlTook: `${runs.filter((run) => run.urlFilter !== null).length} of ${runs.length}`,
    reviewsMax: Math.max(...runs.map((run) => run.reviews)),
  };
}

/** The burst: the newest text wins, with no backlog; and T1 under it. */
function burstSummary(runs: TypingRun[]) {
  return {
    gapMs: runs[0].gapMs,
    settledMs: cell(runs.map((run) => run.settledMs)),
    settledP95: spread(
      runs.map((run) => run.settledMs ?? Number.POSITIVE_INFINITY),
    ).p95,
    finalShown: `${runs.filter((run) => run.settledMs !== null).length} of ${runs.length}`,
    inOrder: `${runs.filter((run) => run.inOrder).length} of ${runs.length}`,
    staleAfterLast: runs.reduce((sum, run) => sum + run.staleAfterLast, 0),
    texts: cell(
      runs.map((run) => run.shown.filter((s) => s.painted !== null).length),
    ),
    ...echoSummary(runs),
    ...quietSummary(runs),
  };
}

/** D3: D2's slope between the two largest fixture sizes run, per scenario. */
function slope(results: SubjectResult[]) {
  const fixtures = results
    .filter((r) => r.subject.kind === "fixture" && r.main.length > 0)
    .sort((a, b) => sizeOf(a) - sizeOf(b));
  if (fixtures.length < 2) return null;
  const [from, to] = fixtures.slice(-2);
  const docs = sizeOf(to) - sizeOf(from);
  const at = (r: SubjectResult, s: (typeof SCENARIOS)[number]) =>
    median(r.main.map((run) => gpOf(run, s).cardsMs));
  return {
    from: sizeOf(from),
    to: sizeOf(to),
    msPerDocument: Object.fromEntries(
      SCENARIOS.map((s) => {
        const a = at(from, s);
        const b = at(to, s);
        return [
          s,
          a === null || b === null
            ? null
            : Math.round(((b - a) / docs) * 100) / 100,
        ];
      }),
    ),
  };
}

const sizeOf = (r: SubjectResult) =>
  r.subject.kind === "fixture" ? r.subject.size : 0;

/** Which flows a subject runs. */
interface Flows {
  main: boolean;
  heap: boolean;
  building: boolean;
  dev: boolean;
  firstBuild: boolean;
  typing: boolean;
}

/** A subject whose server is up: what it runs, and its results so far. */
interface Prepared {
  result: SubjectResult;
  server: Running;
  served: Served;
  holdDocs: string[];
  flows: Flows;
}

const nameOf = (result: SubjectResult) =>
  result.subject.kind === "fixture"
    ? `${result.subject.size} documents`
    : "repository";

function print(result: SubjectResult): void {
  const name =
    result.subject.kind === "fixture"
      ? describeFixture(result.subject.fixture)
      : `repository ${result.subject.path}`;
  console.log(`\n${name}\n  start: ${result.start}`);
  for (const [target, value] of Object.entries(result.summary)) {
    if (target === "typing" || target === "burst") {
      // One line a measure: the typing summaries are too wide for one.
      console.log(`  ${target}`);
      for (const [measure, v] of Object.entries(value as object)) {
        console.log(`    ${measure.padEnd(14)} ${JSON.stringify(v)}`);
      }
      continue;
    }
    console.log(`  ${target.padEnd(10)} ${JSON.stringify(value)}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { targets, flow } = args;
  const scratch = mkdtempSync(path.join(tmpdir(), "vantage-planning-perf-"));
  const loadAtStart = loadavg();
  process.on("SIGINT", () => {
    stopAll();
    process.exit(130);
  });
  process.on("exit", stopAll);

  const wantsMain = MAIN.some((t) => targets.has(t));
  const wantsHeap = HEAP.some((t) => targets.has(t));
  const wantsTyping = TYPING.some((t) => targets.has(t));
  const fixtureTargets =
    wantsMain ||
    wantsHeap ||
    wantsTyping ||
    targets.has("D4") ||
    targets.has("D5");
  const subjects: ({ kind: "fixture"; size: number } | { kind: "repo" })[] = [
    ...(fixtureTargets && (args.repo === null || args.sized)
      ? args.sizes.map((size) => ({ kind: "fixture" as const, size }))
      : []),
    ...(args.repo === null ? [] : [{ kind: "repo" as const }]),
  ];
  const firstBuildRepo = targets.has("first-build")
    ? (args.repo ?? REPO_ROOT)
    : null;

  console.log(
    `planning-perf: ${[...targets].join(" ")}; ${args.runs} runs per cell; ` +
      `${cpus().length} cores, load ${loadAtStart
        .map((l) => l.toFixed(1))
        .join(" ")}`,
  );
  const prepared: Prepared[] = [];
  let browser: Browser | null = null;
  try {
    const binary = buildBinary(scratch, args.build);
    browser = await chromium.launch();
    const chrome: Browser = browser;
    const prepare = async (
      subject: SubjectResult["subject"],
      target: string,
      flows: Flows,
    ) => {
      const server = await startServer(binary, target, scratch);
      const served: Served = { base: server.url, start: args.start };
      prepared.push({
        result: {
          subject,
          start: args.start,
          main: [],
          heap: [],
          building: [],
          dev: [],
          firstBuild: [],
          typing: [],
          burst: [],
          narrows: null,
          summary: {},
        },
        server,
        served,
        holdDocs:
          subject.kind === "fixture"
            ? subject.fixture.documents.slice(0, 4).map((d) => d.path)
            : [],
        flows,
      });
      if (flows.typing) {
        // The query narrows the page, or its keystrokes measure nothing.
        const keeps = filterKeeps(target, args.typing.query);
        prepared[prepared.length - 1].result.narrows = keeps;
        if (keeps.shown === 0 || keeps.shown >= keeps.of) {
          throw new Error(
            `the typing query ${JSON.stringify(args.typing.query)} keeps ${keeps.shown} of ${keeps.of} entries in ${target}: it must narrow the page`,
          );
        }
      }
      await warmUp(chrome, served, flow);
    };

    // Every subject's server, started and warmed up before any run.
    for (const subject of subjects) {
      if (subject.kind === "fixture") {
        const fixture = writeFixture(subject.size, scratch);
        console.log(`\n${describeFixture(fixture)}`);
        await prepare(
          { kind: "fixture", size: subject.size, fixture },
          fixture.dir,
          {
            main: wantsMain,
            heap: wantsHeap,
            building: targets.has("D5"),
            dev: targets.has("D4"),
            firstBuild: false,
            typing: wantsTyping,
          },
        );
      } else {
        const repo = args.repo ?? REPO_ROOT;
        console.log(`\nrepository ${repo}`);
        await prepare({ kind: "repo", path: repo }, repo, {
          main: wantsMain,
          heap: wantsHeap,
          building: targets.has("D5"),
          dev: targets.has("D4"),
          firstBuild: firstBuildRepo === repo,
          typing: wantsTyping,
        });
      }
    }
    if (firstBuildRepo !== null && !prepared.some((p) => p.flows.firstBuild)) {
      console.log(`\nrepository ${firstBuildRepo} (first build)`);
      await prepare({ kind: "repo", path: firstBuildRepo }, firstBuildRepo, {
        main: false,
        heap: false,
        building: false,
        dev: false,
        firstBuild: true,
        typing: false,
      });
    }

    // The runs: every subject in turn, the order reversed each run.
    console.log("");
    for (let run = 1; run <= args.runs; run += 1) {
      const order = run % 2 === 1 ? prepared : [...prepared].reverse();
      for (const { result, served, holdDocs, flows } of order) {
        process.stdout.write(`  run ${run}/${args.runs}, ${nameOf(result)}:`);
        if (flows.main) {
          process.stdout.write(" main");
          result.main.push(
            await mainRun(chrome, served, flow, {
              heap: false,
              hold: targets.has("hold"),
              holdDocs,
            }),
          );
        }
        if (flows.heap) {
          process.stdout.write(" heap");
          result.heap.push(
            await mainRun(chrome, served, flow, {
              heap: true,
              hold: false,
              holdDocs: [],
            }),
          );
        }
        if (flows.building) {
          process.stdout.write(" building");
          result.building.push(await buildingRun(chrome, served, flow));
        }
        if (flows.firstBuild) {
          process.stdout.write(" first-build");
          result.firstBuild.push(await firstBuildRun(chrome, served, flow));
        }
        if (flows.typing) {
          process.stdout.write(" typing");
          result.typing.push(
            await typingRun(chrome, served, flow, args.typing),
          );
          if (args.burst !== null) {
            process.stdout.write(" burst");
            result.burst.push(
              await typingRun(chrome, served, flow, args.burst),
            );
          }
        }
        process.stdout.write("\n");
      }
    }

    // D4: the dev server in front of each subject's server, one at a time.
    for (const { result, server, flows } of prepared) {
      if (!flows.dev) continue;
      const dev = await startDevServer(server.url, scratch);
      try {
        const served: Served = { base: dev.url, start: args.start };
        await warmUp(chrome, served, flow);
        for (let run = 1; run <= args.runs; run += 1) {
          process.stdout.write(
            `  run ${run}/${args.runs}, ${nameOf(result)}: dev\n`,
          );
          result.dev.push(
            await mainRun(chrome, served, flow, {
              heap: false,
              hold: false,
              holdDocs: [],
            }),
          );
        }
      } finally {
        await dev.stop();
      }
    }
  } catch (error) {
    console.error(
      `\nfailed; the servers' logs and the fixture are in ${scratch}`,
    );
    throw error;
  } finally {
    await browser?.close();
    for (const { server } of prepared) await server.stop();
  }

  const results = prepared.map((p) => p.result);
  for (const result of results) {
    result.summary = summarize(result, targets);
    print(result);
  }

  const d3 = targets.has("D3") ? slope(results) : null;
  if (d3 !== null) {
    console.log(`\nD3         ${JSON.stringify(d3)}`);
    if (d3.from !== 45 || d3.to !== 60) {
      console.log("           (§18 defines D3 from 45 to 60 documents)");
    }
    if (args.runs < D3_RUNS) {
      console.log(
        `           (${args.runs} runs a size cannot resolve 0.5 ms per document; ` +
          `run --runs ${D3_RUNS} or more, as the README says)`,
      );
    }
  } else if (targets.has("D3")) {
    console.log(
      "\nD3         needs two fixture sizes; §18 defines it from 45 to 60",
    );
  }
  const out =
    args.out ??
    path.join(
      tmpdir(),
      `vantage-planning-perf-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
  const report = {
    harness: {
      commit: treeCommit(),
      date: new Date().toISOString(),
      chromium: browser?.version() ?? null,
      node: process.version,
      cores: cpus().length,
      loadAverage: { start: loadAtStart, end: loadavg() },
      runs: args.runs,
      viewport: "1440x900",
      ...flow,
      typing: wantsTyping ? { pace: args.typing, burst: args.burst } : null,
      targets: [...targets],
    },
    subjects: results,
    D3: d3,
  };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nraw results: ${out}`);
  if (args.keep) console.log(`kept: ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  stopAll();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
