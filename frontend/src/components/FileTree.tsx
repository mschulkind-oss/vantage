import React, { memo, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Link,
  AlertTriangle,
} from "lucide-react";
import { FileNode } from "../types";
import { useRepoStore } from "../stores/useRepoStore";
import { cn } from "../lib/utils";
import { useNavigate } from "react-router-dom";
import { shouldHandleInternalNavigation } from "../lib/navigation";

interface FileTreeProps {
  nodes: FileNode[];
}

interface FileTreeNodeProps {
  node: FileNode;
}

const FileTreeNodeInner: React.FC<FileTreeNodeProps> = ({ node }) => {
  // Use shallow selectors to only subscribe to the specific pieces of state we need
  const currentPath = useRepoStore((state) => state.currentPath);
  const isExpanded = useRepoStore(
    (state) => state.expandedDirs[node.path] ?? false,
  );
  const toggleDir = useRepoStore((state) => state.toggleDir);
  const loadDirChildren = useRepoStore((state) => state.loadDirChildren);
  const isMultiRepo = useRepoStore((state) => state.isMultiRepo);
  const currentRepo = useRepoStore((state) => state.currentRepo);
  const showEmptyDirs = useRepoStore((state) => state.showEmptyDirs);
  const isRecentlyChanged = useRepoStore((state) =>
    state.recentlyChangedPaths.has(node.path),
  );
  const navigate = useNavigate();

  // Build path with repo prefix in multi-repo mode
  const buildPath = useCallback(
    (filePath: string): string => {
      if (isMultiRepo && currentRepo) {
        return `/${currentRepo}/${filePath}`;
      }
      return `/${filePath}`;
    },
    [isMultiRepo, currentRepo],
  );

  // Arrow click: only expand/collapse, don't navigate
  const handleToggleExpand = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (node.is_dir) {
        // If stuck in loading state (expanded, no children), retry load
        if (isExpanded && !node.children) {
          await loadDirChildren(node.path);
          return;
        }
        toggleDir(node.path);
        if (!node.children && !isExpanded) {
          await loadDirChildren(node.path);
        }
      }
    },
    [
      node.is_dir,
      node.path,
      node.children,
      isExpanded,
      toggleDir,
      loadDirChildren,
    ],
  );

  // Name/row click: for dirs → navigate to dir + expand; for files → navigate to file
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (node.is_dir) {
        e.preventDefault();
        e.stopPropagation();
        // Navigate to the directory (shows README in DirectoryViewer)
        navigate(buildPath(node.path));
        // Also expand it if not already expanded
        if (!isExpanded) {
          toggleDir(node.path);
          if (!node.children) {
            loadDirChildren(node.path);
          }
        } else if (!node.children) {
          // Expanded but no children (stuck spinner) — retry load
          loadDirChildren(node.path);
        }
        return;
      }

      // For files: Allow browser default for Ctrl+click, Cmd+click, middle-click, etc.
      if (!shouldHandleInternalNavigation(e)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      navigate(buildPath(node.path));
    },
    [
      navigate,
      node.path,
      node.is_dir,
      buildPath,
      isExpanded,
      toggleDir,
      node.children,
      loadDirChildren,
    ],
  );

  const nameRef = useRef<HTMLSpanElement>(null);
  const [hoverOverlay, setHoverOverlay] = useState<{
    left: number;
    top: number;
    height: number;
  } | null>(null);

  const handleNameHover = useCallback(() => {
    const span = nameRef.current;
    if (!span) return;
    if (span.scrollWidth <= span.clientWidth + 1) return;
    const rect = span.getBoundingClientRect();
    setHoverOverlay({
      left: rect.left,
      top: rect.top,
      height: rect.height,
    });
  }, []);
  const clearHoverOverlay = useCallback(() => setHoverOverlay(null), []);

  const isActive = currentPath === node.path;
  const nodeHref = buildPath(node.path);
  const isDimmed = node.is_dir && node.has_markdown === false;
  const gitStatus = node.git_status;
  const hasGitChange =
    gitStatus === "modified" ||
    gitStatus === "added" ||
    gitStatus === "untracked";
  const dirHasChanges = gitStatus === "contains_changes";
  const isSymlink = node.is_symlink === true;
  const isSymlinkError = isSymlink && node.symlink_target == null;

  // Hide non-markdown directories when the toggle is off
  if (isDimmed && !showEmptyDirs) return null;

  // Determine file icon color based on git status
  const fileIconColor = isSymlinkError
    ? "text-red-400"
    : isSymlink
      ? "text-slate-400"
      : hasGitChange
        ? gitStatus === "untracked"
          ? "text-green-500"
          : "text-amber-500"
        : "text-slate-400";
  const folderIconColor = isSymlinkError
    ? "text-red-400"
    : isSymlink
      ? "text-slate-400"
      : isDimmed
        ? "text-slate-300"
        : dirHasChanges
          ? "text-amber-400"
          : isExpanded
            ? "text-blue-500"
            : "text-blue-400";
  const nameColor = isSymlinkError
    ? "text-red-400 dark:text-red-500 line-through"
    : isSymlink
      ? "text-slate-400 dark:text-slate-500 italic"
      : isDimmed
        ? "text-slate-400 dark:text-slate-600"
        : hasGitChange
          ? gitStatus === "untracked"
            ? "text-green-700 dark:text-green-400"
            : "text-amber-700 dark:text-amber-400"
          : dirHasChanges
            ? "text-amber-700 dark:text-amber-400"
            : "text-slate-700 dark:text-slate-300";

  return (
    <div>
      <a
        href={isSymlinkError ? undefined : nodeHref}
        className={cn(
          "relative flex items-center py-1.5 px-2 cursor-pointer rounded-md text-sm transition-all duration-150",
          "hover:bg-slate-100 dark:hover:bg-slate-700 no-underline",
          isActive &&
            !isSymlinkError &&
            "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium",
          isDimmed && "opacity-40",
          isRecentlyChanged && "animate-flash-update",
          isSymlinkError && "cursor-not-allowed opacity-60",
        )}
        onMouseEnter={handleNameHover}
        onMouseLeave={clearHoverOverlay}
        onClick={
          isSymlinkError
            ? (e: React.MouseEvent) => e.preventDefault()
            : handleClick
        }
        title={
          isSymlinkError
            ? "Symlink target is outside this project or broken"
            : isSymlink
              ? `Symlink → ${node.symlink_target}`
              : undefined
        }
      >
        {/* Arrow toggle — large click target with visible hover feedback */}
        <span
          className={cn(
            "mr-1 p-1 -ml-1 rounded transition-colors",
            node.is_dir &&
              !isSymlinkError &&
              "cursor-pointer hover:bg-slate-200 active:bg-slate-300",
          )}
          onClick={
            node.is_dir && !isSymlinkError ? handleToggleExpand : undefined
          }
        >
          {node.is_dir ? (
            isExpanded ? (
              <ChevronDown size={14} className="text-slate-500" />
            ) : (
              <ChevronRight size={14} className="text-slate-400" />
            )
          ) : (
            <span className="w-3.5 block" />
          )}
        </span>
        <span className="mr-2 relative">
          {node.is_dir ? (
            <Folder
              size={15}
              className={cn("transition-colors", folderIconColor)}
            />
          ) : (
            <File size={15} className={fileIconColor} />
          )}
          {isSymlink && (
            <span className="absolute -bottom-0.5 -right-1">
              {isSymlinkError ? (
                <AlertTriangle size={8} className="text-red-500" />
              ) : (
                <Link size={7} className="text-slate-400" />
              )}
            </span>
          )}
        </span>
        <span
          ref={nameRef}
          className={cn(
            "truncate",
            isActive && !isSymlinkError ? undefined : nameColor,
          )}
        >
          {node.name}
        </span>
        {hasGitChange && !isSymlink && (
          <span
            className={cn(
              "ml-auto shrink-0 w-1.5 h-1.5 rounded-full",
              gitStatus === "untracked" ? "bg-green-500" : "bg-amber-500",
            )}
          />
        )}
      </a>
      {hoverOverlay &&
        createPortal(
          <span
            aria-hidden="true"
            style={{
              position: "fixed",
              left: hoverOverlay.left,
              top: hoverOverlay.top,
              height: hoverOverlay.height,
              lineHeight: `${hoverOverlay.height}px`,
              paddingRight: "0.5rem",
              whiteSpace: "nowrap",
              width: "max-content",
              maxWidth: `calc(100vw - ${hoverOverlay.left}px)`,
              zIndex: 60,
              pointerEvents: "none",
            }}
            className={cn(
              "text-sm",
              isActive && !isSymlinkError
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium"
                : cn("bg-slate-100 dark:bg-slate-700", nameColor),
            )}
          >
            {node.name}
          </span>,
          document.body,
        )}
      {node.is_dir &&
        isExpanded &&
        (node.children ? (
          <div className="ml-3 pl-2 border-l border-slate-200 dark:border-slate-700">
            <FileTree nodes={node.children} />
          </div>
        ) : (
          <div className="ml-3 pl-2 border-l border-slate-200 dark:border-slate-700 py-1.5 px-2">
            <div className="flex items-center space-x-2 animate-pulse">
              <div className="w-3 h-3 bg-slate-200 rounded" />
              <div className="h-3 bg-slate-200 rounded w-24" />
            </div>
          </div>
        ))}
    </div>
  );
};

// Memoize to prevent re-renders when parent re-renders
const FileTreeNode = memo(FileTreeNodeInner, (prevProps, nextProps) => {
  // Re-render only if the node reference or its key properties change
  return (
    prevProps.node === nextProps.node ||
    (prevProps.node.path === nextProps.node.path &&
      prevProps.node.name === nextProps.node.name &&
      prevProps.node.is_dir === nextProps.node.is_dir &&
      prevProps.node.has_markdown === nextProps.node.has_markdown &&
      prevProps.node.git_status === nextProps.node.git_status &&
      prevProps.node.is_symlink === nextProps.node.is_symlink &&
      prevProps.node.symlink_target === nextProps.node.symlink_target &&
      prevProps.node.children === nextProps.node.children)
  );
});

const FileTreeInner: React.FC<FileTreeProps> = ({ nodes }) => {
  return (
    <div className="flex flex-col space-y-0.5">
      {nodes.map((node) => (
        <FileTreeNode key={node.path} node={node} />
      ))}
    </div>
  );
};

// Export memoized FileTree
export const FileTree = memo(FileTreeInner);
