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
    try {
      const res = await axios.get<StarredResponse>(`${API_BASE}/starred`);
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
    try {
      const res = await axios.post<StarredResponse>(`${API_BASE}/starred`, {
        repo,
        path,
        is_dir: isDir,
      });
      set({ entries: res.data.entries ?? [], loaded: true });
    } catch (error) {
      console.error("Failed to add bookmark:", error);
    }
  },

  removeStar: async (repo, path) => {
    if (isStaticMode()) return;
    try {
      const res = await axios.delete<StarredResponse>(`${API_BASE}/starred`, {
        params: { repo, path },
      });
      set({ entries: res.data.entries ?? [], loaded: true });
    } catch (error) {
      console.error("Failed to remove bookmark:", error);
    }
  },

  isStarred: (repo, path) =>
    get().entries.some((e) => e.repo === repo && e.path === path),
}));
