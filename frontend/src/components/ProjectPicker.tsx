import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FolderGit2, Search } from "lucide-react";
import { cn } from "../lib/utils";
import { RelativeTime } from "./RelativeTime";

interface RepoItem {
  name: string;
  last_activity?: string | null;
}

interface ProjectPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (repoName: string) => void;
  repos: RepoItem[];
}

/** Subsequence fuzzy match. */
function fuzzyMatch(
  query: string,
  str: string,
): { match: boolean; score: number; indices: number[] } {
  const q = query.toLowerCase();
  const s = str.toLowerCase();
  const indices: number[] = [];
  let qi = 0;

  for (let si = 0; si < s.length && qi < q.length; si++) {
    if (s[si] === q[qi]) {
      indices.push(si);
      qi++;
    }
  }

  if (qi !== q.length) return { match: false, score: 0, indices: [] };

  let score = 0;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) score += 10;
  }
  if (indices[0] === 0) score += 5;
  score -= str.length * 0.1;

  return { match: true, score, indices };
}

function HighlightedName({
  name,
  indices,
}: {
  name: string;
  indices: number[];
}) {
  const indexSet = new Set(indices);
  return (
    <span className="truncate">
      {name.split("").map((char, i) => (
        <span
          key={i}
          className={cn(indexSet.has(i) && "text-blue-600 font-semibold")}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

export const ProjectPicker: React.FC<ProjectPickerProps> = ({
  isOpen,
  onClose,
  onSelect,
  repos,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) {
      return repos.map((r) => ({ ...r, score: 0, indices: [] as number[] }));
    }
    const matched: (RepoItem & { score: number; indices: number[] })[] = [];
    for (const repo of repos) {
      const { match, score, indices } = fuzzyMatch(query, repo.name);
      if (match) {
        matched.push({ ...repo, score, indices });
      }
    }
    matched.sort((a, b) => b.score - a.score);
    return matched;
  }, [query, repos]);

  useEffect(() => {
    setSelectedIndex(0); // eslint-disable-line react-hooks/set-state-in-effect
  }, [results]);

  useEffect(() => {
    if (isOpen) {
      setQuery(""); // eslint-disable-line react-hooks/set-state-in-effect
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-project-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            onSelect(results[selectedIndex].name);
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, onSelect, onClose],
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700">
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-slate-200 dark:border-slate-700">
          <Search
            size={16}
            className="text-slate-500 dark:text-slate-400 shrink-0"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search projects..."
            className="w-full px-3 py-3 text-sm outline-none bg-transparent placeholder:text-slate-400 text-slate-900 dark:text-slate-100"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[10px] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 font-mono shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto max-h-80">
          {results.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {query ? "No matching projects" : "No projects found"}
            </div>
          ) : (
            results.map((result, i) => (
              <div
                key={result.name}
                data-project-item
                className={cn(
                  "flex items-center px-4 py-3 cursor-pointer transition-colors",
                  i === selectedIndex
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100"
                    : "hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300",
                )}
                onClick={() => {
                  onSelect(result.name);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <FolderGit2
                  size={16}
                  className={cn(
                    "shrink-0 mr-3",
                    i === selectedIndex
                      ? "text-blue-500"
                      : "text-slate-500 dark:text-slate-400",
                  )}
                />
                <HighlightedName name={result.name} indices={result.indices} />
                {result.last_activity && (
                  <span className="ml-auto pl-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                    <RelativeTime date={result.last_activity} />
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            {results.length} {results.length === 1 ? "project" : "projects"}
          </span>
          <div className="flex items-center space-x-2">
            <span>
              <kbd className="border border-slate-200 dark:border-slate-600 rounded px-1 py-0.5 font-mono">
                ↑↓
              </kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="border border-slate-200 dark:border-slate-600 rounded px-1 py-0.5 font-mono">
                ↵
              </kbd>{" "}
              open
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
