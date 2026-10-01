import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRepoStore } from "../stores/useRepoStore";
import { useGitStore } from "../stores/useGitStore";
import { StarButton } from "../components/StarButton";
import { RemoveBookmarkButton } from "../components/RemoveBookmarkButton";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { DirectoryViewer } from "../components/DirectoryViewer";
import { DiffViewer } from "../components/DiffViewer";
import { AppLink } from "../components/AppLink";
import {
  OpenSidebarButton,
  ViewToggles,
  ViewTogglesPanel,
} from "../components/AppShell";
import { useShellPage, type PageShortcuts } from "../hooks/useShellPage";
import { CollapsedFolders } from "../components/CollapsedFolders";
import { HeaderOverflow } from "../components/HeaderOverflow";
import { useWebSocket } from "../hooks/useWebSocket";
import {
  Clock,
  MessageSquare,
  GitBranch,
  ChevronRight,
  File,
  AlertCircle,
  History,
  FileQuestion,
  Loader2,
  Code,
  Copy,
  Check,
  ArrowDownAZ,
  FolderGit2,
} from "lucide-react";
// History icon retained for the file-history link in the breadcrumb area.
import { RelativeTime } from "../components/RelativeTime";
import { CommentsDriftedIndicator } from "../components/CommentsDriftedIndicator";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";
import { scrollToAnchor } from "../lib/anchorScroll";
import { isStaticMode } from "../lib/staticMode";
import { bookmarkTargetFromRoute } from "../lib/bookmarkTarget";
import { copyTextOrWarn } from "../lib/clipboard";
import {
  isAnsweredByAgent,
  isPendingForAgent,
  useReviewStore,
} from "../stores/useReviewStore";
import { ReviewPanel } from "../components/ReviewPanel";
import { MessageSquarePlus, ClipboardCopy } from "lucide-react";
import { useLineAnchor } from "../hooks/useLineAnchor";
import { useHeaderFit } from "../hooks/useHeaderFit";
import { useFirstPaintHold } from "../hooks/useFirstPaintHold";
import { usePlanningStore } from "../stores/usePlanningStore";
import { LATE_CLASS, splitExtension } from "../lib/headerFit";
import { usePersistentFlag } from "../hooks/usePersistentFlag";
import { useConnectionStore } from "../stores/useConnectionStore";
import { ReviewStripe } from "../components/ReviewStripe";
import { TableOfContents } from "../components/TableOfContents";

/** Format an ISO date string as a short local datetime (e.g. "Mar 2, 2026 3:45 PM"). */
/** `noun`, or its plural for any count but one: `plural(2, "comment")`. */
function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

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

/**
 * How long a document or folder followed to its renamed directory's new name
 * may fail to load before the page says so. Renamed again in the meantime, it
 * is not at that name either, and the push saying where it went next reaches
 * the page within the watcher's and the socket's windows, well under this.
 */
const FOLLOW_GRACE_MS = 1500;

export const ViewerPage: React.FC = () => {
  const {
    // What the store has loaded. What the page draws is what the first
    // paint's hold lets through, below.
    fileContent: loadedContent,
    currentDirectory: loadedDirectory,
    currentPath: loadedPath,
    error: loadedError,
    isLoading: loadedIsLoading,
    viewDirectory,
    loadFile,
    expandToPath,
    loadPathDirectories,
    repos,
    isMultiRepo,
    currentRepo,
    setCurrentRepo,
    reposLoaded,
    repoSortMode,
    setRepoSortMode,
    sortedRepos,
  } = useRepoStore();

  // Whether the live socket is up, which decides if the error view can promise
  // to recover on its own.
  const connected = useConnectionStore((s) => s.connected);

  const {
    statusByPath,
    historyByPath,
    fetchStatus,
    diff,
    showDiff,
    isDiffLoading,
    fetchDiff,
    fetchWorkingDiff,
    closeDiff,
    recentFiles,
    isRecentLoading,
    repoName,
    repoRootPath,
    fetchRepoInfo,
    isRepoInfoLoading,
    fetchHistory,
  } = useGitStore();

  // Whether this repository's planning index may be being built warm, from
  // the scan cache (planning-index.md §2): the one build a document's
  // first paint waits for. A cold one can take seconds, and is never waited
  // on. Until the scanner's `started` has said which it is, it may be warm:
  // git usually answers first, and reading that silence as cold ended the
  // hold a few milliseconds before a warm index landed.
  const planningRepo = isMultiRepo ? currentRepo : "";
  const warmBuild = usePlanningStore((state) => {
    const load = planningRepo === null ? undefined : state.byRepo[planningRepo];
    return load?.status === "loading" && load.warm !== false;
  });
  // The hold (§12.3): a document that has just arrived waits, at most
  // `holdMs`, for what its first paint shows that is already on its way — its
  // header's git facts, asked for with its content, the index of a build that
  // is warm or not yet known to be cold, and on a first load the recent-files
  // list the header takes an untracked file's date from and the Path button's
  // root. The previous document, or the shell, stays up meanwhile.
  const firstPaintWaiting =
    loadedPath !== null &&
    (statusByPath[loadedPath] === undefined ||
      (loadedPath.toLowerCase().endsWith(".md") &&
        historyByPath[loadedPath] === undefined) ||
      warmBuild ||
      (isRecentLoading && recentFiles.length === 0) ||
      isRepoInfoLoading);
  const { fileContent, currentDirectory, currentPath, error, isLoading } =
    useFirstPaintHold(
      {
        fileContent: loadedContent,
        currentDirectory: loadedDirectory,
        currentPath: loadedPath,
        error: loadedError,
        isLoading: loadedIsLoading,
      },
      firstPaintWaiting,
    );

  // The git facts the header shows are the shown path's own, and there are
  // none until git has answered for it: an unknown status is not an untracked
  // file (docs/reference/planning-index.md §12.1, L3), and neither is a
  // request that failed. They are asked for with the content, so the next
  // document's answer can land while this one is still on screen, and leaves
  // this one's header as it was.
  const pathGit = currentPath ? statusByPath[currentPath] : undefined;
  const statusKnown = pathGit !== undefined && !pathGit.failed;
  const latestCommit = pathGit?.lastCommit ?? null;
  const fileGitStatus = pathGit?.gitStatus ?? null;
  const history = useMemo(
    () => (currentPath ? historyByPath[currentPath] : undefined) ?? [],
    [currentPath, historyByPath],
  );
  const navigate = useNavigate();
  const location = useLocation();
  const { "*": pathParam } = useParams();
  const contentRef = useRef<HTMLDivElement>(null);
  useLineAnchor(contentRef, fileContent);
  const prevPathRef = useRef<string | null>(null);
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

  // Fallback modification date from recent files when git has said the file
  // has no commit. Before it has said anything, the date could be about to
  // give way to the commit's, so it waits too.
  const fileMtime = React.useMemo(() => {
    if (!statusKnown || latestCommit || !currentPath) return null;
    const match = recentFiles.find((f) => f.path === currentPath);
    return match?.date ?? null;
  }, [statusKnown, latestCommit, currentPath, recentFiles]);

  // What the header had in hand when the shown path first painted. An item
  // drawn from anything that arrived after that is late data: it is marked
  // `hdr-late`, and takes only the room the header has left, so it never
  // moves what the reader is already looking at (planning-index.md
  // §12.2; "Late items" in lib/headerFit.ts). Kept per path, adjusted during
  // render as the viewer's own visit is, so the render that meets a new path
  // already answers for it.
  const inHand = {
    path: currentPath,
    status: statusKnown,
    history: currentPath !== null && historyByPath[currentPath] !== undefined,
    root: repoRootPath !== null,
    mtime: fileMtime !== null,
  };
  const [paintedWith, setPaintedWith] = useState(inHand);
  if (paintedWith.path !== currentPath) setPaintedWith(inHand);
  const firstPaint = paintedWith.path === currentPath ? paintedWith : inHand;
  /** The late item's class, for an item drawn from what the first paint lacked. */
  const lateUnless = (had: boolean) => (had ? undefined : LATE_CLASS);

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

  // A document or folder whose directory was renamed under it, which
  // useWebSocket reports when the push shows where it went: the reader is
  // taken to its new address and stays where they were in it, as through a
  // live edit. The move is kept for the route and scroll effects below: `from`
  // is the path on screen, `to` where it is being loaded from.
  //
  // A folder renamed again before `to` was asked for is not there either, so
  // `to` is loaded keeping what is on screen when it fails, and the next push
  // follows it on from `to` — which is why `from` stays the path on screen
  // across a chain of them. Should no push come, `to` is loaded again after
  // FOLLOW_GRACE_MS without that, and shows whether it is gone.
  const followedRef = useRef<{ from: string; to: string } | null>(null);
  // The address the page was last taken to by a follow, which is no
  // navigation of the reader's: the mobile sidebar stays open through it.
  const [followedParam, setFollowedParam] = useState<string | null>(null);
  const followGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (followGraceRef.current) clearTimeout(followGraceRef.current);
    },
    [],
  );
  const followMoved = useCallback(
    (from: string, to: string) => {
      const previous = followedRef.current;
      followedRef.current = {
        from: previous && previous.to === from ? previous.from : from,
        to,
      };
      useReviewStore.getState().followDocument(from, to);
      const address = buildPath(to);
      setFollowedParam(address.slice(1));
      // Replaced, not pushed: the old address names nothing now. Its hash is
      // left behind, since a line anchor applied again at the new address
      // would scroll the reader away from where they are.
      navigate(address, { replace: true });

      if (followGraceRef.current) clearTimeout(followGraceRef.current);
      followGraceRef.current = setTimeout(() => {
        followGraceRef.current = null;
        const { currentPath, requestedPath } = useRepoStore.getState();
        if (requestedPath !== to || currentPath === to) return;
        if (to.toLowerCase().endsWith(".md")) void loadFile(to);
        else void viewDirectory(to);
      }, FOLLOW_GRACE_MS);
    },
    [navigate, buildPath, loadFile, viewDirectory],
  );
  useWebSocket({ onMoved: followMoved });

  // The route as the reader moves through it, which the shell closes the
  // phone's slide-out on. It adjusts state during render (React's documented
  // pattern) rather than from an effect. A follow of a renamed folder is not
  // the reader going anywhere, so it leaves the key as it was.
  const [readerMoves, setReaderMoves] = useState(0);
  const [prevPathParam, setPrevPathParam] = useState(pathParam);
  if (prevPathParam !== pathParam) {
    setPrevPathParam(pathParam);
    if (pathParam === followedParam) setFollowedParam(null);
    else setReaderMoves((n) => n + 1);
  }

  // What a bookmark for this route would be keyed by. Derived from the URL so
  // it still answers when the repo store cannot — see bookmarkTargetFromRoute.
  const bookmarkTarget = useMemo(
    () => bookmarkTargetFromRoute(pathParam, isMultiRepo),
    [pathParam, isMultiRepo],
  );

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

    // The header's git facts are asked for with the content, not once it
    // has rendered, so they are in hand when it paints, or all but
    // (docs/reference/planning-index.md §12.2).
    const load = (p: string) => {
      // Followed there, it keeps what is on screen should it have moved on
      // again already (followMoved).
      const followed = followedRef.current?.to === p;
      if (p.toLowerCase().endsWith(".md")) {
        if (followed) loadFile(p, { keepOnFailure: true });
        else loadFile(p);
        fetchHistory(p);
      } else if (followed) {
        viewDirectory(p, { keepOnFailure: true });
        // A folder view keeps no place in it for the scroll effect to carry
        // over, which is what clears a document's follow.
        followedRef.current = null;
      } else {
        viewDirectory(p);
      }
      fetchStatus(p);
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
          requestedPath: fullPath,
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

      load(filePath);
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

      load(path);
    }
  }, [
    pathParam,
    loadFile,
    viewDirectory,
    fetchStatus,
    fetchHistory,
    expandToPath,
    loadPathDirectories,
    isMultiRepo,
    currentRepo,
    repos,
    setCurrentRepo,
    reposLoaded,
  ]);

  // Scroll to top when navigating to a new file, or to anchor if hash is present.
  // When the *same* file updates (live reload), preserve scroll position.
  useEffect(() => {
    if (!fileContent || !contentRef.current) return;

    // A document followed to where its renamed directory put it is the same
    // document under a new path, so it keeps the reader's place too.
    const followed = followedRef.current;
    if (followed && fileContent.path !== followed.from) {
      followedRef.current = null;
    }
    const isFollow =
      followed !== null &&
      prevPathRef.current === followed.from &&
      fileContent.path === followed.to;
    const isSameFile = prevPathRef.current === fileContent.path;
    prevPathRef.current = fileContent.path;

    // Where the reader was is where the page still is: the document stayed in
    // its container, and whatever else moved under it the browser's scroll
    // anchoring has already answered for. The restore below would undo that.
    if (isFollow) return;

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

  // Fetch repo info when repo is set (or on mount for single-repo). The shell
  // asks for the recent files at the same moment.
  useEffect(() => {
    if (!reposLoaded) return;
    if (isMultiRepo && !currentRepo) return;
    fetchRepoInfo();
  }, [fetchRepoInfo, reposLoaded, isMultiRepo, currentRepo]);

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

  const handleToggleToc = useCallback(() => {
    setTocOpen((prev) => !prev);
  }, [setTocOpen]);
  const handleToggleFullWidth = useCallback(() => {
    setFullWidth((prev) => !prev);
  }, [setFullWidth]);
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

  // The shortcuts that act on the document; the shell owns the rest.
  const pageShortcuts = useMemo<PageShortcuts>(
    () => ({
      onViewDiff: handleViewDiff,
      onViewHistory: handleViewHistory,
      onCopyPath: handleCopyPath,
      onEscape: handleEscape,
    }),
    [handleViewDiff, handleViewHistory, handleCopyPath, handleEscape],
  );

  const breadcrumbs =
    currentPath && currentPath !== "." ? currentPath.split("/") : [];
  const breadcrumbDirs = breadcrumbs.slice(0, -1);
  const breadcrumbLeaf = breadcrumbs.at(-1);
  // Only a file has an extension to keep; a folder's dot is part of its name.
  const [leafStem, leafExt] =
    breadcrumbLeaf && currentDirectory === null
      ? splitExtension(breadcrumbLeaf)
      : [breadcrumbLeaf ?? "", ""];
  const crumbRoot = useMemo(
    () =>
      isMultiRepo && currentRepo
        ? { label: currentRepo, href: `/${currentRepo}` }
        : { label: "root", href: "/" },
    [isMultiRepo, currentRepo],
  );
  const breadcrumbDirHref = useCallback(
    (depth: number) =>
      buildPath(
        (currentPath ?? "")
          .split("/")
          .slice(0, depth + 1)
          .join("/") || ".",
      ),
    [buildPath, currentPath],
  );
  const headerRef = useHeaderFit();

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
  // The toggle for it, though, is in the header from the moment the route
  // names a document, before its content arrives: added when the content
  // landed, it pushed the full-width toggle and the breadcrumb along on every
  // document's first paint (planning-index.md §12.1, L1). Only a
  // document that turns out to be binary takes it away again.
  const routeFile =
    (isMultiRepo ? pathParam?.split("/").slice(1).join("/") : pathParam) ?? "";
  const tocOffered =
    tocAvailable ||
    (!showRaw &&
      routeFile.toLowerCase().endsWith(".md") &&
      !(fileContent?.encoding === "binary" && currentPath === routeFile));

  // The header's two view toggles, as the page offers them: in the header's
  // leading half, and in the toolbar's "⋯" panel once the `actions` step
  // folds them in (lib/headerFit.ts).
  const contentsToggle = tocOffered
    ? { on: tocOpen, onToggle: handleToggleToc }
    : null;
  const fullWidthToggle = { on: fullWidth, onToggle: handleToggleFullWidth };
  const headerViewExtras = (
    <ViewTogglesPanel contents={contentsToggle} fullWidth={fullWidthToggle} />
  );

  // The page's own dialogs: the diff, and the review panel.
  const overlays = (
    <>
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
      {/* Review Panel — mounted only while open, so its local state (armed
          destructive confirms, half-typed replies, copy flashes) cannot
          survive a close and reappear when the reviewer opens it again. */}
      {reviewPanelOpen && (
        <ReviewPanel
          isOpen={reviewPanelOpen}
          onClose={() => setReviewPanelOpen(false)}
        />
      )}
    </>
  );

  // Drawn in the app shell, which shows its loading state until the
  // repositories are known, so this page never renders before they are.
  const shell = useShellPage({
    contentRef,
    showSidebar,
    routeKey: `viewer\n${readerMoves}`,
    currentPath,
    shortcuts: pageShortcuts,
  });

  return (
    <>
      {overlays}
      {/* Header / Breadcrumbs - hidden on repo picker page */}
      {showSidebar ? (
        // The header gives up room in a fixed order as it narrows, the file
        // name last: `headerRef` decides how many of those steps to take
        // (lib/headerFit.ts) and the `hdr-*` classes are what each step
        // acts on (index.css, "The viewer header's yield steps").
        <div
          ref={headerRef}
          data-testid="viewer-header"
          className="viewer-header h-14 border-b border-slate-200 dark:border-slate-700 flex items-center px-3 md:px-6 justify-between shrink-0 bg-white dark:bg-slate-800 gap-2"
        >
          <div className="hdr-lead flex items-center gap-2">
            <OpenSidebarButton shell={shell} />
            {/* The full-width toggle is the header's whenever the
                    header is, which is where the sidebar is. */}
            <ViewToggles
              contents={contentsToggle}
              fullWidth={fullWidthToggle}
            />
            <nav className="hdr-crumbs flex items-center text-sm gap-1 min-w-0 overflow-hidden">
              <AppLink
                to={crumbRoot.href}
                className="hdr-repo text-slate-500 dark:text-slate-400 hover:text-blue-600 font-medium transition-colors shrink-0 no-underline"
              >
                {crumbRoot.label}
              </AppLink>
              {breadcrumbDirs.length > 0 && (
                <span className="hdr-dirs items-center gap-1 shrink-0">
                  {breadcrumbDirs.map((part, i) => (
                    <React.Fragment key={i}>
                      <ChevronRight
                        size={14}
                        className="text-slate-500 dark:text-slate-400 shrink-0"
                      />
                      <AppLink
                        to={breadcrumbDirHref(i)}
                        className="text-slate-500 dark:text-slate-400 hover:text-blue-600 transition-colors no-underline"
                      >
                        {part}
                      </AppLink>
                    </React.Fragment>
                  ))}
                </span>
              )}
              {/* The folders' "…", and at the `repo` step the
                      repository's too — which is why it is here even at the
                      root, where there are no folders for it to stand for
                      until then. */}
              <span
                className={cn(
                  "hdr-dirs-collapsed items-center gap-1 shrink-0",
                  breadcrumbDirs.length === 0 && "hdr-no-dirs",
                )}
              >
                <ChevronRight
                  size={14}
                  className="hdr-sep text-slate-500 dark:text-slate-400 shrink-0"
                />
                <CollapsedFolders
                  root={crumbRoot}
                  dirs={breadcrumbDirs}
                  hrefFor={breadcrumbDirHref}
                />
              </span>
              {breadcrumbLeaf && (
                <>
                  <ChevronRight
                    size={14}
                    className="text-slate-500 dark:text-slate-400 shrink-0"
                  />
                  {/* The last thing in the header to give up room, and
                          then it keeps its extension: only the stem truncates.
                          The ellipsis is the only place any of the path is
                          elided without a menu behind it, so the tooltip
                          carries all of it. */}
                  <span
                    data-testid="breadcrumb-name"
                    className={cn(
                      "hdr-name flex min-w-0 font-semibold text-slate-900 dark:text-slate-100",
                      leafStem.length >= 3 && "hdr-stem-floor",
                    )}
                    title={currentPath ?? undefined}
                  >
                    {leafExt ? (
                      <>
                        {/* Two flex items are two words to assistive
                                technology ("notes .md"), so it is given the
                                name whole and the halves are only drawn. */}
                        <span className="sr-only">{breadcrumbLeaf}</span>
                        <span aria-hidden="true" className="truncate">
                          {leafStem}
                        </span>
                        <span aria-hidden="true" className="shrink-0">
                          {leafExt}
                        </span>
                      </>
                    ) : (
                      <span className="truncate">{leafStem}</span>
                    )}
                  </span>
                </>
              )}
            </nav>
            <StarButton
              path={currentPath}
              repo={currentRepo}
              isDir={currentDirectory !== null}
            />
          </div>

          {latestCommit ? (
            <div className="hdr-tools flex items-center gap-2">
              {fileGitStatus && (
                <button
                  onClick={handleCommitClick}
                  className={cn(
                    "flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1.5 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors cursor-pointer",
                    lateUnless(firstPaint.status),
                  )}
                  title="View uncommitted changes"
                >
                  <GitBranch size={12} />
                  <span className="hdr-label font-medium">
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
                className={cn(
                  "hdr-commit hidden sm:flex items-center gap-3 min-w-0 text-xs group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 -mx-2 transition-colors",
                  lateUnless(firstPaint.status),
                )}
                // The subject is the first thing the header gives up, so
                // the tooltip is where it can still be read in full.
                title={`${latestCommit.message}\n${formatDateTime(latestCommit.date)} — click to view diff`}
              >
                <div className="flex items-center gap-1.5 shrink-0 text-slate-500 dark:text-slate-400">
                  <Clock size={14} />
                  <span data-testid="header-time" className="hdr-time">
                    <RelativeTime date={latestCommit.date} />
                  </span>
                  <span
                    data-testid="header-date"
                    className="hdr-date items-center gap-1.5"
                  >
                    <span aria-hidden="true">·</span>
                    <span>{formatDateTime(latestCommit.date)}</span>
                  </span>
                </div>
                <div className="hdr-subject flex items-center gap-1.5 min-w-0 bg-slate-100 dark:bg-slate-700 group-hover:bg-slate-200 dark:group-hover:bg-slate-600 px-2.5 py-1.5 rounded-md transition-colors">
                  <MessageSquare
                    size={12}
                    className="shrink-0 text-slate-500 dark:text-slate-400"
                  />
                  <span
                    data-testid="commit-subject"
                    className="hdr-subject-text font-medium text-slate-700 dark:text-slate-200 truncate max-w-[200px]"
                  >
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
                className={cn(
                  "sm:hidden flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors",
                  lateUnless(firstPaint.status),
                )}
                title="View diff"
              >
                <Clock size={14} />
                <span className="hdr-time">
                  <RelativeTime date={latestCommit.date} addSuffix={false} />
                </span>
              </button>
              <HeaderOverflow extra={headerViewExtras}>
                {currentPath &&
                  currentPath.toLowerCase().endsWith(".md") &&
                  history.length >= 1 && (
                    <AppLink
                      to={
                        isMultiRepo && currentRepo
                          ? `/history/${currentRepo}/${currentPath}`
                          : `/history/${currentPath}`
                      }
                      className={cn(
                        "flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors no-underline",
                        lateUnless(firstPaint.history),
                      )}
                      title={`View full history: ${history.length} ${plural(history.length, "commit")}`}
                    >
                      <History size={14} />
                      <span className="hdr-label">
                        {history.length} commits
                      </span>
                    </AppLink>
                  )}
                {currentPath && repoRootPath && (
                  <button
                    onClick={handleCopyPath}
                    className={cn(
                      "flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                      lateUnless(firstPaint.root),
                    )}
                    title={`Copy absolute path: ${repoRootPath}/${currentPath}`}
                  >
                    {pathCopied ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                    <span
                      className="hdr-label hdr-reserve"
                      data-reserve="Copied!"
                    >
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
                      "flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                      showRaw
                        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                        : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                    )}
                    title={showRaw ? "View rendered" : "View raw markdown"}
                  >
                    <Code size={14} />
                    <span
                      className="hdr-label hdr-reserve"
                      data-reserve="Rendered"
                    >
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
                          "flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                          reviewExitConfirm
                            ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 ring-1 ring-red-300 dark:ring-red-700"
                            : isReviewMode
                              ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-300 dark:ring-purple-700"
                              : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                        )}
                        title={reviewToggleTitle}
                      >
                        <MessageSquarePlus size={14} />
                        <span
                          className="hdr-label hdr-reserve"
                          data-reserve="End review?"
                        >
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
                            className={`hdr-dismiss flex items-center gap-1.5 text-xs rounded-lg sm:min-w-[100px] px-2 py-1.5 transition-colors cursor-pointer ${
                              reviewDismissConfirm
                                ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50"
                                : "text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-600/50"
                            }`}
                            title={
                              reviewDismissConfirm
                                ? "Click again to dismiss all"
                                : answeredReviewCount > 0
                                  ? `Dismiss the ${answeredReviewCount} ${plural(answeredReviewCount, "comment")} the agent has answered`
                                  : activeReviewCount === 1
                                    ? "Dismiss 1 comment"
                                    : `Dismiss all ${activeReviewCount} comments`
                            }
                          >
                            <Check size={14} />
                            <span className="hdr-label">
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
                            className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 rounded-lg px-2 py-1.5 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
                            title={`Copy ${pendingReviewCount} ${plural(pendingReviewCount, "comment")} to clipboard`}
                          >
                            {reviewCopied ? (
                              <Check size={14} />
                            ) : (
                              <ClipboardCopy size={14} />
                            )}
                            <span
                              className="hdr-label hdr-reserve"
                              data-reserve="Copied!"
                            >
                              {reviewCopied
                                ? "Copied!"
                                : `Copy ${pendingReviewCount}`}
                            </span>
                          </button>
                        )}
                        <button
                          onClick={() => setReviewPanelOpen(true)}
                          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
                          title="Manage comments"
                        >
                          <MessageSquare size={14} />
                          <span className="hdr-panel-only">
                            Manage comments
                          </span>
                        </button>
                      </>
                    )}
                  </>
                )}
              </HeaderOverflow>
            </div>
          ) : currentPath && currentPath.toLowerCase().endsWith(".md") ? (
            <div className="hdr-tools flex items-center gap-2">
              {/* Only once git has said so: before it answers, a file
                      with a commit would read as untracked for as long as
                      the answer took (§12.1, L3). */}
              {statusKnown && !isStaticMode() && (
                <button
                  onClick={() => currentPath && fetchWorkingDiff(currentPath)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer",
                    lateUnless(firstPaint.status),
                  )}
                  title="View file content as diff"
                >
                  <FileQuestion size={14} />
                  <span className="hdr-label font-medium">Untracked file</span>
                </button>
              )}
              {fileMtime && (
                <div
                  className={cn(
                    "hidden sm:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 px-2 py-1.5",
                    lateUnless(firstPaint.mtime),
                  )}
                  title={formatDateTime(fileMtime)}
                >
                  <Clock size={14} />
                  <span data-testid="header-time" className="hdr-time">
                    <RelativeTime date={fileMtime} />
                  </span>
                  <span
                    data-testid="header-date"
                    className="hdr-date items-center gap-1.5"
                  >
                    <span aria-hidden="true">·</span>
                    <span>{formatDateTime(fileMtime)}</span>
                  </span>
                </div>
              )}
              <HeaderOverflow extra={headerViewExtras}>
                {currentPath && repoRootPath && (
                  <button
                    onClick={handleCopyPath}
                    className={cn(
                      "flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                      lateUnless(firstPaint.root),
                    )}
                    title={`Copy absolute path: ${repoRootPath}/${currentPath}`}
                  >
                    {pathCopied ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                    <span
                      className="hdr-label hdr-reserve"
                      data-reserve="Copied!"
                    >
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
                    "flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                    showRaw
                      ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                  )}
                  title={showRaw ? "View rendered" : "View raw markdown"}
                >
                  <Code size={14} />
                  <span
                    className="hdr-label hdr-reserve"
                    data-reserve="Rendered"
                  >
                    {showRaw ? "Rendered" : "Raw"}
                  </span>
                </button>
                {/* Same as the wide toolbar: review controls survive raw view. */}
                <>
                  {reviewToggleVisible && (
                    <button
                      onClick={handleReviewToggle}
                      className={cn(
                        "flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 transition-colors cursor-pointer",
                        reviewExitConfirm
                          ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 ring-1 ring-red-300 dark:ring-red-700"
                          : isReviewMode
                            ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-300 dark:ring-purple-700"
                            : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50",
                      )}
                      title={reviewToggleTitle}
                    >
                      <MessageSquarePlus size={14} />
                      <span
                        className="hdr-label hdr-reserve"
                        data-reserve="End review?"
                      >
                        {reviewExitConfirm ? "End review?" : "Review"}
                      </span>
                    </button>
                  )}
                  {isReviewMode && (
                    <>
                      {activeReviewCount > 0 && (
                        <button
                          onClick={handleReviewDismiss}
                          className={`hdr-dismiss flex items-center gap-1.5 text-xs rounded-lg sm:min-w-[100px] px-2 py-1.5 transition-colors cursor-pointer ${
                            reviewDismissConfirm
                              ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50"
                              : "text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-600/50"
                          }`}
                          title={
                            reviewDismissConfirm
                              ? "Click again to dismiss all"
                              : answeredReviewCount > 0
                                ? `Dismiss the ${answeredReviewCount} ${plural(answeredReviewCount, "comment")} the agent has answered`
                                : activeReviewCount === 1
                                  ? "Dismiss 1 comment"
                                  : `Dismiss all ${activeReviewCount} comments`
                          }
                        >
                          <Check size={14} />
                          <span className="hdr-label">
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
                          className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 rounded-lg px-2 py-1.5 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
                          title={`Copy ${pendingReviewCount} ${plural(pendingReviewCount, "comment")} to clipboard`}
                        >
                          {reviewCopied ? (
                            <Check size={14} />
                          ) : (
                            <ClipboardCopy size={14} />
                          )}
                          <span
                            className="hdr-label hdr-reserve"
                            data-reserve="Copied!"
                          >
                            {reviewCopied
                              ? "Copied!"
                              : `Copy ${pendingReviewCount}`}
                          </span>
                        </button>
                      )}
                      <button
                        onClick={() => setReviewPanelOpen(true)}
                        className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer"
                        title="Manage comments"
                      >
                        <MessageSquare size={14} />
                        <span className="hdr-panel-only">Manage comments</span>
                      </button>
                    </>
                  )}
                </>
              </HeaderOverflow>
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
        {/* Focusable, not in the tab order: the shell gives it the focus
                as the page opens (useShellPage), so the browser's scrolling
                keys scroll it. */}
        <div
          ref={contentRef}
          data-content-scroll
          tabIndex={-1}
          className={cn(
            "flex-1 overflow-y-auto bg-white dark:bg-slate-900 outline-none",
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
                            copyTextOrWarn(fileContent.content).then((ok) => {
                              if (!ok) return;
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            });
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
          {/* Room below the content for the degradation banner, which
                  floats over the pane's bottom: it only lengthens what can be
                  scrolled, so it moves nothing already painted, and it lets
                  the last line scroll clear of the banner. */}
          {shell.bannerSpace > 0 && (
            <div aria-hidden="true" style={{ height: shell.bannerSpace }} />
          )}
        </div>
      </div>
    </>
  );
};
