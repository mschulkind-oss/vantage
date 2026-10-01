import React, { useEffect, useId, useLayoutEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useRepoStore } from "../stores/useRepoStore";
import { degradationKey, useDegradedStore } from "../stores/useDegradedStore";
import type { Degradation } from "../types";

/** The banner's distance from the bottom of the pane it floats over (bottom-4). */
const BOTTOM_OFFSET_PX = 16;

/** What a dismiss button dismisses, for its accessible name. */
function dismissLabel(d: Pick<Degradation, "kind">): string {
  switch (d.kind) {
    case "watch_limit":
    case "watcher_failed":
      return "Dismiss the live reload warning";
    case "walk_timeout":
      return "Dismiss the recent files warning";
    default:
      return "Dismiss this warning";
  }
}

interface DegradedBannerProps {
  /**
   * Hears how much of the bottom of the pane the banner covers, in pixels —
   * its height and its offset, or 0 when it shows nothing — so the pane can
   * leave that much room below its content and let the last line scroll
   * clear of it.
   */
  onSpaceChange?: (px: number) => void;
}

/**
 * Says what is degraded when the open project is too big for one of the
 * server's limits — live reload out of watches, recents out of time — which
 * otherwise only ever reached the server's log. See
 * docs/reference/serve-clones-directory.md §7.4.
 *
 * It floats at the bottom of the app shell's main pane (the viewer's and the
 * planning page's) rather than taking a place in the page's flow: the list
 * arrives after the page has painted, and a banner pushing content down at
 * that point would move what the reader is already reading. Instead the pane
 * reserves room below its content (see `onSpaceChange`), which only lengthens
 * what can be scrolled. Placed in the pane, not the viewport, it never covers
 * the sidebar, and it comes after the content in the tab order, as it does on
 * screen.
 *
 * The live region is mounted, empty, from the first render: one inserted
 * already filled is not reliably announced.
 */
export const DegradedBanner: React.FC<DegradedBannerProps> = ({
  onSpaceChange,
}) => {
  const items = useDegradedStore((s) => s.items);
  const dismissed = useDegradedStore((s) => s.dismissed);
  const load = useDegradedStore((s) => s.load);
  const dismiss = useDegradedStore((s) => s.dismiss);
  const isMultiRepo = useRepoStore((s) => s.isMultiRepo);
  const currentRepo = useRepoStore((s) => s.currentRepo);
  const reposLoaded = useRepoStore((s) => s.reposLoaded);
  const regionRef = useRef<HTMLDivElement>(null);
  // Where focus was before it came into the banner, to give it back to when
  // the last item is dismissed.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const idPrefix = useId();

  useEffect(() => {
    void load();
  }, [load]);

  // One project's limits say nothing about another's; the project list
  // itself (no project open) shows none.
  const shown = reposLoaded
    ? items.filter(
        (d) =>
          (isMultiRepo ? d.repo === currentRepo : true) &&
          !dismissed.includes(degradationKey(d)),
      )
    : [];
  const count = shown.length;

  useLayoutEffect(() => {
    if (!onSpaceChange) return;
    const region = regionRef.current;
    const report = () =>
      onSpaceChange(
        count === 0 || !region
          ? 0
          : region.getBoundingClientRect().height + BOTTOM_OFFSET_PX,
      );
    report();
    if (count === 0 || !region || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(report);
    observer.observe(region);
    return () => observer.disconnect();
  }, [count, onSpaceChange]);

  // Gone with the page: the pane needs no room for it any more.
  useEffect(() => () => onSpaceChange?.(0), [onSpaceChange]);

  const handleDismiss = (d: Degradation) => {
    const buttons = Array.from(
      regionRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-dismiss]",
      ) ?? [],
    );
    const at = buttons.findIndex(
      (b) => b.dataset.dismiss === degradationKey(d),
    );
    const next = buttons[at + 1] ?? buttons[at - 1];
    const hadFocus =
      regionRef.current?.contains(document.activeElement) ?? false;
    dismiss(d);
    if (!hadFocus) return;
    if (next) {
      next.focus();
    } else if (returnFocusTo.current?.isConnected) {
      returnFocusTo.current.focus();
    }
  };

  return (
    <div
      ref={regionRef}
      role="status"
      aria-label="Project too big to serve fully"
      data-testid="degraded-banner"
      onFocus={(e) => {
        const from = e.relatedTarget as HTMLElement | null;
        if (!regionRef.current?.contains(from)) returnFocusTo.current = from;
      }}
      className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(40rem,calc(100%-2rem))] flex flex-col gap-2"
    >
      {shown.map((d) => {
        const key = degradationKey(d);
        const messageId = `${idPrefix}-${d.kind}`;
        return (
          <div
            key={key}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow-lg dark:border-amber-600 dark:bg-slate-800 dark:text-slate-200"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <p id={messageId} className="min-w-0 flex-1">
              {d.message}
            </p>
            <button
              type="button"
              data-dismiss={key}
              onClick={() => handleDismiss(d)}
              aria-label={dismissLabel(d)}
              aria-describedby={messageId}
              title="Dismiss until the page is reloaded"
              className="shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
};
