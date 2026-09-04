import React, { useState, useRef, useCallback, useEffect } from "react";
import ReactDOM from "react-dom";
import { format } from "date-fns";
import {
  MessageSquare,
  User,
  Clock,
  GitCommitHorizontal,
  FileText,
} from "lucide-react";
import type { RecentFile } from "../types";
import { sideAnchoredPosition } from "../lib/popoverPosition";
import { cn } from "../lib/utils";

interface RecentFilePopoverProps {
  file: RecentFile;
  children: React.ReactNode;
}

const SHOW_DELAY = 150;
const HIDE_DELAY = 150;

export const RecentFilePopover: React.FC<RecentFilePopoverProps> = ({
  file,
  children,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const handleMouseEnter = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (!isVisible && !showTimerRef.current) {
      showTimerRef.current = setTimeout(() => {
        setIsVisible(true);
        showTimerRef.current = null;
      }, SHOW_DELAY);
    }
  }, [isVisible]);

  const handleMouseLeave = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (!hideTimerRef.current) {
      hideTimerRef.current = setTimeout(() => {
        setIsVisible(false);
        hideTimerRef.current = null;
      }, HIDE_DELAY);
    }
  }, []);

  const handlePopoverMouseEnter = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const handlePopoverMouseLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false);
      hideTimerRef.current = null;
    }, HIDE_DELAY);
  }, []);

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible && (
        <PopoverCard
          file={file}
          anchorRef={wrapperRef}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        />
      )}
    </div>
  );
};

interface PopoverCardProps {
  file: RecentFile;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const PopoverCard: React.FC<PopoverCardProps> = ({
  file,
  anchorRef,
  onMouseEnter,
  onMouseLeave,
}) => {
  // Position the popover via a callback ref to avoid accessing refs during render
  const popoverCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const { top, left } = sideAnchoredPosition(
        { left: rect.left, right: rect.right, top: rect.top },
        320, // w-80
        180,
        window.innerWidth,
        window.innerHeight,
      );

      node.style.top = `${top}px`;
      node.style.left = `${left}px`;
    },
    [anchorRef],
  );

  const content = (
    <div
      ref={popoverCallbackRef}
      data-testid="recent-file-popover"
      className={cn(
        "fixed z-[9999] w-80",
        "bg-white dark:bg-slate-800 rounded-lg shadow-xl",
        "border border-slate-200 dark:border-slate-700",
        "p-3 text-sm",
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* File path */}
      <div className="flex items-center gap-2 mb-2">
        <FileText
          size={14}
          className="shrink-0 text-blue-500 dark:text-blue-400"
        />
        <span className="font-medium text-slate-900 dark:text-slate-100 break-all text-xs">
          {file.path}
        </span>
      </div>

      {file.untracked ? (
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs font-medium">
          Untracked
        </div>
      ) : (
        <div className="space-y-2">
          {/* Commit message */}
          {file.message && (
            <div className="flex items-start gap-2">
              <MessageSquare
                size={13}
                className="shrink-0 mt-0.5 text-slate-400"
              />
              <span className="text-slate-700 dark:text-slate-300 text-xs leading-relaxed">
                {file.message}
              </span>
            </div>
          )}

          {/* Author & Date row */}
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {file.author_name && (
              <div className="flex items-center gap-1">
                <User size={12} className="shrink-0" />
                <span>{file.author_name}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Clock size={12} className="shrink-0" />
              <span>
                {format(new Date(file.date), "MMM d, yyyy 'at' h:mm a")}
              </span>
            </div>
          </div>

          {/* SHA */}
          {file.hexsha && (
            <div className="flex items-center gap-1.5">
              <GitCommitHorizontal
                size={12}
                className="shrink-0 text-slate-400"
              />
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-600">
                {file.hexsha.slice(0, 8)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
};
