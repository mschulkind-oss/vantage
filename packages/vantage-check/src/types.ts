/**
 * Shared result types for the check command.
 *
 * A `Finding` is one reported problem, tied to a file, rule, line, and a
 * human-readable message. The same shape carries findings from the CLI's own
 * link rules (phase 3) and from the delegated validators (phase 5).
 */

export type Severity = "error" | "warning";

export interface Finding {
  /** Path to report (relative to the working directory). */
  file: string;
  /** Rule id, e.g. `link/missing-target`, `math/compile`. */
  rule: string;
  severity: Severity;
  /** 1-based line in the file (0 when no specific line applies). */
  line: number;
  message: string;
}

export interface Report {
  /** How many documents were checked. */
  files: number;
  findings: Finding[];
}
