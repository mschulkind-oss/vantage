/**
 * Report rendering: human-readable text (default) and JSON (`--format json`).
 */

import type { Report } from "./types.js";

function byPosition(
  a: { file: string; line: number },
  b: { file: string; line: number },
) {
  return a.file.localeCompare(b.file) || a.line - b.line;
}

export function formatHuman(report: Report): string {
  if (report.configError !== null) {
    return `config error: ${report.configError}`;
  }
  const { findings, files } = report;
  const conclusive = report.unchecked.length === 0;
  const lines: string[] = [];
  if (findings.length === 0) {
    lines.push(
      `${conclusive ? "✓ " : ""}${files} ${files === 1 ? "file" : "files"} checked, no findings`,
    );
  } else {
    lines.push(
      ...findings
        .slice()
        .sort(byPosition)
        .map(
          (f) => `${f.file}:${f.line}: ${f.severity}: ${f.rule} — ${f.message}`,
        ),
    );
    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.length - errors;
    lines.push(
      "",
      `${findings.length} finding${findings.length === 1 ? "" : "s"} in ` +
        `${files} ${files === 1 ? "file" : "files"}${
          warnings > 0
            ? ` (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"})`
            : ""
        }`,
    );
  }
  if (report.unchecked.length > 0) {
    lines.push(
      "",
      `⚠ unchecked — could not verify with ${report.unchecked.length === 1 ? "this validator" : `these ${report.unchecked.length} validators`} (environment failure; exit 2):`,
    );
    for (const id of report.unchecked) lines.push(`  - ${id}`);
    if (report.environmentError !== null) {
      lines.push(`  ${report.environmentError}`);
    }
  }
  return lines.join("\n");
}

export function formatJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}
