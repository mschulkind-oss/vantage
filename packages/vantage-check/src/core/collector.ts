import type { Node } from "unist";
import type { Document } from "./document.js";
import { fileLine } from "./document.js";
import type { Settings } from "./settings.js";
import type { EnvironmentFailure, Finding } from "./types.js";
import type { Workspace } from "./workspace.js";

/** Where a finding points, in *file* coordinates. */
export interface FilePosition {
  line: number;
  column: number;
}

/**
 * What a rule is handed, and the only way it can say anything.
 *
 * The two verbs are deliberately different shapes. `report` states something
 * about the document. `fail` says the check itself did not happen — the
 * distinction the whole design rests on, and the reason a rule cannot
 * accidentally turn a broken environment into a finding by throwing.
 */
export class Collector {
  readonly findings: Finding[] = [];
  readonly failures: EnvironmentFailure[] = [];

  constructor(
    readonly doc: Document,
    readonly settings: Settings,
    readonly workspace: Workspace,
    /** Where the run was started, for naming files a reader can find. */
    readonly cwd: string,
  ) {}

  enabled(rule: string): boolean {
    return this.settings.enabled(rule);
  }

  /** Report a problem with the document. */
  report(
    rule: string,
    at: FilePosition,
    message: string,
    detail?: string,
  ): void {
    if (!this.enabled(rule)) return;
    this.findings.push({
      rule,
      severity: this.settings.severity(rule),
      message,
      file: this.doc.display,
      line: at.line,
      column: at.column,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  /**
   * Report that a check could not run. Never a finding: the document has not
   * been judged, and a checker that cannot check must not report green.
   */
  fail(rule: string, message: string): void {
    this.failures.push({ rule, file: this.doc.display, message });
  }

  /**
   * The file position of an mdast node.
   *
   * mdast positions are relative to the *body*, because frontmatter is stripped
   * before parsing. Every rule goes through here so none of them has to
   * remember that.
   */
  at(node: Node): FilePosition {
    const start = node.position?.start;
    return {
      line: fileLine(this.doc, start?.line ?? 1),
      column: start?.column ?? 1,
    };
  }
}
