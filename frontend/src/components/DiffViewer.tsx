import React from "react";
import { X, GitCommit as GitCommitIcon, User, Calendar } from "lucide-react";
import { RelativeTime } from "./RelativeTime";
import { FileDiff, DiffLine } from "../types";
import { cn } from "../lib/utils";

interface DiffViewerProps {
  diff: FileDiff;
  onClose: () => void;
}

const LineNumber: React.FC<{ num: number | null; side: "old" | "new" }> = ({
  num,
  side,
}) => (
  <span
    className={cn(
      "inline-block w-10 text-right pr-2 text-xs select-none",
      side === "old" ? "text-red-400" : "text-green-400",
      num === null && "opacity-0",
    )}
  >
    {num ?? " "}
  </span>
);

const DiffLineComponent: React.FC<{ line: DiffLine }> = ({ line }) => {
  const lineClasses = {
    add: "bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400",
    delete: "bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400",
    context: "bg-white dark:bg-slate-900 border-l-4 border-transparent",
    header:
      "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-mono text-xs border-l-4 border-blue-400",
  };

  // The `+`/`-`/`@@` markers are the only thing that says which side a line is
  // on when the row tints are as faint as they are in dark mode, so they carry
  // their own dark values. The 600 shades are tuned against a white page and
  // land at 3.6:1 or less on the tinted rows here; the 400 shades clear 4.5:1.
  const prefixClasses = {
    add: "text-green-600 dark:text-green-400",
    delete: "text-red-600 dark:text-red-400",
    context: "text-slate-500 dark:text-slate-400",
    header: "text-blue-600 dark:text-blue-400",
  };

  const prefixChar = {
    add: "+",
    delete: "-",
    context: " ",
    header: "",
  };

  if (line.type === "header") {
    return (
      <div
        className={cn("px-3 py-1.5 font-mono text-sm", lineClasses[line.type])}
      >
        {line.content}
      </div>
    );
  }

  return (
    <div className={cn("flex font-mono text-sm", lineClasses[line.type])}>
      <div className="flex-shrink-0 bg-slate-50 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 px-1">
        <LineNumber num={line.old_line_no} side="old" />
        <LineNumber num={line.new_line_no} side="new" />
      </div>
      <span
        className={cn(
          "flex-shrink-0 w-5 text-center",
          prefixClasses[line.type],
        )}
      >
        {prefixChar[line.type]}
      </span>
      <pre className="flex-1 whitespace-pre-wrap break-all pr-4">
        {line.content || " "}
      </pre>
    </div>
  );
};

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff, onClose }) => {
  const isWorkingDiff = diff.commit_hexsha === "working";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-3">
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  isWorkingDiff
                    ? "bg-gradient-to-br from-green-500 to-emerald-600"
                    : "bg-gradient-to-br from-amber-500 to-orange-600",
                )}
              >
                <GitCommitIcon size={16} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                  {isWorkingDiff ? "Uncommitted Changes" : "Commit Diff"}
                </h2>
                {!isWorkingDiff && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {diff.commit_hexsha.slice(0, 8)}
                  </p>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 font-medium pl-11">
              {diff.commit_message}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label="Close diff viewer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Commit metadata */}
        <div className="flex items-center space-x-6 px-6 py-3 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
          <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
            <User size={14} className="text-slate-500 dark:text-slate-400" />
            <span>{diff.commit_author}</span>
          </div>
          <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
            <Calendar
              size={14}
              className="text-slate-500 dark:text-slate-400"
            />
            <span>
              <RelativeTime date={diff.commit_date} />
            </span>
          </div>
          <div className="flex-1 text-right">
            <span className="text-slate-500 dark:text-slate-400 font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200/50 dark:border-slate-700">
              {diff.file_path}
            </span>
          </div>
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-auto">
          {diff.hunks.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-500 dark:text-slate-400">
              <p>No changes in this file for this commit</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {diff.hunks.map((hunk, hunkIndex) => (
                <div key={hunkIndex} className="bg-white dark:bg-slate-900">
                  {hunk.lines.map((line, lineIndex) => (
                    <DiffLineComponent
                      key={`${hunkIndex}-${lineIndex}`}
                      line={line}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
