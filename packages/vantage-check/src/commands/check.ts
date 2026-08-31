import { resolve } from "node:path";
import { Collector } from "../core/collector.js";
import { ConfigError, loadConfig, type CheckPolicy } from "../core/config.js";
import { discover } from "../core/discover.js";
import { loadDocument } from "../core/document.js";
import type { Settings } from "../core/settings.js";
import type { EnvironmentFailure, Finding, RunReport } from "../core/types.js";
import { Workspace } from "../core/workspace.js";
import {
  EXIT_ENVIRONMENT,
  EXIT_FINDINGS,
  EXIT_OK,
  EXIT_USAGE,
} from "../exit.js";
import type { Io } from "../io.js";
import { renderJson } from "../report/json.js";
import { renderFailures, renderFindings } from "../report/text.js";
import { checkFrontmatter } from "../rules/frontmatter.js";
import { checkLinks } from "../rules/links.js";
import { checkMath } from "../rules/math.js";
import { checkMarkdownHygiene } from "../rules/markdown.js";
import { checkMermaid } from "../rules/mermaid.js";

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
}

export async function checkCommand(
  options: CheckOptions,
  io: Io,
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

  const report = await checkFiles(files, io.cwd, config.settings);

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

/** Run every enabled rule over every file. */
export async function checkFiles(
  files: string[],
  cwd: string,
  settings: Settings,
): Promise<RunReport> {
  const workspace = new Workspace();
  const findings: Finding[] = [];
  const failures: EnvironmentFailure[] = [];
  let filesChecked = 0;

  for (const file of files) {
    let collector: Collector;
    try {
      collector = new Collector(
        loadDocument(file, cwd),
        settings,
        workspace,
        cwd,
      );
    } catch (error) {
      // A file we cannot open has not been judged. It is a failure of the run,
      // never a finding against the document.
      failures.push({
        rule: "document/read",
        file,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    filesChecked++;
    checkLinks(collector);
    checkFrontmatter(collector);
    checkMath(collector);
    await checkMermaid(collector);
    await checkMarkdownHygiene(collector);

    findings.push(...collector.findings);
    failures.push(...collector.failures);
  }

  return { filesChecked, findings, failures };
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
