/**
 * The app shell (a term this module coins): the frame every page of a
 * repository sits in. It is the sidebar — the bookmarks, the file tree, the
 * recent files and the handle that resizes it — the pickers and dialogs the
 * keyboard opens (`t`, `Shift+T`, `Shift+P`, `r`, `Shift+R`, `?`), the style
 * guide, the connection banner, the degradation banner, and the shortcuts
 * themselves.
 *
 * It is a layout route (`App.tsx`) around the document viewer and the
 * planning page, drawn once for both: going from one to the other replaces
 * the main column and nothing else, so the sidebar is where it was, with its
 * tree scrolled where the reader left it, and nothing it shows is asked for
 * again. `b` puts it away on either, and a width the reader dragged it to
 * holds on both.
 *
 * A page renders its own header and its own content pane in the main column
 * and tells the shell what it shows through `useShellPage`
 * (`hooks/useShellPage.ts`), including the pane that `j`, `k`, `g g` and
 * `Shift+G` scroll.
 *
 * The sidebar's preferences are the reader's, not a page's: its width and
 * whether it is put away are remembered and follow the reader between tabs.
 * The phone's slide-out is a gesture, not a preference, and is not
 * remembered.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Clock,
  Database,
  Expand,
  File,
  GitBranch,
  List,
  ListChecks,
  Loader2,
  Menu,
  PanelLeftClose,
  Shrink,
  X,
} from "lucide-react";
import { AppLink } from "./AppLink";
import { ConnectionBanner } from "./ConnectionBanner";
import { DegradedBanner } from "./DegradedBanner";
import { FilePicker } from "./FilePicker";
import { FileTree } from "./FileTree";
import {
  KeyboardShortcutsButton,
  KeyboardShortcutsModal,
} from "./KeyboardShortcuts";
import { ProjectPicker } from "./ProjectPicker";
import { RecentFilePopover } from "./RecentFilePopover";
import { RecentsModal, type RecentsScope } from "./RecentsModal";
import { RelativeTime } from "./RelativeTime";
import { SettingsDropdown } from "./SettingsDropdown";
import { StarredSection } from "./StarredSection";
import { StyleGuideModal } from "./StyleGuideModal";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { usePersistentFlag } from "../hooks/usePersistentFlag";
import { usePersistentValue } from "../hooks/usePersistentValue";
import {
  ShellContext,
  type ShellContextValue,
  type ShellControls,
  type ShellRegistered,
  type ShellShown,
} from "../hooks/useShellPage";
import { prefetchPlanningPage } from "../hooks/usePlanningPageInputs";
import { planningPath } from "../lib/planningRoute";
import { cn } from "../lib/utils";
import { useFilePickerStore } from "../stores/useFilePickerStore";
import { useGitStore } from "../stores/useGitStore";
import { useRepoStore } from "../stores/useRepoStore";
import { useStarredStore } from "../stores/useStarredStore";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 800;
const SIDEBAR_DEFAULT_WIDTH = 288;

/**
 * The remembered sidebar width, in px.
 *
 * Out-of-range and unparseable both mean the default rather than a clamp,
 * because a stored width outside these bounds is not a preference the reader
 * expressed — it is a value from a build with different bounds, or a
 * hand-edited one — and honoring it would leave a sidebar the drag handle
 * cannot get back to.
 *
 * Declared at module scope, not in the component: `usePersistentValue` follows
 * this preference for as long as this function's identity holds, and an
 * arrow rebuilt on every render would make it re-read storage on every render.
 */
function parseSidebarWidth(raw: string | null): number {
  const width = raw === null ? NaN : parseInt(raw, 10);
  return Number.isFinite(width) &&
    width >= SIDEBAR_MIN_WIDTH &&
    width <= SIDEBAR_MAX_WIDTH
    ? width
    : SIDEBAR_DEFAULT_WIDTH;
}

const noop = () => {};

/**
 * The shell: its loading state until the repositories are known, since which
 * sidebar to draw is not known before, then the frame. `children` stand in
 * for the route's outlet, for a test that draws one page in it.
 */
export const AppShell: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const { reposLoaded, loadRepos } = useRepoStore();
  // Once for the app, as the history and recents pages ask for them: going
  // between the shell's pages keeps the repositories it has, and pushes keep
  // them current (`refreshRepos`).
  useEffect(() => {
    if (!reposLoaded) loadRepos();
  }, [loadRepos, reposLoaded]);
  if (!reposLoaded) return <ShellLoading />;
  return <ShellFrame>{children ?? <Outlet />}</ShellFrame>;
};

const ShellFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    fileTree,
    refreshTree,
    refreshExpandedTree,
    repos,
    isMultiRepo,
    currentRepo,
    reposLoaded,
    refreshRepos,
    showEmptyDirs,
    setShowEmptyDirs,
    showHidden,
    setShowHidden,
    showGitignored,
    setShowGitignored,
  } = useRepoStore();
  const { recentFiles, isRecentLoading, fetchRecentFiles } = useGitStore();
  const recentlyChangedPaths = useRepoStore((s) => s.recentlyChangedPaths);
  const navigate = useNavigate();

  // What the page on screen publishes (`useShellPage`), and, until the first
  // one has, the viewer's rule for the sidebar: none over daemon mode's
  // project list.
  const [shown, setShown] = useState<ShellShown | null>(null);
  const publish = useCallback((next: ShellShown) => {
    setShown((prev) =>
      prev !== null &&
      prev.showSidebar === next.showSidebar &&
      prev.routeKey === next.routeKey &&
      prev.currentPath === next.currentPath &&
      prev.documentKeys === next.documentKeys &&
      prev.filterKey === next.filterKey
        ? prev
        : next,
    );
  }, []);
  const showSidebar = shown?.showSidebar ?? !(isMultiRepo && !currentRepo);
  const routeKey = shown?.routeKey ?? null;
  const currentPath = shown?.currentPath ?? null;
  // What the page registers for the keys, read only when one is pressed.
  const pageRef = useRef<ShellRegistered | null>(null);
  const register = useCallback((page: ShellRegistered | null) => {
    pageRef.current = page;
  }, []);
  // The pane the scrolling keys move: the page's, whichever is on screen.
  const contentScrollRef = useMemo(
    () => ({
      get current(): HTMLDivElement | null {
        return pageRef.current?.contentRef.current ?? null;
      },
    }),
    [],
  );
  const onViewDiff = useCallback(
    () => (pageRef.current?.shortcuts?.onViewDiff ?? noop)(),
    [],
  );
  const onViewHistory = useCallback(
    () => (pageRef.current?.shortcuts?.onViewHistory ?? noop)(),
    [],
  );
  const onCopyPath = useCallback(
    () => (pageRef.current?.shortcuts?.onCopyPath ?? noop)(),
    [],
  );
  const onEscape = useCallback(
    () => (pageRef.current?.shortcuts?.onEscape ?? noop)(),
    [],
  );
  // `/`, wired only while the page on screen has a filter box: elsewhere the
  // key stays the browser's (docs/design/planning-filter.md §7).
  const focusFilter = useCallback(
    () => (pageRef.current?.onFocusFilter ?? noop)(),
    [],
  );
  const onFocusFilter = shown?.filterKey === true ? focusFilter : undefined;
  // How much of the pane's bottom the degradation banner covers.
  const [bannerSpace, setBannerSpace] = useState(0);

  // Page 1 of the planning page, asked for when the pointer or focus reaches
  // the sidebar's planning entry (planning-index.md §6.4), so the
  // click finds its inputs in hand. Nothing is asked before the index is
  // ready, nor in daemon mode with no repository open.
  const planningRepo = isMultiRepo ? currentRepo : "";
  const prefetchPlanning = useCallback(() => {
    if (planningRepo !== null) prefetchPlanningPage(planningRepo);
  }, [planningRepo]);

  const buildPath = useCallback(
    (filePath: string): string =>
      isMultiRepo && currentRepo
        ? `/${currentRepo}/${filePath}`
        : `/${filePath}`,
    [isMultiRepo, currentRepo],
  );

  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  // Which recents modal is open: `r`'s current project, or `Shift+R`'s all.
  const [recentsScope, setRecentsScope] = useState<RecentsScope | null>(null);
  const [styleGuideOpen, setStyleGuideOpen] = useState(false);
  // The file pickers' lists live in a store so the watcher can refresh them
  // while they are on screen.
  const {
    open: filePickerMode,
    files: allFiles,
    globalFiles,
    loading: filePickerLoading,
    openLocal: openLocalFilePicker,
    openGlobal: openGlobalFilePicker,
    close: closeFilePicker,
  } = useFilePickerStore();

  // `sidebarOpen` is the mobile slide-out panel, which is a gesture rather than a
  // preference and is deliberately not remembered. The two below are
  // preferences, and they follow the reader between tabs: a reader who narrowed
  // the sidebar or put it away meant it for the window, not for one tab of it.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentFlag(
    "vantage:sidebarCollapsed",
  );
  const [sidebarWidth, setSidebarWidth] = usePersistentValue(
    "vantage:sidebarWidth",
    parseSidebarWidth,
    String,
  );
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const isResizingSidebarRef = useRef(false);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isResizingSidebarRef.current) return;
      const w = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, e.clientX),
      );
      setSidebarWidth(w);
    };
    const onUp = () => {
      if (!isResizingSidebarRef.current) return;
      isResizingSidebarRef.current = false;
      setIsResizingSidebar(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // The setter is stable — `usePersistentValue` memoizes it on the preference
    // name — so naming it here does not cost the drag listeners a re-bind.
  }, [setSidebarWidth]);
  const [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled] =
    usePersistentFlag("vantage:shortcuts-enabled", true);

  // Close the mobile sidebar when the route changes. This adjusts state during
  // render (React's documented pattern) rather than from an effect.
  //
  // Dropping the previous repository's file list used to live here too, for the
  // same reason; useFilePickerStore now drops it as it opens, which cannot
  // publish a render carrying the wrong repo's list at all.
  const [prevRouteKey, setPrevRouteKey] = useState(routeKey);
  if (prevRouteKey !== routeKey) {
    setPrevRouteKey(routeKey);
    setSidebarOpen(false);
  }

  // Bookmarks are global rather than repo-scoped, so they load once on mount
  // and do not wait for a repo to be selected.
  const loadStarred = useStarredStore((s) => s.loadStarred);
  useEffect(() => {
    void loadStarred();
  }, [loadStarred]);

  // Load initial tree structure (after repos are loaded, only for single-repo
  // mode; in daemon mode choosing the repository loads its tree).
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

  // The recent files, when a repository is set (or on mount for single-repo).
  useEffect(() => {
    if (!reposLoaded) return;
    if (isMultiRepo && !currentRepo) return;
    fetchRecentFiles();
  }, [fetchRecentFiles, reposLoaded, isMultiRepo, currentRepo]);

  // Keyboard shortcuts
  //
  // Opening a picker refetches its list, and the watcher's pushes keep it
  // current while it is open (see useFilePickerStore). The list already on
  // screen stays there until the answer arrives, so neither a reopen nor a live
  // refresh is a spinner.
  const handleOpenFilePicker = useCallback(() => {
    const {
      isMultiRepo: imr,
      currentRepo: cr,
      reposLoaded: rl,
    } = useRepoStore.getState();
    if (!rl) return;
    // In multi-repo mode with no repo selected there is no local list to search
    if (imr && !cr) {
      void openGlobalFilePicker("all");
      return;
    }
    void openLocalFilePicker();
  }, [openLocalFilePicker, openGlobalFilePicker]);
  const handleOpenGlobalFilePicker = useCallback(() => {
    void openGlobalFilePicker("all");
  }, [openGlobalFilePicker]);
  const handleOpenProjectPicker = useCallback(() => {
    setProjectPickerOpen(true);
    // `repos` tracks `repos_changed` pushes, but only while the socket is up —
    // a project discovered during a disconnect would otherwise be missing here
    // until a reload.
    refreshRepos();
  }, [refreshRepos]);
  const handleOpenRecentFiles = useCallback(() => {
    setRecentsScope("project");
  }, []);
  const handleOpenGlobalRecentFiles = useCallback(() => {
    setRecentsScope("all");
  }, []);
  // File picker route and select handler. The picker renders each row as a
  // link to `filePickerHref`, and selecting a row navigates to the same route.
  const filePickerHref = useCallback(
    (path: string, repo?: string): string =>
      // Global mode names the repo; local mode is the current one
      repo ? `/${repo}/${path}` : buildPath(path),
    [buildPath],
  );
  const handleFilePickerSelect = useCallback(
    (path: string, repo?: string) => {
      navigate(filePickerHref(path, repo));
    },
    [navigate, filePickerHref],
  );
  const projectPickerHref = useCallback(
    (repoName: string): string => `/${repoName}`,
    [],
  );
  const handleProjectSelect = useCallback(
    (repoName: string) => {
      navigate(projectPickerHref(repoName));
    },
    [navigate, projectPickerHref],
  );
  const handleToggleSidebar = useCallback(() => {
    // On mobile, toggle the slide-out panel; on desktop, collapse the sidebar
    if (window.innerWidth < 768) {
      setSidebarOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  }, [setSidebarCollapsed]);
  const openSidebar = useCallback(() => {
    if (window.innerWidth < 768) {
      setSidebarOpen(true);
    } else {
      setSidebarCollapsed(false);
    }
  }, [setSidebarCollapsed]);
  const handleShortcutNavigate = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate],
  );

  const { shortcutsOpen, setShortcutsOpen } = useKeyboardShortcuts({
    onOpenFilePicker: handleOpenFilePicker,
    onOpenGlobalFilePicker: handleOpenGlobalFilePicker,
    onOpenProjectPicker: handleOpenProjectPicker,
    onOpenRecentFiles: handleOpenRecentFiles,
    onOpenGlobalRecentFiles: handleOpenGlobalRecentFiles,
    onToggleSidebar: handleToggleSidebar,
    onNavigate: handleShortcutNavigate,
    onViewDiff,
    onViewHistory,
    onCopyPath,
    onEscape,
    onFocusFilter,
    contentScrollRef,
    isMultiRepo,
    currentRepo,
    enabled: keyboardShortcutsEnabled,
  });

  const controls = useMemo<ShellControls>(
    () => ({ sidebarCollapsed, openSidebar, bannerSpace }),
    [sidebarCollapsed, openSidebar, bannerSpace],
  );
  const context = useMemo<ShellContextValue>(
    () => ({ controls, publish, register }),
    [controls, publish, register],
  );

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
            data-testid="sidebar"
            style={{ width: `${sidebarWidth}px` }}
            className={cn(
              "flex-shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-white dark:bg-slate-800 shadow-sm relative",
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
                  className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
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
                {/* The planning page (planning-index.md §6), also `g p`. */}
                <AppLink
                  to={planningPath(isMultiRepo, currentRepo)}
                  className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  aria-label="Planning"
                  title="Planning (g p)"
                  onPointerEnter={prefetchPlanning}
                  onFocus={prefetchPlanning}
                >
                  <ListChecks size={16} />
                </AppLink>
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
                  onOpenStyleGuide={() => setStyleGuideOpen(true)}
                />
                <button
                  className="hidden md:block p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  onClick={() => {
                    setSidebarCollapsed(true);
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
                <StarredSection />
                <FileTree nodes={fileTree} />
              </>
            </div>
            {/* Recent Files Section - always visible, with spinner when loading */}
            {(!isMultiRepo || currentRepo) && (
              <div className="border-t border-slate-200 dark:border-slate-700 px-2 py-2 shrink-0">
                <button
                  onClick={() => setRecentsScope("project")}
                  className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center space-x-1.5 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-full"
                >
                  <Clock size={12} />
                  <span>Recent</span>
                  {isRecentLoading && (
                    <Loader2
                      size={10}
                      className="animate-spin text-slate-500 dark:text-slate-400"
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
                                  : "text-slate-500 dark:text-slate-400",
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate text-slate-700 dark:text-slate-300 font-medium">
                                  {fileName}
                                </span>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                                  <RelativeTime
                                    date={file.date}
                                    addSuffix={false}
                                  />
                                </span>
                              </div>
                              {parentDir && (
                                <div className="truncate text-slate-500 dark:text-slate-400">
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
            <div
              data-testid="sidebar-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onPointerDown={(e) => {
                e.preventDefault();
                isResizingSidebarRef.current = true;
                setIsResizingSidebar(true);
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
              className={cn(
                "hidden md:block absolute top-0 right-0 h-full w-1 -mr-0.5 cursor-col-resize z-10 touch-none",
                "hover:bg-blue-400/60 active:bg-blue-500/80 transition-colors",
                isResizingSidebar && "bg-blue-500/80",
              )}
            />
          </div>
        )}

        {/* Main Content: the page's header and pane, and the degradation
            banner, which floats over the pane's bottom (the page leaves
            `bannerSpace` of room under its content for it). */}
        <div className="relative flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900 min-w-0">
          <ShellContext.Provider value={context}>
            {children}
          </ShellContext.Provider>
          <DegradedBanner onSpaceChange={setBannerSpace} />
        </div>

        {/* File Picker (local) */}
        <FilePicker
          isOpen={filePickerMode === "local"}
          onClose={closeFilePicker}
          onSelect={handleFilePickerSelect}
          hrefFor={filePickerHref}
          files={allFiles}
          loading={filePickerLoading && allFiles.length === 0}
        />
        {/* File Picker (global - all repos) */}
        <FilePicker
          isOpen={filePickerMode === "global"}
          onClose={closeFilePicker}
          onSelect={handleFilePickerSelect}
          hrefFor={filePickerHref}
          files={[]}
          globalFiles={globalFiles}
          mode="global"
          placeholder="Search all projects' files..."
          loading={filePickerLoading && globalFiles.length === 0}
        />
        {/* Project Picker */}
        <ProjectPicker
          isOpen={projectPickerOpen}
          onClose={() => setProjectPickerOpen(false)}
          onSelect={handleProjectSelect}
          hrefFor={projectPickerHref}
          repos={repos}
        />
        {/* Recents Modal */}
        <RecentsModal
          isOpen={recentsScope !== null}
          scope={recentsScope ?? "project"}
          onClose={() => setRecentsScope(null)}
        />
        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal
          isOpen={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
          documentKeys={shown?.documentKeys ?? true}
          filterKey={shown?.filterKey ?? false}
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

/** The whole app's loading state, before the repositories are known. */
export const ShellLoading: React.FC = () => (
  <div className="flex h-screen bg-slate-50 dark:bg-slate-900 items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <Loader2 size={24} className="animate-spin text-blue-500" />
      <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
    </div>
  </div>
);

/**
 * The header's way back to a sidebar that is put away, or to the phone's
 * slide-out, which is always put away until asked for.
 */
export const OpenSidebarButton: React.FC<{ shell: ShellControls }> = ({
  shell,
}) => (
  <button
    className={cn(
      "p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 shrink-0",
      shell.sidebarCollapsed ? "" : "md:hidden",
    )}
    onClick={shell.openSidebar}
    aria-label="Open sidebar"
  >
    <Menu size={20} />
  </button>
);

/** One of the header's two view toggles, as a page offers it. */
export interface ViewToggle {
  on: boolean;
  onToggle: () => void;
}

const toggleClass = (on: boolean) =>
  on
    ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700";

/**
 * The header's contents-column and full-width toggles, desktop-only, in the
 * header's leading half. The contents toggle is left out where a page has no
 * contents column to offer. The two fold into the toolbar's "⋯" with the
 * actions (`lib/headerFit.ts`), where {@link ViewTogglesPanel} draws them.
 */
export const ViewToggles: React.FC<{
  contents: ViewToggle | null;
  fullWidth: ViewToggle;
}> = ({ contents, fullWidth }) => (
  <>
    {contents !== null && (
      <button
        onClick={contents.onToggle}
        className={cn(
          "hdr-view hidden md:block p-1.5 rounded-md shrink-0 transition-colors cursor-pointer",
          toggleClass(contents.on),
        )}
        aria-label={contents.on ? "Hide contents" : "Show contents"}
        aria-pressed={contents.on}
        title={contents.on ? "Hide contents" : "Show contents"}
      >
        <List size={18} />
      </button>
    )}
    <button
      onClick={fullWidth.onToggle}
      className={cn(
        "hdr-view hidden md:block p-1.5 rounded-md shrink-0 transition-colors cursor-pointer",
        toggleClass(fullWidth.on),
      )}
      aria-label={fullWidth.on ? "Use fixed width" : "Use full width"}
      aria-pressed={fullWidth.on}
      title={fullWidth.on ? "Use fixed width" : "Use full width"}
    >
      {fullWidth.on ? <Shrink size={18} /> : <Expand size={18} />}
    </button>
  </>
);

/**
 * The same two toggles as they appear in the toolbar's "⋯" panel once the
 * `actions` step folds them in. Only rendered while that panel is open, so
 * the header never holds two of each. Desktop-only, as the toggles are.
 */
export const ViewTogglesPanel: React.FC<{
  contents: ViewToggle | null;
  fullWidth: ViewToggle;
}> = ({ contents, fullWidth }) => {
  const panelButton =
    "hidden md:flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer";
  const panelToggle = (on: boolean) =>
    on
      ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
      : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50";
  return (
    <>
      {contents !== null && (
        <button
          type="button"
          onClick={contents.onToggle}
          className={cn(panelButton, panelToggle(contents.on))}
          aria-pressed={contents.on}
        >
          <List size={14} />
          <span>{contents.on ? "Hide contents" : "Show contents"}</span>
        </button>
      )}
      <button
        type="button"
        onClick={fullWidth.onToggle}
        className={cn(panelButton, panelToggle(fullWidth.on))}
        aria-pressed={fullWidth.on}
      >
        {fullWidth.on ? <Shrink size={14} /> : <Expand size={14} />}
        <span>{fullWidth.on ? "Use fixed width" : "Use full width"}</span>
      </button>
    </>
  );
};
