import { create } from "zustand";
import axios from "axios";
import { GitCommit, FileDiff, RecentFile, FileStatus } from "../types";
import { useRepoStore } from "./useRepoStore";

// Build query string for recent files endpoint, including filter state
const getRecentParams = (limit: number): string => {
  const { showHidden, showGitignored } = useRepoStore.getState();
  const params = new URLSearchParams({ limit: String(limit) });
  if (!showHidden) params.set("show_hidden", "false");
  if (!showGitignored) params.set("show_gitignored", "false");
  return params.toString();
};

// Helper to get API base path.
// Returns null in multi-repo mode when no repo is selected.
const getApiBase = (): string | null => {
  const { currentRepo, isMultiRepo } = useRepoStore.getState();
  if (isMultiRepo) {
    if (!currentRepo) return null;
    return `/api/r/${encodeURIComponent(currentRepo)}`;
  }
  return "/api";
};

interface GitState {
  history: GitCommit[];
  latestCommit: GitCommit | null;
  fileGitStatus: string | null; // 'modified', 'added', 'deleted', 'untracked', or null
  isLoading: boolean;
  diff: FileDiff | null;
  isDiffLoading: boolean;
  showDiff: boolean;
  recentFiles: RecentFile[];
  isRecentLoading: boolean;
  recentFilesError: boolean;
  repoName: string | null;
  repoRootPath: string | null;

  fetchHistory: (path: string) => Promise<void>;
  fetchStatus: (path: string) => Promise<void>;
  fetchDiff: (path: string, commitSha: string) => Promise<void>;
  fetchWorkingDiff: (path: string) => Promise<void>;
  closeDiff: () => void;
  fetchRecentFiles: (force?: boolean) => Promise<void>;
  fetchRepoInfo: () => Promise<void>;
}

// In-flight request deduplication to prevent concurrent identical requests
// (e.g. multiple tabs or rapid WebSocket updates).
let _recentFilesPromise: Promise<void> | null = null;

export const useGitStore = create<GitState>((set) => ({
  history: [],
  latestCommit: null,
  fileGitStatus: null,
  isLoading: false,
  diff: null,
  isDiffLoading: false,
  showDiff: false,
  recentFiles: [],
  isRecentLoading: false,
  recentFilesError: false,
  repoName: null,
  repoRootPath: null,

  fetchHistory: async (path) => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    set({ isLoading: true });
    try {
      const response = await axios.get<GitCommit[]>(
        `${apiBase}/git/history?path=${encodeURIComponent(path)}`,
      );
      set({ history: response.data, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  fetchStatus: async (path) => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    try {
      const response = await axios.get<FileStatus>(
        `${apiBase}/git/status?path=${encodeURIComponent(path)}`,
      );
      set({
        latestCommit: response.data.last_commit,
        fileGitStatus: response.data.git_status,
      });
    } catch {
      set({ latestCommit: null, fileGitStatus: null });
    }
  },

  fetchDiff: async (path, commitSha) => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    set({ isDiffLoading: true, showDiff: true });
    try {
      const response = await axios.get<FileDiff | null>(
        `${apiBase}/git/diff?path=${encodeURIComponent(path)}&commit=${encodeURIComponent(commitSha)}`,
      );
      set({ diff: response.data, isDiffLoading: false });
    } catch {
      set({ diff: null, isDiffLoading: false });
    }
  },

  fetchWorkingDiff: async (path) => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    set({ isDiffLoading: true, showDiff: true });
    try {
      const response = await axios.get<FileDiff | null>(
        `${apiBase}/git/diff/working?path=${encodeURIComponent(path)}`,
      );
      set({ diff: response.data, isDiffLoading: false });
    } catch {
      set({ diff: null, isDiffLoading: false });
    }
  },

  closeDiff: () => {
    set({ showDiff: false, diff: null });
  },

  fetchRecentFiles: async (force?: boolean) => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    // Deduplicate concurrent requests (skip dedup if force=true)
    if (!force && _recentFilesPromise) return _recentFilesPromise;
    set({ isRecentLoading: true, recentFilesError: false });
    const promise = (async () => {
      let lastError = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // Re-check apiBase on retry — repo may have initialized
          const base = attempt === 0 ? apiBase : getApiBase();
          if (!base) break;
          const response = await axios.get<RecentFile[]>(
            `${base}/git/recent?${getRecentParams(30)}`,
          );
          set({ recentFiles: response.data, isRecentLoading: false });
          return;
        } catch {
          lastError = true;
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
      if (lastError) {
        // Preserve existing data on error (don't wipe to [])
        set((state) => ({
          recentFilesError: true,
          isRecentLoading: false,
          recentFiles: state.recentFiles,
        }));
      }
    })();
    _recentFilesPromise = promise;
    promise.finally(() => {
      _recentFilesPromise = null;
    });
    return promise;
  },

  fetchRepoInfo: async () => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    try {
      const response = await axios.get<{ name: string; root_path: string }>(
        `${apiBase}/info`,
      );
      set({
        repoName: response.data.name,
        repoRootPath: response.data.root_path,
      });
    } catch {
      set({ repoName: null, repoRootPath: null });
    }
  },
}));
