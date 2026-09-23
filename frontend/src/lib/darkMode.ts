/**
 * Light or dark, which is the `dark` class on `<html>` and nothing else.
 *
 * This file exists because the preference had two writers. The settings menu
 * owned a `useState` copy and wrote storage; Shift+D in `useKeyboardShortcuts`
 * wrote the class and the storage and told nobody, so the menu's own state went
 * stale in the tab the reader was looking at — the Light button still lit after
 * the page had gone dark. Both writers now come through `chooseColorMode`, and
 * there is one thing that can be read to learn the mode.
 *
 * Light/dark stays a separate switch from the color theme (`lib/colorTheme.ts`):
 * a theme supplies both halves of a palette and this decides which half applies.
 */

import {
  readPreference,
  subscribePreference,
  writePreference,
} from "./preferences";

export type ColorMode = "light" | "dark";

const COLOR_MODE_KEY = "vantage:theme";

/**
 * Anything but the exact string `"dark"` is light, nothing stored included:
 * light is the app's default, and a value this code does not recognize is no
 * reason to invert the page.
 */
function parseColorMode(raw: string | null): ColorMode {
  return raw === "dark" ? "dark" : "light";
}

/**
 * The mode in effect, read back off the element that carries it.
 *
 * No module variable shadows this. The class on `<html>` is what every
 * stylesheet in the app keys off, so a cached copy beside it would be a second
 * truth able to disagree with the page — which is the bug this file was written
 * to end, in its smaller form.
 */
export function colorMode(): ColorMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(mode: ColorMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

/** Everything in this tab that is showing the mode, so it can be told. */
const watchers = new Set<() => void>();

// Copied before iterating, because a watcher is free to unsubscribe from inside
// its own callback — React does exactly that when a component unmounts during a
// commit this notification triggered.
function announce(): void {
  for (const notify of [...watchers]) notify();
}

/**
 * The reader chose `mode` in this tab: apply it, remember it, and tell this tab.
 *
 * Telling this tab is the half that used to be missing, and it cannot be left to
 * the `storage` event: the browser does not raise one in the window that wrote,
 * so a writer that only wrote left every other reader in its own tab stale.
 */
export function chooseColorMode(mode: ColorMode): void {
  apply(mode);
  writePreference(COLOR_MODE_KEY, mode);
  announce();
}

/** Shift+D, which has no opinion about which mode it wants, only that it flips. */
export function toggleColorMode(): void {
  chooseColorMode(colorMode() === "dark" ? "light" : "dark");
}

/**
 * The `subscribe` half of a `useSyncExternalStore` pair whose snapshot is
 * `colorMode`. A component that renders the mode this way cannot show a stale
 * one: there is no local copy to go stale, and it is told whether the change
 * came from its own click, from Shift+D, or from another tab.
 */
export function subscribeColorMode(notify: () => void): () => void {
  watchers.add(notify);
  return () => {
    watchers.delete(notify);
  };
}

// Applied at module load, before React renders, because the first paint has to
// already be in the reader's mode: a page that mounts light and goes dark in an
// effect is a white flash on every single load. This is the same bargain
// `initColorTheme` makes by running from `main.tsx` before `createRoot`.
apply(parseColorMode(readPreference(COLOR_MODE_KEY)));

// Another tab's switch, adopted without storing it again: that tab already did,
// and re-storing what we were just handed is how a pair of tabs would talk each
// other in circles if `storage` events ever did echo to their own window. Never
// unsubscribed, because the mode is a property of the document and outlives
// every component that shows it.
subscribePreference(COLOR_MODE_KEY, (raw) => {
  apply(parseColorMode(raw));
  announce();
});
