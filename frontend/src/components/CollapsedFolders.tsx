import { useCallback, useRef, useState } from "react";
import { Folder } from "lucide-react";

import { AnchoredMenu } from "./AnchoredMenu";
import { AppLink } from "./AppLink";

interface CollapsedFoldersProps {
  /**
   * The breadcrumb's head: the repository, as "root" or a daemon's repo name.
   * It heads the menu, since the header's `repo` step folds it in here too.
   */
  root: { label: string; href: string };
  /** The breadcrumb's folder segments, outermost first. May be empty. */
  dirs: string[];
  /** The route of the folder `dirs[0..depth]`. */
  hrefFor: (depth: number) => string;
}

/**
 * The "…" a narrow viewer header shows in place of the breadcrumb's folders
 * (and, narrower still, its repository), and the menu it opens with one link
 * to the repository and one per folder — so collapsing them hides
 * them from view without taking any of them out of reach. The tooltip names
 * the whole collapsed path for a reader who only wants to know where they are.
 *
 * Which of the two the header shows — the folders or this — is the header's
 * `dirs` yield step (`lib/headerFit.ts`); this component only has to be ready.
 */
export function CollapsedFolders({
  root,
  dirs,
  hrefFor,
}: CollapsedFoldersProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // What the "…" stands for: the folders, or at the repository root, where
  // only the `repo` step shows it, the repository itself.
  const path = dirs.length ? dirs.join("/") : root.label;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-1 rounded text-slate-500 dark:text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Folders: ${path}`}
        title={path}
      >
        …
      </button>
      <AnchoredMenu
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        width={240}
        align="start"
        aria-label="Folders"
      >
        <AppLink
          to={root.href}
          role="menuitem"
          onBeforeNavigate={close}
          title={root.label}
          className="flex items-center gap-2 py-1.5 pr-3 pl-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 no-underline"
        >
          <span className="truncate">{root.label}</span>
        </AppLink>
        {dirs.map((dir, depth) => (
          <AppLink
            key={depth}
            to={hrefFor(depth)}
            role="menuitem"
            onBeforeNavigate={close}
            title={dirs.slice(0, depth + 1).join("/")}
            className="flex items-center gap-2 py-1.5 pr-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 no-underline"
            // Indented by depth under the repository, so the list reads as
            // the path it came from.
            style={{ paddingLeft: 24 + depth * 12 }}
          >
            <Folder
              size={14}
              className="shrink-0 text-slate-500 dark:text-slate-400"
            />
            <span className="truncate">{dir}</span>
          </AppLink>
        ))}
      </AnchoredMenu>
    </>
  );
}
