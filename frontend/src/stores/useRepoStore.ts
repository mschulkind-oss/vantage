import { create } from "zustand";
import axios from "axios";
import { FileNode, FileContent, RepoInfo } from "../types";

interface RepoState {
  currentPath: string | null;
  currentRepo: string | null; // Current repo name (null for single-repo mode)
  repos: RepoInfo[]; // Available repos (empty for single-repo mode)
  isMultiRepo: boolean; // Whether running in multi-repo mode
  reposLoaded: boolean; // Whether repos have been loaded
  repoSortMode: "alphabetical" | "recent"; // How to sort repos in the list
  fileTree: FileNode[];
  fileContent: FileContent | null;
  currentDirectory: FileNode[] | null;
  isLoading: boolean;
  error: string | null;
  expandedDirs: Record<string, boolean>;
  showEmptyDirs: boolean; // Whether to show non-markdown directories
  showHidden: boolean; // Whether to show hidden (dot-prefixed) files/dirs
  showGitignored: boolean; // Whether to show gitignored files/dirs
  recentlyChangedPaths: ReadonlySet<string>; // Paths that just changed (for flash animation)

  loadRepos: () => Promise<void>;
  setCurrentRepo: (repo: string | null) => void;
  setRepoSortMode: (mode: "alphabetical" | "recent") => void;
  sortedRepos: () => RepoInfo[];
  loadFile: (path: string) => Promise<void>;
  viewDirectory: (path: string) => Promise<void>;
  refreshTree: (path?: string) => Promise<void>;
  refreshExpandedTree: () => Promise<void>;
  setCurrentPath: (path: string | null) => void;
  loadDirChildren: (path: string) => Promise<void>;
  toggleDir: (path: string) => void;
  expandToPath: (path: string) => void;
  loadPathDirectories: (path: string) => Promise<void>;
  setShowEmptyDirs: (show: boolean) => void;
  setShowHidden: (show: boolean) => void;
  setShowGitignored: (show: boolean) => void;
  markPathsChanged: (paths: Iterable<string>) => void;
}

// Helper to get API base path.
// Returns null in multi-repo mode when no repo is selected, to prevent
// accidental calls to legacy endpoints (which would serve CWD).
const getApiBase = (
  repo: string | null,
  isMultiRepo: boolean,
): string | null => {
  if (isMultiRepo) {
    if (!repo) return null; // No repo selected — caller must not proceed
    return `/api/r/${encodeURIComponent(repo)}`;
  }
  return "/api";
};

// Build query string for tree endpoints, including filter state
const getTreeParams = (
  path: string,
  extra?: Record<string, string>,
): string => {
  const { showHidden, showGitignored } = useRepoStore.getState();
  const params = new URLSearchParams({ path });
  if (!showHidden) params.set("show_hidden", "false");
  if (!showGitignored) params.set("show_gitignored", "false");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  return params.toString();
};

// Helper function to recursively update tree nodes
const updateTreeNode = (
  nodes: FileNode[],
  path: string,
  children: FileNode[],
): FileNode[] => {
  return nodes.map((node) => {
    if (node.path === path) {
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: updateTreeNode(node.children, path, children),
      };
    }
    return node;
  });
};

// Helper to merge new nodes with existing nodes, preserving children of existing nodes
const mergeNodes = (
  existingNodes: FileNode[],
  newNodes: FileNode[],
): FileNode[] => {
  return newNodes.map((newNode) => {
    const existing = existingNodes.find((n) => n.path === newNode.path);
    if (existing && existing.children) {
      return { ...newNode, children: existing.children };
    }
    return newNode;
  });
};

export const useRepoStore = create<RepoState>((set, get) => ({
  currentPath: null,
  currentRepo: null,
  repos: [],
  isMultiRepo: false,
  reposLoaded: false,
  repoSortMode: (() => {
    try {
      const stored = localStorage.getItem("vantage:repoSortMode");
      return stored === "recent" ? "recent" : "alphabetical";
    } catch {
      return "alphabetical" as const;
    }
  })(),
  fileTree: [],
  fileContent: null,
  currentDirectory: null,
  isLoading: false,
  error: null,
  expandedDirs: {},
  showEmptyDirs: (() => {
    try {
      return localStorage.getItem("vantage:showEmptyDirs") !== "false";
    } catch {
      return true;
    }
  })(),
  showHidden: (() => {
    try {
      return localStorage.getItem("vantage:showHidden") === "true";
    } catch {
      return false;
    }
  })(),
  showGitignored: (() => {
    try {
      return localStorage.getItem("vantage:showGitignored") !== "false";
    } catch {
      return true;
    }
  })(),
  recentlyChangedPaths: new Set<string>(),

  markPathsChanged: (paths) => {
    const pathSet = new Set(paths);
    set({ recentlyChangedPaths: pathSet });
    setTimeout(() => {
      // Only clear if the set hasn't been replaced by a newer update
      if (get().recentlyChangedPaths === pathSet) {
        set({ recentlyChangedPaths: new Set<string>() });
      }
    }, 1500);
  },

  setShowEmptyDirs: (show) => {
    try {
      localStorage.setItem("vantage:showEmptyDirs", String(show));
    } catch {
      /* ignore */
    }
    set({ showEmptyDirs: show });
  },

  setShowHidden: (show) => {
    try {
      localStorage.setItem("vantage:showHidden", String(show));
    } catch {
      /* ignore */
    }
    set({ showHidden: show });
  },

  setShowGitignored: (show) => {
    try {
      localStorage.setItem("vantage:showGitignored", String(show));
    } catch {
      /* ignore */
    }
    set({ showGitignored: show });
  },

  loadRepos: async () => {
    try {
      const response = await axios.get<RepoInfo[]>("/api/repos");
      const repos = response.data;
      // If there's exactly one repo with empty name, we're in single-repo mode
      const isMultiRepo = !(repos.length === 1 && repos[0].name === "");
      set({
        repos,
        isMultiRepo,
        reposLoaded: true,
        currentRepo: isMultiRepo ? null : null,
        // Clear directory when switching to multi-repo mode
        currentDirectory: isMultiRepo ? null : get().currentDirectory,
        fileContent: isMultiRepo ? null : get().fileContent,
        fileTree: isMultiRepo ? [] : get().fileTree,
      });
    } catch (error) {
      console.error("Failed to load repos", error);
      set({ reposLoaded: true }); // Mark as loaded even on error to avoid infinite loop
    }
  },

  setCurrentRepo: (repo) => {
    // Skip full reset if already on this repo (e.g. coming back from HistoryPage)
    if (repo === get().currentRepo) return;
    set({
      currentRepo: repo,
      fileTree: [],
      fileContent: null,
      currentDirectory: null,
      currentPath: null,
      expandedDirs: {},
      isLoading: false,
      error: null,
    });
    // Refresh tree for the new repo
    get().refreshTree();
  },

  setRepoSortMode: (mode) => {
    set({ repoSortMode: mode });
    try {
      localStorage.setItem("vantage:repoSortMode", mode);
    } catch {
      // localStorage may be unavailable
    }
  },

  sortedRepos: () => {
    const { repos, repoSortMode } = get();
    const sorted = [...repos];
    if (repoSortMode === "recent") {
      sorted.sort((a, b) => {
        if (!a.last_activity && !b.last_activity)
          return a.name.localeCompare(b.name);
        if (!a.last_activity) return 1;
        if (!b.last_activity) return -1;
        return (
          new Date(b.last_activity).getTime() -
          new Date(a.last_activity).getTime()
        );
      });
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  },

  setCurrentPath: (path) => set({ currentPath: path }),

  toggleDir: (path) =>
    set((state) => {
      const isExpanded = state.expandedDirs[path];
      return {
        expandedDirs: {
          ...state.expandedDirs,
          [path]: !isExpanded,
        },
      };
    }),

  expandToPath: (path) =>
    set((state) => {
      // Handle empty or root paths
      if (!path || path === ".") {
        return state;
      }

      // Split path and build directory paths
      const parts = path.split("/");

      // Check if the last part is a file (has an extension like .md)
      const lastPart = parts[parts.length - 1] || "";
      const isFile = lastPart.includes(".");

      // If it's a file, remove it from parts (we don't expand files, only directories)
      if (isFile) {
        parts.pop();
      }

      // Build all directory paths and mark them as expanded
      const newExpandedDirs = { ...state.expandedDirs };
      let currentPath = "";
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        newExpandedDirs[currentPath] = true;
      }

      return { expandedDirs: newExpandedDirs };
    }),

  // Load directory children for all expanded directories along a path
  loadPathDirectories: async (path: string) => {
    if (!path || path === ".") return;

    const parts = path.split("/");
    parts.pop(); // Remove file name

    // Build the list of directory paths along the way
    const paths: string[] = [];
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      paths.push(currentPath);
    }

    // Helper: find a node in the tree by path
    const findNode = (
      nodes: FileNode[],
      targetPath: string,
    ): FileNode | undefined => {
      for (const node of nodes) {
        if (node.path === targetPath) return node;
        if (node.children) {
          const found = findNode(node.children, targetPath);
          if (found) return found;
        }
      }
      return undefined;
    };

    // Load directories sequentially (parent before child) so that
    // updateTreeNode can locate each child in the already-updated tree.
    // Using Promise.all here would race: a child dir response arriving
    // before its parent causes updateTreeNode to silently drop the update,
    // leaving the child expanded with no children (permanent spinner).
    const { loadDirChildren } = useRepoStore.getState();
    for (const p of paths) {
      const { fileTree: currentTree } = useRepoStore.getState();
      const node = findNode(currentTree, p);
      if (!node || !node.children) {
        await loadDirChildren(p);
      }
    }
  },

  loadDirChildren: async (path) => {
    const { currentRepo, isMultiRepo } = get();
    const apiBase = getApiBase(currentRepo, isMultiRepo);
    if (!apiBase) return; // No repo selected in multi-repo mode
    try {
      const response = await axios.get<FileNode[]>(
        `${apiBase}/tree?${getTreeParams(path)}`,
        { timeout: 15_000 },
      );
      set((state) => {
        if (path === ".") {
          return { fileTree: mergeNodes(state.fileTree, response.data) };
        }
        return {
          fileTree: updateTreeNode(state.fileTree, path, response.data),
        };
      });
    } catch (error) {
      console.error("Failed to load directory children", error);
      // Set empty children so the loading skeleton doesn't get stuck
      set((state) => ({
        fileTree: updateTreeNode(state.fileTree, path, []),
      }));
    }
  },

  loadFile: async (path) => {
    const { currentRepo, isMultiRepo } = get();
    const apiBase = getApiBase(currentRepo, isMultiRepo);
    if (!apiBase) return; // No repo selected in multi-repo mode
    // Don't clear existing content until new content arrives — avoids flash
    set({ isLoading: true, error: null });
    try {
      const response = await axios.get<FileContent>(
        `${apiBase}/content?path=${encodeURIComponent(path)}`,
      );
      set({
        fileContent: response.data,
        currentPath: path,
        isLoading: false,
        currentDirectory: null,
      });
    } catch {
      set({
        error: "Failed to load file content",
        isLoading: false,
        fileContent: null,
        currentDirectory: null,
      });
    }
  },

  viewDirectory: async (path) => {
    const { currentRepo, isMultiRepo } = get();
    const apiBase = getApiBase(currentRepo, isMultiRepo);
    if (!apiBase) return; // No repo selected in multi-repo mode
    // Don't clear existing content until new content arrives — avoids flash
    set({ isLoading: true, error: null });
    try {
      // include_git=true because DirectoryViewer shows commit messages/dates
      const response = await axios.get<FileNode[]>(
        `${apiBase}/tree?${getTreeParams(path, { include_git: "true" })}`,
      );
      set({
        currentDirectory: response.data,
        currentPath: path,
        isLoading: false,
        fileContent: null,
      });
    } catch {
      set({
        error: "Failed to load directory",
        isLoading: false,
        currentDirectory: null,
        fileContent: null,
      });
    }
  },

  refreshTree: async (path = ".") => {
    const { currentRepo, isMultiRepo } = get();
    const apiBase = getApiBase(currentRepo, isMultiRepo);
    if (!apiBase) return; // No repo selected in multi-repo mode
    try {
      const response = await axios.get<FileNode[]>(
        `${apiBase}/tree?${getTreeParams(path)}`,
      );
      if (path === ".") {
        set((state) => ({
          fileTree: mergeNodes(state.fileTree, response.data),
        }));
      } else {
        set((state) => ({
          fileTree: updateTreeNode(state.fileTree, path, response.data),
        }));
      }
    } catch (error) {
      console.error("Failed to refresh tree", error);
    }
  },

  refreshExpandedTree: async () => {
    const { currentRepo, isMultiRepo } = get();
    const apiBase = getApiBase(currentRepo, isMultiRepo);
    if (!apiBase) return;

    // 1. Fetch root tree data
    let rootData: FileNode[] | null = null;
    try {
      const response = await axios.get<FileNode[]>(
        `${apiBase}/tree?${getTreeParams(".")}`,
      );
      rootData = response.data;
    } catch (error) {
      console.error("Failed to refresh root tree", error);
    }

    // 2. Collect expanded dirs, sorted parent-before-child
    const { expandedDirs } = get();
    const expanded = Object.entries(expandedDirs)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort((a, b) => a.split("/").length - b.split("/").length);

    // 3. Fetch all expanded dirs in parallel
    const dirResults: Array<{ path: string; children: FileNode[] }> = [];
    const fetches = expanded.map(async (dir) => {
      try {
        const response = await axios.get<FileNode[]>(
          `${apiBase}/tree?${getTreeParams(dir)}`,
          { timeout: 15_000 },
        );
        return { path: dir, children: response.data };
      } catch {
        return { path: dir, children: [] as FileNode[] };
      }
    });
    dirResults.push(...(await Promise.all(fetches)));

    // 4. Apply ALL updates in a single set() — one render instead of N+1
    set((state) => {
      let tree = rootData
        ? mergeNodes(state.fileTree, rootData)
        : state.fileTree;
      // Apply in depth order so parent nodes exist before children
      for (const { path, children } of dirResults) {
        if (path === ".") {
          tree = mergeNodes(tree, children);
        } else {
          tree = updateTreeNode(tree, path, children);
        }
      }
      return { fileTree: tree };
    });
  },
}));
