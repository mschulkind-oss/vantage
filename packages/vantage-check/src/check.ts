/**
 * The check command: walk a file or directory for Markdown, run the rules,
 * and assemble a Report. Exit-code policy lives here too:
 *
 *   0  no findings (or warnings only, without --strict)
 *   1  at least one error-severity finding (or a warning under --strict)
 *   2  could not check at all (missing target) — phase 5 adds the
 *      environment-failure and bad-config cases to this code
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { severityOf } from "./config.js";
import { parseDoc } from "./parse.js";
import { checkDoc, makeCtx } from "./rules/links.js";
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

/** Run every rule over every Markdown file under `target`. */
export function runCheck(target: string): Report {
  const files = collectMarkdownFiles(target);
  const ctx = makeCtx();
  const findings: Finding[] = [];
  for (const abs of files) {
    const rel = path.relative(process.cwd(), abs) || path.basename(abs);
    const doc = parseDoc(abs, rel);
    findings.push(...checkDoc(doc, ctx));
  }
  // Apply the configured severity (defaults in phase 3; .vantage.toml in 5).
  for (const f of findings) f.severity = severityOf(f.rule);
  return { files: files.length, findings };
}

/** Map a report to a process exit code. */
export function exitCode(report: Report, strict: boolean): number {
  const hasError = report.findings.some((f) => f.severity === "error");
  if (hasError) return 1;
  if (strict && report.findings.length > 0) return 1;
  return 0;
}
