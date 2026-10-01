/**
 * Where the planning page lives (`docs/reference/planning-index.md` §6).
 *
 * Under `.vantage`, because viewer URLs are `/<path>` and `/<repo>/<path>`: a
 * bare `/planning` would hide every document under a top-level `planning/`
 * directory, and a whole repository named `planning`. The server never serves
 * a `.vantage` path as a document, so this URL hides nothing (Plan Q13).
 */

/** The planning page's route, before any repository segment. */
export const PLANNING_ROUTE = "/.vantage/planning";

/**
 * The planning page's URL: `/.vantage/planning`, or
 * `/.vantage/planning/<repo>` in daemon mode, where `repo` is the current one.
 */
export function planningPath(
  isMultiRepo: boolean,
  repo: string | null,
): string {
  return isMultiRepo && repo ? `${PLANNING_ROUTE}/${repo}` : PLANNING_ROUTE;
}
