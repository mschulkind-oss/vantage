import type { StarredEntry } from "../types";

/**
 * The viewer link for a bookmark.
 *
 * Built from the entry's own repo, never from the repo currently selected: in
 * daemon mode one bookmark list spans several repositories, so using the
 * selected one would send half the rows to the wrong project. An empty repo is
 * the single-repo sentinel, whose URLs carry no repo segment at all.
 */
export const starredHref = (entry: StarredEntry): string =>
  entry.repo ? `/${entry.repo}/${entry.path}` : `/${entry.path}`;
