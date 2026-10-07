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
 * (`docs/reference/planning-index.md` §13.5).
 */
export const PLANNING_ROUTE = PLANNING_PAGE_PATH;

/**
 * The planning page's URL: `/.vantage/planning`, or
 * `/.vantage/planning/<repo>` in daemon mode, where `repo` is the current one,
 * percent-encoded as one path segment with `encodeURIComponent`. A
 * repository's name is a directory name, and may hold a space, `#`, `?` or
 * `%`. The server's startup tip encodes the segment too, with Go's
 * `url.PathEscape`, which writes some characters differently (`+ = @ : $ &`
 * bare where this encodes them, `( ) ! * '` encoded where this leaves them
 * bare). The route decodes either to the same name, so the two are the same
 * page but not always the same string.
 */
export function planningPath(
  isMultiRepo: boolean,
  repo: string | null,
): string {
  return isMultiRepo && repo
    ? `${PLANNING_ROUTE}/${encodeURIComponent(repo)}`
    : PLANNING_ROUTE;
}

/**
 * Whether `href`, as a link in a document writes it, is the planning page's
 * route: `/.vantage/planning`, with or without a project segment, a query or
 * a fragment. It is an app route rather than a path in the repository, so a
 * document's link to it, such as the checker's `Planning page:` line in a
 * handoff note (`docs/reference/planning-index.md` §13.6), opens it as
 * written, in daemon mode too.
 */
export function isPlanningRouteHref(href: string): boolean {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  return path === PLANNING_ROUTE || path.startsWith(`${PLANNING_ROUTE}/`);
}
