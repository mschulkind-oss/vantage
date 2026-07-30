/**
 * Clipboard writes that survive a non-secure context.
 *
 * `navigator.clipboard` is only defined in a secure context — HTTPS or a
 * localhost origin. When Vantage is reached over plain HTTP under a
 * non-localhost name (e.g. a machine's DNS name over a tunnel), the API is
 * `undefined` and every copy button silently does nothing. `copyText` falls
 * back to the legacy `document.execCommand("copy")` path, which works over
 * plain HTTP inside a user gesture, and reports failure so callers can warn
 * instead of failing silently.
 */

/**
 * Writes text to the clipboard, returning whether it succeeded.
 *
 * Tries the async Clipboard API first, then a hidden-element + execCommand
 * fallback for non-secure contexts. Must be called from within a user gesture
 * (a click handler) for the fallback to work — browsers reject synthetic
 * copies. Returns false when both paths fail (notably iOS Safari over plain
 * HTTP), so the caller can surface guidance rather than nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path — some browsers reject the async API
      // even where it exists (permissions, non-secure context quirks).
    }
  }
  return legacyCopy(text);
}

/**
 * copyGuidance is the single message shown when a copy fails, pointing at the
 * secure-context workarounds so a remote user isn't left guessing.
 */
export const copyGuidance =
  "Copy needs HTTPS or a localhost URL. Reach Vantage via an SSH tunnel " +
  "(ssh -L 8000:localhost:8000 <host>) or serve it over HTTPS (e.g. Tailscale).";

/**
 * copyTextOrWarn copies text and, on failure, shows a transient on-screen
 * toast with [copyGuidance] so a plain-HTTP remote user learns why the button
 * did nothing instead of getting silence. Returns whether the copy succeeded.
 */
export async function copyTextOrWarn(text: string): Promise<boolean> {
  const ok = await copyText(text);
  if (!ok) showCopyError();
  return ok;
}

/**
 * showCopyError renders a single self-dismissing toast carrying [copyGuidance].
 * A prior toast is replaced so rapid clicks don't stack. No-ops outside a DOM.
 */
export function showCopyError(): void {
  if (typeof document === "undefined") return;
  document.getElementById("copy-error-toast")?.remove();

  const toast = document.createElement("div");
  toast.id = "copy-error-toast";
  toast.className = "copy-error-toast";
  toast.setAttribute("role", "alert");
  toast.textContent = copyGuidance;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 6000);
}

/**
 * legacyCopy performs a clipboard write via a hidden, off-screen element and
 * document.execCommand("copy"). It uses a contentEditable span with a Range
 * selection — the textarea variant silently no-ops on iOS Safari, which the
 * span dance avoids. Returns false if the command is unavailable or reports
 * failure.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;

  const span = document.createElement("span");
  span.textContent = text;
  // Preserve whitespace/newlines and keep the node out of layout and a11y.
  span.style.whiteSpace = "pre";
  span.style.position = "fixed";
  span.style.top = "-9999px";
  span.style.left = "-9999px";
  span.setAttribute("aria-hidden", "true");

  document.body.appendChild(span);
  const selection = window.getSelection();
  const previous =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const range = document.createRange();
  range.selectNodeContents(span);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let ok: boolean;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  selection?.removeAllRanges();
  if (previous) selection?.addRange(previous);
  document.body.removeChild(span);

  return ok;
}
