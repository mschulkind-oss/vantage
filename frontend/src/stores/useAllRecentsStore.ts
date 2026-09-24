import { create } from "zustand";
import axios from "axios";
import type { RecentAllFile } from "../types";
import { getRecentParams } from "./useGitStore";

/**
 * How many rows the all-projects recents modal asks for. Larger than the
 * per-project modal's 30 because it spans every project, and one busy project
 * would otherwise crowd the rest out.
 */
export const ALL_RECENTS_LIMIT = 50;

// Out-of-order responses: a watcher refresh can overtake the fetch an open
// fired, and the older answer must not land on top of the newer one.
let seq = 0;

interface AllRecentsState {
  /** Whether the all-projects recents modal is on screen. */
  active: boolean;
  files: RecentAllFile[];
  loading: boolean;
  error: boolean;

  /** Mark the list as on screen and fetch it. */
  open: () => Promise<void>;
  close: () => void;
  /**
   * Refetch while the modal is open, keeping the list on screen until the
   * answer arrives. A no-op when it is closed, so the watcher's pushes fetch
   * nothing for a list nobody is looking at.
   */
  refresh: () => Promise<void>;
}

/**
 * The recently changed files across every project, for `Shift+R`.
 *
 * A store rather than component state for the same reason as the file
 * pickers' lists (see useFilePickerStore): the watcher's pushes reach it
 * through useWebSocket, so the list stays live while it is open. The
 * per-project list lives in useGitStore, which the sidebar shares.
 */
export const useAllRecentsStore = create<AllRecentsState>((set, get) => {
  const load = async () => {
    const mine = ++seq;
    set({ loading: true, error: false });
    try {
      const res = await axios.get<RecentAllFile[]>(
        `/api/recent/all?${getRecentParams(ALL_RECENTS_LIMIT)}`,
      );
      if (mine !== seq) return;
      set({ files: res.data });
    } catch (error) {
      if (mine !== seq) return;
      // Keep whatever is on screen rather than blanking it on a transient
      // failure; the modal shows a retry banner over it.
      console.error("Failed to load recent files across projects:", error);
      set({ error: true });
    } finally {
      if (mine === seq) set({ loading: false });
    }
  };

  return {
    active: false,
    files: [],
    loading: false,
    error: false,

    open: async () => {
      set({ active: true });
      await load();
    },

    close: () => set({ active: false }),

    refresh: async () => {
      if (!get().active) return;
      await load();
    },
  };
});
