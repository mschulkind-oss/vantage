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
 * SettingsDropdown); a theme supplies both halves and the mode picks one.
 *
 * Two kinds of theme share one id space:
 *
 * - **Built-ins** ship in this bundle and apply synchronously, so a stored
 *   built-in is in the page before React renders and there is no flash.
 * - **User themes** are `*.css` files in the reader's themes directory, served
 *   by `/api/themes/{id}`. A user theme with a built-in's id replaces it, which
 *   is how a reader tweaks Catppuccin: copy it into the directory and edit.
 *
 * The `data-vantage-theme` attribute on `<html>` names the active theme, and it
 * is set only once the theme's variables are live. Mermaid watches it to redraw
 * diagrams, and a diagram drawn from half-loaded variables would be cached in
 * the wrong colours — so a user theme's `<link>` loads beside the old theme and
 * the swap happens in its `load` handler, never before.
 */

import axios from "axios";
import {
  COLOR_THEME_ATTRIBUTE,
  COLOR_THEME_SOURCE_ATTRIBUTE,
} from "vantage-md";
import catppuccinCss from "../themes/catppuccin.css?inline";
import lilaCss from "../themes/lila.css?inline";
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
}

/**
 * The built-in themes' CSS, by id. `?inline` makes Vite hand over the compiled
 * text instead of injecting it, because the sheet must be in the page only
 * while its theme is active. (Vitest stubs it to `""`, which no test minds:
 * they check where the sheet goes, not what it says.)
 */
const BUILT_IN_CSS: Record<string, string> = {
  catppuccin: catppuccinCss,
  lila: lilaCss,
};

const BUILT_INS: readonly ColorTheme[] = [
  { id: DEFAULT_COLOR_THEME, name: "Vantage", source: "built-in" },
  { id: "catppuccin", name: "Catppuccin", source: "built-in" },
  { id: "lila", name: "Lila", source: "built-in" },
];

export function builtInColorThemes(): ColorTheme[] {
  return BUILT_INS.map((t) => ({ ...t }));
}

function findBuiltIn(id: string): ColorTheme | undefined {
  return builtInColorThemes().find((t) => t.id === id);
}

function userTheme(id: string, name = id): ColorTheme {
  return { id, name, source: "user" };
}

// Storage can throw outright — Safari private windows, a sandboxed iframe, or
// site data blocked — and a colour preference is never worth a broken page.
function readStored(): string | null {
  try {
    return localStorage.getItem(COLOR_THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string): void {
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

function clearStored(): void {
  try {
    localStorage.removeItem(COLOR_THEME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** The theme in effect right now, `"default"` when none is. */
export function activeColorThemeId(): string {
  return (
    document.documentElement.getAttribute(COLOR_THEME_ATTRIBUTE) ||
    DEFAULT_COLOR_THEME
  );
}

/**
 * A user theme's `<link>` that has not loaded yet, and how to tell its caller
 * it was abandoned. There is at most one: a newer choice discards it.
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

  if (theme.source === "built-in") {
    const style = document.createElement("style");
    style.textContent = BUILT_IN_CSS[theme.id] ?? "";
    install(style, theme);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `/api/themes/${encodeURIComponent(theme.id)}`;
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
 */
function mergeThemes(list: ThemeList | null): ColorTheme[] {
  const themes = builtInColorThemes();
  for (const info of list?.themes ?? []) {
    if (info.id === DEFAULT_COLOR_THEME) continue;
    const i = themes.findIndex((b) => b.id === info.id);
    if (i >= 0) themes[i] = userTheme(info.id, themes[i].name);
    else themes.push(userTheme(info.id, info.name));
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
 * Apply the theme this page should open with. The stored choice wins; with
 * none, the server's configured default applies. A stored built-in goes in
 * synchronously, before the first await, so the first paint is already themed.
 */
export async function initColorTheme(): Promise<void> {
  let stored = readStored();
  const storedBuiltIn = stored ? findBuiltIn(stored) : undefined;
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
  const wanted = stored ?? list.default;
  const theme = themes.find((t) => t.id === wanted);
  // A stored built-in is already applied; only a user theme replacing it needs
  // the switch. The configured default is applied but not stored: it is the
  // server's choice, and the reader's config can still change it.
  if (!theme || (stored && theme.source === "built-in")) return;
  await applyColorTheme(theme);
}
