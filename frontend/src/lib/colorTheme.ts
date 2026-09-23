/**
 * Colour themes: which one the reader chose, and putting its stylesheet in the
 * page.
 *
 * A colour theme is a stylesheet that sets CSS variables on `:root` (light) and
 * `:root.dark` (dark). Tailwind compiles every colour utility to
 * `var(--color-<family>-<step>)` and declares the defaults in `@layer theme`,
 * so an unlayered sheet redefining those variables recolours every component
 * without touching one. Only the active theme's sheet is ever in the page, and
 * the default look has none at all — which is what keeps it pixel-identical to
 * the app before themes existed.
 *
 * Light/dark stays a separate switch (`.dark` on `<html>`, owned by
 * `lib/darkMode.ts`); a theme supplies both halves and the mode picks one.
 *
 * Two kinds of theme share one id space, and both reach the page the same way —
 * as a `<link>` to a stylesheet, so there is one code path to reason about:
 *
 * - **Built-ins** are assets of this bundle, imported `?url`. They were
 *   `?inline` until their CSS — 23 KB of source, 16 KB of the entry chunk —
 *   was being downloaded and parsed by every reader, including one who never
 *   leaves the default look, with each new theme adding to it.
 * - **User themes** are `*.css` files in the reader's themes directory, served
 *   by `/api/themes/{id}`. A user theme with a built-in's id replaces it, which
 *   is how a reader tweaks Catppuccin: copy it into the directory and edit.
 *
 * Nothing flashes, and nothing has to be synchronous for that. `initColorTheme`
 * runs from `main.tsx` before `createRoot().render()`, and `applyColorTheme`
 * appends the `<link>` before it returns — so a stored theme's sheet is pending
 * in `<head>` before the first paint, and a pending stylesheet in `<head>` is
 * one the browser will not paint without. That is what inlining the built-ins
 * bought, and it did not need a `<style>` element to buy it.
 *
 * The `data-vantage-theme` attribute on `<html>` names the active theme, and it
 * is set only once the theme's variables are live. Mermaid watches it to redraw
 * diagrams, and a diagram drawn from half-loaded variables would be cached in
 * the wrong colours — so a theme's `<link>` loads beside the old theme and the
 * swap happens in its `load` handler, never before.
 */

import axios from "axios";
import {
  COLOR_THEME_ATTRIBUTE,
  COLOR_THEME_SOURCE_ATTRIBUTE,
} from "vantage-md";
import catppuccinUrl from "../themes/catppuccin.css?url";
import gruvboxUrl from "../themes/gruvbox.css?url";
import lilaUrl from "../themes/lila.css?url";
import nordUrl from "../themes/nord.css?url";
import solarizedUrl from "../themes/solarized.css?url";
import tokyoNightUrl from "../themes/tokyo-night.css?url";
import {
  clearPreference,
  readPreference,
  subscribePreference,
  writePreference,
} from "./preferences";
import { isStaticMode } from "./staticMode";
import type { ThemeList } from "../types";

// The attribute names are vantage-md's, not ours: its mermaid code reads them
// to key and redraw diagrams, so there is one copy and it lives there.
export { COLOR_THEME_ATTRIBUTE };

/** The id of the built-in look: no stylesheet and no attribute. */
export const DEFAULT_COLOR_THEME = "default";

/** Where the reader's choice is remembered, per browser. */
export const COLOR_THEME_STORAGE_KEY = "vantage:colorTheme";

/** The one element in `<head>` that carries the active theme's stylesheet. */
export const COLOR_THEME_ELEMENT_ID = "vantage-color-theme";

export interface ColorTheme {
  id: string;
  name: string;
  source: "built-in" | "user";
  /**
   * Whether the sheet has a dark half at all. A theme that declares only
   * `:root` fails invisibly rather than loudly — that rule applies in both
   * modes, so dark mode renders the light palette on a light page — which is
   * why the picker says so. A theme nobody has described yet counts as having
   * one: the flag only decides a label, and a guess is not worth printing.
   */
  hasDark: boolean;
}

/**
 * Where each built-in's stylesheet is served from. `?url` gives the hashed
 * asset path Vite emits for it, so the CSS travels as a file the browser
 * fetches and caches on its own rather than as text in the entry chunk.
 * (Vitest stubs a CSS import to `""`, `?url` included, which no test minds:
 * they check that a link points at this import rather than at the API route,
 * not what the URL says.)
 */
const BUILT_IN_HREF: Record<string, string> = {
  catppuccin: catppuccinUrl,
  gruvbox: gruvboxUrl,
  lila: lilaUrl,
  nord: nordUrl,
  solarized: solarizedUrl,
  "tokyo-night": tokyoNightUrl,
};

/**
 * The palettes the project maintains: the app's own look first, because it is
 * what "no theme" means, then the rest alphabetically — the picker shows this
 * order and a list of palettes has no better one.
 *
 * Every sheet here declares `:root.dark`, which is what `hasDark` claims;
 * `colorThemeCss.test.ts` reads the files to keep that true rather than merely
 * once having been, and holds each to the readability floor.
 */
const BUILT_INS: readonly ColorTheme[] = [
  {
    id: DEFAULT_COLOR_THEME,
    name: "Slate",
    source: "built-in",
    hasDark: true,
  },
  { id: "catppuccin", name: "Catppuccin", source: "built-in", hasDark: true },
  { id: "gruvbox", name: "Gruvbox", source: "built-in", hasDark: true },
  { id: "lila", name: "Lila", source: "built-in", hasDark: true },
  { id: "nord", name: "Nord", source: "built-in", hasDark: true },
  { id: "solarized", name: "Solarized", source: "built-in", hasDark: true },
  { id: "tokyo-night", name: "Tokyo Night", source: "built-in", hasDark: true },
];

export function builtInColorThemes(): ColorTheme[] {
  return BUILT_INS.map((t) => ({ ...t }));
}

function findBuiltIn(id: string): ColorTheme | undefined {
  return builtInColorThemes().find((t) => t.id === id);
}

function userTheme(id: string, name = id, hasDark = true): ColorTheme {
  return { id, name, source: "user", hasDark };
}

// Through `lib/preferences`, which is where the throwing cases live — Safari
// private windows, a sandboxed iframe, site data blocked — because a colour
// preference is never worth a broken page.
function readStored(): string | null {
  return readPreference(COLOR_THEME_STORAGE_KEY);
}

function writeStored(id: string): void {
  writePreference(COLOR_THEME_STORAGE_KEY, id);
}

function clearStored(): void {
  clearPreference(COLOR_THEME_STORAGE_KEY);
}

/** The theme in effect right now, `"default"` when none is. */
export function activeColorThemeId(): string {
  return (
    document.documentElement.getAttribute(COLOR_THEME_ATTRIBUTE) ||
    DEFAULT_COLOR_THEME
  );
}

/**
 * A theme's `<link>` that has not loaded yet, and how to tell its caller it was
 * abandoned. There is at most one: a newer choice discards it.
 */
let pending: { link: HTMLLinkElement; settle: (ok: boolean) => void } | null =
  null;

function discardPending(): void {
  if (!pending) return;
  const { link, settle } = pending;
  pending = null;
  link.remove();
  settle(false);
}

/** Make `el` the managed element, replacing the old one, at the end of <head>. */
function install(el: HTMLElement | null, theme: ColorTheme): void {
  document.getElementById(COLOR_THEME_ELEMENT_ID)?.remove();
  const root = document.documentElement;
  if (!el) {
    root.removeAttribute(COLOR_THEME_ATTRIBUTE);
    root.removeAttribute(COLOR_THEME_SOURCE_ATTRIBUTE);
    return;
  }
  el.id = COLOR_THEME_ELEMENT_ID;
  // Appended last so it follows the app's stylesheet: a theme's `:root` rule
  // ties with anything else unlayered on `:root`, and source order breaks it.
  // A loaded <link> already last is left alone: moving one re-fetches it.
  if (el !== document.head.lastElementChild) document.head.appendChild(el);
  // The source goes first: a user theme replacing the same-id built-in changes
  // only the source, and mermaid's palette key must already say so when the
  // id is set.
  root.setAttribute(COLOR_THEME_SOURCE_ATTRIBUTE, theme.source);
  root.setAttribute(COLOR_THEME_ATTRIBUTE, theme.id);
}

/**
 * The stylesheet `theme` is served from: an asset of this bundle for a built-in,
 * the themes route for one of the reader's files.
 */
function themeHref(theme: ColorTheme): string {
  return theme.source === "built-in"
    ? BUILT_IN_HREF[theme.id]
    : `/api/themes/${encodeURIComponent(theme.id)}`;
}

/**
 * Put `theme` in the page. Resolves `true` once it is in effect, or `false` if
 * it never will be: its stylesheet failed to load, or a later call replaced it
 * first. Either way the previous theme stays whole until a new one is live.
 */
export function applyColorTheme(theme: ColorTheme): Promise<boolean> {
  discardPending();

  if (theme.id === DEFAULT_COLOR_THEME) {
    install(null, theme);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = themeHref(theme);
    const current = { link, settle: resolve };
    link.onload = () => {
      if (pending !== current) return;
      pending = null;
      install(link, theme);
      resolve(true);
    };
    link.onerror = () => {
      if (pending !== current) return;
      pending = null;
      link.remove();
      console.warn(`[Vantage] colour theme "${theme.id}" failed to load`);
      resolve(false);
    };
    pending = current;
    document.head.appendChild(link);
  });
}

/**
 * The server's user themes and configured default, or `null` when there is no
 * server to ask (static mode) or it could not be reached. A static export has
 * no /api/themes, and the axios interceptor would only turn the request into a
 * 404 for `themes.json`.
 */
async function fetchThemeList(): Promise<ThemeList | null> {
  if (isStaticMode()) return null;
  try {
    const { data } = await axios.get<ThemeList>("/api/themes");
    return data;
  } catch {
    return null;
  }
}

/**
 * Built-ins merged with the server's list. A user theme takes a built-in's
 * place when it shares its id, keeping the built-in's name: the server can only
 * name a theme by its file stem, and a reader who copied `catppuccin.css` to
 * tweak it still thinks of it as Catppuccin. One named `default` is dropped,
 * because that id means "no theme" and a stylesheet cannot be that.
 *
 * `has_dark` comes over with each theme rather than being read off the sheet
 * here: the server has the file open already, and this side would have to fetch
 * and parse the CSS of a theme the reader has not even picked.
 */
function mergeThemes(list: ThemeList | null): ColorTheme[] {
  const themes = builtInColorThemes();
  for (const info of list?.themes ?? []) {
    if (info.id === DEFAULT_COLOR_THEME) continue;
    const i = themes.findIndex((b) => b.id === info.id);
    if (i >= 0) themes[i] = userTheme(info.id, themes[i].name, info.has_dark);
    else themes.push(userTheme(info.id, info.name, info.has_dark));
  }
  return themes;
}

/** Every theme the reader can pick: built-ins only when there is no server. */
export async function listColorThemes(): Promise<ColorTheme[]> {
  return mergeThemes(await fetchThemeList());
}

/**
 * Counts the reader's choices, so the startup sequence can tell that one was
 * made while it waited on the server and must not be overridden.
 */
let choices = 0;

/**
 * The reader picked `theme` in the settings menu: apply it and remember it.
 * The default look is stored too, as an explicit `"default"`, so a default
 * configured in config.toml does not override a reader who chose none. A user
 * theme that fails to load is not stored, so the next page load does not try
 * it again.
 */
export async function chooseColorTheme(theme: ColorTheme): Promise<boolean> {
  choices++;
  const ok = await applyColorTheme(theme);
  if (ok) writeStored(theme.id);
  return ok;
}

/**
 * The theme the repository being read offers, or `""` when it offers none.
 *
 * The repo is taken from the URL's first path segment rather than from the repo
 * store, because the store is filled by `/api/repos` and waiting on a second
 * request would put the first paint behind it — the one thing startup must not
 * do. The lookup cannot pick the wrong key: in single-repo mode the only key is
 * `""` (the sentinel the bookmarks API already uses), so a first segment like
 * `docs` matches nothing and falls through to it, and in daemon mode the keys
 * are repo names and `""` is absent.
 *
 * The honest cost of reading the URL: in daemon mode a route whose first segment
 * is not a repo — the repo picker at `/`, or any future top-level page — gets no
 * repo default. It is a default, so the reader sees the next one down rather
 * than something broken.
 */
function repoOfferedTheme(list: ThemeList): string {
  const [repo = ""] = location.pathname.split("/").filter(Boolean);
  return list.repo_defaults[repo] ?? list.repo_defaults[""] ?? "";
}

/**
 * Apply the theme this page should open with, highest precedence first: the
 * choice stored in this browser, the reader's configured default, then the
 * theme this repository offers. A stored theme's stylesheet is requested before
 * the first await, so the first paint waits on it rather than arriving unthemed.
 */
export async function initColorTheme(): Promise<void> {
  let stored = readStored();
  const storedBuiltIn = stored ? findBuiltIn(stored) : undefined;
  // Not awaited, because what the first paint needs is the <link> in <head>,
  // which is done by the time this call returns; the rest of this function has
  // nothing left to decide for a stored built-in that no user file replaces.
  if (storedBuiltIn) void applyColorTheme(storedBuiltIn);

  if (isStaticMode()) return;
  // An id no built-in claims can only be a user theme, and trying it needs no
  // list: the <link> either loads or reports an error.
  if (stored && !storedBuiltIn) {
    const before = choices;
    if (await applyColorTheme(userTheme(stored))) return;
    // A reader's choice made while it loaded superseded it, and stands.
    if (choices !== before) return;
    // The file is gone — deleted, renamed, or on a server with no themes
    // directory. Kept, the dead id outranked the configured default forever
    // and re-requested a 404 on every page load; forgotten, the page falls
    // through to the configured default as if nothing had been chosen.
    clearStored();
    stored = null;
  }
  if (stored === DEFAULT_COLOR_THEME) return;

  const before = choices;
  const list = await fetchThemeList();
  if (!list || choices !== before) return;

  const themes = mergeThemes(list);
  // `default: ""` is how the server says the reader configured none, so the
  // repository's offer is what a falsy one falls through to.
  const wanted = stored ?? (list.default || repoOfferedTheme(list));
  const theme = themes.find((t) => t.id === wanted);
  // A stored built-in is already applied; only a user theme replacing it needs
  // the switch. Neither the configured default nor the repository's is stored:
  // they are somebody else's choice, and the file that holds them can change.
  if (!theme || (stored && theme.source === "built-in")) return;
  await applyColorTheme(theme);
}

/**
 * Follow the colour theme the reader picks in another tab, for the life of this
 * one. Returns its unsubscribe, which `main.tsx` never calls — the preference
 * outlives every component — but a test does.
 *
 * A storage event has to *apply* the theme, not merely record its id: the choice
 * is a stylesheet in `<head>`, so a tab that only remembered the new id would go
 * on rendering the old palette while claiming the new one. It goes through
 * `applyColorTheme` for both kinds of theme, which is what keeps the `<link>`
 * swap, the `pending` bookkeeping and the `data-vantage-theme` timing identical
 * to a local pick — a user theme still waits for its sheet to load before
 * mermaid is told the palette changed.
 *
 * It does not store what it adopts: `applyColorTheme`, never
 * `chooseColorTheme`. The id is already stored, by the tab the reader actually
 * clicked in, and writing it back here would put every tab's read on the other
 * tabs' write path.
 *
 * It does count as a choice, because it is one — the reader made it, next door.
 * `initColorTheme` may still be waiting on a slow `/api/themes`, and `choices`
 * is how it knows a pick was made while it waited and must not be overridden.
 * Without the increment, a theme chosen in another tab during this tab's startup
 * would be replaced by the configured default a moment later.
 */
export function followColorTheme(): () => void {
  return subscribePreference(COLOR_THEME_STORAGE_KEY, (raw) => {
    // A removed key means the reader is back on the app's own look, which is
    // also what `initColorTheme` does with a stored id whose file has gone.
    const id = raw ?? DEFAULT_COLOR_THEME;
    // Already in effect: re-applying would discard a sheet still loading and
    // re-fetch one the browser has, for no visible change.
    if (id === activeColorThemeId()) return;
    choices++;
    // An id no built-in claims can only be one of the reader's files, and
    // trying it needs no list — the `<link>` either loads or reports an error,
    // and an error leaves the theme already in the page untouched.
    void applyColorTheme(findBuiltIn(id) ?? userTheme(id));
  });
}
