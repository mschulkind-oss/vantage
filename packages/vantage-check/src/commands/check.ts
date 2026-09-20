import { resolve } from "node:path";
import { ConfigError, loadConfig, type CheckPolicy } from "../core/config.js";
import { discover } from "../core/discover.js";
import {
  checkFilesInParallel,
  resolveJobs,
  workerShard,
  type JobsRequest,
  type RunShard,
} from "../core/parallel.js";
import { checkFiles } from "../core/runner.js";
import type { RunReport } from "../core/types.js";
import {
  EXIT_ENVIRONMENT,
  EXIT_FINDINGS,
  EXIT_OK,
  EXIT_USAGE,
} from "../exit.js";
import type { Io } from "../io.js";
import { renderJson } from "../report/json.js";
import { renderFailures, renderFindings } from "../report/text.js";

export interface CheckOptions {
  /** Files and directories to check. Empty means the working directory. */
  paths: string[];
  format: "text" | "json";
  /** Fail the run on warnings too. Config can ask for this as well. */
  strict: boolean;
  quiet: boolean;
  /** Undefined means "decide from the terminal". */
  color?: boolean;
  /** An explicit `.vantage.toml`; missing is an error, not a fallback. */
  configPath?: string;
  /** Ignore any `.vantage.toml` and use the built-in defaults. */
  noConfig?: boolean;
  /** Threads to check with. Undefined means "ask the environment, then auto". */
  jobs?: JobsRequest;
}

/** Sets the default for `--jobs` on a machine, without touching a command line. */
export const JOBS_ENV = "VANTAGE_CHECK_JOBS";

export async function checkCommand(
  options: CheckOptions,
  io: Io,
  /** How a shard is run. Tests substitute an in-process runner. */
  runShard: RunShard = workerShard,
): Promise<number> {
  const color = options.color ?? io.isTty;
  const paths = options.paths.length > 0 ? options.paths : ["."];
  const { files, errors } = discover(paths, io.cwd);

  if (errors.length > 0) {
    for (const error of errors) io.err(`vantage-check: ${error}\n`);
    return EXIT_USAGE;
  }

  // One config for the run, found by walking up from the first target — so a
  // repository's severities apply however the checker was invoked, and a run
  // never silently mixes two repositories' policies.
  let config;
  try {
    config = loadConfig({
      from: resolve(io.cwd, paths[0] as string),
      ...(options.configPath === undefined
        ? {}
        : { explicitPath: resolve(io.cwd, options.configPath) }),
      ...(options.noConfig === undefined ? {} : { noConfig: options.noConfig }),
    });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    io.err(`vantage-check: ${error.message}\n`);
    return EXIT_USAGE;
  }

  let request: JobsRequest;
  try {
    request = options.jobs ?? jobsFromEnv(io);
  } catch (error) {
    io.err(`vantage-check: ${(error as Error).message}\n`);
    return EXIT_USAGE;
  }

  const jobs = resolveJobs(request, files.length);
  const report =
    jobs === 1
      ? await checkFiles(files, io.cwd, config.settings)
      : await checkFilesInParallel(
          files,
          io.cwd,
          config.settings,
          jobs,
          runShard,
        );

  if (options.format === "json") {
    io.out(renderJson(report));
  } else {
    io.out(renderFindings(report, { color, quiet: options.quiet }));
    io.err(renderFailures(report.failures, color));
  }

  return exitCodeFor(report, {
    strict: options.strict || config.policy.strict,
    exitCode: config.policy.exitCode,
  });
}

/**
 * `VANTAGE_CHECK_JOBS`, when it is set.
 *
 * An environment variable rather than a `.vantage.toml` key on purpose: how many
 * threads to use is a fact about the *machine*, not about the repository, so a
 * committed `jobs = 16` would be wrong for everyone who checks out the tree on a
 * laptop. This is where CI pins it.
 *
 * A value that is not a thread count is a usage error, not a silent fallback to
 * `auto`: a typo in the variable would otherwise make an explicit choice
 * disappear with nothing said.
 */
function jobsFromEnv(io: Io): JobsRequest {
  const raw = io.env[JOBS_ENV];
  if (raw === undefined || raw === "") return "auto";
  return parseJobs(raw, JOBS_ENV);
}

/** `auto`, or a positive whole number of threads. */
export function parseJobs(value: string, source: string): JobsRequest {
  if (value === "auto") return "auto";
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(
      `${source} takes auto or a number of 1 or more (got ${value})`,
    );
  }
  return count;
}

/**
 * Turn a report into an exit code.
 *
 * A failed validator beats a finding: if something could not run, the honest
 * answer is "this run does not know", and saying that with code 3 matters more
 * than reporting the subset of problems we did manage to see. Nothing here can
 * produce 0 while `failures` is non-empty — including a config that has turned
 * the findings exit code off, which is a statement about findings only.
 */
export function exitCodeFor(
  report: RunReport,
  policy: CheckPolicy = { strict: false, exitCode: EXIT_FINDINGS },
): number {
  if (report.failures.length > 0) return EXIT_ENVIRONMENT;

  const hasErrors = report.findings.some((f) => f.severity === "error");
  if (hasErrors) return policy.exitCode;
  if (policy.strict && report.findings.length > 0) return policy.exitCode;
  return EXIT_OK;
}
