import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MoreHorizontal } from "lucide-react";

interface HeaderOverflowProps {
  /** The toolbar's actions: a row of buttons until the header folds them. */
  children: React.ReactNode;
  /**
   * Controls that live elsewhere in the header and fold in here with the
   * actions — the TOC and full-width toggles. Rendered only while the panel
   * is open, so each control exists once in the document otherwise.
   */
  extra?: React.ReactNode;
}

/** What a reader can focus in the panel, in order, skipping anything undrawn. */
function focusables(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"),
  ).filter((el) =>
    // A desktop-only toggle on a phone is display:none. Where the check is
    // not implemented (jsdom), everything counts as drawn.
    typeof el.checkVisibility === "function" ? el.checkVisibility() : true,
  );
}

/**
 * The viewer toolbar's actions, and the "⋯" they fold into when the header's
 * `actions` yield step is taken (`lib/headerFit.ts`).
 *
 * The same buttons serve both: in the row they are ordinary toolbar items, and
 * once the step is taken they are hidden until the "⋯" opens them as a panel
 * under it, labels and all (index.css, "The viewer header's yield steps"). So
 * nothing is rendered twice, every handler is the one the row uses, and a
 * button keeps its name, its state and its place in the tab order — the panel
 * is not portaled, so Tab from the "⋯" walks straight into it.
 *
 * It is a disclosure rather than a `role="menu"`: its items are the toolbar's
 * own buttons, some of them two-step confirms and toggles that stay open to be
 * clicked again, which a menu's close-on-choose would break.
 */
export function HeaderOverflow({ children, extra }: HeaderOverflowProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Into the panel the moment it opens, before it is painted.
  useLayoutEffect(() => {
    if (open) focusables(panelRef.current)[0]?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // A resize can give the step back, which would leave the panel's
    // controls open in the row the next time it is taken.
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
      return;
    }
    const items = focusables(panelRef.current);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    const next =
      e.key === "ArrowDown"
        ? (at + 1) % items.length
        : e.key === "ArrowUp"
          ? (at - 1 + items.length) % items.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  };

  return (
    <div
      ref={rootRef}
      className="hdr-overflow relative flex items-center gap-2"
      data-open={open ? "" : undefined}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Focus moving out of it — a Tab past the last action — closes it.
        const to = e.relatedTarget as Node | null;
        if (open && to && !rootRef.current?.contains(to)) setOpen(false);
      }}
      onClick={(e) => {
        // A link leaves the page the panel was opened on.
        if (open && (e.target as HTMLElement).closest("a[href]")) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="hdr-more items-center rounded-lg px-2 py-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
        aria-label="Toolbar actions"
        title="Toolbar actions"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={14} />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className="hdr-actions flex items-center gap-2"
      >
        {open && extra}
        {children}
      </div>
    </div>
  );
}
