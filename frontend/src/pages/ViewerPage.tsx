import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { FileTree } from "../components/FileTree";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { DirectoryViewer } from "../components/DirectoryViewer";
import { DiffViewer } from "../components/DiffViewer";
import { FilePicker } from "../components/FilePicker";
import type { GlobalFile } from "../components/FilePicker";
import { ProjectPicker } from "../components/ProjectPicker";
import { WhatsNewModal } from "../components/WhatsNewModal";
import { useWhatsNew } from "../hooks/useWhatsNew";
import { AppLink } from "../components/AppLink";
import { useWebSocket } from "../hooks/useWebSocket";
import {
  Clock,
  MessageSquare,
  GitBranch,
  ChevronRight,
  File,
  AlertCircle,
  Database,
  History,
  FileQuestion,
  Loader2,
  Menu,
  X,
  Code,
  Copy,
  Check,
  ArrowDownAZ,
  FolderGit2,
  PanelLeftClose,
} from "lucide-react";
// History icon retained for the file-history link in the breadcrumb area.
import { RelativeTime } from "../components/RelativeTime";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { isStaticMode } from "../lib/staticMode";
import axios from "axios";
import { SettingsDropdown } from "../components/SettingsDropdown";
import { RecentFilePopover } from "../components/RecentFilePopover";
import {
  KeyboardShortcutsModal,
  KeyboardShortcutsButton,
} from "../components/KeyboardShortcuts";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { RecentsModal } from "../components/RecentsModal";
import { useReviewStore } from "../stores/useReviewStore";
import { ReviewPanel } from "../components/ReviewPanel";
import { MessageSquarePlus, ClipboardCopy, Lightbulb } from "lucide-react";
import { useLineAnchor } from "../hooks/useLineAnchor";
import { StyleGuideModal } from "../components/StyleGuideModal";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ReviewStripe } from "../components/ReviewStripe";
import { analyzeDoc, type DocTip } from "../lib/docTips";

/** Format an ISO date string as a short local datetime (e.g. "Mar 2, 2026 3:45 PM"). */
function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export const ViewerPage: React.FC = () => {
  const {
    fileTree,
    fileContent,
    currentDirectory,
    currentPath,
    error,
    refreshTree,
    refreshExpandedTree,
    viewDirectory,
    loadFile,
    expandToPath,
    loadPathDirectories,
    repos,
    isMultiRepo,
    currentRepo,
    setCurrentRepo,
    loadRepos,
    reposLoaded,
    showEmptyDirs,
    setShowEmptyDirs,
    showHidden,
    setShowHidden,
    showGitignored,
    setShowGitignored,
    repoSortMode,
    setRepoSortMode,
    sortedRepos,
  } = useRepoStore();

  const {
    latestCommit,
    fileGitStatus,
    fetchStatus,
    diff,
    showDiff,
    isDiffLoading,
    fetchDiff,
    fetchWorkingDiff,
    closeDiff,
    recentFiles,
    isRecentLoading,
    fetchRecentFiles,
    repoName,
    repoRootPath,
    fetchRepoInfo,
    history,
    fetchHistory,
  } = useGitStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { "*": pathParam } = useParams();
  const contentRef = useRef<HTMLDivElement>(null);
  useLineAnchor(contentRef);
  const prevPathRef = useRef<string | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [globalFilePickerOpen, setGlobalFilePickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [recentsModalOpen, setRecentsModalOpen] = useState(false);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [globalFiles, setGlobalFiles] = useState<GlobalFile[]>([]);
  const [filePickerLoading, setFilePickerLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("vantage:sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled] =
    useState<boolean>(() => {
      try {
        return localStorage.getItem("vantage:shortcuts-enabled") !== "false";
      } catch {
        return true;
      }
    });
  const { isLoading } = useRepoStore();
  const recentlyChangedPaths = useRepoStore((s) => s.recentlyChangedPaths);

  // Fallback modification date from recent files when no git commit exists
  const fileMtime = React.useMemo(() => {
    if (latestCommit || !currentPath) return null;
    const match = recentFiles.find((f) => f.path === currentPath);
    return match?.date ?? null;
  }, [latestCommit, currentPath, recentFiles]);

  useWebSocket();

  // --- Review mode ---
  const isReviewMode = useReviewStore((s) => s.isReviewMode);
  const toggleReviewMode = useReviewStore((s) => s.toggleReviewMode);
  const loadReview = useReviewStore((s) => s.loadReview);
  const reviewSetLastContent = useReviewStore((s) => s.setLastContent);
  const reviewComments = useReviewStore((s) => s.comments);
  const pendingReviewCount = reviewComments.filter(
    (c) =>
      !c.resolved &&
      !(c.reactions ?? []).some(
        (r) => r.actor === "agent" && r.kind === "addressed",
      ),
  ).length;
  const copyAllReviewComments = useReviewStore((s) => s.copyAllToClipboard);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [reviewCopied, setReviewCopied] = useState(false);

  const handleReviewToggle = useCallback(() => {
    // PR2: review mode is now a plain on/off toggle.  Destructive
    // "End review" lives in the side-panel `…` menu (ReviewPanel)
    // because the day-to-day toggle shouldn't risk losing data.
    toggleReviewMode();
  }, [toggleReviewMode]);

  // Load review data when file changes
  useEffect(() => {
    if (currentPath && currentPath.toLowerCase().endsWith(".md")) {
      loadReview(currentPath).catch(() => {});
    }
  }, [currentPath, loadReview]);

  // Track lastContent so the clipboard prompt has source lines to render.
  // Snapshots themselves are written server-side by the watcher (it
  // caches the previous file content per (repo,path) and uses it as the
  // before-text when the changelog parser fires).  The frontend no
  // longer issues an auto-snapshot PUT — that PUT was racing with the
  // server's reaction write and clobbering reactions when the agent
  // edited the file while the browser was open.
  useEffect(() => {
    if (!fileContent || !isReviewMode) return;
    reviewSetLastContent(fileContent.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContent?.content, isReviewMode]);

  // --- Style guide & doc tips ---
  const [styleGuideOpen, setStyleGuideOpen] = useState(false);
  const [dismissedTips, setDismissedTips] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("vantage:dismissedDocTips");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const fileContentStr = fileContent?.content ?? null;
  const docTips = React.useMemo<DocTip[]>(() => {
    if (!fileContentStr || showRaw) return [];
    return analyzeDoc(fileContentStr);
  }, [fileContentStr, showRaw]);
  const visibleTips = docTips.filter((t) => !dismissedTips.has(t.id));
  const dismissTip = useCallback((id: string) => {
    setDismissedTips((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(
          "vantage:dismissedDocTips",
          JSON.stringify([...next]),
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const whatsNew = useWhatsNew();

  // Helper to get API base
  const getApiBase = useCallback((): string => {
    const { currentRepo: cr, isMultiRepo: imr } = useRepoStore.getState();
    if (imr && cr) return `/api/r/${encodeURIComponent(cr)}`;
    return "/api";
  }, []);

  // Build the proper URL path considering multi-repo mode
  const buildPath = useCallback(
    (filePath: string): string => {
      if (isMultiRepo && currentRepo) {
        return `/${currentRepo}/${filePath}`;
      }
      return `/${filePath}`;
    },
    [isMultiRepo, currentRepo],
  );

  // Load repos on mount
  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  // Clear cached file list when repo changes
  useEffect(() => {
    setAllFiles([]); // eslint-disable-line react-hooks/set-state-in-effect
  }, [currentRepo]);

  // Load initial tree structure (after repos are loaded, only for single-repo mode)
  useEffect(() => {
    if (!reposLoaded) return; // Wait for repos to be loaded first
    if (!isMultiRepo) {
      refreshTree();
    }
  }, [refreshTree, isMultiRepo, reposLoaded]);

  // Re-fetch tree and recents when filter settings change
  const filterSettingsInitialized = useRef(false);
  useEffect(() => {
    if (!filterSettingsInitialized.current) {
      filterSettingsInitialized.current = true;
      return;
    }
    refreshExpandedTree();
    fetchRecentFiles(true);
  }, [showHidden, showGitignored, refreshExpandedTree, fetchRecentFiles]);

  // Handle URL changes - parse repo and path from URL
  useEffect(() => {
    if (!reposLoaded) return; // Wait for repos to be loaded first

    const fullPath = pathParam || "";

    // Sanitize: reject path traversal attempts
    const sanitizePath = (p: string): string | null => {
      if (p.startsWith("/") || p.includes("..") || p.includes("\0"))
        return null;
      return p;
    };

    if (isMultiRepo) {
      // In multi-repo mode, the first segment is the repo name
      const segments = fullPath.split("/").filter(Boolean);

      if (segments.length === 0) {
        // Root URL in multi-repo mode - show repo selector
        if (currentRepo) {
          setCurrentRepo(null);
        }
        return;
      }

      const repoName = segments[0];
      const rawFilePath = segments.slice(1).join("/") || ".";
      const filePath = sanitizePath(rawFilePath) ?? ".";

      // Check if this repo exists
      const repoExists = repos.some((r) => r.name === repoName);
      if (!repoExists) {
        // Repo not found - set error and clear content
        useRepoStore.setState({
          error: `Repository not found: ${repoName}`,
          fileContent: null,
          currentDirectory: null,
          currentPath: fullPath,
          fileTree: [],
        });
        return;
      }

      // Set the current repo if different
      if (currentRepo !== repoName) {
        setCurrentRepo(repoName);
        return; // Let the state update trigger a re-render
      }

      // Clear any previous errors and load the file/directory
      useRepoStore.setState({ error: null });

      if (filePath !== ".") {
        expandToPath(filePath);
        loadPathDirectories(filePath);
      }

      if (filePath.toLowerCase().endsWith(".md")) {
        loadFile(filePath);
      } else {
        viewDirectory(filePath);
      }
    } else {
      // Single-repo mode - path is the file path directly
      const rawPath = fullPath || ".";
      const path = sanitizePath(rawPath) ?? ".";

      // Clear any previous errors on path change
      useRepoStore.setState({ error: null });

      if (path !== ".") {
        expandToPath(path);
        loadPathDirectories(path);
      }

      if (path.toLowerCase().endsWith(".md")) {
        loadFile(path);
      } else {
        viewDirectory(path);
      }
    }
  }, [
    pathParam,
    loadFile,
    viewDirectory,
    expandToPath,
    loadPathDirectories,
    isMultiRepo,
    currentRepo,
    repos,
    setCurrentRepo,
    reposLoaded,
  ]);

  useEffect(() => {
    if (currentPath) {
      fetchStatus(currentPath);
    }
  }, [currentPath, fetchStatus]);

  // Scroll to top when navigating to a new file, or to anchor if hash is present.
  // When the *same* file updates (live reload), preserve scroll position.
  useEffect(() => {
    if (!fileContent || !contentRef.current) return;

    const isSameFile = prevPathRef.current === fileContent.path;
    prevPathRef.current = fileContent.path;

    if (isSameFile) {
      // Same file updated – keep current scroll position.
      // The DOM will re-render in place; the browser preserves scrollTop
      // automatically for the container, but we capture/restore to be safe
      // against layout shifts from content-length changes.
      const container = contentRef.current;
      const savedTop = container.scrollTop;
      const savedHeight = container.scrollHeight;
      requestAnimationFrame(() => {
        if (!container) return;
        const newHeight = container.scrollHeight;
        if (newHeight !== savedHeight) {
          // Content height changed – keep relative position
          const ratio = savedHeight > 0 ? savedTop / savedHeight : 0;
          container.scrollTop = ratio * newHeight;
        }
        // If height didn't change, scrollTop is already correct
      });
      return;
    }

    // Navigated to a different file
    // Use React Router's location.hash (works with both BrowserRouter and HashRouter).
    // window.location.hash includes the route path in HashRouter, which is always truthy.
    const anchor = location.hash ? location.hash.slice(1) : "";
    if (anchor) {
      requestAnimationFrame(() => {
        const el = document.getElementById(anchor);
        if (el && contentRef.current?.scrollTo) {
          const offset =
            el.getBoundingClientRect().top -
            contentRef.current.getBoundingClientRect().top +
            contentRef.current.scrollTop;
          contentRef.current.scrollTo({ top: offset - 16 });
        }
      });
    } else if (contentRef.current.scrollTo) {
      contentRef.current.scrollTo(0, 0);
    }
  }, [fileContent, location.hash]);

  // Fetch recent files and repo info when repo is set (or on mount for single-repo)
  useEffect(() => {
    if (!reposLoaded) return;
    if (isMultiRepo && !currentRepo) return;
    fetchRecentFiles();
    fetchRepoInfo();
  }, [fetchRecentFiles, fetchRepoInfo, reposLoaded, isMultiRepo, currentRepo]);

  // Fetch file history when viewing a file
  useEffect(() => {
    if (currentPath && currentPath.toLowerCase().endsWith(".md")) {
      fetchHistory(currentPath);
    }
  }, [currentPath, fetchHistory]);

  // Dynamic page title
  useEffect(() => {
    if (repoName) {
      document.title = `Vantage: ${repoName}`;
    } else {
      document.title = "Vantage";
    }
    return () => {
      document.title = "Vantage";
    };
  }, [repoName]);

  const handleCommitClick = () => {
    if (!currentPath) return;
    // For modified files, default to showing uncommitted changes
    if (fileGitStatus === "modified" || fileGitStatus === "added") {
      fetchWorkingDiff(currentPath);
    } else if (latestCommit) {
      fetchDiff(currentPath, latestCommit.hexsha);
    }
  };

  // File picker select handler
  const handleFilePickerSelect = useCallback(
    (path: string, repo?: string) => {
      if (repo) {
        // Global mode: navigate to the file in the specified repo
        navigate(`/${repo}/${path}`);
      } else {
        navigate(buildPath(path));
      }
    },
    [navigate, buildPath],
  );

  // Keyboard shortcuts
  const handleOpenFilePicker = useCallback(() => {
    setFilePickerOpen(true);
  }, []);
  const handleOpenGlobalFilePicker = useCallback(() => {
    setGlobalFilePickerOpen(true);
    if (globalFiles.length === 0) {
      setFilePickerLoading(true);
      axios.get<GlobalFile[]>("/api/files/all").then((res) => {
        setGlobalFiles(res.data);
        setFilePickerLoading(false);
      });
    }
  }, [globalFiles]);
  const handleOpenProjectPicker = useCallback(() => {
    setProjectPickerOpen(true);
  }, []);
  const handleOpenRecentFiles = useCallback(() => {
    setRecentsModalOpen(true);
  }, []);
  const handleOpenGlobalRecentFiles = useCallback(() => {
    // For global recents, fetch from /api/recent/all and open global file picker
    setGlobalFilePickerOpen(true);
    setFilePickerLoading(true);
    axios.get<GlobalFile[]>("/api/recent/all?limit=200").then((res) => {
      setGlobalFiles(res.data);
      setFilePickerLoading(false);
    });
  }, []);
  const handleProjectSelect = useCallback(
    (repoName: string) => {
      navigate(`/${repoName}`);
    },
    [navigate],
  );
  const handleToggleSidebar = useCallback(() => {
    // On mobile, toggle the slide-out panel; on desktop, collapse the sidebar
    if (window.innerWidth < 768) {
      setSidebarOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem("vantage:sidebarCollapsed", String(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
  }, []);
  const handleShortcutNavigate = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate],
  );
  const handleViewDiff = useCallback(() => {
    if (latestCommit && currentPath) {
      fetchDiff(currentPath, latestCommit.hexsha);
    }
  }, [latestCommit, currentPath, fetchDiff]);
  const handleViewHistory = useCallback(() => {
    if (
      currentPath &&
      currentPath.toLowerCase().endsWith(".md") &&
      history.length > 0
    ) {
      const historyPath =
        isMultiRepo && currentRepo
          ? `/history/${currentRepo}/${currentPath}`
          : `/history/${currentPath}`;
      navigate(historyPath);
    }
  }, [currentPath, history, isMultiRepo, currentRepo, navigate]);
  const handleCopyPath = useCallback(() => {
    if (!repoRootPath || !currentPath) return;
    const absolutePath = `${repoRootPath}/${currentPath}`;
    navigator.clipboard.writeText(absolutePath).then(() => {
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 2000);
    });
  }, [repoRootPath, currentPath]);
  const { shortcutsOpen, setShortcutsOpen } = useKeyboardShortcuts({
    onOpenFilePicker: handleOpenFilePicker,
    onOpenGlobalFilePicker: handleOpenGlobalFilePicker,
    onOpenProjectPicker: handleOpenProjectPicker,
    onOpenRecentFiles: handleOpenRecentFiles,
    onOpenGlobalRecentFiles: handleOpenGlobalRecentFiles,
    onToggleSidebar: handleToggleSidebar,
    onNavigate: handleShortcutNavigate,
    onViewDiff: handleViewDiff,
    onViewHistory: handleViewHistory,
    onCopyPath: handleCopyPath,
    contentScrollRef: contentRef,
    isMultiRepo,
    currentRepo,
    enabled: keyboardShortcutsEnabled,
  });

  // 't' hotkey for file picker
  useEffect(() => {
    try {
      localStorage.setItem(
        "vantage:shortcuts-enabled",
        keyboardShortcutsEnabled ? "true" : "false",
      );
    } catch {
      // ignore
    }
  }, [keyboardShortcutsEnabled]);

  useEffect(() => {
    if (!keyboardShortcutsEnabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input/textarea, or if modifier keys are held
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "t") return;

      e.preventDefault();

      const {
        isMultiRepo: imr,
        currentRepo: cr,
        reposLoaded: rl,
      } = useRepoStore.getState();
      if (!rl) return;

      // In multi-repo mode without repo selected, open global search
      if (imr && !cr) {
        setGlobalFilePickerOpen(true);
        if (globalFiles.length === 0) {
          setFilePickerLoading(true);
          axios.get<GlobalFile[]>("/api/files/all").then((res) => {
            setGlobalFiles(res.data);
            setFilePickerLoading(false);
          });
        }
        return;
      }

      // Fetch file list if not already loaded, then open picker
      const apiBase = getApiBase();
      setFilePickerOpen(true);
      if (allFiles.length === 0) {
        setFilePickerLoading(true);
        axios.get<string[]>(`${apiBase}/files`).then((res) => {
          setAllFiles(res.data);
          setFilePickerLoading(false);
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [allFiles, globalFiles, getApiBase, keyboardShortcutsEnabled]);

  // Close sidebar on mobile when navigating to a new path
  useEffect(() => {
    setSidebarOpen(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [pathParam]);

  const breadcrumbs =
    currentPath && currentPath !== "." ? currentPath.split("/") : [];

  // Whether to show the sidebar (hide on repo picker page)
  const showSidebar = !(isMultiRepo && !currentRepo);

  // Show a minimal loading state until repos metadata is loaded.
  // This prevents flashing the single-repo sidebar before multi-repo
  // mode is detected.
  if (!reposLoaded) {
    return (
      <div className="flex h-screen bg-slate-50 dark:bg-slate-900 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-blue-500" />
          <p className="text-sm text-slate-400">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-900 overflow-hidden text-slate-900 dark:text-slate-100">
      <ConnectionBanner />
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile sidebar backdrop */}
        {showSidebar && sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar - hidden on repo picker page, collapsible on desktop */}
        {showSidebar && (
          <div
            className={cn(
              "w-72 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-white dark:bg-slate-800 shadow-sm",
              "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out md:relative md:z-auto",
              sidebarOpen ? "translate-x-0" : "-translate-x-full",
              sidebarCollapsed
                ? "md:-translate-x-full md:absolute"
                : "md:translate-x-0",
            )}
          >
            <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <GitBranch size={18} className="text-white" />
                </div>
                <AppLink
                  to="/"
                  className="font-semibold text-lg tracking-tight hover:text-blue-600 transition-colors no-underline text-inherit dark:text-slate-100"
                >
                  Vantage
                </AppLink>
              </div>
              <div className="flex items-center gap-1">
                <a
                  href="https://github.com/mschulkind-oss/vantage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  title="View on GitHub"
                >
                  <svg
                    width={16}
                    height={16}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                </a>
                <KeyboardShortcutsButton
                  onClick={() => setShortcutsOpen(true)}
                />
                <SettingsDropdown
                  showEmptyDirs={showEmptyDirs}
                  onShowEmptyDirsChange={setShowEmptyDirs}
                  showHidden={showHidden}
                  onShowHiddenChange={setShowHidden}
                  showGitignored={showGitignored}
                  onShowGitignoredChange={setShowGitignored}
                  keyboardShortcutsEnabled={keyboardShortcutsEnabled}
                  onKeyboardShortcutsEnabledChange={setKeyboardShortcutsEnabled}
                  onOpenWhatsNew={whatsNew.open}
                  onOpenStyleGuide={() => setStyleGuideOpen(true)}
                />
                <button
                  className="hidden md:block p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  onClick={() => {
                    setSidebarCollapsed(true);
                    try {
                      localStorage.setItem("vantage:sidebarCollapsed", "true");
                    } catch {
                      /* ignore */
                    }
                  }}
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar (b)"
                >
                  <PanelLeftClose size={16} />
                </button>
                <button
                  className="md:hidden p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close sidebar"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-2 px-2">
              {/* File tree (sidebar only shows when a repo is selected) */}
              <>
                {/* Show current repo name with back button in multi-repo mode */}
                {isMultiRepo && currentRepo && (
                  <AppLink
                    to="/"
                    className="flex items-center py-2 px-2 mb-2 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 border-b border-slate-100 dark:border-slate-700 no-underline"
                  >
                    <ChevronRight size={12} className="mr-1 rotate-180" />
                    <Database size={12} className="mr-1" />
                    <span className="font-medium">{currentRepo}</span>
                  </AppLink>
                )}
                <FileTree nodes={fileTree} />
              </>
            </div>
            {/* Recent Files Section - always visible, with spinner when loading */}
            {(!isMultiRepo || currentRepo) && (
              <div className="border-t border-slate-200 dark:border-slate-700 px-2 py-2 shrink-0">
                <button
                  onClick={() => setRecentsModalOpen(true)}
                  className="px-2 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center space-x-1.5 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-full"
                >
                  <Clock size={12} />
                  <span>Recent</span>
                  {isRecentLoading && (
                    <Loader2
                      size={10}
                      className="animate-spin text-slate-400"
                    />
                  )}
                </button>
                <div className="space-y-0.5 overflow-y-auto h-40">
                  {isRecentLoading && recentFiles.length === 0 ? (
                    <div className="flex flex-col space-y-2 px-2 py-1">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="flex items-center space-x-2 animate-pulse"
                        >
                          <div className="w-3 h-3 bg-slate-200 rounded shrink-0" />
                          <div className="h-3 bg-slate-200 rounded flex-1" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    recentFiles.map((file) => {
                      const parts = file.path.split("/");
                      const fileName = parts.pop() || "";
                      const parentDir = parts.length > 0 ? parts.join("/") : "";
                      return (
                        <RecentFilePopover key={file.path} file={file}>
                          <AppLink
                            to={buildPath(file.path)}
                            className={cn(
                              "w-full flex items-start py-1.5 px-2 text-left rounded-md text-xs transition-all duration-150 no-underline",
                              "hover:bg-slate-100 dark:hover:bg-slate-700",
                              currentPath === file.path &&
                                "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
                              recentlyChangedPaths.has(file.path) &&
                                "animate-flash-update",
                            )}
                          >
                            <File
                              size={13}
                              className={cn(
                                "mr-1.5 mt-0.5 shrink-0",
                                file.untracked
                                  ? "text-amber-400"
                                  : "text-slate-400",
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate text-slate-700 dark:text-slate-300 font-medium">
                                  {fileName}
                                </span>
                                <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                                  <RelativeTime
                                    date={file.date}
                                    addSuffix={false}
                                  />
                                </span>
                              </div>
                              {parentDir && (
                                <div className="truncate text-slate-400">
                                  {parentDir}/
                                </div>
                              )}
                            </div>
                          </AppLink>
                        </RecentFilePopover>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900 min-w-0">
          {/* Header / Breadcrumbs - hidden on repo picker page */}
          {showSidebar ? (
            <div className="h-14 border-b border-slate-200 dark:border-slate-700 flex items-center px-3 md:px-6 justify-between shrink-0 bg-white dark:bg-slate-800 gap-2">
              <div className="flex items-center min-w-0 gap-2">
                <button
                  className={cn(
                    "p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 shrink-0",
                    sidebarCollapsed ? "" : "md:hidden",
                  )}
                  onClick={() => {
                    if (window.innerWidth < 768) {
                      setSidebarOpen(true);
                    } else {
                      setSidebarCollapsed(false);
                      try {
                        localStorage.setItem(
                          "vantage:sidebarCollapsed",
                          "false",
                        );
                      } catch {
                        /* ignore */
                      }
                    }
                  }}
                  aria-label="Open sidebar"
                >
                  <Menu size={20} />
                </button>
                <nav className="flex items-center text-sm space-x-1 min-w-0 overflow-hidden">
                  <AppLink
                    to={isMultiRepo && currentRepo ? `/${currentRepo}` : "/"}
                    className="text-slate-500 hover:text-blue-600 font-medium transition-colors shrink-0 no-underline"
                  >
                    {isMultiRepo && currentRepo ? currentRepo : "root"}
                  </AppLink>
                  {breadcrumbs.map((part, i) => (
                    <React.Fragment key={i}>
                      <ChevronRight
                        size={14}
                        className="text-slate-300 shrink-0"
                      />
                      {i < breadcrumbs.length - 1 ? (
                        <AppLink
                          to={buildPath(
                            currentPath
                              ?.split("/")
                              .slice(0, i + 1)
                              .join("/") || ".",
                          )}
                          className="text-slate-500 hover:text-blue-600 transition-colors no-underline hidden sm:inline"
                        >
                          {part}
                        </AppLink>
                      ) : (
                        <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {part}
                        </span>
                      )}
                    </React.Fragment>
                  ))}
                </nav>
              </div>

              {latestCommit ? (
                <div className="flex items-center space-x-2 shrink-0">
                  {fileGitStatus && (
                    <button
                      onClick={handleCommitClick}
                      className="flex items-center space-x-1.5 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1.5 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors cursor-pointer"
                      title="View uncommitted changes"
                    >
                      <GitBranch size={12} />
                      <span className="font-medium hidden sm:inline">
                        {fileGitStatus === "modified"
                          ? "Modified"
                          : fileGitStatus === "added"
                            ? "Added"
                            : fileGitStatus === "deleted"
                              ? "Deleted"
                              : fileGitStatus}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() =>
                      latestCommit &&
                      currentPath &&
                      fetchDiff(currentPath, latestCommit.hexsha)
                    }
                    className="hidden sm:flex items-center space-x-3 text-xs group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
                    title={`${formatDateTime(latestCommit.date)} — click to view diff`}
                  >
                    <div className="flex items-center space-x-1.5 text-slate-500 dark:text-slate-400">
                      <Clock size={14} />
                      <span>
                        <RelativeTime date={latestCommit.date} />
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">
                        ·
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">
                        {formatDateTime(latestCommit.date)}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-100 dark:bg-slate-700 group-hover:bg-slate-200 dark:group-hover:bg-slate-600 px-2.5 py-1.5 rounded-md transition-colors">
                      <MessageSquare size={12} className="text-slate-400" />
                      <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[200px]">
                        {latestCommit.message}
                      </span>
                    </div>
                  </button>
                  {/* Mobile: just show clock icon as commit button */}
                  <button
                    onClick={() =>
                      latestCommit &&
                      currentPath &&
                      fetchDiff(currentPath, latestCommit.hexsha)
                    }
                    className="sm:hidden flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors"
                    title="View diff"
                  >
                    <Clock size={14} />
                    <span>
                      <RelativeTime
                        date={latestCommit.date}
                        addSuffix={false}
                      />
                    </span>
                  </button>
                  {currentPath &&
                    currentPath.toLowerCase().endsWith(".md") &&
                    history.length >= 1 && (
                      <AppLink
                        to={
                          isMultiRepo && currentRepo
                            ? `/history/${currentRepo}/${currentPath}`
                            : `/history/${currentPath}`
                        }
                        className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors no-underline"
                        title="View full history"
                      >
                        <History size={14} />
                        <span className="hidden sm:inline">
                          {history.length} commits
                        </span>
                      </AppLink>
                    )}
                  {currentPath && repoRootPath && (
                    <button
                      onClick={handleCopyPath}
                      className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
                      title={`Copy absolute path: ${repoRootPath}/${currentPath}`}
                    >
                      {pathCopied ? (
                        <Check size={14} className="text-green-500" />
                      ) : (
                        <Copy size={14} />
                      )}
                      <span className="hidden sm:inline">
                        {pathCopied ? "Copied!" : "Path"}
                      </span>
                    </button>
                  )}
                  {currentPath && currentPath.toLowerCase().endsWith(".md") && (
                    <button
                      onClick={() => {
                        setShowRaw((v) => !v);
                        setCopied(false);
                      }}
                      className={cn(
                        "flex items-center space-x-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                        showRaw
                          ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                          : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                      )}
                      title={showRaw ? "View rendered" : "View raw markdown"}
                    >
                      <Code size={14} />
                      <span className="hidden sm:inline">
                        {showRaw ? "Rendered" : "Raw"}
                      </span>
                    </button>
                  )}
                  {currentPath &&
                    currentPath.toLowerCase().endsWith(".md") &&
                    !showRaw && (
                      <>
                        <button
                          onClick={handleReviewToggle}
                          className={cn(
                            "flex items-center space-x-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                            isReviewMode
                              ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-300 dark:ring-purple-700"
                              : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                          )}
                          title={
                            isReviewMode
                              ? "Exit review mode"
                              : "Enter review mode"
                          }
                        >
                          <MessageSquarePlus size={14} />
                          <span className="hidden sm:inline">Review</span>
                        </button>
                        {isReviewMode && (
                          <>
                            {pendingReviewCount > 0 && (
                              <button
                                onClick={async () => {
                                  const ok = await copyAllReviewComments();
                                  if (ok) {
                                    setReviewCopied(true);
                                    setTimeout(
                                      () => setReviewCopied(false),
                                      2000,
                                    );
                                  }
                                }}
                                className="flex items-center space-x-1.5 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 rounded-lg px-2 py-1.5 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
                                title="Copy all comments to clipboard"
                              >
                                {reviewCopied ? (
                                  <Check size={14} />
                                ) : (
                                  <ClipboardCopy size={14} />
                                )}
                                <span className="hidden sm:inline">
                                  {reviewCopied
                                    ? "Copied!"
                                    : `Copy ${pendingReviewCount}`}
                                </span>
                              </button>
                            )}
                            <button
                              onClick={() => setReviewPanelOpen(true)}
                              className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
                              title="Manage comments"
                            >
                              <MessageSquare size={14} />
                            </button>
                          </>
                        )}
                      </>
                    )}
                </div>
              ) : currentPath && currentPath.toLowerCase().endsWith(".md") ? (
                <div className="flex items-center space-x-2 shrink-0">
                  {!isStaticMode() && (
                    <button
                      onClick={() =>
                        currentPath && fetchWorkingDiff(currentPath)
                      }
                      className="flex items-center space-x-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
                      title="View file content as diff"
                    >
                      <FileQuestion size={14} />
                      <span className="font-medium hidden sm:inline">
                        Untracked file
                      </span>
                    </button>
                  )}
                  {fileMtime && (
                    <div
                      className="hidden sm:flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 px-2 py-1.5"
                      title={formatDateTime(fileMtime)}
                    >
                      <Clock size={14} />
                      <span>
                        <RelativeTime date={fileMtime} />
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">
                        ·
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">
                        {formatDateTime(fileMtime)}
                      </span>
                    </div>
                  )}
                  {currentPath && repoRootPath && (
                    <button
                      onClick={handleCopyPath}
                      className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
                      title={`Copy absolute path: ${repoRootPath}/${currentPath}`}
                    >
                      {pathCopied ? (
                        <Check size={14} className="text-green-500" />
                      ) : (
                        <Copy size={14} />
                      )}
                      <span className="hidden sm:inline">
                        {pathCopied ? "Copied!" : "Path"}
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowRaw((v) => !v);
                      setCopied(false);
                    }}
                    className={cn(
                      "flex items-center space-x-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                      showRaw
                        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                        : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                    )}
                    title={showRaw ? "View rendered" : "View raw markdown"}
                  >
                    <Code size={14} />
                    <span className="hidden sm:inline">
                      {showRaw ? "Rendered" : "Raw"}
                    </span>
                  </button>
                  {!showRaw && (
                    <>
                      <button
                        onClick={handleReviewToggle}
                        className={cn(
                          "flex items-center space-x-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                          isReviewMode
                            ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-300 dark:ring-purple-700"
                            : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                        )}
                        title={
                          isReviewMode
                            ? "Exit review mode"
                            : "Enter review mode"
                        }
                      >
                        <MessageSquarePlus size={14} />
                        <span className="hidden sm:inline">Review</span>
                      </button>
                      {isReviewMode && (
                        <>
                          {pendingReviewCount > 0 && (
                            <button
                              onClick={async () => {
                                const ok = await copyAllReviewComments();
                                if (ok) {
                                  setReviewCopied(true);
                                  setTimeout(
                                    () => setReviewCopied(false),
                                    2000,
                                  );
                                }
                              }}
                              className="flex items-center space-x-1.5 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 rounded-lg px-2 py-1.5 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
                              title="Copy all comments to clipboard"
                            >
                              {reviewCopied ? (
                                <Check size={14} />
                              ) : (
                                <ClipboardCopy size={14} />
                              )}
                              <span className="hidden sm:inline">
                                {reviewCopied
                                  ? "Copied!"
                                  : `Copy ${pendingReviewCount}`}
                              </span>
                            </button>
                          )}
                          <button
                            onClick={() => setReviewPanelOpen(true)}
                            className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
                            title="Manage comments"
                          >
                            <MessageSquare size={14} />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Review mode indicator bar */}
          {isReviewMode && (
            <div className="h-1 bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500 shrink-0" />
          )}

          {/* Viewer */}
          <div
            ref={contentRef}
            data-content-scroll
            className={cn(
              "flex-1 overflow-y-auto bg-white dark:bg-slate-900 relative",
              isReviewMode &&
                "ring-1 ring-inset ring-purple-200 dark:ring-purple-800/50",
            )}
          >
            {isReviewMode && (
              <ReviewStripe scrollRef={contentRef} comments={reviewComments} />
            )}
            <div className="max-w-5xl mx-auto py-4 px-4 sm:py-6 sm:px-8">
              {error ? (
                <div className="flex flex-col items-center justify-center h-64 text-red-500">
                  <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-4">
                    <AlertCircle size={32} className="text-red-400" />
                  </div>
                  <p className="text-lg font-medium text-red-600">{error}</p>
                  {currentPath && (
                    <p className="text-sm text-red-400 mt-1 font-mono">
                      {currentPath}
                    </p>
                  )}
                  <AppLink
                    to="/"
                    className="mt-4 px-4 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors no-underline inline-block"
                  >
                    Go to Home
                  </AppLink>
                </div>
              ) : isLoading && !fileContent && !currentDirectory ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                  <Loader2
                    size={32}
                    className="animate-spin text-blue-500 mb-4"
                  />
                  <p className="text-sm text-slate-500">Loading...</p>
                </div>
              ) : fileContent ? (
                fileContent.encoding === "binary" ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800">
                    <File size={48} className="mb-3 text-slate-300" />
                    <p className="text-sm">
                      Binary file content cannot be displayed.
                    </p>
                  </div>
                ) : (
                  <div className="pb-8">
                    {showRaw ? (
                      <div className="relative">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(fileContent.content);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors z-10"
                          title="Copy to clipboard"
                        >
                          {copied ? <Check size={12} /> : <Copy size={12} />}
                          {copied ? "Copied!" : "Copy"}
                        </button>
                        <pre className="p-4 pr-24 text-sm font-mono whitespace-pre-wrap break-words bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-auto max-h-[80vh] text-slate-700 dark:text-slate-300">
                          {fileContent.content}
                        </pre>
                      </div>
                    ) : (
                      <>
                        <MarkdownViewer
                          content={fileContent.content}
                          currentPath={fileContent.path}
                          isReviewMode={isReviewMode}
                        />
                        {visibleTips.length > 0 && (
                          <div className="mt-6 space-y-2">
                            {visibleTips.map((tip) => (
                              <div
                                key={tip.id}
                                className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-blue-50/60 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/30 text-sm text-blue-700 dark:text-blue-300"
                              >
                                <Lightbulb
                                  size={14}
                                  className="shrink-0 mt-0.5 text-blue-400"
                                />
                                <span className="flex-1">{tip.message}</span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    onClick={() => setStyleGuideOpen(true)}
                                    className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 underline underline-offset-2"
                                  >
                                    Style guide
                                  </button>
                                  <button
                                    onClick={() => dismissTip(tip.id)}
                                    className="text-blue-300 dark:text-blue-600 hover:text-blue-500 dark:hover:text-blue-400"
                                    title="Dismiss"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              ) : currentDirectory ? (
                <DirectoryViewer
                  nodes={currentDirectory}
                  currentPath={currentPath || "."}
                />
              ) : isMultiRepo && !currentRepo ? (
                <div className="max-w-2xl mx-auto w-full py-12 md:py-16">
                  <div className="flex items-end justify-between mb-8">
                    <div>
                      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                        Projects
                      </h1>
                      <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                        {repos.length}{" "}
                        {repos.length === 1 ? "repository" : "repositories"}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setRepoSortMode(
                          repoSortMode === "alphabetical"
                            ? "recent"
                            : "alphabetical",
                        )
                      }
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                        "border border-slate-200 dark:border-slate-700",
                        "text-slate-500 dark:text-slate-400",
                        "hover:bg-slate-50 dark:hover:bg-slate-800",
                      )}
                      title={
                        repoSortMode === "alphabetical"
                          ? "Sort by recent activity"
                          : "Sort alphabetically"
                      }
                    >
                      {repoSortMode === "alphabetical" ? (
                        <>
                          <ArrowDownAZ size={14} />
                          <span>A–Z</span>
                        </>
                      ) : (
                        <>
                          <Clock size={14} />
                          <span>Recent</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-800/50 shadow-sm divide-y divide-slate-100 dark:divide-slate-700/50">
                    {sortedRepos().map((repo) => (
                      <AppLink
                        key={repo.name}
                        to={`/${repo.name}`}
                        onBeforeNavigate={() => {
                          setCurrentRepo(repo.name);
                        }}
                        className={cn(
                          "flex items-center gap-3 px-5 py-4 no-underline transition-colors group",
                          "hover:bg-blue-50/50 dark:hover:bg-slate-700/40",
                        )}
                      >
                        <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center shrink-0 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 transition-colors">
                          <FolderGit2
                            size={18}
                            className="text-blue-500 dark:text-blue-400"
                          />
                        </div>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate text-[15px]">
                          {repo.name}
                        </span>
                        {repo.last_activity && (
                          <span className="ml-auto pl-4 text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0 tabular-nums">
                            <RelativeTime date={repo.last_activity} />
                          </span>
                        )}
                      </AppLink>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                  <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                    <GitBranch size={32} className="text-slate-300" />
                  </div>
                  <p className="text-lg font-medium text-slate-500">
                    Select a file or folder to browse
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    Vantage supports Markdown and Mermaid diagrams
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Diff Viewer Modal */}
        {showDiff &&
          (isDiffLoading ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-8 flex flex-col items-center">
                <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-600 border-t-blue-600 rounded-full animate-spin mb-4" />
                <p className="text-slate-600 dark:text-slate-300 font-medium">
                  Loading diff...
                </p>
              </div>
            </div>
          ) : diff ? (
            <DiffViewer diff={diff} onClose={closeDiff} />
          ) : (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-8 flex flex-col items-center">
                <p className="text-slate-600 dark:text-slate-300 font-medium mb-4">
                  Could not load diff
                </p>
                <button
                  onClick={closeDiff}
                  className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ))}
        {/* File Picker (local) */}
        <FilePicker
          isOpen={filePickerOpen}
          onClose={() => {
            setFilePickerOpen(false);
            setFilePickerLoading(false);
          }}
          onSelect={handleFilePickerSelect}
          files={allFiles}
          loading={filePickerLoading}
        />
        {/* File Picker (global - all repos) */}
        <FilePicker
          isOpen={globalFilePickerOpen}
          onClose={() => {
            setGlobalFilePickerOpen(false);
            setFilePickerLoading(false);
          }}
          onSelect={handleFilePickerSelect}
          files={[]}
          globalFiles={globalFiles}
          mode="global"
          placeholder="Search all projects' files..."
          loading={filePickerLoading}
        />
        {/* Project Picker */}
        <ProjectPicker
          isOpen={projectPickerOpen}
          onClose={() => setProjectPickerOpen(false)}
          onSelect={handleProjectSelect}
          repos={repos}
        />
        {/* Recents Modal */}
        <RecentsModal
          isOpen={recentsModalOpen}
          onClose={() => setRecentsModalOpen(false)}
        />
        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal
          isOpen={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
        {/* What's New Modal */}
        <WhatsNewModal isOpen={whatsNew.isOpen} onClose={whatsNew.close} />
        {/* Review Panel */}
        <ReviewPanel
          isOpen={reviewPanelOpen}
          onClose={() => setReviewPanelOpen(false)}
        />
        {/* Style Guide Modal */}
        <StyleGuideModal
          isOpen={styleGuideOpen}
          onClose={() => setStyleGuideOpen(false)}
        />
      </div>
    </div>
  );
};
