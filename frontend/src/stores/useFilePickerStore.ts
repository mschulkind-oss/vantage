import { create } from "zustand";
import axios from "axios";
import { useRepoStore } from "./useRepoStore";
import type { GlobalFile } from "../components/FilePicker";

const getApiBase = (): string | null => {
  const { currentRepo, isMultiRepo } = useRepoStore.getState();
  if (isMultiRepo) {
    if (!currentRepo) return null; // No repo selected — the caller wants global
    return `/api/r/${encodeURIComponent(currentRepo)}`;
  }
  return "/api";
};

// Out-of-order responses: a refresh can overtake the fetch an open fired, and
// the older answer must not land on top of the newer one.
let localSeq = 0;
let globalSeq = 0;

/** Which list the global picker is showing: every file, or recently changed. */
export type GlobalFileSource = "all" | "recent";

interface FilePickerState {
  /** Which picker is on screen, if any. */
  open: "local" | "global" | null;
  /** Files in the current repository. */
  files: string[];
  /** The repository `files` was fetched for. */
  filesRepo: string | null;
  /** Files across every repository, from whichever endpoint `globalSource` names. */
  globalFiles: GlobalFile[];
  globalSource: GlobalFileSource | null;
  loading: boolean;

  openLocal: () => Promise<void>;
  openGlobal: (source: GlobalFileSource) => Promise<void>;
  close: () => void;
  /**
   * Refetch the open picker's list, keeping the one on screen until the answer
   * arrives. A no-op when no picker is open.
   */
  refresh: () => Promise<void>;
}

/**
 * The file pickers' lists.
 *
 * They live in a store rather than in the page because the filesystem changes
 * under them — watching that happen is what this app is for. The watcher's
 * pushes reach them the same way they reach the tree, the recents list and the
 * bookmarks: useWebSocket refreshes the store. A list held in component state
 * could only ever be as fresh as the moment the picker opened.
 */
export const useFilePickerStore = create<FilePickerState>((set, get) => {
  const loadLocal = async () => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const seq = ++localSeq;
    set({ loading: true });
    try {
      const res = await axios.get<string[]>(`${apiBase}/files`);
      if (seq !== localSeq) return;
      set({ files: res.data });
    } catch (error) {
      // Keep whatever is on screen rather than blanking the picker on a
      // transient failure — the same choice useStarredStore makes for bookmarks.
      console.error("Failed to load the file list:", error);
    } finally {
      if (seq === localSeq) set({ loading: false });
    }
  };

  const loadGlobal = async (source: GlobalFileSource) => {
    const seq = ++globalSeq;
    set({ loading: true });
    try {
      const res = await axios.get<GlobalFile[]>(
        source === "all" ? "/api/files/all" : "/api/recent/all?limit=200",
      );
      if (seq !== globalSeq) return;
      set({ globalFiles: res.data });
    } catch (error) {
      console.error("Failed to load the file list:", error);
    } finally {
      if (seq === globalSeq) set({ loading: false });
    }
  };

  return {
    open: null,
    files: [],
    filesRepo: null,
    globalFiles: [],
    globalSource: null,
    loading: false,

    openLocal: async () => {
      const repo = useRepoStore.getState().currentRepo;
      // A list belonging to another repository is not stale data worth showing
      // while the refetch is in flight — it is the wrong list.
      if (get().filesRepo !== repo) set({ files: [], filesRepo: repo });
      set({ open: "local" });
      await loadLocal();
    },

    openGlobal: async (source) => {
      // Same for the other endpoint's answer: `Shift+R`'s recents are not a
      // stale version of `Shift+T`'s every-file list.
      if (get().globalSource !== source) {
        set({ globalFiles: [], globalSource: source });
      }
      set({ open: "global" });
      await loadGlobal(source);
    },

    close: () => set({ open: null, loading: false }),

    refresh: async () => {
      const { open, globalSource } = get();
      if (open === "local") {
        await loadLocal();
      } else if (open === "global" && globalSource) {
        await loadGlobal(globalSource);
      }
    },
  };
});
