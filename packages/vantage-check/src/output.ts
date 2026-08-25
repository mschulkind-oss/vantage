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
  const { findings, files } = report;
  if (findings.length === 0) {
    return `✓ ${files} ${files === 1 ? "file" : "files"} checked, no findings`;
  }
  const lines = findings
    .slice()
    .sort(byPosition)
    .map((f) => `${f.file}:${f.line}: ${f.severity}: ${f.rule} — ${f.message}`);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  const summary =
    `${findings.length} finding${findings.length === 1 ? "" : "s"} in ` +
    `${files} ${files === 1 ? "file" : "files"}${
      warnings > 0
        ? ` (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"})`
        : ""
    }`;
  return [...lines, "", summary].join("\n");
}

export function formatJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}
