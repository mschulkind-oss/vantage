/**
 * The check command: walk a file or directory for Markdown, run the link rules
 * and the delegated validators, and assemble a Report. Exit-code policy:
 *
 *   0  no findings (or warnings only, without strict)
 *   1  at least one error-severity finding (or any finding under strict)
 *   2  could not check: a present config was invalid, or a validator was
 *      unchecked (environment failure) — an inconclusive run never reports
 *      green
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ConfigError, ConfigResolver, severityOf } from "./config.js";
import { parseDoc } from "./parse.js";
import { checkDoc, makeCtx } from "./rules/links.js";
import { activeValidators } from "./validators/index.js";
import { EnvironmentFailure } from "./validators/types.js";
import type { Finding, Report } from "./types.js";

export function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

/**
 * Collect the Markdown files to check. A file argument checks just that file
 * (when it is Markdown); a directory argument is walked recursively, skipping
 * hidden directories and node_modules. Results are sorted for stable output.
 */
export function collectMarkdownFiles(target: string): string[] {
  const st = statSync(target);
  if (st.isFile()) return isMarkdownFile(target) ? [target] : [];
  const out: string[] = [];
  walk(target, out);
  return out.sort();
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && isMarkdownFile(p)) out.push(p);
  }
}

export interface RunOptions {
  /** The --strict flag. */
  strict: boolean;
  /** A --config path, or null to discover per file. */
  configPath: string | null;
}

/** Run every rule and validator over every Markdown file under `target`. */
export async function runCheck(
  target: string,
  opts: RunOptions,
): Promise<Report> {
  const files = collectMarkdownFiles(target);
  const ctx = makeCtx();
  const resolver = new ConfigResolver(opts.configPath);
  const findings: Finding[] = [];
  const unchecked = new Set<string>();
  let environmentError: string | null = null;
  let configError: string | null = null;
  let strict = opts.strict;

  for (const abs of files) {
    const rel = path.relative(process.cwd(), abs) || path.basename(abs);
    const doc = parseDoc(abs, rel);

    let config;
    try {
      config = resolver.forFile(abs);
    } catch (e) {
      if (e instanceof ConfigError) {
        configError = e.message;
        break; // an invalid config makes the run inconclusive
      }
      throw e;
    }
    strict = strict || config.strict;

    const fileFindings: Finding[] = [];
    fileFindings.push(...checkDoc(doc, ctx));
    for (const validator of activeValidators(config)) {
      try {
        fileFindings.push(...(await validator.run(doc)));
      } catch (e) {
        if (e instanceof EnvironmentFailure) {
          unchecked.add(validator.id);
          environmentError ??= `${validator.id}: ${e.message}`;
        } else {
          throw e;
        }
      }
    }

    // Apply this file's configured severity; drop rules set to "off".
    for (const f of fileFindings) {
      const sev = severityOf(f.rule, config);
      if (sev === "off") continue;
      f.severity = sev;
      findings.push(f);
    }
  }

  return {
    files: files.length,
    findings,
    unchecked: [...unchecked].sort(),
    environmentError,
    configError,
    strict,
  };
}

/** Map a report to a process exit code. */
export function exitCode(report: Report): number {
  if (report.configError !== null) return 2;
  if (report.unchecked.length > 0) return 2;
  if (report.findings.some((f) => f.severity === "error")) return 1;
  if (report.strict && report.findings.length > 0) return 1;
  return 0;
}
