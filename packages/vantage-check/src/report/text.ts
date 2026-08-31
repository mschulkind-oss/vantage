import type { EnvironmentFailure, Finding, RunReport } from "../core/types.js";

export interface TextOptions {
  color: boolean;
  /** Drop the trailing summary line. */
  quiet: boolean;
}

const RESET = "\u001b[0m";
const STYLES = {
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
} as const;

type Style = keyof typeof STYLES;

function paint(text: string, style: Style, color: boolean): string {
  return color ? `${STYLES[style]}${text}${RESET}` : text;
}

/**
 * The human-facing report: one block per file, then a one-line verdict.
 *
 * Sorted by file and position so a document's findings read top to bottom, and
 * so two runs over the same tree produce byte-identical output — a report an
 * agent diffs against its previous run is worth more than a prettier one.
 */
export function renderFindings(
  report: RunReport,
  options: TextOptions,
): string {
  const { color } = options;
  const lines: string[] = [];

  const byFile = new Map<string, Finding[]>();
  for (const finding of sortFindings(report.findings)) {
    const bucket = byFile.get(finding.file);
    if (bucket) bucket.push(finding);
    else byFile.set(finding.file, [finding]);
  }

  for (const [file, findings] of byFile) {
    lines.push(paint(file, "bold", color));

    const positions = findings.map((f) => `${f.line}:${f.column}`);
    const positionWidth = Math.max(...positions.map((p) => p.length));
    const severityWidth = Math.max(...findings.map((f) => f.severity.length));
    const ruleWidth = Math.max(...findings.map((f) => f.rule.length));

    findings.forEach((finding, index) => {
      const position = (positions[index] as string).padEnd(positionWidth);
      const severity = finding.severity.padEnd(severityWidth);
      lines.push(
        `  ${paint(position, "dim", color)}  ${paint(
          severity,
          finding.severity === "error" ? "red" : "yellow",
          color,
        )}  ${paint(finding.rule.padEnd(ruleWidth), "dim", color)}  ${
          finding.message
        }`,
      );
      if (finding.detail) {
        for (const detailLine of finding.detail.split("\n")) {
          lines.push(`      ${paint(detailLine, "dim", color)}`);
        }
      }
    });

    lines.push("");
  }

  if (!options.quiet) lines.push(summary(report, color));

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function summary(report: RunReport, color: boolean): string {
  const errors = report.findings.filter((f) => f.severity === "error").length;
  const warnings = report.findings.length - errors;
  const files = `${report.filesChecked} file${report.filesChecked === 1 ? "" : "s"}`;

  if (errors === 0 && warnings === 0) {
    return paint(`✓ ${files} checked, nothing to fix`, "green", color);
  }

  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  const mark = errors ? paint("✖", "red", color) : paint("!", "yellow", color);
  return `${mark} ${parts.join(", ")} in ${files} checked`;
}

/**
 * The report for validators that did not run.
 *
 * Deliberately not formatted like a finding: it is not a statement about the
 * document, and the last line says so, because an agent that mistakes this for
 * a defect will go looking for a defect that is not there.
 */
export function renderFailures(
  failures: EnvironmentFailure[],
  color: boolean,
): string {
  if (failures.length === 0) return "";

  const lines = [
    paint("vantage-check: some checks could not run", "red", color),
  ];
  for (const failure of failures) {
    lines.push(
      `  ${failure.rule}${failure.file ? ` on ${failure.file}` : ""}: ${failure.message}`,
    );
  }
  lines.push(
    paint(
      "  This is an environment failure, not a finding: those documents were not fully checked.",
      "dim",
      color,
    ),
  );
  return `${lines.join("\n")}\n`;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.rule.localeCompare(b.rule),
  );
}
