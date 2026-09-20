import { statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker, parentPort } from "node:worker_threads";
import { checkFiles } from "./runner.js";
import { Settings } from "./settings.js";
import type { RuleSetting, RunReport } from "./types.js";

/**
 * Checking a corpus across several threads.
 *
 * Every file is an independent unit of work — the rules never write anything
 * another file's rules read — so the only shared state worth worrying about is
 * `Workspace`, and that is a *cache*, not a channel: each thread builds its own
 * and answers the same questions, just without the benefit of what the others
 * already looked up. That is the whole cost of parallelism here, and it is why
 * shards are contiguous slices of the sorted file list rather than files dealt
 * round-robin: documents that link to each other live near each other, so
 * neighbouring files share cache entries instead of each thread re-reading the
 * same targets.
 *
 * Determinism is not left to timing. Shards are merged in shard order, and each
 * shard ran its files in list order, so the merged report is byte-identical to
 * the sequential one — including `failures`, which the report layer does not
 * sort.
 */

/** What a shard reports back. A `RunReport` for part of the file list. */
export type ShardReport = RunReport;

/**
 * Run one shard and report what it found.
 *
 * The seam: the shipped binary hands this to a worker thread, and tests hand it
 * an in-process function. Both have to produce the same report for the same
 * files, which is what `parallel.test.ts` is for.
 */
export type RunShard = (
  files: string[],
  cwd: string,
  settings: Settings,
) => Promise<ShardReport>;

/** `--jobs`: a thread count, or "decide from the machine". */
export type JobsRequest = number | "auto";

/**
 * Files per thread that `auto` asks for before it spends another one.
 *
 * A thread is cheap to *start* — about 4ms — and expensive to *have*: it
 * initialises the bundle's 3000-odd modules in its own JavaScript VM, which
 * measures at 300ms of CPU even for a thread that then checks one three-line
 * document, and the first mermaid fence it meets loads mermaid again on top of
 * that. So `auto` only spends a thread where there is enough work to pay for it,
 * and a run over a handful of files does not get slower than it was.
 */
export const MIN_FILES_PER_JOB = 12;

/**
 * The most threads `auto` will ask for, however large the corpus.
 *
 * Six, and the number is measured rather than chosen. Past it this workload gets
 * *slower*, because the per-thread cost above does not stay constant: total CPU
 * for one 110-file run goes 6.4s at one thread, 15.8s at eight, 60.6s at
 * thirty-two, so each extra thread buys less and costs more until it is losing.
 * Wall clock on a 32-core machine, median of 3-5:
 *
 * | files | 1 thread | 3      | 6      | 8      | 16     | 32      |
 * | ----: | -------: | -----: | -----: | -----: | -----: | ------: |
 * |    36 |   1261ms | 1008ms | 1202ms |   1304 |      — |       — |
 * |   110 |   4378ms | 2318ms | 1966ms | 2238ms | 3778ms |  7995ms |
 * |   750 |  22857ms |      — | 6153ms | 6485ms | 9123ms | 17901ms |
 *
 * Six is the best or within 1% of the best at every size, which is why `auto`
 * does not simply take the core count. A machine whose runtime scales further
 * than this one's is what `--jobs` is for.
 */
export const MAX_AUTO_JOBS = 6;

/**
 * How many threads to use.
 *
 * `auto` never asks for more threads than there is work for, nor more than the
 * machine has cores, nor more than `MAX_AUTO_JOBS`. An explicit number is
 * honoured as far as the file count allows — asking for 32 threads for 4 files
 * gets 4, because an empty shard is a thread's startup cost for nothing.
 */
export function resolveJobs(request: JobsRequest, fileCount: number): number {
  if (fileCount === 0) return 1;
  const wanted =
    request === "auto"
      ? Math.min(
          availableParallelism(),
          MAX_AUTO_JOBS,
          Math.floor(fileCount / MIN_FILES_PER_JOB),
        )
      : request;
  return Math.max(1, Math.min(wanted, fileCount));
}

/**
 * Split the file list into contiguous shards of roughly equal *size*.
 *
 * By bytes rather than by file count, because cost tracks length closely — the
 * two dominant steps are a `remark-parse` and a render of the same text — and
 * because the spread is wide: this repository's own documents run from under
 * 1 KB to 46 KB, so thirty-two equal-count shards would have one thread doing
 * several times the work of another and the run would take as long as that one
 * thread.
 *
 * A file whose size cannot be read counts as zero. It is about to be reported as
 * `document/read` by whichever shard gets it, and guessing a weight for it would
 * be inventing data.
 */
export function shardFiles(
  files: readonly string[],
  shards: number,
): string[][] {
  if (files.length === 0) return [];
  const count = Math.min(Math.max(shards, 1), files.length);
  if (count === 1) return [[...files]];

  const sizes = files.map(sizeOf);
  const result: string[][] = [];
  let current: string[] = [];
  /** Bytes not yet closed into a shard, this one's included. */
  let unassigned = sizes.reduce((sum, size) => sum + size, 0);
  let carried = 0;

  for (let index = 0; index < files.length; index++) {
    current.push(files[index] as string);
    carried += sizes[index] as number;

    const shardsLeft = count - result.length;
    // Never cut so early that the shards still to come would have no files.
    if (shardsLeft <= 1 || files.length - index - 1 < shardsLeft - 1) continue;

    // Cut where the shard lands *closest* to its share, rather than at the
    // first file that reaches it. The difference is not academic: one 100 KB
    // document at the end of a run of small ones never reaches a half-share on
    // its own, so a "cut when full" rule would put the whole list in one shard
    // and leave every other thread idle.
    const share = unassigned / shardsLeft;
    const next = sizes[index + 1] as number;
    if (Math.abs(carried + next - share) > Math.abs(carried - share)) {
      result.push(current);
      unassigned -= carried;
      current = [];
      carried = 0;
    }
  }

  if (current.length > 0) result.push(current);
  return result;
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Check a file list across `jobs` shards and merge the reports.
 *
 * A shard that never reports is the case that matters: a thread that died, ran
 * out of memory, or threw where nothing caught it. Those files have *not* been
 * judged, so the run says so with an `EnvironmentFailure` — exit 3, "we do not
 * know" — and never reports the remaining shards' silence as a clean tree.
 */
export async function checkFilesInParallel(
  files: readonly string[],
  cwd: string,
  settings: Settings,
  jobs: number,
  runShard: RunShard,
): Promise<RunReport> {
  const shards = shardFiles(files, jobs);
  const reports = await Promise.all(
    shards.map((shard) =>
      runShard(shard, cwd, settings).catch((error: unknown): ShardReport => ({
        filesChecked: 0,
        findings: [],
        failures: [
          {
            rule: "run/shard",
            message: `a worker thread failed (${error instanceof Error ? error.message : String(error)}), so ${shard.length} file${shard.length === 1 ? " was" : "s were"} not checked: ${shard.join(", ")}`,
          },
        ],
      })),
    ),
  );

  return {
    filesChecked: reports.reduce((sum, report) => sum + report.filesChecked, 0),
    findings: reports.flatMap((report) => report.findings),
    failures: reports.flatMap((report) => report.failures),
  };
}

// ── Worker threads ────────────────────────────────────────────────────────

/**
 * What the parent sends a worker, and what it sends back.
 *
 * Everything crossing the boundary is plain data, which rules out handing a
 * worker the `Settings` object: it is a class with methods, and structured
 * cloning would strip them. The override map is what a `Settings` actually is,
 * so that is what travels.
 */
interface ShardRequest {
  files: string[];
  cwd: string;
  overrides: [string, RuleSetting][];
}

type ShardResponse =
  { ok: true; report: ShardReport } | { ok: false; message: string };

/**
 * The module that a worker thread should run — this program's own entry point.
 *
 * It has to be registered rather than derived. In the compiled binary every
 * module is bundled into the executable, so `import.meta.url` here *is* the
 * entry and deriving it would work; run from source it is this file, and a
 * worker started on it would sit listening to nothing. `main.ts` knows which
 * module it is, so `main.ts` says.
 */
let entry: URL | undefined;

export function setWorkerEntry(url: URL): void {
  entry = url;
}

/**
 * Run a shard in a worker thread.
 *
 * The worker is this program again, with `isMainThread` false — see `main.ts`.
 * That is the one arrangement that works both in the compiled single-file
 * executable, where a second entry point would not be on disk to load, and from
 * source, where it would be TypeScript.
 */
export const workerShard: RunShard = (files, cwd, settings) =>
  new Promise<ShardReport>((resolve, reject) => {
    if (entry === undefined) {
      reject(
        new Error(
          "no worker entry registered — main.ts must call setWorkerEntry before a parallel run",
        ),
      );
      return;
    }

    const worker = new Worker(entry);
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      outcome();
      void worker.terminate();
    };

    worker.on("message", (response: ShardResponse) => {
      finish(() =>
        response.ok
          ? resolve(response.report)
          : reject(new Error(response.message)),
      );
    });
    worker.on("error", (error: Error) => finish(() => reject(error)));
    // A thread that exits without answering has not checked its files, and
    // saying nothing here would hang the run instead of failing it.
    worker.on("exit", (code) =>
      finish(() => reject(new Error(`worker exited with code ${code}`))),
    );

    const request: ShardRequest = {
      files: [...files],
      cwd,
      overrides: settings.entries(),
    };
    worker.postMessage(request);
  });

/**
 * The worker side: check the shard you are handed and post the report.
 *
 * Errors are reported, never thrown away. A shard that could not run has to
 * reach the parent as a failure, because the alternative is a report that looks
 * clean because part of it is missing.
 */
export function serveShards(): void {
  parentPort?.on("message", (request: ShardRequest) => {
    void (async () => {
      let response: ShardResponse;
      try {
        response = {
          ok: true,
          report: await checkFiles(
            request.files,
            request.cwd,
            new Settings(new Map(request.overrides)),
          ),
        };
      } catch (error) {
        response = {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      parentPort?.postMessage(response);
    })();
  });
}
