import React, { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useRepoStore } from "../stores/useRepoStore";
import { degradationKey, useDegradedStore } from "../stores/useDegradedStore";

/**
 * Says what is degraded when the open project is too big for one of the
 * server's limits — live reload out of watches, recents out of time — which
 * otherwise only ever reached the server's log. See
 * docs/design/serve-clones-directory.md §7.
 *
 * Fixed to the bottom of the viewport rather than placed in the page's flow:
 * the list arrives after the page has painted, and a banner pushing content
 * down at that point would move what the reader is already reading.
 */
export const DegradedBanner: React.FC = () => {
  const items = useDegradedStore((s) => s.items);
  const dismissed = useDegradedStore((s) => s.dismissed);
  const load = useDegradedStore((s) => s.load);
  const dismiss = useDegradedStore((s) => s.dismiss);
  const isMultiRepo = useRepoStore((s) => s.isMultiRepo);
  const currentRepo = useRepoStore((s) => s.currentRepo);
  const reposLoaded = useRepoStore((s) => s.reposLoaded);

  useEffect(() => {
    void load();
  }, [load]);

  if (!reposLoaded) return null;
  // One project's limits say nothing about another's; the project list
  // itself (no project open) shows none.
  const shown = items.filter(
    (d) =>
      (isMultiRepo ? d.repo === currentRepo : true) &&
      !dismissed.includes(degradationKey(d)),
  );
  if (shown.length === 0) return null;

  return (
    <div
      role="status"
      aria-label="Project too big to serve fully"
      data-testid="degraded-banner"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] flex flex-col gap-2"
    >
      {shown.map((d) => (
        <div
          key={degradationKey(d)}
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow-lg dark:border-amber-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{d.message}</p>
          <button
            type="button"
            onClick={() => dismiss(d)}
            aria-label="Dismiss"
            title="Dismiss until the page is reloaded"
            className="shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
};
