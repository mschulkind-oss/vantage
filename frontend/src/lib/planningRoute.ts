/**
 * Where the planning page lives (`docs/reference/planning-index.md` §6).
 *
 * Under `.vantage`, because viewer URLs are `/<path>` and `/<repo>/<path>`: a
 * bare `/planning` would hide every document under a top-level `planning/`
 * directory, and a whole repository named `planning`. The server never serves
 * a `.vantage` path as a document, so this URL hides nothing (Plan Q13).
 */

import { PLANNING_PAGE_PATH } from "vantage-md/planning";

/**
 * The planning page's route, before any repository segment: the planning
 * module's, which the checker's root-relative link starts with too
 * (`docs/design/planning-filter.md` §9.2).
 */
export const PLANNING_ROUTE = PLANNING_PAGE_PATH;

/**
 * The planning page's URL: `/.vantage/planning`, or
 * `/.vantage/planning/<repo>` in daemon mode, where `repo` is the current one,
 * percent-encoded as one path segment. A repository's name is a directory
 * name, and may hold a space, `#`, `?` or `%`, which the server's startup tip
 * encodes the same way (`url.PathEscape`), and the route decodes.
 */
export function planningPath(
  isMultiRepo: boolean,
  repo: string | null,
): string {
  return isMultiRepo && repo
    ? `${PLANNING_ROUTE}/${encodeURIComponent(repo)}`
    : PLANNING_ROUTE;
}
