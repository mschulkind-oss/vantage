import type { StarredEntry } from "../types";

/**
 * Percent-encode each segment of a repo-relative path, leaving the separators
 * alone so the result is still a path and not one escaped blob.
 *
 * Filenames may legally contain characters the address bar reads as structure:
 * `docs/#todo.md` would otherwise arrive as a fragment on `/docs/`, and
 * `a?b.md` as a query. React Router decodes params on the way back out, so the
 * path the viewer receives is the original either way.
 */
const encodePath = (p: string): string =>
  p.split("/").map(encodeURIComponent).join("/");

/**
 * The viewer link for a bookmark.
 *
 * Built from the entry's own repo, never from the repo currently selected: in
 * daemon mode one bookmark list spans several repositories, so using the
 * selected one would send half the rows to the wrong project. An empty repo is
 * the single-repo sentinel, whose URLs carry no repo segment at all.
 */
export const starredHref = (entry: StarredEntry): string =>
  entry.repo
    ? `/${encodeURIComponent(entry.repo)}/${encodePath(entry.path)}`
    : `/${encodePath(entry.path)}`;
