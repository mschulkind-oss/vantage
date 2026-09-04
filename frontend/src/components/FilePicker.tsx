import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { File, Search } from "lucide-react";
import { cn } from "../lib/utils";

export interface GlobalFile {
  repo: string;
  path: string;
}

interface FilePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string, repo?: string) => void;
  files: string[];
  /** Global mode: search across all repos */
  globalFiles?: GlobalFile[];
  mode?: "local" | "global";
  placeholder?: string;
  /** Show a loading spinner while file data is being fetched */
  loading?: boolean;
}

const WORD_SEPARATORS = new Set(["/", ".", "-", "_", " "]);

/**
 * Fuzzy match optimized for file paths.
 * Strategy: try basename first (huge bonus), then full path.
 * Heavily penalizes gaps between matched characters.
 */
function fuzzyMatch(
  query: string,
  str: string,
): { match: boolean; score: number; indices: number[] } {
  const q = query.toLowerCase();
  const s = str.toLowerCase();

  if (q.length === 0) return { match: true, score: 0, indices: [] };
  if (q.length > s.length) return { match: false, score: 0, indices: [] };

  // Exact substring match — best possible result
  const substringIdx = s.indexOf(q);
  if (substringIdx !== -1) {
    const indices = Array.from(
      { length: q.length },
      (_, i) => substringIdx + i,
    );
    let score = 1000; // huge bonus for exact substring
    // Extra bonus if it matches in basename
    const lastSlash = s.lastIndexOf("/");
    if (substringIdx > lastSlash) score += 500;
    // Bonus for matching at a word boundary
    if (substringIdx === 0 || WORD_SEPARATORS.has(s[substringIdx - 1]))
      score += 200;
    // Prefer shorter paths
    score -= s.length * 0.5;
    return { match: true, score, indices };
  }

  // Subsequence match with smart index selection
  const indices = subsequenceMatch(q, s);
  if (!indices) return { match: false, score: 0, indices: [] };

  // Score the match
  let score = 0;
  const lastSlash = s.lastIndexOf("/");
  const basenameStart = lastSlash + 1;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];

    // Consecutive character bonus
    if (i > 0 && idx === indices[i - 1] + 1) {
      score += 15;
    } else if (i > 0) {
      // Gap penalty — larger gaps are worse
      const gap = idx - indices[i - 1];
      score -= gap * 2;
    }

    // Word boundary bonus
    if (idx === 0 || WORD_SEPARATORS.has(s[idx - 1])) {
      score += 20;
    }

    // Basename match bonus
    if (idx >= basenameStart) {
      score += 10;
    }

    // CamelCase boundary bonus
    if (idx > 0 && s[idx] >= "a" && str[idx] >= "A" && str[idx] <= "Z") {
      score += 10;
    }
  }

  // Prefer shorter paths
  score -= s.length * 0.5;

  return { match: true, score, indices };
}

/**
 * Find the best subsequence match indices.
 * Uses a two-pass approach: forward scan to verify match exists,
 * then backward scan from the end to prefer tighter groupings.
 */
function subsequenceMatch(query: string, str: string): number[] | null {
  // Forward pass: verify match exists and find rightmost possible positions
  let qi = 0;
  for (let si = 0; si < str.length && qi < query.length; si++) {
    if (str[si] === query[qi]) qi++;
  }
  if (qi !== query.length) return null;

  // Backward pass: prefer matches closer together and near the end (basename)
  const indices: number[] = new Array(query.length);
  qi = query.length - 1;
  for (let si = str.length - 1; si >= 0 && qi >= 0; si--) {
    if (str[si] === query[qi]) {
      indices[qi] = si;
      qi--;
    }
  }

  return indices;
}

interface MatchedFile {
  path: string;
  score: number;
  indices: number[];
  repo?: string;
}

function HighlightedPath({
  path,
  indices,
}: {
  path: string;
  indices: number[];
}) {
  const indexSet = new Set(indices);
  const lastSlash = path.lastIndexOf("/");

  return (
    <span className="truncate">
      {path.split("").map((char, i) => {
        const isHighlighted = indexSet.has(i);
        const isDir = i <= lastSlash;
        return (
          <span
            key={i}
            className={cn(
              isHighlighted && "text-blue-600 font-semibold",
              isDir && !isHighlighted && "text-slate-500 dark:text-slate-400",
            )}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
}

export const FilePicker: React.FC<FilePickerProps> = ({
  isOpen,
  onClose,
  onSelect,
  files,
  globalFiles,
  mode = "local",
  placeholder,
  loading = false,
}) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isGlobal = mode === "global" && globalFiles;

  // Debounce the search query (100ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 100);
    return () => clearTimeout(timer);
  }, [query]);

  // Filter + rank
  const results: MatchedFile[] = useMemo(() => {
    if (isGlobal) {
      // Global mode: search across all repos
      if (!debouncedQuery.trim()) {
        return (globalFiles || [])
          .slice(0, 100)
          .map((f) => ({ path: f.path, repo: f.repo, score: 0, indices: [] }));
      }
      const matched: MatchedFile[] = [];
      for (const f of globalFiles || []) {
        // Match against path first (most relevant)
        const {
          match: pathMatch,
          score: pathScore,
          indices: pathIndices,
        } = fuzzyMatch(debouncedQuery, f.path);
        if (pathMatch) {
          matched.push({
            path: f.path,
            repo: f.repo,
            score: pathScore,
            indices: pathIndices,
          });
          continue;
        }
        // Fall back to matching against "repo/path" for repo-name searches
        const display = `${f.repo}/${f.path}`;
        const { match, score, indices } = fuzzyMatch(debouncedQuery, display);
        if (match) {
          const repoOffset = f.repo.length + 1;
          matched.push({
            path: f.path,
            repo: f.repo,
            score: score - 100,
            // Convert indices to be relative to path only
            indices: indices
              .filter((i) => i >= repoOffset)
              .map((i) => i - repoOffset),
          });
        }
      }
      matched.sort((a, b) => b.score - a.score);
      return matched.slice(0, 100);
    }

    // Local mode: existing behavior
    if (!debouncedQuery.trim()) {
      return files
        .slice(0, 100)
        .map((f) => ({ path: f, score: 0, indices: [] }));
    }
    const matched: MatchedFile[] = [];
    for (const path of files) {
      const { match, score, indices } = fuzzyMatch(debouncedQuery, path);
      if (match) {
        matched.push({ path, score, indices });
      }
    }
    matched.sort((a, b) => b.score - a.score);
    return matched.slice(0, 100);
  }, [debouncedQuery, files, isGlobal, globalFiles]);

  // Reset selection to the top whenever the result set changes. This is the
  // "adjusting state during render" pattern (react.dev/learn/you-might-not-need-an-effect):
  // deriving it here instead of in an effect avoids the extra render pass — and
  // the react-hooks/set-state-in-effect error — that a useEffect would cause.
  const [prevResults, setPrevResults] = useState(results);
  if (results !== prevResults) {
    setPrevResults(results);
    setSelectedIndex(0);
  }

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery(""); // eslint-disable-line react-hooks/set-state-in-effect
      setDebouncedQuery("");
      setSelectedIndex(0);
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-file-item]");
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
            onSelect(results[selectedIndex].path, results[selectedIndex].repo);
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
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700">
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
            placeholder={placeholder || "Search files by name..."}
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
          {loading ? (
            <div className="py-8 flex flex-col items-center text-sm text-slate-500 dark:text-slate-400">
              <svg
                className="animate-spin h-5 w-5 mb-2 text-blue-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Loading files...
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {query ? "No matching files" : "No files found"}
            </div>
          ) : (
            results.map((result, i) => (
              <div
                key={
                  result.repo ? `${result.repo}/${result.path}` : result.path
                }
                data-file-item
                className={cn(
                  "flex items-center px-4 py-2 text-sm cursor-pointer transition-colors",
                  i === selectedIndex
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100"
                    : "hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300",
                )}
                onClick={() => {
                  onSelect(result.path, result.repo);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <File
                  size={14}
                  className={cn(
                    "shrink-0 mr-2.5",
                    i === selectedIndex
                      ? "text-blue-500"
                      : "text-slate-500 dark:text-slate-400",
                  )}
                />
                {isGlobal && result.repo && (
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1.5 shrink-0">
                    {result.repo}/
                  </span>
                )}
                <HighlightedPath path={result.path} indices={result.indices} />
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            {results.length} {results.length === 1 ? "file" : "files"}
            {query && ` matching "${query}"`}
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
