/** How loudly a rule speaks when it fires. */
export type Severity = "error" | "warning";

/** A rule's configured setting: a severity, or off. */
export type RuleSetting = Severity | "off";

/**
 * One thing that is wrong with the document.
 *
 * Every finding is a statement about the *document*. A validator that could not
 * run produces an EnvironmentFailure instead — never a finding — because the
 * fastest way to make an agent stop running a checker is to report our broken
 * environment as its broken document.
 */
export interface Finding {
  /** Rule id, e.g. "link/missing-target". */
  rule: string;
  severity: Severity;
  /** One line, addressed to whoever has to fix it. */
  message: string;
  /** Path as it should be displayed — relative to the working directory. */
  file: string;
  /** 1-based line in the *file*, frontmatter included. */
  line: number;
  /** 1-based column. */
  column: number;
  /** The delegate's own words, when a delegate produced this. */
  detail?: string;
}

/**
 * A validator that could not run: a missing optional dependency, a parser that
 * needed a browser, a file we could not read. The document's status is
 * *unknown*, which is not the same as clean — so these fail the run (exit 3)
 * and never appear as findings.
 */
export interface EnvironmentFailure {
  /** The rule that could not run. */
  rule: string;
  /** The file it was checking, if it got that far. */
  file?: string;
  message: string;
}

/** Everything one file's rules produced. */
export interface FileReport {
  file: string;
  findings: Finding[];
  failures: EnvironmentFailure[];
}

/** Everything a run produced. */
export interface RunReport {
  /** How many files were opened. */
  filesChecked: number;
  findings: Finding[];
  failures: EnvironmentFailure[];
}
