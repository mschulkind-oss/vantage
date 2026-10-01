import { routeHref } from "./staticMode";

/**
 * Determines if a click event should be handled as internal SPA navigation.
 * Returns false if the user is trying to open a link in a new tab/window
 * (via Ctrl+click, Cmd+click, Shift+click, or middle mouse button).
 */
export function shouldHandleInternalNavigation(
  event: MouseEvent | React.MouseEvent,
): boolean {
  // Middle mouse button or right click should not be intercepted
  if (event.button !== 0) {
    return false;
  }

  // Modifier keys indicate user wants to open in new tab/window
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }

  return true;
}

/**
 * Whether an Enter keypress in a menu should open the highlighted row in a new
 * tab rather than navigate this one. Borrowed from Chrome's address bar, where
 * Alt+Enter opens a suggestion in a new tab; Ctrl+Enter (Cmd+Enter on macOS) is
 * accepted too, since it is what most hands reach for first.
 */
export function isNewTabEnter(
  event: KeyboardEvent | React.KeyboardEvent,
): boolean {
  return (
    event.key === "Enter" && (event.altKey || event.ctrlKey || event.metaKey)
  );
}

/**
 * Open an SPA route in a new tab, without handing it a reference to this one.
 * The route is written as the router reads it — in a static export, the hash
 * route `#/docs/a.md` rather than a path the host has no file at (`routeHref`).
 */
export function openInNewTab(route: string): void {
  window.open(routeHref(route), "_blank", "noopener");
}
