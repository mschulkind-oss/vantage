import React, { useCallback } from "react";
import { Star } from "lucide-react";
import { useStarredStore } from "../stores/useStarredStore";
import { isStaticMode } from "../lib/staticMode";
import { cn } from "../lib/utils";

interface StarButtonProps {
  /** Repo-relative path of the open document or directory. */
  path: string | null;
  /** Repo name, or null in single-repo mode (sent as the "" sentinel). */
  repo: string | null;
  /** Whether the open path is a directory, which the bookmark records. */
  isDir: boolean;
}

/**
 * The header's bookmark toggle, sitting to the right of the document name.
 *
 * Hidden rather than disabled when there is nothing to bookmark — no open path,
 * the repository root (which the server rejects: bookmarking "everything" says
 * nothing), or a static export with no backend to store it in.
 */
export const StarButton: React.FC<StarButtonProps> = ({
  path,
  repo,
  isDir,
}) => {
  const repoKey = repo ?? "";
  const starred = useStarredStore((s) =>
    path ? s.isStarred(repoKey, path) : false,
  );
  const toggleStar = useStarredStore((s) => s.toggleStar);

  const handleClick = useCallback(() => {
    if (!path) return;
    void toggleStar(repoKey, path, isDir);
  }, [toggleStar, repoKey, path, isDir]);

  if (!path || path === "." || isStaticMode()) return null;

  const label = starred ? "Remove bookmark" : "Bookmark this";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "p-1.5 rounded-md shrink-0 transition-colors cursor-pointer",
        starred
          ? "text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
          : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700",
      )}
      aria-label={label}
      aria-pressed={starred}
      title={label}
    >
      <Star size={18} className={starred ? "fill-current" : undefined} />
    </button>
  );
};
