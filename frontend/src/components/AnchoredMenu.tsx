import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { anchoredMenuPosition } from "../lib/popoverPosition";
import { cn } from "../lib/utils";

interface AnchoredMenuProps {
  /** Whether the menu is showing. */
  open: boolean;
  /** Asked to close: a click outside, or Escape. */
  onClose: () => void;
  /** The trigger the menu hangs off. Clicks on it are not "outside". */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Menu width in px. Clamped down on viewports narrower than it. */
  width: number;
  children: React.ReactNode;
  className?: string;
  /** Forwarded to the panel, e.g. "menu". */
  role?: string;
  "aria-label"?: string;
}

/**
 * A menu positioned against its trigger and kept on screen.
 *
 * Both of this app's dropdowns were `absolute right-0 top-full` inside their
 * trigger's container, which has two failure modes that showed up together in
 * the settings gear. Right-aligning a 224px menu to a button in a sidebar that
 * resizes down to 200px puts its left edge at about -40px; and because the
 * sidebar's ancestors are `overflow-hidden`, the overflow was clipped rather
 * than allowed to hang over the content, so the menu lost its left edge.
 *
 * Neither is fixable in place — no amount of arithmetic escapes an ancestor
 * that clips. So the panel is portaled to the body and positioned `fixed`, with
 * placement from `anchoredMenuPosition`.
 *
 * Placement is measured rather than assumed: the panel mounts hidden, its real
 * height is read, and only then is it placed and revealed. That is what lets a
 * menu near the bottom of the window flip above its trigger by the right
 * amount. Styles are written straight to the node rather than held in state,
 * matching RecentFilePopover — measuring in an effect and storing the result
 * would re-render on every scroll frame for a value only the DOM consumes.
 */
export function AnchoredMenu({
  open,
  onClose,
  anchorRef,
  width,
  children,
  className,
  role = "menu",
  "aria-label": ariaLabel,
}: AnchoredMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    // scrollHeight, not offsetHeight: the menu's natural height decides whether
    // it fits below, and offsetHeight is already capped by the maxHeight a
    // previous pass applied.
    const { top, left, maxHeight } = anchoredMenuPosition(
      { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
      width,
      panel.scrollHeight,
      window.innerWidth,
      window.innerHeight,
    );
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.maxHeight = `${maxHeight}px`;
    panel.style.visibility = "visible";
  }, [anchorRef, width]);

  // A callback ref, so the measure happens the moment the node exists — before
  // the browser paints it, and without an effect that would show it at 0,0 for
  // a frame first.
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (node) place();
    },
    [place],
  );

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    // Capture, so scrolling any container counts and not just the window.
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel is portaled out of the trigger's subtree, so "outside" has to
      // be tested against both — testing the trigger alone would close on its
      // own click and immediately reopen.
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={attach}
      role={role}
      aria-label={ariaLabel}
      style={{
        width,
        maxWidth: "calc(100vw - 32px)",
        // Hidden until measured — it has to be in the document to have a
        // height at all, and unplaced it would flash at the top-left corner.
        visibility: "hidden",
      }}
      className={cn(
        "fixed z-[200] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
