import React, { useEffect } from "react";
import { Keyboard, X } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["t"], description: "Open file finder" },
      { keys: ["Shift", "T"], description: "Search all projects' files" },
      { keys: ["r"], description: "Recent files (current project)" },
      { keys: ["Shift", "R"], description: "Recent files (all projects)" },
      { keys: ["Shift", "P"], description: "Switch project" },
      { keys: ["g", "h"], description: "Go home (root)" },
      { keys: ["g", "r"], description: "Go to recent files page" },
      { keys: ["b"], description: "Toggle sidebar" },
      { keys: ["Esc"], description: "Close a dialog, or leave raw view" },
    ],
  },
  {
    title: "File Viewing",
    shortcuts: [
      { keys: ["j"], description: "Scroll down" },
      { keys: ["k"], description: "Scroll up" },
      { keys: ["g", "g"], description: "Scroll to top" },
      { keys: ["Shift", "G"], description: "Scroll to bottom" },
      { keys: ["d"], description: "View latest diff" },
      { keys: ["h"], description: "View file history" },
      { keys: ["y"], description: "Copy absolute file path" },
    ],
  },
  {
    title: "Theme & Settings",
    shortcuts: [
      { keys: ["Shift", "D"], description: "Toggle dark mode" },
      { keys: ["?"], description: "Show this help" },
    ],
  },
];

const KeyCombo: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="flex items-center gap-0.5">
    {keys.map((key, i) => (
      <React.Fragment key={i}>
        {i > 0 && (
          <span className="text-slate-500 dark:text-slate-400 text-[10px] mx-0.5">
            then
          </span>
        )}
        <kbd
          className={cn(
            "inline-flex items-center justify-center min-w-[24px] h-6 px-1.5",
            "bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600",
            "rounded-md text-xs font-mono font-medium text-slate-700 dark:text-slate-300",
            "shadow-[0_1px_0_1px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_0_1px_rgba(0,0,0,0.3)]",
          )}
        >
          {key}
        </kbd>
      </React.Fragment>
    ))}
  </span>
);

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKey, { capture: true });
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Keyboard size={20} className="text-blue-500" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-5">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  >
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      {shortcut.description}
                    </span>
                    <KeyCombo keys={shortcut.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
            Press{" "}
            <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-[10px] font-mono text-slate-700 dark:text-slate-200">
              ?
            </kbd>{" "}
            anytime to show this help
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/**
 * Button that opens the keyboard shortcuts modal.
 * Place next to the settings gear icon in the sidebar header.
 */
export const KeyboardShortcutsButton: React.FC<{ onClick: () => void }> = ({
  onClick,
}) => (
  <button
    onClick={onClick}
    className={cn(
      "p-1.5 rounded-md transition-colors",
      "hover:bg-slate-100 text-slate-500 dark:hover:bg-slate-700 dark:text-slate-400",
    )}
    aria-label="Keyboard shortcuts"
    title="Keyboard shortcuts"
  >
    <Keyboard size={16} />
  </button>
);
