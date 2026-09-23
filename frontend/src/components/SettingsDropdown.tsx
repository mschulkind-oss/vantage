import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Settings,
  Sun,
  Moon,
  FolderOpen,
  Keyboard,
  Eye,
  FileX,
  BookOpen,
  Palette,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  activeColorThemeId,
  builtInColorThemes,
  chooseColorTheme,
  listColorThemes,
  type ColorTheme,
} from "../lib/colorTheme";
import {
  chooseColorMode,
  colorMode,
  subscribeColorMode,
} from "../lib/darkMode";
import { AnchoredMenu } from "./AnchoredMenu";

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
  // Subscribed rather than copied into state, so the buttons show the mode the
  // page is actually in however it got there: this menu, Shift+D, or another tab.
  const mode = useSyncExternalStore(subscribeColorMode, colorMode);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const [colorThemes, setColorThemes] =
    useState<ColorTheme[]>(builtInColorThemes);
  const [colorTheme, setColorTheme] = useState(activeColorThemeId);
  const colorSelectId = useId();

  // Asked each time the menu opens rather than once, because the server
  // re-reads the themes directory per request: a theme file dropped in while
  // the page is open shows up without a reload.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listColorThemes().then((themes) => {
      if (!cancelled) setColorThemes(themes);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // The applied theme is always an option, even when the list lacks it — it
  // starts as the built-ins, falls back to them when the server cannot be
  // reached, and drops a theme whose file was removed. Without it the select
  // showed "Slate" over a user theme still in effect, and picking "Slate"
  // was then no change at all, so the reader could not get back to it.
  const colorOptions = colorThemes.some((t) => t.id === colorTheme)
    ? colorThemes
    : [
        ...colorThemes,
        // `hasDark` is a claim about a file this list never saw, so it claims
        // nothing: "(light only)" on a theme that has a dark half would be a
        // worse lie than saying nothing about one that does not.
        {
          id: colorTheme,
          name: colorTheme,
          source: "user" as const,
          hasDark: true,
        },
      ];

  const handleColorThemeChange = (id: string) => {
    const chosen = colorOptions.find((t) => t.id === id);
    if (!chosen) return;
    setColorTheme(id);
    // A user theme applies only once its sheet loads, and not at all if it
    // fails, so the picker settles on whatever is actually in effect.
    void chooseColorTheme(chosen).then(() =>
      setColorTheme(activeColorThemeId()),
    );
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => {
          // Startup may have switched themes since the last render.
          if (!open) setColorTheme(activeColorThemeId());
          setOpen(!open);
        }}
        className={cn(
          "p-1.5 rounded-md transition-colors",
          open
            ? "bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200"
            : "hover:bg-slate-100 text-slate-500 dark:hover:bg-slate-700 dark:text-slate-400",
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
            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
              Theme
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => chooseColorMode("light")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex-1",
                  mode === "light"
                    ? "bg-slate-100 text-slate-900 dark:bg-slate-600 dark:text-white"
                    : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700",
                )}
              >
                <Sun size={13} />
                Light
              </button>
              <button
                onClick={() => chooseColorMode("dark")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex-1",
                  mode === "dark"
                    ? "bg-slate-700 text-white"
                    : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700",
                )}
              >
                <Moon size={13} />
                Dark
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <label
                htmlFor={colorSelectId}
                className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"
              >
                <Palette size={13} />
                Colours
              </label>
              <select
                id={colorSelectId}
                value={colorTheme}
                onChange={(e) => handleColorThemeChange(e.target.value)}
                className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
              >
                {colorOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {/* A theme with no `:root.dark` rule looks broken rather
                        than absent in dark mode — its light palette on a page
                        the reader asked to be dark — and the theme's own file
                        is the only place that can be fixed, so the picker says
                        which theme it is. */}
                    {t.hasDark ? t.name : `${t.name} (light only)`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-700 mx-2 my-1" />

          {/* Keyboard section */}
          <div className="px-3 py-2">
            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
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
            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
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
