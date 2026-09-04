import React, { useCallback, useRef, useState } from "react";
import {
  Settings,
  Sun,
  Moon,
  FolderOpen,
  Keyboard,
  Eye,
  FileX,
  BookOpen,
} from "lucide-react";
import { cn } from "../lib/utils";
import { AnchoredMenu } from "./AnchoredMenu";

type Theme = "light" | "dark";

function getStoredTheme(): Theme {
  try {
    return (localStorage.getItem("vantage:theme") as Theme) || "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  try {
    localStorage.setItem("vantage:theme", theme);
  } catch {
    /* ignore */
  }
}

// Initialize theme on module load (before React renders)
applyTheme(getStoredTheme());

interface SettingsDropdownProps {
  showEmptyDirs: boolean;
  onShowEmptyDirsChange: (show: boolean) => void;
  showHidden: boolean;
  onShowHiddenChange: (show: boolean) => void;
  showGitignored: boolean;
  onShowGitignoredChange: (show: boolean) => void;
  keyboardShortcutsEnabled: boolean;
  onKeyboardShortcutsEnabledChange: (enabled: boolean) => void;
  onOpenStyleGuide?: () => void;
}

export const SettingsDropdown: React.FC<SettingsDropdownProps> = ({
  showEmptyDirs,
  onShowEmptyDirsChange,
  showHidden,
  onShowHiddenChange,
  showGitignored,
  onShowGitignoredChange,
  keyboardShortcutsEnabled,
  onKeyboardShortcutsEnabledChange,
  onOpenStyleGuide,
}) => {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "p-1.5 rounded-md transition-colors",
          open
            ? "bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200"
            : "hover:bg-slate-100 text-slate-400 dark:hover:bg-slate-700 dark:text-slate-400",
        )}
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={16} />
      </button>

      <AnchoredMenu
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        width={224}
        aria-label="Settings"
      >
        <>
          {/* Theme section */}
          <div className="px-3 py-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Theme
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => handleThemeChange("light")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex-1",
                  theme === "light"
                    ? "bg-slate-100 text-slate-900 dark:bg-slate-600 dark:text-white"
                    : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700",
                )}
              >
                <Sun size={13} />
                Light
              </button>
              <button
                onClick={() => handleThemeChange("dark")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex-1",
                  theme === "dark"
                    ? "bg-slate-700 text-white"
                    : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700",
                )}
              >
                <Moon size={13} />
                Dark
              </button>
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />

          {/* Keyboard section */}
          <div className="px-3 py-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Keyboard
            </div>
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={keyboardShortcutsEnabled}
                onChange={(e) =>
                  onKeyboardShortcutsEnabledChange(e.target.checked)
                }
                className="rounded border-slate-300 dark:border-slate-600 text-blue-500 focus:ring-blue-500 w-3.5 h-3.5"
              />
              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
                <Keyboard size={13} />
                Enable shortcuts
              </div>
            </label>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />

          {/* File tree section */}
          <div className="px-3 py-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              File Tree
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                className="flex items-center gap-2 cursor-pointer group"
                title="Include folders that don't contain any markdown files"
              >
                <input
                  type="checkbox"
                  checked={showEmptyDirs}
                  onChange={(e) => onShowEmptyDirsChange(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-500 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
                  <FolderOpen size={13} />
                  Show all folders
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => onShowHiddenChange(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-500 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
                  <Eye size={13} />
                  Show hidden files
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={showGitignored}
                  onChange={(e) => onShowGitignoredChange(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-blue-500 focus:ring-blue-500 w-3.5 h-3.5"
                />
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
                  <FileX size={13} />
                  Show gitignored files
                </div>
              </label>
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />
          <div className="px-3 py-2 flex flex-col gap-1">
            {onOpenStyleGuide && (
              <button
                onClick={() => {
                  onOpenStyleGuide();
                  setOpen(false);
                }}
                className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white w-full text-left py-1"
              >
                <BookOpen size={13} />
                Agent Style Guide
              </button>
            )}
          </div>
        </>
      </AnchoredMenu>
    </div>
  );
};
