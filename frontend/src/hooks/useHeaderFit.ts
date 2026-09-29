import { useCallback, type RefCallback } from "react";
import { fitHeader } from "../lib/headerFit";

/**
 * A ref for the viewer header that keeps its yield steps (see
 * `lib/headerFit.ts`) fitted to it.
 *
 * The fit runs whenever the header's width changes and whenever anything inside
 * it does — a new file name, a label turning into "Copied!", a relative time
 * ticking over to a longer phrase — and from inside those observers' callbacks,
 * which run after layout and before paint, so no frame is ever drawn with the
 * header overflowing or over-collapsed. It writes the `data-yield` attribute
 * straight to the node rather than through state: re-rendering the whole
 * viewer to change one attribute only CSS reads would be all cost.
 *
 * Only the header itself is size-observed. Its own size is not something the
 * fit can change, so fitting inside that callback can never ask to be
 * delivered again; observing the halves the fit resizes would.
 */
export function useHeaderFit(): RefCallback<HTMLElement> {
  return useCallback((header: HTMLElement | null) => {
    if (!header) return;
    let live = true;
    const fit = () => {
      if (live) fitHeader(header);
    };
    fit();
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    resize?.observe(header);
    const content =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(fit);
    content?.observe(header, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    // A web font arriving changes every text width without changing the DOM.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", fit);
    return () => {
      live = false;
      resize?.disconnect();
      content?.disconnect();
      fonts?.removeEventListener?.("loadingdone", fit);
    };
  }, []);
}
