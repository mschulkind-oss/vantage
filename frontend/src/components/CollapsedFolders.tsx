import { useCallback, useRef, useState } from "react";
import { Folder } from "lucide-react";

import { AnchoredMenu } from "./AnchoredMenu";
import { AppLink } from "./AppLink";

interface CollapsedFoldersProps {
  /** The breadcrumb's folder segments, outermost first. */
  dirs: string[];
  /** The route of the folder `dirs[0..depth]`. */
  hrefFor: (depth: number) => string;
}

/**
 * The "…" a narrow viewer header shows in place of the breadcrumb's folders,
 * and the menu it opens with one link per folder — so collapsing them hides
 * them from view without taking any of them out of reach. The tooltip names
 * the whole collapsed path for a reader who only wants to know where they are.
 *
 * Which of the two the header shows — the folders or this — is the header's
 * `dirs` yield step (`lib/headerFit.ts`); this component only has to be ready.
 */
export function CollapsedFolders({ dirs, hrefFor }: CollapsedFoldersProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const path = dirs.join("/");

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
        {dirs.map((dir, depth) => (
          <AppLink
            key={depth}
            to={hrefFor(depth)}
            role="menuitem"
            onBeforeNavigate={close}
            title={dirs.slice(0, depth + 1).join("/")}
            className="flex items-center gap-2 py-1.5 pr-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 no-underline"
            // Indented by depth, so the list reads as the path it came from.
            style={{ paddingLeft: 12 + depth * 12 }}
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
