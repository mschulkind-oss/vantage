/**
 * Rule severities.
 *
 * Phase 3 runs with built-in defaults only. `.vantage.toml` discovery,
 * per-rule overrides, the lint opt-in, and the exit-2 bad-config policy land
 * in phase 5 — this module is where that resolution will live, so `check.ts`
 * already asks it for severities rather than hardcoding them.
 */

import type { Severity } from "./types.js";

/** Built-in severity for every rule the CLI knows. */
export const DEFAULT_SEVERITIES: Record<string, Severity> = {
  "link/leading-slash": "error",
  "link/uri-scheme": "error",
  "link/missing-target": "error",
  "link/line-anchor-range": "error",
  "link/dead-section-anchor": "error",
};

/**
 * Effective severity for a rule under the current (defaults-only) config.
 * Unknown rules default to warning: a rule we don't know about should never
 * by itself make a run fail.
 */
export function severityOf(rule: string): Severity {
  return DEFAULT_SEVERITIES[rule] ?? "warning";
}
