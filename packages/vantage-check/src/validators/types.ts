/**
 * Delegated-validator contract (design P2).
 *
 * A validator runs one of the *real* pieces of the Vantage pipeline against a
 * document and returns findings for what is wrong with the *document*. If it
 * cannot run at all — a missing/changed dependency, an unexpected error shape —
 * it throws an `EnvironmentFailure`. The runner records that validator as
 * *unchecked* and forces exit code 2: a checker that could not check never
 * reports green, and never reports an environment problem as a document
 * finding.
 */

import type { Finding } from "../types.js";
import type { ParsedDoc } from "../parse.js";

/** Stable ids for the delegated validators. */
export type ValidatorId =
  "math/compile" | "frontmatter" | "render/pipeline" | "mermaid/parse" | "lint";

export interface Validator {
  id: ValidatorId;
  /**
   * Run the validator over one document. Returns document-wrong findings, or
   * throws an {@link EnvironmentFailure} when it could not run.
   */
  run(doc: ParsedDoc): Finding[] | Promise<Finding[]>;
}

/**
 * Thrown by a validator when it fails for reasons that are the *environment's*
 * fault (not the document's). Collected into `Report.unchecked` and forces
 * exit code 2.
 */
export class EnvironmentFailure extends Error {
  constructor(
    public readonly validatorId: ValidatorId,
    message: string,
  ) {
    super(message);
    this.name = "EnvironmentFailure";
  }
}
