import React, { useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useGitStore } from "../stores/useGitStore";
import { useRepoStore } from "../stores/useRepoStore";
import { AppLink } from "../components/AppLink";
import {
  GitBranch,
  ArrowLeft,
  Clock,
  User,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { RelativeTime } from "../components/RelativeTime";
import { cn } from "../lib/utils";

export const HistoryPage: React.FC = () => {
  const { "*": pathParam } = useParams();
  const {
    history,
    fetchHistory,
    isLoading,
    fetchDiff,
    showDiff,
    diff,
    isDiffLoading,
    closeDiff,
  } = useGitStore();
  const {
    isMultiRepo,
    currentRepo,
    setCurrentRepo,
    repos,
    reposLoaded,
    loadRepos,
  } = useRepoStore();

  // Parse the file path from the URL
  const getFileInfo = useCallback(() => {
    const fullPath = pathParam || "";
    if (isMultiRepo) {
      const segments = fullPath.split("/").filter(Boolean);
      const repoName = segments[0] || "";
      const filePath = segments.slice(1).join("/") || "";
      return { repoName, filePath };
    }
    return { repoName: "", filePath: fullPath };
  }, [pathParam, isMultiRepo]);

  const { repoName, filePath } = getFileInfo();

  // Build path with repo prefix
  const buildPath = useCallback(
    (path: string): string => {
      if (isMultiRepo && currentRepo) {
        return `/${currentRepo}/${path}`;
      }
      return `/${path}`;
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

  // Fetch history when we have a path
  useEffect(() => {
    if (filePath) {
      fetchHistory(filePath);
    }
  }, [filePath, fetchHistory, currentRepo]);

  const handleCommitClick = (hexsha: string) => {
    if (filePath) {
      fetchDiff(filePath, hexsha);
    }
  };

  const breadcrumbs = filePath ? filePath.split("/") : [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <AppLink
                to={buildPath(filePath)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 no-underline"
                title="Back to file"
              >
                <ArrowLeft size={20} />
              </AppLink>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600">
                <GitBranch size={18} className="text-white" />
              </div>
              <div>
                <h1 className="font-semibold text-lg text-slate-900 dark:text-slate-100">
                  File History
                </h1>
                <nav className="flex items-center text-xs text-slate-500 dark:text-slate-400 space-x-1 mt-0.5">
                  {isMultiRepo && currentRepo && (
                    <>
                      <AppLink
                        to={`/${currentRepo}`}
                        className="hover:text-blue-600 no-underline text-inherit"
                      >
                        {currentRepo}
                      </AppLink>
                      <ChevronRight
                        size={10}
                        className="text-slate-500 dark:text-slate-400"
                      />
                    </>
                  )}
                  {breadcrumbs.map((part, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && (
                        <ChevronRight
                          size={10}
                          className="text-slate-500 dark:text-slate-400"
                        />
                      )}
                      <span
                        className={cn(
                          i === breadcrumbs.length - 1
                            ? "font-medium text-slate-700 dark:text-slate-300"
                            : "hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer",
                        )}
                      >
                        {part}
                      </span>
                    </React.Fragment>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History List */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-slate-200 dark:border-slate-600 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-20 text-slate-500 dark:text-slate-400">
            <GitBranch size={48} className="mx-auto mb-4" />
            <p className="text-lg font-medium text-slate-500 dark:text-slate-400">
              No commit history found
            </p>
            <p className="text-sm mt-1">This file may be untracked or new.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-slate-200 dark:bg-slate-700" />

            <div className="space-y-1">
              {history.map((commit, index) => (
                <div
                  key={commit.hexsha}
                  className="relative flex items-start group"
                >
                  {/* Timeline dot */}
                  <div
                    className={cn(
                      "relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-1 transition-colors",
                      index === 0
                        ? "bg-blue-500 text-white"
                        : "bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 group-hover:border-blue-300 group-hover:text-blue-500",
                    )}
                  >
                    <GitBranch size={16} />
                  </div>

                  {/* Commit card */}
                  <button
                    onClick={() => handleCommitClick(commit.hexsha)}
                    className={cn(
                      "ml-4 flex-1 text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 transition-all cursor-pointer",
                      "hover:border-blue-200 dark:hover:border-blue-700 hover:shadow-md hover:bg-blue-50/30 dark:hover:bg-blue-900/20",
                      index === 0 &&
                        "border-blue-200 dark:border-blue-700 shadow-sm",
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1.5">
                          <MessageSquare
                            size={14}
                            className="text-slate-500 dark:text-slate-400 shrink-0"
                          />
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {commit.message}
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 text-xs text-slate-500 dark:text-slate-400">
                          <div className="flex items-center space-x-1.5">
                            <User size={12} />
                            <span>{commit.author_name}</span>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <Clock size={12} />
                            <span title={format(new Date(commit.date), "PPpp")}>
                              <RelativeTime date={commit.date} />
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 px-2 py-1 rounded-md border border-slate-100 dark:border-slate-600 shrink-0">
                        {commit.hexsha.slice(0, 8)}
                      </span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Git Diff Viewer Modal */}
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
          <DiffViewerModal diff={diff} onClose={closeDiff} />
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
    </div>
  );
};

// Inline DiffViewer modal for the history page (reuse DiffViewer component)
import { DiffViewer as DiffViewerComponent } from "../components/DiffViewer";
import { FileDiff } from "../types";

const DiffViewerModal: React.FC<{ diff: FileDiff; onClose: () => void }> = ({
  diff,
  onClose,
}) => {
  return <DiffViewerComponent diff={diff} onClose={onClose} />;
};
