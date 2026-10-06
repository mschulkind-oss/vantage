/**
 * How much text a planning filter may hold before it is read as not
 * understood (`docs/reference/planning-index.md` §6.14).
 *
 * In a module of its own so that the filter notices in `sections.ts` can name
 * the limits without importing `filter.ts`, which imports `sections.ts`: a
 * cycle between them would build `PLANNING_NOTICES` before its imports exist.
 * `filter.ts` re-exports both names, and that is where callers take them from.
 */

export interface PlanningFilterLimits {
  /** The most terms, counted as written, repeats included. */
  terms: number;
  /** The most code points in the whole text, white space included. */
  codePoints: number;
}

export const PLANNING_FILTER_LIMITS: Readonly<PlanningFilterLimits> =
  Object.freeze({ terms: 64, codePoints: 2048 });
