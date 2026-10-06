/**
 * How a page of the app shell (`components/AppShell.tsx`) tells the shell
 * what it shows, and hears back what the shell offers its header.
 *
 * The shell is a layout route around the document viewer and the planning
 * page, drawn once for both, so a page is its child rather than its parent:
 * it cannot hand the shell props. It calls {@link useShellPage} instead,
 * which publishes what the shell draws from (whether the sidebar is drawn,
 * the route, the file the recent files mark, whether the document keys do
 * anything here, whether `/` has a filter box to focus) and registers what it
 * only reads when a key is pressed (the pane the scrolling keys move, the
 * page's own shortcuts, and what `/` does).
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  type RefObject,
} from "react";

/** What a page's header needs of the shell. */
export interface ShellControls {
  /** Whether the reader has put the desktop sidebar away. */
  sidebarCollapsed: boolean;
  /** Bring the sidebar back: the phone's slide-out, or the desktop's. */
  openSidebar: () => void;
  /**
   * How much of the pane's bottom the degradation banner covers, in px, which
   * the page leaves as room below its content so the last line scrolls clear
   * of it.
   */
  bannerSpace: number;
}

/**
 * The shortcuts that act on what a page shows, which only a page can answer:
 * the viewer's diff, history and path, and Escape out of its raw view. A page
 * without them leaves them out, the keys do nothing there, and the shortcuts
 * help does not list them.
 */
export interface PageShortcuts {
  onViewDiff: () => void;
  onViewHistory: () => void;
  onCopyPath: () => void;
  /** Escape with no dialog of the shell's open. */
  onEscape: () => void;
}

/** What a page tells the shell. */
export interface ShellPage {
  /** The page's scroll container, which the scrolling shortcuts move. */
  contentRef: RefObject<HTMLDivElement | null>;
  /** Whether the sidebar is drawn: not over daemon mode's project list. */
  showSidebar: boolean;
  /**
   * The route as the reader moves through it. The phone's slide-out closes
   * when it changes, as a followed link should leave the reader looking at
   * what it opened. Two pages never use the same key.
   */
  routeKey: string;
  /** The file the page shows, which the recent files mark; `null` for none. */
  currentPath: string | null;
  shortcuts?: PageShortcuts;
  /**
   * Focus the page's filter box and select its text, for `/`: the planning
   * page's Filter box (`docs/reference/planning-index.md` §6.17, OQ-PF4). A
   * page without one leaves it out, and `/` does nothing there, not even stop
   * the browser's own use of it, such as Firefox's quick find.
   */
  onFocusFilter?: () => void;
}

/** What the shell draws from, as a page published it. */
export interface ShellShown {
  showSidebar: boolean;
  routeKey: string;
  currentPath: string | null;
  /** Whether the page wires the document keys (`d`, `h`, `y`). */
  documentKeys: boolean;
  /** Whether `/` focuses a filter box here, which the shortcuts help lists. */
  filterKey: boolean;
}

/** What the shell reads when a key is pressed, as a page registered it. */
export interface ShellRegistered {
  contentRef: RefObject<HTMLDivElement | null>;
  shortcuts: PageShortcuts | undefined;
  onFocusFilter: (() => void) | undefined;
}

export interface ShellContextValue {
  controls: ShellControls;
  /** Set what the shell draws from; a publish that changes nothing is free. */
  publish: (shown: ShellShown) => void;
  /** Set, or with `null` clear, what the shell reads on a key. */
  register: (page: ShellRegistered | null) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * Whether the focus is on nothing the reader chose: on the document itself,
 * or on the content pane the shell hands it to when a page opens, so that the
 * browser's own scrolling keys scroll the pane. A page that moves the focus
 * only when the reader has not put it somewhere asks this.
 */
export function focusIsIdle(active: Element | null): boolean {
  return (
    active === null ||
    active === document.body ||
    (active instanceof HTMLElement &&
      active.hasAttribute("data-content-scroll"))
  );
}

/**
 * Draw the calling page in the app shell: publish what it shows, register
 * its pane and shortcuts, and return what its header offers.
 *
 * Both happen in layout effects, so a page's first paint already has the
 * shell drawn for it. When the page opens with the focus on nothing, the
 * focus goes to its pane, without scrolling it, so PageDown, Space and the
 * arrow keys scroll the page as they would a document that scrolled the
 * window; the pane is focusable with `tabIndex={-1}` for this.
 */
export function useShellPage(page: ShellPage): ShellControls {
  const shell = useContext(ShellContext);
  if (shell === null) {
    throw new Error("useShellPage: a page of the app shell outside AppShell");
  }
  const { publish, register, controls } = shell;
  const {
    contentRef,
    showSidebar,
    routeKey,
    currentPath,
    shortcuts,
    onFocusFilter,
  } = page;

  useLayoutEffect(() => {
    register({ contentRef, shortcuts, onFocusFilter });
    return () => register(null);
  }, [register, contentRef, shortcuts, onFocusFilter]);

  const documentKeys = shortcuts !== undefined;
  const filterKey = onFocusFilter !== undefined;
  useLayoutEffect(() => {
    publish({ showSidebar, routeKey, currentPath, documentKeys, filterKey });
  }, [publish, showSidebar, routeKey, currentPath, documentKeys, filterKey]);

  useLayoutEffect(() => {
    if (focusIsIdle(document.activeElement)) {
      contentRef.current?.focus({ preventScroll: true });
    }
    // Once, as the page opens (its ref never changes): what the focus does
    // after that is the reader's.
  }, [contentRef]);

  return controls;
}
