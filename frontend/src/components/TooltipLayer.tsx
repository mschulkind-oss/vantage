import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/** How long the pointer rests on a control before its tooltip is drawn. */
const POINTER_DELAY_MS = 400;
/** The room between a tooltip and its control, and between it and the window. */
const GAP = 8;

/** Where a control carries the sentence a tooltip shows for it. */
const TIP_ATTR = "data-tip";

/** The tip-carrying control `el` belongs to, if any. */
function holderOf(el: Element | null | undefined): HTMLElement | null {
  const holder = el?.closest?.(`[${TIP_ATTR}]`);
  return holder instanceof HTMLElement ? holder : null;
}

/**
 * The tip-carrying control under a point, by hit test.
 *
 * `null` where there is no hit test to be had — jsdom — or where the point is
 * off the window, so a caller falls back to what its own event names. A
 * `disabled` form control dispatches no pointer events of its own: the event
 * lands on its nearest enabled ancestor, and its `target` is that ancestor, so
 * a hit test is the only way to find the control the pointer is really on.
 */
function holderAtPoint(x: number, y: number): HTMLElement | null {
  if (typeof document.elementFromPoint !== "function") return null;
  return holderOf(document.elementFromPoint(x, y));
}

/**
 * The styled tooltip for a control that carries `data-tip` — what the viewer
 * and planning headers use in place of the browser's own `title`.
 *
 * One layer for the whole app, rather than a wrapper around each control: a
 * wrapper is a box in the header's row, which `lib/headerFit.ts` measures, and
 * a control's own box is what that fit is about. So the control keeps its place
 * and the layer finds it, the way the browser finds a `title` — the same
 * bargain, with a panel this app draws. The layer is also what reaches a
 * control no `absolute` panel of its own could hang over: it is portaled, so a
 * tooltip is not clipped by `.hdr-lead`'s `overflow: clip`, and it is placed
 * against the window rather than against an ancestor that clips.
 *
 * **Not on click, scroll, or a control showing its own panel.** A tooltip that
 * outlives the pointer's intent is noise, so it goes on any of those, and an
 * anchor whose own menu is open (`aria-expanded="true"`) never gets one at all.
 *
 * **A delay for the pointer, none for the keyboard.** A pointer passes over
 * controls on its way somewhere else, and a panel that flashed up under every
 * one would be worse than no tooltip at all; a reader who has tabbed to a
 * control has already said which one they mean.
 *
 * **A labeled row in a menu keeps the browser's own `title`.** It is never
 * collapsed, so what it says is not what a control *is* but the text a narrow
 * panel clipped — a different question, and one the browser answers with the
 * same reach this layer exists to get.
 *
 * What it says is `data-tip`, line breaks and all — the commit button's is its
 * message, its date and what a click does. A `title` is a *description*, not a
 * name: every control here is already named, by the text a yield step may have
 * clipped (which stays in the accessibility tree) or by its `aria-label`, and
 * while the tip is up the layer adds it to that with `aria-describedby`, so a
 * screen reader hears what a sighted reader reads.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<string | null>(null);
  const panelId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  /**
   * Whether the last interaction was the pointer's. A click focuses the control
   * it lands on, and a tip for it would outlive the click that made it — a
   * tooltip is for a reader looking, not for one who has already acted.
   */
  const pointerRef = useRef(false);
  /** The anchor whose `aria-describedby` this layer put there. */
  const describedRef = useRef<HTMLElement | null>(null);

  /**
   * Where the panel goes, measured rather than assumed: its own height decides
   * whether it sits under the control or over it, and its width how far it is
   * pulled in from a window edge — which is what keeps a right-anchored
   * toolbar's tooltips on screen.
   */
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (anchor === null || panel === null) return;
    const a = anchor.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const below = a.bottom + GAP + rect.height <= window.innerHeight - GAP;
    const top = below
      ? a.bottom + GAP
      : Math.max(GAP, a.top - GAP - rect.height);
    const left = Math.min(
      Math.max(GAP, a.left + a.width / 2 - rect.width / 2),
      Math.max(GAP, window.innerWidth - rect.width - GAP),
    );
    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.visibility = "visible";
  }, []);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /** Take down whatever is up, and forget which control it belonged to. */
  const clear = useCallback(() => {
    stopTimer();
    describedRef.current?.removeAttribute("aria-describedby");
    describedRef.current = null;
    anchorRef.current = null;
    setTip(null);
  }, [stopTimer]);

  const show = useCallback(
    (anchor: HTMLElement, text: string) => {
      describedRef.current?.removeAttribute("aria-describedby");
      anchor.setAttribute("aria-describedby", panelId);
      describedRef.current = anchor;
      anchorRef.current = anchor;
      setTip(text);
    },
    [panelId],
  );

  useLayoutEffect(() => {
    if (tip !== null) place();
  }, [place, tip]);

  useEffect(() => {
    /** A control already showing a panel of its own needs no tip as well. */
    const wanted = (el: HTMLElement) =>
      (el.getAttribute(TIP_ATTR) ?? "") !== "" &&
      el.getAttribute("aria-expanded") !== "true";

    /** The pointer arrived at `el`: anything else comes down, and this waits. */
    const arrived = (el: HTMLElement | null) => {
      if (el !== null && el === anchorRef.current) return;
      clear();
      if (el === null || !wanted(el)) return;
      timer.current = window.setTimeout(
        () => show(el, el.getAttribute(TIP_ATTR) ?? ""),
        POINTER_DELAY_MS,
      );
    };
    /** The pointer left for `next`: what was up comes down unless it is inside it. */
    const left = (next: HTMLElement | null) => {
      const anchor = anchorRef.current;
      if (anchor === null) {
        stopTimer();
        return;
      }
      if (next === anchor) return;
      if (next !== null && anchor.contains(next)) return;
      clear();
    };

    const onOver = (e: PointerEvent) =>
      arrived(
        holderAtPoint(e.clientX, e.clientY) ?? holderOf(e.target as Element),
      );
    const onOut = (e: PointerEvent) =>
      left(
        holderAtPoint(e.clientX, e.clientY) ??
          holderOf(e.relatedTarget as Element | null),
      );
    const onFocusIn = (e: FocusEvent) => {
      if (pointerRef.current) {
        // The focus this event reports is the one the click just made.
        pointerRef.current = false;
        return;
      }
      const el = holderOf(e.target as Element);
      if (el !== null && wanted(el)) {
        stopTimer();
        show(el, el.getAttribute(TIP_ATTR) ?? "");
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const el = holderOf(e.relatedTarget as Element | null);
      const anchor = anchorRef.current;
      if (
        anchor !== null &&
        (el === anchor || (el !== null && anchor.contains(el)))
      )
        return;
      if (anchor !== null) clear();
    };
    const onKey = (e: KeyboardEvent) => {
      // Whatever a pointer did last, this is the keyboard's turn now.
      pointerRef.current = false;
      if (e.key === "Escape") clear();
    };
    const onPointerDown = () => {
      pointerRef.current = true;
      clear();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    // Capture, so a scroll of any container under the pointer counts and not
    // just the window: a tip left behind while its control scrolled away would
    // point at the wrong thing.
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", clear);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      fonts?.removeEventListener?.("loadingdone", clear);
    };
  }, [clear, show, stopTimer]);

  if (tip === null) return null;
  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="tooltip"
      // Hidden until placed: it must be in the document to have a size at all,
      // and unplaced it would flash at the top-left corner.
      style={{ visibility: "hidden" }}
      className="pointer-events-none fixed z-[300] w-max max-w-[min(22rem,calc(100vw-1rem))] rounded-md bg-slate-900 px-2 py-1.5 text-xs leading-snug whitespace-pre-line text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
    >
      {tip}
    </div>,
    document.body,
  );
}
