import React, { useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useGitStore } from "../stores/useGitStore";
import { useRepoStore } from "../stores/useRepoStore";
import { AppLink } from "../components/AppLink";
import {
  ArrowLeft,
  Clock,
  User,
  MessageSquare,
  File,
  FileQuestion,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { RelativeTime } from "../components/RelativeTime";
import { cn } from "../lib/utils";

export const RecentsPage: React.FC = () => {
  const { "*": pathParam } = useParams();
  const { recentFiles, isRecentLoading, recentFilesError, fetchRecentFiles } =
    useGitStore();
  const {
    isMultiRepo,
    currentRepo,
    setCurrentRepo,
    repos,
    reposLoaded,
    loadRepos,
  } = useRepoStore();

  // Parse repo from URL in multi-repo mode
  const repoName = isMultiRepo
    ? pathParam?.split("/").filter(Boolean)[0] || ""
    : "";

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
    if (!reposLoaded) loadRepos();
  }, [loadRepos, reposLoaded]);

  // Set current repo for multi-repo mode
  useEffect(() => {
    if (isMultiRepo && repoName && repoName !== currentRepo) {
      const repoExists = repos.some((r) => r.name === repoName);
      if (repoExists) {
        setCurrentRepo(repoName);
      }
    }
  }, [isMultiRepo, repoName, currentRepo, repos, setCurrentRepo]);

  // Fetch recent files with a higher limit for the full page
  useEffect(() => {
    if (!reposLoaded) return;
    if (isMultiRepo && !currentRepo) return;
    fetchRecentFiles();
  }, [fetchRecentFiles, reposLoaded, isMultiRepo, currentRepo]);

  const backLink = isMultiRepo && currentRepo ? `/${currentRepo}` : "/";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center space-x-3">
            <AppLink
              to={backLink}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 no-underline"
              title="Back"
            >
              <ArrowLeft size={20} />
            </AppLink>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Clock size={18} className="text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-lg text-slate-900 dark:text-slate-100">
                Recently Changed
              </h1>
              {isMultiRepo && currentRepo && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {currentRepo}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* File List */}
      <div className="max-w-4xl mx-auto px-6 py-8 relative">
        {/* Subtle loading bar for refreshes when data already exists */}
        {isRecentLoading && recentFiles.length > 0 && (
          <div className="absolute top-0 left-6 right-6 h-0.5 bg-slate-100 dark:bg-slate-700 overflow-hidden rounded-full">
            <div className="h-full bg-blue-500 animate-pulse w-full" />
          </div>
        )}

        {/* Error banner with retry */}
        {recentFilesError && !isRecentLoading && (
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">Failed to load recent files.</span>
            <button
              onClick={() => fetchRecentFiles()}
              className="flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
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
            <File size={48} className="mx-auto mb-4 text-slate-300" />
            <p className="text-lg font-medium text-slate-500 dark:text-slate-400">
              No recent files found
            </p>
            <p className="text-sm mt-1">
              Start editing Markdown files to see them here.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {recentFiles.map((file) => {
              const parts = file.path.split("/");
              const fileName = parts.pop() || "";
              const parentDir = parts.length > 0 ? parts.join("/") + "/" : "";

              return (
                <AppLink
                  key={file.path}
                  to={buildPath(file.path)}
                  className={cn(
                    "flex items-center gap-4 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl transition-all no-underline",
                    "hover:border-blue-200 dark:hover:border-blue-700 hover:shadow-md hover:bg-blue-50/30 dark:hover:bg-blue-900/20",
                  )}
                >
                  {/* File icon */}
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                      file.untracked
                        ? "bg-amber-50 dark:bg-amber-900/30"
                        : "bg-slate-100 dark:bg-slate-700",
                    )}
                  >
                    {file.untracked ? (
                      <FileQuestion size={20} className="text-amber-500" />
                    ) : (
                      <File size={20} className="text-slate-400" />
                    )}
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {fileName}
                      </span>
                      {parentDir && (
                        <span className="text-xs text-slate-400 truncate hidden sm:inline">
                          {parentDir}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                      {file.untracked ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Untracked
                        </span>
                      ) : (
                        <>
                          {file.message && (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <MessageSquare size={12} className="shrink-0" />
                              <span className="truncate">{file.message}</span>
                            </div>
                          )}
                          {file.author_name && (
                            <div className="flex items-center gap-1.5 shrink-0 hidden sm:flex">
                              <User size={12} />
                              <span>{file.author_name}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Date & SHA */}
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <Clock size={12} />
                      <span title={format(new Date(file.date), "PPpp")}>
                        <RelativeTime date={file.date} />
                      </span>
                    </div>
                    {file.hexsha && (
                      <span className="font-mono text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-600">
                        {file.hexsha.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </AppLink>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
