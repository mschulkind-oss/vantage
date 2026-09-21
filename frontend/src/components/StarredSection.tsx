import React from "react";
import { Star, Folder, File } from "lucide-react";
import { useStarredStore } from "../stores/useStarredStore";
import { useRepoStore } from "../stores/useRepoStore";
import { isStaticMode } from "../lib/staticMode";
import { AppLink } from "./AppLink";
import { cn } from "../lib/utils";
import { starredHref } from "../lib/starredLinks";

/**
 * The "Starred" list at the top of the sidebar.
 *
 * It has no height cap and no scroller of its own, and that is deliberate: the
 * sidebar already nests one fixed-height scroll area (Recent) inside a
 * scrolling column, and a third makes the layout unusable on a short window.
 * This section flows with the file tree in the container it is rendered into.
 * The server caps the list, so it cannot grow without bound.
 *
 * Entries are never checked against the filesystem. A bookmark whose target is
 * gone stays listed and looks ordinary; opening it lands in the viewer's error
 * notice, which is where it offers to remove it. Checking here would mean one
 * stat per bookmark and a list that flickers during a git checkout.
 */
export const StarredSection: React.FC = () => {
  const entries = useStarredStore((s) => s.entries);
  const currentPath = useRepoStore((s) => s.currentPath);
  const currentRepo = useRepoStore((s) => s.currentRepo);

  if (isStaticMode() || entries.length === 0) return null;

  return (
    <div className="mb-2 pb-2 border-b border-slate-100 dark:border-slate-700">
      <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
        <Star size={12} />
        <span>Starred</span>
      </div>
      {entries.map((entry) => {
        const parts = entry.path.split("/");
        const name = parts.pop() || entry.path;
        const parentDir = parts.join("/");
        const isActive =
          currentPath === entry.path && (currentRepo ?? "") === entry.repo;
        const Icon = entry.is_dir ? Folder : File;

        return (
          <AppLink
            key={`${entry.repo}/${entry.path}`}
            to={starredHref(entry)}
            title={entry.path}
            className={cn(
              "w-full flex items-start py-1.5 px-2 text-left rounded-md text-xs transition-all duration-150 no-underline",
              "hover:bg-slate-100 dark:hover:bg-slate-700",
              isActive &&
                "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
            )}
          >
            <Icon
              size={13}
              className="mr-1.5 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-slate-700 dark:text-slate-300 font-medium">
                {name}
              </div>
              {parentDir && (
                <div className="truncate text-slate-500 dark:text-slate-400">
                  {parentDir}/
                </div>
              )}
            </div>
          </AppLink>
        );
      })}
    </div>
  );
};
