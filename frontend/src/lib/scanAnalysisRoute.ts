export const SCAN_ANALYSIS_ROUTE = "/.vantage/scan-analysis";

export function scanAnalysisPath(
  isMultiRepo: boolean,
  repo: string | null,
): string {
  return isMultiRepo && repo
    ? `${SCAN_ANALYSIS_ROUTE}/${encodeURIComponent(repo)}`
    : SCAN_ANALYSIS_ROUTE;
}

export function isScanAnalysisRoutePath(path: string): boolean {
  return (
    path === SCAN_ANALYSIS_ROUTE || path.startsWith(`${SCAN_ANALYSIS_ROUTE}/`)
  );
}

/** Read only the explicit project segment in this route, never app selection. */
export function scanAnalysisRepoFromPath(path: string): string | null {
  const prefix = `${SCAN_ANALYSIS_ROUTE}/`;
  if (!path.startsWith(prefix)) return null;
  const segment = path.slice(prefix.length).split("/", 1)[0] ?? "";
  if (segment === "") return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}
