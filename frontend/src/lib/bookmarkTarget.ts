/**
 * The (repo, path) pair a bookmark for the current route would be stored under.
 *
 * This reads the URL rather than the repo store because the store cannot
 * answer it in the one case that matters. When a daemon no longer serves a
 * repository, ViewerPage clears `currentRepo` — deliberately, so the document
 * re-enters cleanly if the repo comes back — and puts the whole route in
 * `currentPath`. A bookmark recorded as ("beta", "b.md") would then be looked
 * up as ("", "beta/b.md") and never match, leaving the reader no way to remove
 * a bookmark to a retired repo, which is exactly when they want to.
 *
 * Returns null when the route names no document: the repo picker, a repo root,
 * or an empty path. None of those can be bookmarked.
 */
export const bookmarkTargetFromRoute = (
  pathParam: string | undefined,
  isMultiRepo: boolean,
): { repo: string; path: string } | null => {
  const segments = (pathParam || "").split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (!isMultiRepo) {
    return { repo: "", path: segments.join("/") };
  }
  // First segment is the repo; a repo with nothing after it is its root.
  if (segments.length === 1) return null;
  return { repo: segments[0], path: segments.slice(1).join("/") };
};
