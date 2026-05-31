import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRepoStore } from "./useRepoStore";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

describe("useRepoStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    useRepoStore.setState({
      currentPath: null,
      currentRepo: null,
      isMultiRepo: false,
      reposLoaded: false,
      fileTree: [],
      fileContent: null,
      currentDirectory: null,
      isLoading: false,
      error: null,
      expandedDirs: {},
      showHidden: true,
      showGitignored: true,
    });
    vi.clearAllMocks();
  });

  describe("setCurrentPath", () => {
    it("sets the current path", () => {
      useRepoStore.getState().setCurrentPath("test/path");
      expect(useRepoStore.getState().currentPath).toBe("test/path");
    });

    it("can set path to null", () => {
      useRepoStore.setState({ currentPath: "some/path" });
      useRepoStore.getState().setCurrentPath(null);
      expect(useRepoStore.getState().currentPath).toBeNull();
    });
  });

  describe("toggleDir", () => {
    it("expands a collapsed directory", () => {
      useRepoStore.getState().toggleDir("subdir");
      expect(useRepoStore.getState().expandedDirs["subdir"]).toBe(true);
    });

    it("collapses an expanded directory", () => {
      useRepoStore.setState({ expandedDirs: { subdir: true } });
      useRepoStore.getState().toggleDir("subdir");
      expect(useRepoStore.getState().expandedDirs["subdir"]).toBe(false);
    });
  });

  describe("loadFile", () => {
    it("loads file content successfully", async () => {
      const mockContent = {
        path: "test.md",
        content: "# Hello World",
        encoding: "utf-8",
      };
      mockedAxios.get.mockResolvedValueOnce({ data: mockContent });

      await useRepoStore.getState().loadFile("test.md");

      expect(mockedAxios.get).toHaveBeenCalledWith("/api/content?path=test.md");
      expect(useRepoStore.getState().fileContent).toEqual(mockContent);
      expect(useRepoStore.getState().currentPath).toBe("test.md");
      expect(useRepoStore.getState().isLoading).toBe(false);
      expect(useRepoStore.getState().currentDirectory).toBeNull();
    });

    it("handles load error gracefully", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Not found"));

      await useRepoStore.getState().loadFile("nonexistent.md");

      expect(useRepoStore.getState().error).toBe("Failed to load file content");
      expect(useRepoStore.getState().isLoading).toBe(false);
    });
  });

  describe("viewDirectory", () => {
    it("loads directory contents successfully", async () => {
      const mockNodes = [
        { name: "file1.md", path: "subdir/file1.md", is_dir: false },
        { name: "file2.md", path: "subdir/file2.md", is_dir: false },
      ];
      mockedAxios.get.mockResolvedValueOnce({ data: mockNodes });

      await useRepoStore.getState().viewDirectory("subdir");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "/api/tree?path=subdir&include_git=true",
      );
      expect(useRepoStore.getState().currentDirectory).toEqual(mockNodes);
      expect(useRepoStore.getState().currentPath).toBe("subdir");
      expect(useRepoStore.getState().isLoading).toBe(false);
      expect(useRepoStore.getState().fileContent).toBeNull();
    });

    it("handles load error gracefully", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Not found"));

      await useRepoStore.getState().viewDirectory("nonexistent");

      expect(useRepoStore.getState().error).toBe("Failed to load directory");
      expect(useRepoStore.getState().isLoading).toBe(false);
    });
  });

  describe("refreshTree", () => {
    it("loads root tree successfully", async () => {
      const mockNodes = [
        { name: "README.md", path: "README.md", is_dir: false },
        { name: "subdir", path: "subdir", is_dir: true },
      ];
      mockedAxios.get.mockResolvedValueOnce({ data: mockNodes });

      await useRepoStore.getState().refreshTree();

      expect(mockedAxios.get).toHaveBeenCalledWith("/api/tree?path=.");
      expect(useRepoStore.getState().fileTree).toEqual(mockNodes);
    });

    it("preserves existing children when refreshing", async () => {
      const existingTree = [
        {
          name: "subdir",
          path: "subdir",
          is_dir: true,
          children: [
            { name: "nested.md", path: "subdir/nested.md", is_dir: false },
          ],
        },
      ];
      useRepoStore.setState({ fileTree: existingTree });

      const refreshedNodes = [{ name: "subdir", path: "subdir", is_dir: true }];
      mockedAxios.get.mockResolvedValueOnce({ data: refreshedNodes });

      await useRepoStore.getState().refreshTree();

      const tree = useRepoStore.getState().fileTree;
      expect(tree[0].children).toBeDefined();
      expect(tree[0].children?.length).toBe(1);
    });
  });

  describe("loadDirChildren", () => {
    it("loads and updates tree with children", async () => {
      const initialTree = [{ name: "subdir", path: "subdir", is_dir: true }];
      useRepoStore.setState({ fileTree: initialTree });

      const mockChildren = [
        { name: "nested.md", path: "subdir/nested.md", is_dir: false },
      ];
      mockedAxios.get.mockResolvedValueOnce({ data: mockChildren });

      await useRepoStore.getState().loadDirChildren("subdir");

      expect(mockedAxios.get).toHaveBeenCalledWith("/api/tree?path=subdir", {
        timeout: 15_000,
      });
      const tree = useRepoStore.getState().fileTree;
      expect(tree[0].children).toEqual(mockChildren);
    });

    it("sets empty children on API error to clear spinner", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const initialTree = [{ name: "subdir", path: "subdir", is_dir: true }];
      useRepoStore.setState({ fileTree: initialTree });

      mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));

      await useRepoStore.getState().loadDirChildren("subdir");
      consoleSpy.mockRestore();

      const tree = useRepoStore.getState().fileTree;
      // children should be empty array, not undefined — spinner must stop
      expect(tree[0].children).toEqual([]);
    });

    it("sets empty children on timeout to clear spinner", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const initialTree = [{ name: "subdir", path: "subdir", is_dir: true }];
      useRepoStore.setState({ fileTree: initialTree });

      mockedAxios.get.mockRejectedValueOnce(
        new Error("timeout of 15000ms exceeded"),
      );

      await useRepoStore.getState().loadDirChildren("subdir");
      consoleSpy.mockRestore();

      const tree = useRepoStore.getState().fileTree;
      expect(tree[0].children).toEqual([]);
    });

    it("does nothing when no repo selected in multi-repo mode", async () => {
      useRepoStore.setState({
        isMultiRepo: true,
        currentRepo: null,
        fileTree: [{ name: "subdir", path: "subdir", is_dir: true }],
      });

      await useRepoStore.getState().loadDirChildren("subdir");

      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("handles root path by merging nodes", async () => {
      const existingTree = [
        {
          name: "docs",
          path: "docs",
          is_dir: true,
          children: [{ name: "file.md", path: "docs/file.md", is_dir: false }],
        },
      ];
      useRepoStore.setState({ fileTree: existingTree });

      const newRootNodes = [
        { name: "docs", path: "docs", is_dir: true },
        { name: "README.md", path: "README.md", is_dir: false },
      ];
      mockedAxios.get.mockResolvedValueOnce({ data: newRootNodes });

      await useRepoStore.getState().loadDirChildren(".");

      const tree = useRepoStore.getState().fileTree;
      expect(tree).toHaveLength(2);
      // Existing children should be preserved via mergeNodes
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children![0].path).toBe("docs/file.md");
    });
  });

  describe("loadPathDirectories", () => {
    it("loads directories sequentially for nested paths", async () => {
      // Set up root tree with a "docs" dir (no children loaded yet)
      useRepoStore.setState({
        fileTree: [{ name: "docs", path: "docs", is_dir: true }],
      });

      const callOrder: string[] = [];

      mockedAxios.get.mockImplementation(async (url: string) => {
        const path = decodeURIComponent(url.replace("/api/tree?path=", ""));
        callOrder.push(path);

        if (path === "docs") {
          return {
            data: [{ name: "design", path: "docs/design", is_dir: true }],
          };
        }
        if (path === "docs/design") {
          return {
            data: [
              {
                name: "spec.md",
                path: "docs/design/spec.md",
                is_dir: false,
              },
            ],
          };
        }
        return { data: [] };
      });

      await useRepoStore.getState().loadPathDirectories("docs/design/spec.md");

      // Verify sequential order: parent loaded before child
      expect(callOrder).toEqual(["docs", "docs/design"]);

      // Verify tree structure is complete
      const tree = useRepoStore.getState().fileTree;
      expect(tree[0].path).toBe("docs");
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children![0].path).toBe("docs/design");
      expect(tree[0].children![0].children).toHaveLength(1);
      expect(tree[0].children![0].children![0].path).toBe(
        "docs/design/spec.md",
      );
    });

    it("skips directories that already have children loaded", async () => {
      useRepoStore.setState({
        fileTree: [
          {
            name: "docs",
            path: "docs",
            is_dir: true,
            children: [{ name: "design", path: "docs/design", is_dir: true }],
          },
        ],
      });

      mockedAxios.get.mockResolvedValueOnce({
        data: [
          {
            name: "spec.md",
            path: "docs/design/spec.md",
            is_dir: false,
          },
        ],
      });

      await useRepoStore.getState().loadPathDirectories("docs/design/spec.md");

      // Only "docs/design" should be loaded (docs already has children)
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "/api/tree?path=docs%2Fdesign",
        { timeout: 15_000 },
      );
    });

    it("handles empty or root paths gracefully", async () => {
      await useRepoStore.getState().loadPathDirectories("");
      await useRepoStore.getState().loadPathDirectories(".");

      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("does not leave permanent spinners when parent loads after child would", async () => {
      // This test verifies the fix for the race condition.
      // With sequential loading, the parent always resolves before the child,
      // so the child node exists in the tree when updateTreeNode runs.
      useRepoStore.setState({
        fileTree: [{ name: "a", path: "a", is_dir: true }],
      });

      const resolveOrder: string[] = [];

      mockedAxios.get.mockImplementation(async (url: string) => {
        const path = decodeURIComponent(url.replace("/api/tree?path=", ""));
        resolveOrder.push(path);

        if (path === "a") {
          return {
            data: [{ name: "b", path: "a/b", is_dir: true }],
          };
        }
        if (path === "a/b") {
          return {
            data: [{ name: "file.md", path: "a/b/file.md", is_dir: false }],
          };
        }
        return { data: [] };
      });

      await useRepoStore.getState().loadPathDirectories("a/b/file.md");

      // Parent loaded first, child loaded second
      expect(resolveOrder).toEqual(["a", "a/b"]);

      // Both nodes have children — no spinners
      const tree = useRepoStore.getState().fileTree;
      const nodeA = tree.find((n) => n.path === "a");
      expect(nodeA?.children).toBeDefined();
      expect(nodeA!.children!.length).toBeGreaterThan(0);

      const nodeB = nodeA!.children!.find((n) => n.path === "a/b");
      expect(nodeB?.children).toBeDefined();
      expect(nodeB!.children!.length).toBeGreaterThan(0);
    });
  });

  describe("expandToPath", () => {
    it("expands all parent directories of a path", () => {
      useRepoStore.getState().expandToPath("docs/design/technical_spec.md");

      const expandedDirs = useRepoStore.getState().expandedDirs;
      expect(expandedDirs["docs"]).toBe(true);
      expect(expandedDirs["docs/design"]).toBe(true);
      expect(expandedDirs["docs/design/technical_spec.md"]).toBeUndefined();
    });

    it("handles root-level files gracefully", () => {
      useRepoStore.getState().expandToPath("README.md");
      expect(Object.keys(useRepoStore.getState().expandedDirs).length).toBe(0);
    });

    it("handles single-level directory paths", () => {
      useRepoStore.getState().expandToPath("docs/file.md");
      expect(useRepoStore.getState().expandedDirs["docs"]).toBe(true);
    });

    it("expands directories when navigating to them directly", () => {
      useRepoStore.getState().expandToPath("docs");
      expect(useRepoStore.getState().expandedDirs["docs"]).toBe(true);
    });

    it("expands nested directories when navigating to them directly", () => {
      useRepoStore.getState().expandToPath("docs/design");
      const expandedDirs = useRepoStore.getState().expandedDirs;
      expect(expandedDirs["docs"]).toBe(true);
      expect(expandedDirs["docs/design"]).toBe(true);
    });

    it("handles empty path gracefully", () => {
      useRepoStore.getState().expandToPath("");
      expect(Object.keys(useRepoStore.getState().expandedDirs).length).toBe(0);
    });

    it("handles dot path gracefully", () => {
      useRepoStore.getState().expandToPath(".");
      expect(Object.keys(useRepoStore.getState().expandedDirs).length).toBe(0);
    });
  });

  describe("refreshExpandedTree", () => {
    it("refreshes root and all expanded directories", async () => {
      // Set up: docs is expanded with stale children
      useRepoStore.setState({
        fileTree: [
          {
            name: "docs",
            path: "docs",
            is_dir: true,
            children: [{ name: "old.md", path: "docs/old.md", is_dir: false }],
          },
        ],
        expandedDirs: { docs: true },
      });

      const callOrder: string[] = [];
      mockedAxios.get.mockImplementation(async (url: string) => {
        const path = decodeURIComponent(
          (url as string).replace("/api/tree?path=", ""),
        );
        callOrder.push(path);

        if (path === ".") {
          return {
            data: [
              {
                name: "docs",
                path: "docs",
                is_dir: true,
                git_status: "contains_changes",
              },
            ],
          };
        }
        if (path === "docs") {
          return {
            data: [
              { name: "old.md", path: "docs/old.md", is_dir: false },
              {
                name: "new-file.md",
                path: "docs/new-file.md",
                is_dir: false,
                git_status: "untracked",
              },
            ],
          };
        }
        return { data: [] };
      });

      await useRepoStore.getState().refreshExpandedTree();

      // Root refreshed first, then expanded dir
      expect(callOrder).toEqual([".", "docs"]);

      // New file should appear in the tree
      const tree = useRepoStore.getState().fileTree;
      expect(tree[0].git_status).toBe("contains_changes");
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children!.map((c) => c.path)).toContain(
        "docs/new-file.md",
      );
    });

    it("refreshes nested expanded dirs in depth order", async () => {
      useRepoStore.setState({
        fileTree: [
          {
            name: "a",
            path: "a",
            is_dir: true,
            children: [
              {
                name: "b",
                path: "a/b",
                is_dir: true,
                children: [
                  { name: "old.md", path: "a/b/old.md", is_dir: false },
                ],
              },
            ],
          },
        ],
        expandedDirs: { a: true, "a/b": true },
      });

      const callOrder: string[] = [];
      mockedAxios.get.mockImplementation(async (url: string) => {
        const path = decodeURIComponent(
          (url as string).replace("/api/tree?path=", ""),
        );
        callOrder.push(path);

        if (path === ".") {
          return { data: [{ name: "a", path: "a", is_dir: true }] };
        }
        if (path === "a") {
          return {
            data: [{ name: "b", path: "a/b", is_dir: true }],
          };
        }
        if (path === "a/b") {
          return {
            data: [
              { name: "old.md", path: "a/b/old.md", is_dir: false },
              { name: "new.md", path: "a/b/new.md", is_dir: false },
            ],
          };
        }
        return { data: [] };
      });

      await useRepoStore.getState().refreshExpandedTree();

      // Must be depth-ordered: root → a → a/b
      expect(callOrder).toEqual([".", "a", "a/b"]);

      // Deep new file should appear
      const tree = useRepoStore.getState().fileTree;
      const aNode = tree[0];
      expect(aNode.children).toHaveLength(1);
      const bNode = aNode.children![0];
      expect(bNode.children).toHaveLength(2);
      expect(bNode.children!.map((c) => c.path)).toContain("a/b/new.md");
    });

    it("skips collapsed directories", async () => {
      useRepoStore.setState({
        fileTree: [
          {
            name: "open",
            path: "open",
            is_dir: true,
            children: [],
          },
          {
            name: "closed",
            path: "closed",
            is_dir: true,
            children: [],
          },
        ],
        expandedDirs: { open: true, closed: false },
      });

      const fetched: string[] = [];
      mockedAxios.get.mockImplementation(async (url: string) => {
        const path = decodeURIComponent(
          (url as string).replace("/api/tree?path=", ""),
        );
        fetched.push(path);
        if (path === ".") {
          return {
            data: [
              { name: "open", path: "open", is_dir: true },
              { name: "closed", path: "closed", is_dir: true },
            ],
          };
        }
        return { data: [] };
      });

      await useRepoStore.getState().refreshExpandedTree();

      // Root + only the expanded dir, NOT the collapsed one
      expect(fetched).toEqual([".", "open"]);
    });

    it("does nothing in multi-repo mode with no repo selected", async () => {
      useRepoStore.setState({
        isMultiRepo: true,
        currentRepo: null,
        expandedDirs: { docs: true },
      });

      await useRepoStore.getState().refreshExpandedTree();

      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("handles API errors gracefully without breaking other dirs", async () => {
      useRepoStore.setState({
        fileTree: [
          {
            name: "good",
            path: "good",
            is_dir: true,
            children: [],
          },
          {
            name: "bad",
            path: "bad",
            is_dir: true,
            children: [],
          },
        ],
        expandedDirs: { good: true, bad: true },
      });

      mockedAxios.get.mockImplementation(async (url: string) => {
        const path = decodeURIComponent(
          (url as string).replace("/api/tree?path=", ""),
        );
        if (path === ".") {
          return {
            data: [
              { name: "good", path: "good", is_dir: true },
              { name: "bad", path: "bad", is_dir: true },
            ],
          };
        }
        if (path === "good") {
          return {
            data: [{ name: "file.md", path: "good/file.md", is_dir: false }],
          };
        }
        if (path === "bad") {
          throw new Error("Network error");
        }
        return { data: [] };
      });

      await useRepoStore.getState().refreshExpandedTree();

      const tree = useRepoStore.getState().fileTree;
      // "good" dir should still be refreshed
      const goodNode = tree.find((n) => n.path === "good");
      expect(goodNode?.children).toHaveLength(1);
      // "bad" dir should have empty children (error fallback), not stuck spinner
      const badNode = tree.find((n) => n.path === "bad");
      expect(badNode?.children).toEqual([]);
    });

    it("updates git_status at all levels", async () => {
      useRepoStore.setState({
        fileTree: [
          {
            name: "docs",
            path: "docs",
            is_dir: true,
            children: [
              { name: "file.md", path: "docs/file.md", is_dir: false },
            ],
          },
        ],
        expandedDirs: { docs: true },
      });

      mockedAxios.get.mockImplementation(async (url: string) => {
        const path = decodeURIComponent(
          (url as string).replace("/api/tree?path=", ""),
        );
        if (path === ".") {
          return {
            data: [
              {
                name: "docs",
                path: "docs",
                is_dir: true,
                git_status: "contains_changes",
              },
            ],
          };
        }
        if (path === "docs") {
          return {
            data: [
              {
                name: "file.md",
                path: "docs/file.md",
                is_dir: false,
                git_status: "modified",
              },
            ],
          };
        }
        return { data: [] };
      });

      await useRepoStore.getState().refreshExpandedTree();

      const tree = useRepoStore.getState().fileTree;
      expect(tree[0].git_status).toBe("contains_changes");
      expect(tree[0].children![0].git_status).toBe("modified");
    });
  });
});
