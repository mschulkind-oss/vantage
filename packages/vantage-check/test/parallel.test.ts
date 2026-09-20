import { availableParallelism } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { bufferIo } from "../src/io.js";
import { EXIT_ENVIRONMENT, EXIT_FINDINGS, EXIT_OK } from "../src/exit.js";
import { JOBS_ENV } from "../src/commands/check.js";
import {
  MAX_AUTO_JOBS,
  MIN_FILES_PER_JOB,
  checkFilesInParallel,
  resolveJobs,
  shardFiles,
  type RunShard,
} from "../src/core/parallel.js";
import { discover } from "../src/core/discover.js";
import { checkFiles } from "../src/core/runner.js";
import { Settings } from "../src/core/settings.js";
import type { RuleSetting } from "../src/core/types.js";
import { makeTree } from "./helpers.js";

/**
 * Parallelism has exactly one job: produce the report the sequential run would
 * have produced, sooner. So most of this file is that comparison, and the rest
 * is the two ways it could lie — a shard that never answers, and a shard list
 * that loses or duplicates a file.
 *
 * The threads themselves are not started here: a worker runs this program's own
 * entry point (see `main.ts`), which vitest cannot load as a worker because it
 * is TypeScript. What runs in a thread in the binary runs in-process here,
 * through the same `RunShard` seam the binary passes a worker spawner to. The
 * thread half is proved end-to-end by `just check`, which runs the compiled
 * binary over this repository's own docs at more than one job and diffs the
 * JSON against a single-threaded run.
 */

/** The seam, wired to the real checker in this process. */
const inProcess: RunShard = (files, cwd, settings) =>
  checkFiles(files, cwd, settings);

describe("resolveJobs", () => {
  it("stays sequential when there is nothing to parallelise", () => {
    expect(resolveJobs("auto", 0)).toBe(1);
    expect(resolveJobs("auto", 1)).toBe(1);
    expect(resolveJobs("auto", MIN_FILES_PER_JOB - 1)).toBe(1);
  });

  it("spends one thread per batch of files, up to the core count", () => {
    expect(resolveJobs("auto", MIN_FILES_PER_JOB * 2)).toBe(
      Math.min(2, availableParallelism(), MAX_AUTO_JOBS),
    );
  });

  it("stops well short of the core count, however large the corpus", () => {
    // Not a safety margin — a measured ceiling. Past `MAX_AUTO_JOBS` this
    // workload's total CPU grows faster than its parallelism, so more threads
    // make the run slower. `--jobs` is the way past it.
    const huge = resolveJobs("auto", 1_000_000);

    expect(huge).toBe(Math.min(availableParallelism(), MAX_AUTO_JOBS));
    expect(huge).toBeLessThanOrEqual(availableParallelism());
  });

  it("honours an explicit count, but not past one thread per file", () => {
    expect(resolveJobs(4, 400)).toBe(4);
    expect(resolveJobs(1, 400)).toBe(1);
    // An empty shard is a thread's startup cost for no work.
    expect(resolveJobs(32, 3)).toBe(3);
  });
});

describe("shardFiles", () => {
  /** Sized files, so the byte weighting has something to weigh. */
  function sizedTree(sizes: number[]): string[] {
    const root = makeTree({ ".keep": "" });
    return sizes.map((size, index) => {
      const path = join(root, `f${index}.md`);
      writeFileSync(path, "x".repeat(size));
      return path;
    });
  }

  it("loses nothing and reorders nothing", () => {
    const files = sizedTree([100, 200, 50, 400, 1, 900, 30]);

    for (const jobs of [1, 2, 3, 4, 7, 9]) {
      const shards = shardFiles(files, jobs);

      // Contiguous slices in order: this is what makes the merged report
      // identical to the sequential one, not merely equivalent to it.
      expect(shards.flat()).toEqual(files);
      expect(shards.length).toBeLessThanOrEqual(Math.min(jobs, files.length));
      expect(shards.every((shard) => shard.length > 0)).toBe(true);
    }
  });

  it("has nothing to shard when there are no files", () => {
    expect(shardFiles([], 8)).toEqual([]);
  });

  it("balances by bytes, not by file count", () => {
    // One 10 KB document and nine tiny ones. Split evenly by count, the shard
    // holding the big file does most of the run's work and the other finishes
    // immediately; the run then takes as long as the slow shard.
    const files = sizedTree([10_000, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const shards = shardFiles(files, 2);

    expect(shards).toHaveLength(2);
    expect(shards[0]).toEqual([files[0]]);
    expect(shards[1]).toHaveLength(9);
  });

  it("gives a heavy tail its own shard, not the whole list one", () => {
    // The case a "cut when this shard is full" rule gets wrong: no prefix of
    // the small files ever reaches half the bytes, so it would never cut.
    const files = sizedTree([...Array<number>(9).fill(10), 10_000]);
    const shards = shardFiles(files, 2);

    expect(shards).toHaveLength(2);
    expect(shards[1]).toEqual([files[9]]);
  });
});

describe("checkFilesInParallel", () => {
  /** A cross-linked tree with one finding and one unreadable file. */
  function corpus(): { root: string; files: string[] } {
    const root = makeTree({
      "a.md": "# A\n\nSee [B](./b.md#b) and [nowhere](./gone.md).\n",
      "b.md": "# B\n\nSee [A](./a.md#a).\n",
      "c.md": "# C\n\nSee [B](./b.md#b).\n",
      "d.md": "# D\n\nSee [C](./c.md#missing).\n",
      "e.md": "# E\n",
      "f.md": "# F\n\nSee [E](./e.md#e).\n",
    });
    const { files } = discover(["."], root);
    return { root, files };
  }

  it("reports exactly what one thread would have reported", async () => {
    const { root, files } = corpus();
    const settings = Settings.defaults();

    const sequential = await checkFiles(files, root, settings);

    for (const jobs of [2, 3, 6, 12]) {
      const parallel = await checkFilesInParallel(
        files,
        root,
        settings,
        jobs,
        inProcess,
      );

      // Deep equality including array order: shards are contiguous and merged
      // in order, so even `failures` — which the report layer never sorts —
      // comes out in the same sequence.
      expect(parallel).toEqual(sequential);
    }
  });

  // The failure mode that must never be quiet. A thread that dies has not
  // judged its files, and reporting the survivors' silence as a clean tree is
  // the one outcome worse than being slow.
  it("turns a shard that never answers into a failure, naming its files", async () => {
    const { root, files } = corpus();
    const settings = Settings.defaults();
    let shardIndex = 0;
    const firstShardDies: RunShard = (shard, cwd, given) =>
      shardIndex++ === 0
        ? Promise.reject(new Error("out of memory"))
        : checkFiles(shard, cwd, given);

    const report = await checkFilesInParallel(
      files,
      root,
      settings,
      2,
      firstShardDies,
    );

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.rule).toBe("run/shard");
    expect(report.failures[0]?.message).toContain("out of memory");
    expect(report.failures[0]?.message).toContain("a.md");
    // The other shard's work is still reported, and the count is honest about
    // how many files were actually checked.
    expect(report.filesChecked).toBeLessThan(files.length);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("survives a shard whose settings crossed a thread boundary", async () => {
    // What a worker really receives: the override map, rebuilt into a Settings
    // on the far side. A class with methods does not survive structured
    // cloning, so this is the shape that travels.
    const { root, files } = corpus();
    const overrides = new Map<string, RuleSetting>([
      ["link/dead-section-anchor", "warning"],
    ]);
    const settings = new Settings(overrides);
    const rebuilt: RunShard = (shard, cwd, given) =>
      checkFiles(shard, cwd, new Settings(new Map(given.entries())));

    const direct = await checkFiles(files, root, settings);
    const viaEntries = await checkFilesInParallel(
      files,
      root,
      settings,
      3,
      rebuilt,
    );

    expect(viaEntries).toEqual(direct);
    expect(direct.findings.some((f) => f.severity === "warning")).toBe(true);
  });
});

describe("the --jobs option", () => {
  const TREE = {
    "docs/a.md": "# A\n\nSee [gone](./nowhere.md).\n",
    "docs/b.md": "# B\n\nSee [A](./a.md#a).\n",
    "docs/c.md": "# C\n",
  };

  it("prints the same report however many threads it used", async () => {
    const root = makeTree(TREE);
    const outputs = await Promise.all(
      ["1", "2", "3", "auto"].map(async (jobs) => {
        const io = bufferIo(root);
        const code = await run(
          ["check", "docs", "--jobs", jobs],
          io,
          inProcess,
        );
        return { code, stdout: io.stdout, stderr: io.stderr };
      }),
    );

    for (const output of outputs) {
      expect(output.code).toBe(EXIT_FINDINGS);
      expect(output).toEqual(outputs[0]);
    }
  });

  it("takes the count from the environment, and lets the flag win", async () => {
    const root = makeTree(TREE);
    const shards: number[] = [];
    const counting: RunShard = (files, cwd, settings) => {
      shards.push(files.length);
      return checkFiles(files, cwd, settings);
    };

    const fromEnv = bufferIo(root, { [JOBS_ENV]: "3" });
    await run(["check", "docs"], fromEnv, counting);
    expect(shards).toHaveLength(3);

    shards.length = 0;
    const flagWins = bufferIo(root, { [JOBS_ENV]: "3" });
    await run(["check", "docs", "--jobs", "1"], flagWins, counting);
    // One job runs in this thread and never reaches a shard runner at all.
    expect(shards).toEqual([]);
  });

  it("rejects a value that is not a thread count", async () => {
    for (const value of ["0", "-2", "two", "2.5", ""]) {
      const io = bufferIo();
      expect(await run(["check", ".", "--jobs", value], io)).not.toBe(EXIT_OK);
      expect(io.stderr).toContain("vantage-check:");
    }
  });

  it("rejects a bad VANTAGE_CHECK_JOBS instead of quietly using auto", async () => {
    const root = makeTree(TREE);
    const io = bufferIo(root, { [JOBS_ENV]: "lots" });

    const code = await run(["check", "docs"], io, inProcess);

    expect(code).not.toBe(EXIT_OK);
    expect(code).not.toBe(EXIT_ENVIRONMENT);
    expect(io.stderr).toContain(JOBS_ENV);
  });
});
