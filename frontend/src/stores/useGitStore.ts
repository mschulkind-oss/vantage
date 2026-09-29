import { create } from "zustand";
import axios from "axios";
import { GitCommit, FileDiff, RecentFile, FileStatus } from "../types";
import { useRepoStore } from "./useRepoStore";

// Build query string for a recent files endpoint, including filter state.
// Shared with useAllRecentsStore, so both scopes of the recents modal honor the
// same hidden/gitignored filters.
export const getRecentParams = (limit: number): string => {
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

/** One path's git status, as the server answered for it. */
export interface PathGitStatus {
  /** Its most recent commit, or `null` for a file with none (untracked). */
  lastCommit: GitCommit | null;
  /** `modified`, `added`, `deleted`, `untracked`, or `null` when clean. */
  gitStatus: string | null;
}

/**
 * How many paths' answers `statusByPath` and `historyByPath` keep, the least
 * recently answered first out. The viewer reads one path at a time, and the
 * one before it while a navigation is in flight; the rest is headroom.
 */
export const GIT_PATHS_KEPT = 32;

interface GitState {
  /** The last history asked for, whichever path it was: the history page's. */
  history: GitCommit[];
  /**
   * Each path's git status once the server has answered for it, by path, of
   * the repository asked about last. A path that is absent has no answer yet:
   * its status is not known, and the viewer's header shows nothing that
   * depends on it — above all not *Untracked file*, which is what an absent
   * commit used to read as (`docs/design/planning-index-at-scale.md` §11.1,
   * L3). Kept per path rather than as one current answer so that asking about
   * the next document, which the viewer does together with its content, leaves
   * the header of the document still on screen alone.
   *
   * A request that fails still answers: with no commit and no status.
   */
  statusByPath: Readonly<Record<string, PathGitStatus>>;
  /** Each path's history once answered, likewise; a failure answers `[]`. */
  historyByPath: Readonly<Record<string, GitCommit[]>>;
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

/**
 * The API base the per-path answers belong to. A path names a file only
 * within one repository, so the first request for another one forgets them,
 * and an answer for the one before is dropped when it lands.
 */
let answersBase: string | null = null;

/**
 * Per path, the number of the latest status and history request. An answer to
 * an older one is dropped, so a slow first answer cannot land over a newer one
 * (a document's load, then a push naming it).
 */
let requestSeq = 0;
const statusSent = new Map<string, number>();
const historySent = new Map<string, number>();

/** `record` with `path` answered `value`, as its newest entry, capped. */
function remember<T>(
  record: Readonly<Record<string, T>>,
  path: string,
  value: T,
): Record<string, T> {
  const next: Record<string, T> = { ...record };
  delete next[path];
  next[path] = value;
  const paths = Object.keys(next);
  const over = Math.max(0, paths.length - GIT_PATHS_KEPT);
  for (const old of paths.slice(0, over)) delete next[old];
  return next;
}

/** Forget every per-path answer and request number. For tests. */
export function resetGitAnswers(): void {
  answersBase = null;
  statusSent.clear();
  historySent.clear();
  useGitStore.setState({ statusByPath: {}, historyByPath: {} });
}

/**
 * Number a request for `path`'s status or history, forgetting the previous
 * repository's answers if this is the first for a new one. Answers whether the
 * request is still the one to keep when it lands.
 */
function send(
  sent: Map<string, number>,
  apiBase: string,
  path: string,
): () => boolean {
  if (apiBase !== answersBase) {
    answersBase = apiBase;
    statusSent.clear();
    historySent.clear();
    useGitStore.setState({ statusByPath: {}, historyByPath: {} });
  }
  const seq = ++requestSeq;
  sent.set(path, seq);
  return () => apiBase === answersBase && sent.get(path) === seq;
}

export const useGitStore = create<GitState>((set, get) => ({
  history: [],
  statusByPath: {},
  historyByPath: {},
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
    const current = send(historySent, apiBase, path);
    set({ isLoading: true });
    try {
      const response = await axios.get<GitCommit[]>(
        `${apiBase}/git/history?path=${encodeURIComponent(path)}`,
      );
      set({ history: response.data, isLoading: false });
      if (current()) {
        set({
          historyByPath: remember(get().historyByPath, path, response.data),
        });
      }
    } catch {
      set({ isLoading: false });
      if (current()) {
        set({ historyByPath: remember(get().historyByPath, path, []) });
      }
    }
  },

  fetchStatus: async (path) => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const current = send(statusSent, apiBase, path);
    let answer: PathGitStatus;
    try {
      const response = await axios.get<FileStatus>(
        `${apiBase}/git/status?path=${encodeURIComponent(path)}`,
      );
      answer = {
        lastCommit: response.data.last_commit,
        gitStatus: response.data.git_status,
      };
    } catch {
      answer = { lastCommit: null, gitStatus: null };
    }
    if (current()) {
      set({ statusByPath: remember(get().statusByPath, path, answer) });
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
