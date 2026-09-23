import { create } from "zustand";
import axios from "axios";
import { isStaticMode } from "../lib/staticMode";
import type { StarredEntry } from "../types";

/**
 * Bookmarks ("Starred").
 *
 * The API base is the literal "/api" here, with no getApiBase helper. That is
 * not an omission: the bookmark routes are global rather than repo-scoped,
 * because the server keys the list by the vantage invocation and each entry
 * carries its own repo name. `/api/r/{repo}/starred` does not exist.
 *
 * Bookmarks live on the server, not in localStorage, for two reasons the
 * feature is defined by: they must survive the browser (relaunching vantage in
 * the same directory restores them, on any port) and they must stay in sync
 * across browsers, which the `starred_changed` WebSocket push does by making
 * every client refetch.
 *
 * Static exports (`vantage build`) have no backend, and their axios interceptor
 * rewrites every request to a pre-generated JSON file and forces the method to
 * GET. Nothing is emitted for bookmarks there, so every action below is a
 * no-op: without the guard the star would appear to toggle and then revert on
 * reload.
 */
const API_BASE = "/api";

/**
 * Monotonic counter discarding a bookmark response that lost a race, the same
 * device useReviewStore's loadSeq is.
 *
 * Four things write this list — the mount GET, the reconnect GET, a GET
 * triggered by a `starred_changed` push, and every mutation's own response —
 * and none of them can be canceled. Without sequencing, starring while the
 * first GET is still in flight lets that older, emptier response land last and
 * erase the bookmark from the sidebar until something else refetches.
 */
let listSeq = 0;

interface StarredResponse {
  entries: StarredEntry[];
}

interface StarredState {
  entries: StarredEntry[];
  /** Whether the list has been fetched at least once. */
  loaded: boolean;

  loadStarred: () => Promise<void>;
  toggleStar: (repo: string, path: string, isDir: boolean) => Promise<void>;
  removeStar: (repo: string, path: string) => Promise<void>;
  isStarred: (repo: string, path: string) => boolean;
}

export const useStarredStore = create<StarredState>((set, get) => ({
  entries: [],
  loaded: false,

  loadStarred: async () => {
    if (isStaticMode()) return;
    const seq = ++listSeq;
    try {
      const res = await axios.get<StarredResponse>(`${API_BASE}/starred`);
      if (seq !== listSeq) return;
      set({ entries: res.data.entries ?? [], loaded: true });
    } catch (error) {
      // Keep whatever was on screen rather than blanking the section on a
      // transient failure — the same choice useGitStore makes for recents.
      console.error("Failed to load bookmarks:", error);
    }
  },

  // Writes are deliberately not optimistic: the server is local, and every
  // mutation answers with the whole list, so there is nothing to roll back and
  // no delta to merge.
  toggleStar: async (repo, path, isDir) => {
    if (isStaticMode()) return;
    if (get().isStarred(repo, path)) {
      await get().removeStar(repo, path);
      return;
    }
    const seq = ++listSeq;
    try {
      const res = await axios.post<StarredResponse>(`${API_BASE}/starred`, {
        repo,
        path,
        is_dir: isDir,
      });
      if (seq !== listSeq) return;
      set({ entries: res.data.entries ?? [], loaded: true });
    } catch (error) {
      console.error("Failed to add bookmark:", error);
    }
  },

  removeStar: async (repo, path) => {
    if (isStaticMode()) return;
    const seq = ++listSeq;
    try {
      const res = await axios.delete<StarredResponse>(`${API_BASE}/starred`, {
        params: { repo, path },
      });
      if (seq !== listSeq) return;
      set({ entries: res.data.entries ?? [], loaded: true });
    } catch (error) {
      console.error("Failed to remove bookmark:", error);
    }
  },

  // "The reader starred this" — NOT "this path is in the list". The distinction
  // is invisible until something is promoted and then breaks in a way nothing
  // reports: StarButton uses this one predicate both to render filled-vs-empty
  // and to choose add-vs-remove, so a promoted row counted here renders a filled
  // amber star for a document the reader never starred, whose click issues a
  // DELETE the server answers 404, which is logged and swallowed, leaving the
  // star filled. Nothing crashes and no test fails.
  isStarred: (repo, path) =>
    get().entries.some(
      (e) => e.source === "user" && e.repo === repo && e.path === path,
    ),
}));
