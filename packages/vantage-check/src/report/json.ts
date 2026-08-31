import type { RunReport } from "../core/types.js";
import { VERSION } from "../version.js";
import { sortFindings } from "./text.js";

/**
 * The machine-readable report.
 *
 * `failures` is a sibling of `findings` rather than mixed into it, so a
 * consumer cannot treat "we could not check this" as "this is broken" by
 * looping over one array. The shape is a compatibility promise once it ships.
 */
export function renderJson(report: RunReport): string {
  const errors = report.findings.filter((f) => f.severity === "error").length;

  return `${JSON.stringify(
    {
      tool: "vantage-check",
      version: VERSION,
      filesChecked: report.filesChecked,
      summary: {
        errors,
        warnings: report.findings.length - errors,
        failures: report.failures.length,
      },
      findings: sortFindings(report.findings),
      failures: report.failures,
    },
    null,
    2,
  )}\n`;
}
