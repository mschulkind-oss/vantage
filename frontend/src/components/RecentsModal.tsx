import React, { useEffect } from "react";
import { useGitStore } from "../stores/useGitStore";
import { useRepoStore } from "../stores/useRepoStore";
import { AppLink } from "./AppLink";
import {
  Clock,
  User,
  GitCommitHorizontal,
  FileQuestion,
  X,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { RelativeTime } from "./RelativeTime";
import { MiddleEllipsis } from "./MiddleEllipsis";
import { cn } from "../lib/utils";

interface RecentsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RecentsModal: React.FC<RecentsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { recentFiles, isRecentLoading, recentFilesError, fetchRecentFiles } =
    useGitStore();
  const { isMultiRepo, currentRepo } = useRepoStore();

  const buildPath = (filePath: string): string => {
    if (isMultiRepo && currentRepo) {
      return `/${currentRepo}/${filePath}`;
    }
    return `/${filePath}`;
  };

  // Fetch fresh data every time the modal opens
  useEffect(() => {
    if (isOpen) {
      fetchRecentFiles(true);
    }
  }, [isOpen, fetchRecentFiles]);

  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — no backdrop-blur to avoid GPU recomposite on every scroll frame */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[80vh] mx-4 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Clock size={14} className="text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-base text-slate-900 dark:text-slate-100">
                Recently Changed
              </h2>
              {isMultiRepo && currentRepo && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {currentRepo}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto relative will-change-scroll">
          {/* Subtle loading bar for refreshes when data already exists */}
          {isRecentLoading && recentFiles.length > 0 && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-100 dark:bg-slate-700 overflow-hidden z-10">
              <div className="h-full bg-blue-500 animate-pulse w-full" />
            </div>
          )}

          {/* Error banner with retry */}
          {recentFilesError && !isRecentLoading && (
            <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle size={16} className="shrink-0" />
              <span className="flex-1">Failed to load recent files.</span>
              <button
                onClick={() => fetchRecentFiles()}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          )}

          {isRecentLoading && recentFiles.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin text-blue-600" />
            </div>
          ) : recentFiles.length === 0 && !recentFilesError ? (
            <div className="text-center py-20 text-slate-400">
              <p className="text-lg font-medium text-slate-500 dark:text-slate-400">
                No recent files found
              </p>
              <p className="text-sm mt-1">
                Start editing Markdown files to see them here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {recentFiles.map((file, index) => {
                const parts = file.path.split("/");
                const fileName = parts.pop() || "";
                const parentDir = parts.length > 0 ? parts.join("/") : "";
                const isEven = index % 2 === 0;

                return (
                  <AppLink
                    key={file.path}
                    to={buildPath(file.path)}
                    onBeforeNavigate={() => {
                      onClose();
                    }}
                    className={cn(
                      "block px-5 py-3 transition-colors no-underline",
                      isEven
                        ? "bg-slate-50 dark:bg-slate-700/20"
                        : "bg-white dark:bg-slate-800",
                      "hover:bg-blue-50 dark:hover:bg-blue-900/20",
                    )}
                  >
                    {/* Row 1: Filename + time */}
                    <div className="flex items-center justify-between gap-3 mb-0.5">
                      <div className="flex-1 min-w-0">
                        <MiddleEllipsis
                          text={fileName}
                          className="font-medium text-sm text-slate-900 dark:text-slate-100"
                        />
                      </div>
                      <span
                        className="text-[11px] text-slate-400 shrink-0 tabular-nums"
                        title={format(new Date(file.date), "PPpp")}
                      >
                        <RelativeTime date={file.date} />
                      </span>
                    </div>

                    {/* Row 2: Directory path */}
                    {parentDir && (
                      <div
                        className="text-xs text-slate-400 truncate mb-0.5"
                        title={parentDir}
                      >
                        {parentDir}
                      </div>
                    )}

                    {/* Row 3: Metadata line */}
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      {file.untracked ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                          <FileQuestion size={11} className="shrink-0" />
                          Untracked
                        </span>
                      ) : (
                        <>
                          {file.message && (
                            <span className="truncate" title={file.message}>
                              {file.message}
                            </span>
                          )}
                          {file.message &&
                            (file.author_name || file.hexsha) && (
                              <span className="text-slate-300 dark:text-slate-500">
                                ·
                              </span>
                            )}
                          {file.author_name && (
                            <span className="shrink-0 inline-flex items-center gap-0.5">
                              <User size={10} />
                              {file.author_name}
                            </span>
                          )}
                          {file.hexsha && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 font-mono text-[10px]">
                              <GitCommitHorizontal size={10} />
                              {file.hexsha.slice(0, 7)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </AppLink>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
