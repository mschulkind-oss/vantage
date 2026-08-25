/**
 * The delegated validators and which run by default.
 *
 * The core validators always run — each delegates to a real piece of the
 * Vantage pipeline (KaTeX, the frontmatter parser, renderMarkdown, mermaid).
 * The lint validator is opt-in via `[check.lint] enabled = true`.
 */

import { validateFrontmatter } from "./frontmatter.js";
import { validateLint } from "./lint.js";
import { validateMath } from "./math.js";
import { validateMermaid } from "./mermaid.js";
import { validatePipeline } from "./pipeline.js";
import type { Validator } from "./types.js";
import type { Config } from "../config.js";

export { validateMath } from "./math.js";
export { validateFrontmatter } from "./frontmatter.js";
export { validatePipeline } from "./pipeline.js";
export { validateMermaid } from "./mermaid.js";
export { validateLint } from "./lint.js";
export { EnvironmentFailure } from "./types.js";
export type { Validator, ValidatorId } from "./types.js";

/** Validators that always run. */
export const CORE_VALIDATORS: Validator[] = [
  validateFrontmatter,
  validateMath,
  validateMermaid,
  validatePipeline,
];

/** Every validator, in run order. */
export const ALL_VALIDATORS: Validator[] = [
  validateFrontmatter,
  validateMath,
  validateMermaid,
  validatePipeline,
  validateLint,
];

/** Which validators run under a given config (lint is opt-in). */
export function activeValidators(config: Config): Validator[] {
  return config.lint.enabled ? ALL_VALIDATORS : CORE_VALIDATORS;
}
