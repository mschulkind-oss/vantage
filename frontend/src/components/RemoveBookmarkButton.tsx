import React, { useCallback } from "react";
import { useStarredStore } from "../stores/useStarredStore";
import { isStaticMode } from "../lib/staticMode";

interface RemoveBookmarkButtonProps {
  /** The path that failed to load. */
  path: string | null;
  /** Repo name, or null in single-repo mode. */
  repo: string | null;
}

/**
 * Offered in the viewer's error notice when the document that failed to load is
 * bookmarked — the one place a bookmark whose target is gone can be cleaned up,
 * since the sidebar deliberately lists it as though nothing were wrong.
 *
 * It subscribes to the entries themselves rather than to the store's isStarred
 * action. The action is a stable reference, so a component selecting it is not
 * re-rendered when the list arrives, and the button silently failed to appear
 * on a cold load until this was split out.
 *
 * Removing does not navigate. The failed load is surprise enough; the row
 * disappearing from the sidebar is the confirmation, and this button removes
 * itself once the bookmark is gone. "Go to Home" beside it covers leaving.
 */
export const RemoveBookmarkButton: React.FC<RemoveBookmarkButtonProps> = ({
  path,
  repo,
}) => {
  const repoKey = repo ?? "";
  const starred = useStarredStore((s) =>
    path ? s.entries.some((e) => e.repo === repoKey && e.path === path) : false,
  );
  const removeStar = useStarredStore((s) => s.removeStar);

  const handleClick = useCallback(() => {
    if (!path) return;
    void removeStar(repoKey, path);
  }, [removeStar, repoKey, path]);

  if (!path || !starred || isStaticMode()) return null;

  return (
    <button
      onClick={handleClick}
      className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
    >
      Remove bookmark
    </button>
  );
};
