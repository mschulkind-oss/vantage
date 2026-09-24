import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { FileTree } from "../components/FileTree";
import { StarButton } from "../components/StarButton";
import { StarredSection } from "../components/StarredSection";
import { RemoveBookmarkButton } from "../components/RemoveBookmarkButton";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { DirectoryViewer } from "../components/DirectoryViewer";
import { DiffViewer } from "../components/DiffViewer";
import { FilePicker } from "../components/FilePicker";
import { useFilePickerStore } from "../stores/useFilePickerStore";
import { ProjectPicker } from "../components/ProjectPicker";
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
  List,
  Expand,
  Shrink,
} from "lucide-react";
// History icon retained for the file-history link in the breadcrumb area.
import { RelativeTime } from "../components/RelativeTime";
import { CommentsDriftedIndicator } from "../components/CommentsDriftedIndicator";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { scrollToAnchor } from "../lib/anchorScroll";
import { isStaticMode } from "../lib/staticMode";
import { bookmarkTargetFromRoute } from "../lib/bookmarkTarget";
import { useStarredStore } from "../stores/useStarredStore";
import { copyTextOrWarn } from "../lib/clipboard";
import { SettingsDropdown } from "../components/SettingsDropdown";
import { RecentFilePopover } from "../components/RecentFilePopover";
import {
  KeyboardShortcutsModal,
  KeyboardShortcutsButton,
} from "../components/KeyboardShortcuts";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { RecentsModal } from "../components/RecentsModal";
import {
  isAnsweredByAgent,
  isPendingForAgent,
  useReviewStore,
} from "../stores/useReviewStore";
import { ReviewPanel } from "../components/ReviewPanel";
import { MessageSquarePlus, ClipboardCopy } from "lucide-react";
import { useLineAnchor } from "../hooks/useLineAnchor";
import { usePersistentFlag } from "../hooks/usePersistentFlag";
import { usePersistentValue } from "../hooks/usePersistentValue";
import { StyleGuideModal } from "../components/StyleGuideModal";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { useConnectionStore } from "../stores/useConnectionStore";
import { ReviewStripe } from "../components/ReviewStripe";
import { TableOfContents } from "../components/TableOfContents";

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
    refreshRepos,
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

  // Whether the live socket is up, which decides if the error view can promise
  // to recover on its own.
  const connected = useConnectionStore((s) => s.connected);

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
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [recentsModalOpen, setRecentsModalOpen] = useState(false);
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
  const [showRaw, setShowRaw] = useState(false);
  // Remembered across documents, reloads and tabs: a reader who wants a table
  // of contents wants it for the next document too, and a second tab of the
  // same repo is the same reader — so `usePersistentFlag` also adopts the
  // change when the other tab makes it, rather than waiting for a reload.
  const [tocOpen, setTocOpen] = usePersistentFlag("vantage:tocOpen");
  // Whether the document uses the whole window instead of a measured column.
  const [fullWidth, setFullWidth] = usePersistentFlag("vantage:fullWidth");
  /**
   * How many Open Questions the open document offers a one-click answer for.
   *
   * Reported by the viewer whether or not review mode is on, because the
   * button is gated on review mode (D4) and nothing else says the affordance
   * is there at all — a document with three `oq` directives and review mode
   * off otherwise looks exactly like one with none. It reaches the reader
   * through the Review toggle's tooltip; see `advertiseOpenQuestions`.
   */
  const [openQuestionCount, setOpenQuestionCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled] =
    usePersistentFlag("vantage:shortcuts-enabled", true);
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
  const pendingReviewCount = reviewComments.filter(isPendingForAgent).length;
  const activeReviewCount = reviewComments.filter((c) => !c.resolved).length;
  const copyAllReviewComments = useReviewStore((s) => s.copyAllToClipboard);
  const dismissAllReview = useReviewStore((s) => s.dismissAll);
  const dismissAnsweredReview = useReviewStore((s) => s.dismissAnswered);
  // Answered, not outdated. "Outdated" is an anchor fact — the text this was
  // written against is gone — and bulk-dismissing by it grouped comments for a
  // reason nobody is thinking about. The useful sweep is "the agent replied and
  // I am happy", which is what this counts.
  const answeredReviewCount = reviewComments.filter(isAnsweredByAgent).length;
  const endReview = useReviewStore((s) => s.endReview);
  const hasReviewData = useReviewStore((s) => s.hasReviewData);
  // The document changed under a comment still awaiting a response, so the
  // context those comments were written against is no longer what's on screen.
  // Published by useReviewHighlights from the anchor hashes it already resolves.
  const commentsDrifted = useReviewStore((s) => s.commentsDrifted);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [reviewCopied, setReviewCopied] = useState(false);
  const [reviewExitConfirm, setReviewExitConfirm] = useState(false);
  const [reviewDismissConfirm, setReviewDismissConfirm] = useState(false);

  // Raw view can't host the inline highlights review mode is made of; a static
  // export can't save a comment at all — `vantage build` emits no review
  // endpoint and staticMode.ts coerces every write to a GET, so an offered
  // Review toggle there loses the reviewer's answer on reload while looking
  // like it worked. A control that cannot work must not render (design D4/R7),
  // the same way the Untracked-file button below is gated.
  const reviewToggleVisible = !showRaw && !isStaticMode();
  /**
   * Whether to advertise this document's one-click Open Questions on the
   * Review toggle.
   *
   * The tooltip, and nothing else. It used to be a count chip beside the
   * label too; that read as an unread badge on a toolbar that has no other
   * notification, so the number is gone and the sentence it stood for now
   * lives only in `reviewToggleTitle`.
   *
   * Only while review mode is OFF: once it is on, the buttons are on the page
   * and the count would be repeating what the reader can already see.
   */
  const advertiseOpenQuestions =
    reviewToggleVisible &&
    !isReviewMode &&
    !reviewExitConfirm &&
    openQuestionCount > 0;
  const reviewToggleTitle = reviewExitConfirm
    ? "Click again to end review & clear data"
    : isReviewMode
      ? "Exit review mode"
      : advertiseOpenQuestions
        ? `Enter review mode — ${openQuestionCount} open question${
            openQuestionCount === 1 ? "" : "s"
          } here can be answered in one click`
        : "Enter review mode";

  const handleReviewToggle = useCallback(() => {
    if (isReviewMode && hasReviewData()) {
      if (reviewExitConfirm) {
        endReview();
        setReviewExitConfirm(false);
      } else {
        setReviewExitConfirm(true);
        setTimeout(() => setReviewExitConfirm(false), 3000);
      }
    } else {
      toggleReviewMode();
    }
  }, [
    isReviewMode,
    hasReviewData,
    reviewExitConfirm,
    endReview,
    toggleReviewMode,
  ]);

  const handleReviewDismiss = useCallback(() => {
    if (reviewDismissConfirm) {
      dismissAllReview();
      setReviewDismissConfirm(false);
    } else if (answeredReviewCount > 0) {
      dismissAnsweredReview();
    } else {
      setReviewDismissConfirm(true);
      setTimeout(() => setReviewDismissConfirm(false), 3000);
    }
  }, [
    reviewDismissConfirm,
    answeredReviewCount,
    dismissAllReview,
    dismissAnsweredReview,
  ]);

  // Load review data when file changes
  useEffect(() => {
    if (currentPath && currentPath.toLowerCase().endsWith(".md")) {
      loadReview(currentPath).catch(() => {});
    }
  }, [currentPath, loadReview]);

  // Track lastContent so the clipboard prompt has source lines to render.
  // Before/after capture is entirely server-side: the comment's anchored
  // block is captured at create/reply time and again at delivery time.
  useEffect(() => {
    if (!fileContent || !isReviewMode) return;
    reviewSetLastContent(fileContent.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContent?.content, isReviewMode]);

  // --- Style guide ---
  const [styleGuideOpen, setStyleGuideOpen] = useState(false);

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

  // Bookmarks are global rather than repo-scoped, so they load once on mount
  // and do not wait for a repo to be selected.
  const loadStarred = useStarredStore((s) => s.loadStarred);
  useEffect(() => {
    void loadStarred();
  }, [loadStarred]);

  // What a bookmark for this route would be keyed by. Derived from the URL so
  // it still answers when the repo store cannot — see bookmarkTargetFromRoute.
  const bookmarkTarget = useMemo(
    () => bookmarkTargetFromRoute(pathParam, isMultiRepo),
    [pathParam, isMultiRepo],
  );

  // Close the mobile sidebar when the path changes. This adjusts state during
  // render (React's documented pattern) rather than from an effect.
  //
  // Dropping the previous repository's file list used to live here too, for the
  // same reason; useFilePickerStore now drops it as it opens, which cannot
  // publish a render carrying the wrong repo's list at all.
  const [prevPathParam, setPrevPathParam] = useState(pathParam);
  if (prevPathParam !== pathParam) {
    setPrevPathParam(pathParam);
    setSidebarOpen(false);
  }

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
        // Not served: never configured, or retired by the daemon because its
        // directory went away. This page is live either way — `repos` is
        // refetched on every repos_changed push, so this effect re-runs when
        // the repo comes back and loads the document below.
        //
        // Deselecting the repo is what makes that return clean: with
        // currentRepo cleared it re-enters through setCurrentRepo, which
        // refetches the file tree this branch is about to drop. Left selected,
        // the document would come back under an empty sidebar.
        if (currentRepo) setCurrentRepo(null);
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
      // One frame, so the markdown for the new file has rendered. Then
      // `scrollToAnchor` — an `other.md#slug` arrival lands on a section the
      // author collapsed just as often as an in-document link does, and it has
      // to open before anything measures the target's box.
      requestAnimationFrame(() => {
        scrollToAnchor(anchor, contentRef.current);
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
    setRecentsModalOpen(true);
  }, []);
  const handleOpenGlobalRecentFiles = useCallback(() => {
    void openGlobalFilePicker("recent");
  }, [openGlobalFilePicker]);
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
  const handleToggleToc = useCallback(() => {
    setTocOpen((prev) => !prev);
  }, [setTocOpen]);
  const handleToggleFullWidth = useCallback(() => {
    setFullWidth((prev) => !prev);
  }, [setFullWidth]);
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
    copyTextOrWarn(absolutePath).then((ok) => {
      if (!ok) return;
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 2000);
    });
  }, [repoRootPath, currentPath]);
  /**
   * Escape leaves raw view.
   *
   * Raw is a toggle, but it replaces the entire content pane, so it reads as a
   * mode — and every other thing that takes the pane or the screen over leaves
   * on Escape. Nothing else here claims the key: the shortcuts modal is handled
   * one level in, inside the hook, and gets first refusal.
   */
  const handleEscape = useCallback(() => {
    setShowRaw((raw) => (raw ? false : raw));
  }, []);

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
    onEscape: handleEscape,
    contentScrollRef: contentRef,
    isMultiRepo,
    currentRepo,
    enabled: keyboardShortcutsEnabled,
  });

  const breadcrumbs =
    currentPath && currentPath !== "." ? currentPath.split("/") : [];

  // Whether to show the sidebar (hide on repo picker page)
  const showSidebar = !(isMultiRepo && !currentRepo);

  // The table of contents is built from the rendered headings, so it only has anything to
  // say while a document is actually rendered: not over raw source, a binary
  // file, a directory listing or the repo picker.
  const tocAvailable =
    !showRaw &&
    !!fileContent &&
    fileContent.encoding !== "binary" &&
    !!currentPath?.toLowerCase().endsWith(".md");

  // Show a minimal loading state until repos metadata is loaded.
  // This prevents flashing the single-repo sidebar before multi-repo
  // mode is detected.
  if (!reposLoaded) {
    return (
      <div className="flex h-screen bg-slate-50 dark:bg-slate-900 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-blue-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
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
                  onClick={() => setRecentsModalOpen(true)}
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

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900 min-w-0">
          {/* Header / Breadcrumbs - hidden on repo picker page */}
          {showSidebar ? (
            <div className="h-14 border-b border-slate-200 dark:border-slate-700 flex items-center px-3 md:px-6 justify-between shrink-0 bg-white dark:bg-slate-800 gap-2">
              <div className="flex items-center min-w-0 gap-2">
                <button
                  className={cn(
                    "p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 shrink-0",
                    sidebarCollapsed ? "" : "md:hidden",
                  )}
                  onClick={() => {
                    if (window.innerWidth < 768) {
                      setSidebarOpen(true);
                    } else {
                      setSidebarCollapsed(false);
                    }
                  }}
                  aria-label="Open sidebar"
                >
                  <Menu size={20} />
                </button>
                {tocAvailable && (
                  <button
                    onClick={handleToggleToc}
                    className={cn(
                      "hidden md:block p-1.5 rounded-md shrink-0 transition-colors cursor-pointer",
                      tocOpen
                        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                        : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700",
                    )}
                    aria-label={tocOpen ? "Hide contents" : "Show contents"}
                    aria-pressed={tocOpen}
                    title={tocOpen ? "Hide contents" : "Show contents"}
                  >
                    <List size={18} />
                  </button>
                )}
                {showSidebar && (
                  <button
                    onClick={handleToggleFullWidth}
                    className={cn(
                      "hidden md:block p-1.5 rounded-md shrink-0 transition-colors cursor-pointer",
                      fullWidth
                        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                        : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700",
                    )}
                    aria-label={
                      fullWidth ? "Use fixed width" : "Use full width"
                    }
                    aria-pressed={fullWidth}
                    title={fullWidth ? "Use fixed width" : "Use full width"}
                  >
                    {fullWidth ? <Shrink size={18} /> : <Expand size={18} />}
                  </button>
                )}
                <nav className="flex items-center text-sm space-x-1 min-w-0 overflow-hidden">
                  <AppLink
                    to={isMultiRepo && currentRepo ? `/${currentRepo}` : "/"}
                    className="text-slate-500 dark:text-slate-400 hover:text-blue-600 font-medium transition-colors shrink-0 no-underline"
                  >
                    {isMultiRepo && currentRepo ? currentRepo : "root"}
                  </AppLink>
                  {breadcrumbs.map((part, i) => (
                    <React.Fragment key={i}>
                      <ChevronRight
                        size={14}
                        className="text-slate-500 dark:text-slate-400 shrink-0"
                      />
                      {i < breadcrumbs.length - 1 ? (
                        <AppLink
                          to={buildPath(
                            currentPath
                              ?.split("/")
                              .slice(0, i + 1)
                              .join("/") || ".",
                          )}
                          className="text-slate-500 dark:text-slate-400 hover:text-blue-600 transition-colors no-underline hidden sm:inline"
                        >
                          {part}
                        </AppLink>
                      ) : (
                        // `truncate` is what puts the ellipsis there, and it
                        // is the only place the full name is ever elided, so
                        // the title is the only way to read it back.
                        <span
                          className="font-semibold text-slate-900 dark:text-slate-100 truncate"
                          title={part}
                        >
                          {part}
                        </span>
                      )}
                    </React.Fragment>
                  ))}
                </nav>
                <StarButton
                  path={currentPath}
                  repo={currentRepo}
                  isDir={currentDirectory !== null}
                />
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
                      <span className="text-slate-500 dark:text-slate-400">
                        ·
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {formatDateTime(latestCommit.date)}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1.5 bg-slate-100 dark:bg-slate-700 group-hover:bg-slate-200 dark:group-hover:bg-slate-600 px-2.5 py-1.5 rounded-md transition-colors">
                      <MessageSquare
                        size={12}
                        className="text-slate-500 dark:text-slate-400"
                      />
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
                  {/* Raw view can't host inline highlights, but the review
                      controls must stay reachable: hiding them stranded a
                      reviewer with pending comments and no way to copy,
                      dismiss, or open the panel without switching back. */}
                  {currentPath && currentPath.toLowerCase().endsWith(".md") && (
                    <>
                      {reviewToggleVisible && (
                        <button
                          onClick={handleReviewToggle}
                          className={cn(
                            "flex items-center space-x-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                            reviewExitConfirm
                              ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 ring-1 ring-red-300 dark:ring-red-700"
                              : isReviewMode
                                ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-300 dark:ring-purple-700"
                                : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                          )}
                          title={reviewToggleTitle}
                        >
                          <MessageSquarePlus size={14} />
                          <span className="hidden sm:inline">
                            {reviewExitConfirm ? "End review?" : "Review"}
                          </span>
                        </button>
                      )}
                      {isReviewMode && (
                        <>
                          {/* The min-width reserves room for the longest label
                              so arming the confirm doesn't resize the button
                              under the reviewer's finger. It is sm:-only
                              because the label is: below that it reserved
                              100px of blank pill beside a 14px icon, on the
                              screen with the least room to spare. */}
                          {activeReviewCount > 0 && (
                            <button
                              onClick={handleReviewDismiss}
                              className={`flex items-center space-x-1.5 text-xs rounded-lg sm:min-w-[100px] px-2 py-1.5 transition-colors cursor-pointer ${
                                reviewDismissConfirm
                                  ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50"
                                  : "text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-600/50"
                              }`}
                              title={
                                reviewDismissConfirm
                                  ? "Click again to dismiss all"
                                  : answeredReviewCount > 0
                                    ? "Dismiss comments the agent has answered"
                                    : "Dismiss all comments"
                              }
                            >
                              <Check size={14} />
                              <span className="hidden sm:inline">
                                {reviewDismissConfirm
                                  ? "Confirm?"
                                  : answeredReviewCount > 0
                                    ? `Dismiss ${answeredReviewCount} answered`
                                    : `Dismiss ${activeReviewCount}`}
                              </span>
                            </button>
                          )}
                          {commentsDrifted && <CommentsDriftedIndicator />}
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
                      <span className="text-slate-500 dark:text-slate-400">
                        ·
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
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
                  {/* Same as the wide toolbar: review controls survive raw view. */}
                  <>
                    {reviewToggleVisible && (
                      <button
                        onClick={handleReviewToggle}
                        className={cn(
                          "flex items-center space-x-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                          reviewExitConfirm
                            ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 ring-1 ring-red-300 dark:ring-red-700"
                            : isReviewMode
                              ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-300 dark:ring-purple-700"
                              : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                        )}
                        title={reviewToggleTitle}
                      >
                        <MessageSquarePlus size={14} />
                        <span className="hidden sm:inline">
                          {reviewExitConfirm ? "End review?" : "Review"}
                        </span>
                      </button>
                    )}
                    {isReviewMode && (
                      <>
                        {activeReviewCount > 0 && (
                          <button
                            onClick={handleReviewDismiss}
                            className={`flex items-center space-x-1.5 text-xs rounded-lg sm:min-w-[100px] px-2 py-1.5 transition-colors cursor-pointer ${
                              reviewDismissConfirm
                                ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50"
                                : "text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-600/50"
                            }`}
                            title={
                              reviewDismissConfirm
                                ? "Click again to dismiss all"
                                : answeredReviewCount > 0
                                  ? "Dismiss comments the agent has answered"
                                  : "Dismiss all comments"
                            }
                          >
                            <Check size={14} />
                            <span className="hidden sm:inline">
                              {reviewDismissConfirm
                                ? "Confirm?"
                                : answeredReviewCount > 0
                                  ? `Dismiss ${answeredReviewCount} answered`
                                  : `Dismiss ${activeReviewCount}`}
                            </span>
                          </button>
                        )}
                        {commentsDrifted && <CommentsDriftedIndicator />}
                        {pendingReviewCount > 0 && (
                          <button
                            onClick={async () => {
                              const ok = await copyAllReviewComments();
                              if (ok) {
                                setReviewCopied(true);
                                setTimeout(() => setReviewCopied(false), 2000);
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
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Review mode indicator bar */}
          {isReviewMode && (
            <div className="h-1 bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500 shrink-0" />
          )}

          {/* Viewer */}
          <div className="flex-1 flex min-h-0 relative">
            {isReviewMode && (
              <ReviewStripe scrollRef={contentRef} comments={reviewComments} />
            )}
            <div
              ref={contentRef}
              data-content-scroll
              className={cn(
                "flex-1 overflow-y-auto bg-white dark:bg-slate-900",
                isReviewMode &&
                  "ring-1 ring-inset ring-purple-200 dark:ring-purple-800/50",
              )}
            >
              <div
                className={cn(
                  // The band holds the table of contents and the document side
                  // by side, glued to the left of the pane: file list, then
                  // contents, then text, with whatever window is left over
                  // gathered on the right rather than split around the text.
                  // Nothing is centered horizontally — the document column
                  // carries its own max width, so the prose keeps its measure
                  // while the table of contents may take a comfortable width
                  // without ever squeezing it.
                  //
                  // The gap is 3rem because every prose heading hangs 1.5em
                  // into its left margin to park the `#` anchor there, and at
                  // h1's 2em that is 48px of box reaching towards it.
                  "flex gap-12 py-4 px-4 sm:py-6 sm:px-8",
                )}
              >
                <TableOfContents
                  containerRef={contentRef}
                  open={tocOpen && tocAvailable}
                />
                <div
                  className={cn(
                    "min-w-0 flex-1",
                    fullWidth ? "max-w-none" : "max-w-5xl",
                  )}
                >
                  {error ? (
                    <div className="flex flex-col items-center justify-center h-64 text-red-500">
                      <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-4">
                        <AlertCircle size={32} className="text-red-400" />
                      </div>
                      {/* Stepped per mode, like every other red ink in the app
                          (`DiffViewer`, `ReviewPanel`): `red-600` is 2.8:1 on
                          the dark content surface, and this is the sentence
                          that says what went wrong. */}
                      <p className="text-lg font-medium text-red-600 dark:text-red-400">
                        {error}
                      </p>
                      {currentPath && (
                        <p className="text-sm text-red-400 mt-1 font-mono">
                          {currentPath}
                        </p>
                      )}
                      {connected && (
                        // Both errors that land here — a document that is gone and
                        // a repository the daemon has retired — are re-checked on
                        // the live socket, so this page loads by itself the moment
                        // the thing returns. Saying so stops the reader reaching
                        // for a reload that does nothing extra.
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
                          Waiting — this page loads it automatically if it comes
                          back.
                        </p>
                      )}
                      <div className="mt-4 flex items-center gap-2">
                        <AppLink
                          to="/"
                          className="px-4 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors no-underline inline-block"
                        >
                          Go to Home
                        </AppLink>
                        {connected && (
                          // Only offered while the socket is up — the same
                          // condition as the "it may come back" notice above.
                          // A backend hiccup must not invite deleting a
                          // bookmark whose target is fine.
                          //
                          // The target comes from the route, not the store: a
                          // retired daemon repo clears currentRepo and leaves
                          // the whole route in currentPath, which would never
                          // match the (repo, path) the bookmark was stored
                          // under.
                          <RemoveBookmarkButton
                            path={bookmarkTarget?.path ?? null}
                            repo={bookmarkTarget?.repo ?? null}
                          />
                        )}
                      </div>
                    </div>
                  ) : isLoading && !fileContent && !currentDirectory ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-500 dark:text-slate-400">
                      <Loader2
                        size={32}
                        className="animate-spin text-blue-500 mb-4"
                      />
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Loading...
                      </p>
                    </div>
                  ) : fileContent ? (
                    fileContent.encoding === "binary" ? (
                      <div className="flex flex-col items-center justify-center h-64 text-slate-500 dark:text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800">
                        <File size={48} className="mb-3" />
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
                                copyTextOrWarn(fileContent.content).then(
                                  (ok) => {
                                    if (!ok) return;
                                    setCopied(true);
                                    setTimeout(() => setCopied(false), 2000);
                                  },
                                );
                              }}
                              className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors z-10"
                              title="Copy to clipboard"
                            >
                              {copied ? (
                                <Check size={12} />
                              ) : (
                                <Copy size={12} />
                              )}
                              {copied ? "Copied!" : "Copy"}
                            </button>
                            <pre className="p-4 pr-24 text-sm font-mono whitespace-pre-wrap break-words bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-auto max-h-[80vh] text-slate-700 dark:text-slate-300">
                              {fileContent.content}
                            </pre>
                          </div>
                        ) : (
                          <MarkdownViewer
                            content={fileContent.content}
                            currentPath={fileContent.path}
                            isReviewMode={isReviewMode}
                            onOpenQuestionCount={setOpenQuestionCount}
                          />
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
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
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
                              <span className="ml-auto pl-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                                <RelativeTime date={repo.last_activity} />
                              </span>
                            )}
                          </AppLink>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-500 dark:text-slate-400">
                      <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                        <GitBranch size={32} />
                      </div>
                      <p className="text-lg font-medium text-slate-500 dark:text-slate-400">
                        Select a file or folder to browse
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Vantage supports Markdown and Mermaid diagrams
                      </p>
                    </div>
                  )}
                </div>
              </div>
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
          isOpen={recentsModalOpen}
          onClose={() => setRecentsModalOpen(false)}
        />
        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal
          isOpen={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
        {/* Review Panel — mounted only while open, so its local state (armed
            destructive confirms, half-typed replies, copy flashes) cannot
            survive a close and reappear when the reviewer opens it again. */}
        {reviewPanelOpen && (
          <ReviewPanel
            isOpen={reviewPanelOpen}
            onClose={() => setReviewPanelOpen(false)}
          />
        )}
        {/* Style Guide Modal */}
        <StyleGuideModal
          isOpen={styleGuideOpen}
          onClose={() => setStyleGuideOpen(false)}
        />
      </div>
    </div>
  );
};
