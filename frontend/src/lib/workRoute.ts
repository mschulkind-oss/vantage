export const WORK_ROUTE = "/.vantage/work";

export function workPath(isMultiRepo: boolean, repo: string | null): string {
  return isMultiRepo && repo
    ? `${WORK_ROUTE}/${encodeURIComponent(repo)}`
    : WORK_ROUTE;
}

export function workRepoFromPath(path: string): string | null {
  const match = new RegExp(`^${WORK_ROUTE}/([^/]+)(?:/|$)`).exec(path);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return "";
  }
}

export function isWorkRouteHref(href: string): boolean {
  const path = href.split(/[?#]/, 1)[0] ?? "";
  return path === WORK_ROUTE || path.startsWith(`${WORK_ROUTE}/`);
}
