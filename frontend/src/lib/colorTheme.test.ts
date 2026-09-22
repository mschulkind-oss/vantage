import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import {
  COLOR_THEME_ELEMENT_ID,
  COLOR_THEME_STORAGE_KEY,
  DEFAULT_COLOR_THEME,
  activeColorThemeId,
  applyColorTheme,
  builtInColorThemes,
  chooseColorTheme,
  initColorTheme,
  listColorThemes,
  type ColorTheme,
} from "./colorTheme";
import type { ThemeList } from "../types";
import catppuccinUrl from "../themes/catppuccin.css?url";
import lilaUrl from "../themes/lila.css?url";
import { currentMermaidPalette } from "../../../packages/vantage-md/src/mermaidTheme";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

const ATTR = "data-vantage-theme";
const root = document.documentElement;

const managed = () => document.getElementById(COLOR_THEME_ELEMENT_ID);
const links = () =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>("link"));

const builtIn = (id: string): ColorTheme =>
  builtInColorThemes().find((t) => t.id === id)!;
const user = (id: string, name = id, hasDark = true): ColorTheme => ({
  id,
  name,
  source: "user",
  hasDark,
});

/** The parts of a response a test does not care about, filled in. */
function serve(list: Partial<ThemeList> = {}) {
  mockedAxios.get.mockResolvedValue({
    data: { default: "", repo_defaults: {}, themes: [], ...list },
  });
}

/** The newest `<link>` in `<head>` — the one a theme just appended. */
const lastLink = () => links()[links().length - 1];

/** Wait for a theme's `<link>` to appear, then fire `type` on it. */
async function settleLink(type: "load" | "error", href?: string) {
  await vi.waitFor(() => {
    const l = lastLink();
    expect(l).toBeDefined();
    if (href) expect(l.getAttribute("href")).toBe(href);
  });
  lastLink().dispatchEvent(new Event(type));
}

/**
 * Apply `theme` and let its stylesheet load, which a browser does on its own and
 * jsdom never does: it fetches nothing, so the event has to be dispatched here.
 */
async function applyLoaded(theme: ColorTheme): Promise<boolean> {
  const done = applyColorTheme(theme);
  await settleLink("load");
  return done;
}

/**
 * A built-in's stylesheet is an asset of this bundle, not an API route. The
 * comparison is against the very import the module under test makes, because
 * vitest stubs a CSS import — `?url` included — to the empty string; what it
 * still catches is a built-in that goes back to being fetched from the server,
 * or inlined into a `<style>`, which has no href to compare at all.
 */
function expectBundledHref(link: HTMLLinkElement, url: string) {
  expect(link.getAttribute("href")).toBe(url);
  expect(link.getAttribute("href")).not.toContain("/api/themes/");
}

describe("colorTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    serve();
    // Single-repo mode's route, which is what `repo_defaults[""]` keys on.
    window.history.pushState({}, "", "/");
  });

  afterEach(async () => {
    // Dropping back to the default also discards a link still waiting to load,
    // so no test inherits another's pending theme.
    await applyColorTheme(builtIn(DEFAULT_COLOR_THEME));
    document.head.innerHTML = "";
    delete window.__VANTAGE_STATIC__;
    vi.restoreAllMocks();
  });

  // Mermaid redraws when its palette key changes. A user theme that replaces
  // the same-id built-in changes every colour but not the id, so if the key
  // did not change with it, diagrams drawn under the built-in would be served
  // from the cache in the built-in's colours.
  it("gives mermaid a new palette key when a user theme replaces a built-in", async () => {
    await applyLoaded(builtIn("catppuccin"));
    const builtInKey = currentMermaidPalette();
    const done = applyColorTheme(user("catppuccin"));
    await settleLink("load");
    await done;
    expect(root.getAttribute(ATTR)).toBe("catppuccin");
    expect(currentMermaidPalette()).not.toBe(builtInKey);
  });

  describe("built-ins", () => {
    it("lead with the default look, then read alphabetically", () => {
      // The order the picker shows. The default look is first because it is what
      // "no theme" means, not because of its name.
      expect(builtInColorThemes().map((t) => [t.id, t.name])).toEqual([
        ["default", "Slate"],
        ["catppuccin", "Catppuccin"],
        ["gruvbox", "Gruvbox"],
        ["lila", "Lila"],
        ["nord", "Nord"],
        ["solarized", "Solarized"],
        ["tokyo-night", "Tokyo Night"],
      ]);
    });

    it("all have a dark half", () => {
      // The claim `colorThemeCss.test.ts` checks against the files themselves.
      expect(builtInColorThemes().every((t) => t.hasDark)).toBe(true);
    });

    // Adding a palette is two edits — the stylesheet's `?url` import and the
    // entry in this list — and the roadmap has more palettes queued. Miss the
    // import and the href is the string "undefined": a 404, a console warning,
    // and a theme that is offered in the picker and can never apply. Nothing
    // else here would notice, because vitest stubs a CSS import to "" and every
    // other assertion compares against that same stub.
    it.each(
      builtInColorThemes()
        .filter((t) => t.id !== "default")
        .map((t) => [t.id] as const),
    )("%s has a stylesheet to link to", async (id) => {
      await applyLoaded(builtIn(id));
      expect(lastLink().getAttribute("href")).not.toBe("undefined");
      expect(lastLink().getAttribute("href")).not.toBeNull();
    });
  });

  describe("applyColorTheme", () => {
    it("loads a built-in from this bundle's own asset, not from the API", async () => {
      // The CSS used to be inlined into the entry chunk and injected as a
      // <style>; every reader paid for it, themed or not.
      const done = applyColorTheme(builtIn("catppuccin"));
      const link = lastLink();
      expect(link.rel).toBe("stylesheet");
      expectBundledHref(link, catppuccinUrl);

      link.dispatchEvent(new Event("load"));
      await expect(done).resolves.toBe(true);
      expect(managed()).toBe(link);
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("has a built-in's <link> in <head> before it has loaded", () => {
      // The no-flash guarantee, now that no theme applies synchronously:
      // initColorTheme runs before the first render, and a stylesheet already
      // pending in <head> is one the browser will not paint without.
      void applyColorTheme(builtIn("lila"));
      expect(links()).toHaveLength(1);
      expectBundledHref(lastLink(), lilaUrl);
      expect(managed()).toBeNull();
    });

    it("puts the theme at the end of <head>, after the app's own stylesheet", async () => {
      // Something the app's own stylesheet would be: the theme must follow it
      // so an unlayered rule of equal specificity wins on source order.
      document.head.appendChild(document.createElement("style"));
      await applyLoaded(builtIn("catppuccin"));
      expect(document.head.lastElementChild).toBe(managed());
    });

    it("the default look removes the element and the attribute", async () => {
      await applyLoaded(builtIn("catppuccin"));
      await applyColorTheme(builtIn(DEFAULT_COLOR_THEME));
      expect(managed()).toBeNull();
      expect(links()).toHaveLength(0);
      expect(root.hasAttribute(ATTR)).toBe(false);
      expect(root.hasAttribute("data-vantage-theme-source")).toBe(false);
    });

    it("keeps exactly one managed element across switches", async () => {
      await applyLoaded(builtIn("catppuccin"));
      await applyLoaded(builtIn("lila"));
      expect(links()).toHaveLength(1);
      expect(managed()).toBe(lastLink());
    });

    it("loads a user theme as a <link>, and switches only once it has loaded", async () => {
      await applyLoaded(builtIn("catppuccin"));
      const before = managed();
      const done = applyColorTheme(user("my theme"));

      const link = lastLink();
      expect(link.rel).toBe("stylesheet");
      expect(link.getAttribute("href")).toBe("/api/themes/my%20theme");
      // Until the sheet is live the previous theme stays whole: its element and
      // the attribute mermaid redraws on.
      expect(managed()).toBe(before);
      expect(root.getAttribute(ATTR)).toBe("catppuccin");

      link.dispatchEvent(new Event("load"));
      await expect(done).resolves.toBe(true);
      expect(managed()).toBe(link);
      expect(links()).toHaveLength(1);
      expect(document.head.lastElementChild).toBe(link);
      expect(root.getAttribute(ATTR)).toBe("my theme");
    });

    it("keeps the previous theme when a user theme fails to load", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await applyLoaded(builtIn("catppuccin"));
      const before = managed();
      const done = applyColorTheme(user("gone"));
      lastLink().dispatchEvent(new Event("error"));

      await expect(done).resolves.toBe(false);
      expect(links()).toHaveLength(1);
      expect(managed()).toBe(before);
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
      expect(warn).toHaveBeenCalled();
    });

    it("a newer choice supersedes a theme still loading", async () => {
      const slow = applyColorTheme(user("slow"));
      const stale = lastLink();
      await applyLoaded(builtIn("catppuccin"));

      await expect(slow).resolves.toBe(false);
      expect(stale.isConnected).toBe(false);
      // A late load event from the abandoned sheet must not switch back to it.
      stale.dispatchEvent(new Event("load"));
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });
  });

  describe("listColorThemes", () => {
    it("merges the server's user themes after the built-ins", async () => {
      serve({ themes: [{ id: "ocean", name: "ocean", has_dark: true }] });
      const themes = await listColorThemes();
      expect(themes.map((t) => [t.id, t.source])).toEqual([
        ...builtInColorThemes().map((t) => [t.id, "built-in"]),
        ["ocean", "user"],
      ]);
      expect(mockedAxios.get).toHaveBeenCalledWith("/api/themes");
    });

    it("carries each theme's dark half from the server", async () => {
      serve({
        themes: [
          { id: "ocean", name: "ocean", has_dark: true },
          { id: "daylight", name: "daylight", has_dark: false },
        ],
      });
      const themes = await listColorThemes();
      expect(themes.map((t) => [t.id, t.hasDark])).toEqual([
        ...builtInColorThemes().map((t) => [t.id, true]),
        ["ocean", true],
        ["daylight", false],
      ]);
    });

    it("lets a user theme replace the built-in with the same id", async () => {
      serve({
        themes: [{ id: "catppuccin", name: "catppuccin", has_dark: true }],
      });
      const themes = await listColorThemes();
      // The built-in's name, not the file stem the server names it by.
      expect(themes.filter((t) => t.id === "catppuccin")).toEqual([
        {
          id: "catppuccin",
          name: "Catppuccin",
          source: "user",
          hasDark: true,
        },
      ]);
    });

    it("takes a replacing user theme's dark half from the file, not the built-in", async () => {
      // The name is the built-in's, but the sheet in the page is the reader's:
      // a copy of catppuccin.css with the dark half deleted is light only.
      serve({
        themes: [{ id: "catppuccin", name: "catppuccin", has_dark: false }],
      });
      const themes = await listColorThemes();
      expect(themes.find((t) => t.id === "catppuccin")?.hasDark).toBe(false);
    });

    it("ignores a user theme named default", async () => {
      serve({ themes: [{ id: "default", name: "default", has_dark: true }] });
      const themes = await listColorThemes();
      expect(themes.filter((t) => t.id === "default")).toEqual([
        builtIn("default"),
      ]);
    });

    it("is the built-ins only when the fetch fails", async () => {
      mockedAxios.get.mockRejectedValue(new Error("network"));
      expect(await listColorThemes()).toEqual(builtInColorThemes());
    });

    it("is the built-ins only in static mode, without asking a server", async () => {
      window.__VANTAGE_STATIC__ = true;
      expect(await listColorThemes()).toEqual(builtInColorThemes());
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe("chooseColorTheme", () => {
    it("stores the choice and applies it", async () => {
      const done = chooseColorTheme(builtIn("catppuccin"));
      await settleLink("load");
      await done;
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("catppuccin");
      expect(activeColorThemeId()).toBe("catppuccin");
    });

    it("stores an explicit default", async () => {
      await chooseColorTheme(builtIn(DEFAULT_COLOR_THEME));
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("default");
      expect(activeColorThemeId()).toBe("default");
    });

    it("does not store a user theme that failed to load", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "catppuccin");
      const done = chooseColorTheme(user("gone"));
      lastLink().dispatchEvent(new Event("error"));
      await done;
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("catppuccin");
    });

    it("still applies when localStorage throws", async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const done = chooseColorTheme(builtIn("catppuccin"));
      await settleLink("load");
      await done;
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });
  });

  describe("initColorTheme", () => {
    it("requests a stored built-in's stylesheet before the server answers", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "catppuccin");
      let answer!: (v: { data: ThemeList }) => void;
      mockedAxios.get.mockReturnValue(new Promise((r) => (answer = r)));

      const done = initColorTheme();
      // No flash: the <link> is in <head> on the same tick, which is before
      // main.tsx renders, so the first paint waits on the sheet.
      expect(links()).toHaveLength(1);
      expectBundledHref(lastLink(), catppuccinUrl);

      answer({ data: { default: "", repo_defaults: {}, themes: [] } });
      await done;
      lastLink().dispatchEvent(new Event("load"));
      expect(managed()?.tagName).toBe("LINK");
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("switches a stored built-in to a user theme with the same id", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "catppuccin");
      serve({
        themes: [{ id: "catppuccin", name: "catppuccin", has_dark: true }],
      });

      const done = initColorTheme();
      await settleLink("load", "/api/themes/catppuccin");
      await done;
      expect(managed()?.tagName).toBe("LINK");
      expect(links()).toHaveLength(1);
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("tries an unknown stored id as a user theme", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "ocean");
      const done = initColorTheme();
      await settleLink("load", "/api/themes/ocean");
      await done;
      expect(root.getAttribute(ATTR)).toBe("ocean");
    });

    // A stored user theme whose file is gone used to end startup: the
    // configured default never applied, and the dead id stayed stored, so
    // every later load requested the same 404.
    it("forgets a stored user theme that no longer loads, and falls through to the configured default", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "gone");
      serve({ default: "catppuccin" });

      const done = initColorTheme();
      await settleLink("error", "/api/themes/gone");
      await settleLink("load");
      await done;
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBeNull();
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("keeps a choice made while a stored user theme was loading", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "slow");
      serve({ default: "catppuccin" });

      const done = initColorTheme();
      await vi.waitFor(() => expect(lastLink()).toBeDefined());
      await chooseColorTheme(builtIn(DEFAULT_COLOR_THEME));
      await done;
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("default");
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("lets a stored choice outrank the server default", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "catppuccin");
      serve({
        default: "ocean",
        themes: [{ id: "ocean", name: "ocean", has_dark: true }],
      });
      const done = initColorTheme();
      await settleLink("load");
      await done;
      // One <link>, the stored theme's: the server's default was never asked for.
      expect(links()).toHaveLength(1);
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("keeps an explicit default over a configured one", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "default");
      serve({ default: "catppuccin" });
      await initColorTheme();
      expect(managed()).toBeNull();
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("applies the server default when nothing is stored", async () => {
      serve({ default: "catppuccin" });
      const done = initColorTheme();
      await settleLink("load");
      await done;
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
      // The configured default is not a choice, so it is not remembered as one.
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBeNull();
    });

    it("applies a user theme as the server default", async () => {
      serve({
        default: "ocean",
        themes: [{ id: "ocean", name: "ocean", has_dark: true }],
      });
      const done = initColorTheme();
      await settleLink("load", "/api/themes/ocean");
      await done;
      expect(root.getAttribute(ATTR)).toBe("ocean");
    });

    it("stays on the default look when the server is unreachable", async () => {
      mockedAxios.get.mockRejectedValue(new Error("network"));
      await initColorTheme();
      expect(managed()).toBeNull();
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("in static mode applies a stored built-in and asks no server", async () => {
      window.__VANTAGE_STATIC__ = true;
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "catppuccin");
      const done = initColorTheme();
      // The asset is part of the export, so a built-in works with no server.
      await settleLink("load");
      await done;
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("in static mode ignores a stored user theme", async () => {
      window.__VANTAGE_STATIC__ = true;
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "ocean");
      await initColorTheme();
      expect(links()).toHaveLength(0);
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("does not override a choice made while the list was loading", async () => {
      let answer!: (v: { data: ThemeList }) => void;
      mockedAxios.get.mockReturnValue(new Promise((r) => (answer = r)));
      const done = initColorTheme();
      await chooseColorTheme(builtIn(DEFAULT_COLOR_THEME));
      answer({
        data: { default: "catppuccin", repo_defaults: {}, themes: [] },
      });
      await done;
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("falls back to the server default when localStorage throws", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      serve({ default: "catppuccin" });
      const done = initColorTheme();
      await settleLink("load");
      await done;
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    describe("a repository's offered default", () => {
      it("applies in single-repo mode, where the key is the empty sentinel", async () => {
        // The route has a path segment and no repo in it, which is exactly the
        // case the `""` key exists for.
        window.history.pushState({}, "", "/docs/design/themes.md");
        serve({ repo_defaults: { "": "catppuccin" } });
        const done = initColorTheme();
        await settleLink("load");
        await done;
        expect(root.getAttribute(ATTR)).toBe("catppuccin");
      });

      it("is not stored, so it stops applying when the repository stops offering it", async () => {
        serve({ repo_defaults: { "": "catppuccin" } });
        const done = initColorTheme();
        await settleLink("load");
        await done;
        expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBeNull();
      });

      it("is the repo named by the URL's first segment in daemon mode", async () => {
        window.history.pushState({}, "", "/beta/notes.md");
        serve({
          default: "",
          repo_defaults: { alpha: "catppuccin", beta: "lila" },
          themes: [],
        });
        const done = initColorTheme();
        await settleLink("load");
        await done;
        expect(root.getAttribute(ATTR)).toBe("lila");
      });

      it("applies a user theme the repository names", async () => {
        serve({
          repo_defaults: { "": "ocean" },
          themes: [{ id: "ocean", name: "ocean", has_dark: true }],
        });
        const done = initColorTheme();
        await settleLink("load", "/api/themes/ocean");
        await done;
        expect(root.getAttribute(ATTR)).toBe("ocean");
      });

      it("is outranked by the reader's configured default", async () => {
        serve({ default: "lila", repo_defaults: { "": "catppuccin" } });
        const done = initColorTheme();
        await settleLink("load");
        await done;
        expect(root.getAttribute(ATTR)).toBe("lila");
      });

      it("is outranked by a choice stored in this browser", async () => {
        localStorage.setItem(COLOR_THEME_STORAGE_KEY, "lila");
        serve({ repo_defaults: { "": "catppuccin" } });
        const done = initColorTheme();
        await settleLink("load");
        await done;
        expect(root.getAttribute(ATTR)).toBe("lila");
      });

      it("is outranked by an explicitly chosen default look", async () => {
        localStorage.setItem(COLOR_THEME_STORAGE_KEY, "default");
        serve({ repo_defaults: { "": "catppuccin" } });
        await initColorTheme();
        expect(links()).toHaveLength(0);
        expect(root.hasAttribute(ATTR)).toBe(false);
      });

      it("leaves the default look alone when no key matches the route", async () => {
        // The caveat of reading the URL: a daemon-mode route whose first segment
        // is not a repo — here the repo picker itself — matches nothing.
        window.history.pushState({}, "", "/");
        serve({ repo_defaults: { alpha: "catppuccin" } });
        await initColorTheme();
        expect(links()).toHaveLength(0);
        expect(root.hasAttribute(ATTR)).toBe(false);
      });
    });
  });
});
