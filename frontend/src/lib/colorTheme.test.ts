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
const user = (id: string, name = id): ColorTheme => ({
  id,
  name,
  source: "user",
});

function serve(list: ThemeList) {
  mockedAxios.get.mockResolvedValue({ data: list });
}

/** The newest `<link>` in `<head>` — the one a user theme just appended. */
const lastLink = () => links()[links().length - 1];

/** Wait for a user theme's `<link>` to appear, then fire `type` on it. */
async function settleLink(type: "load" | "error", href?: string) {
  await vi.waitFor(() => {
    const l = lastLink();
    expect(l).toBeDefined();
    if (href) expect(l.getAttribute("href")).toBe(href);
  });
  lastLink().dispatchEvent(new Event(type));
}

describe("colorTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    serve({ default: "", themes: [] });
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
    await applyColorTheme(builtIn("catppuccin"));
    const builtInKey = currentMermaidPalette();
    const done = applyColorTheme(user("catppuccin"));
    await settleLink("load");
    await done;
    expect(root.getAttribute(ATTR)).toBe("catppuccin");
    expect(currentMermaidPalette()).not.toBe(builtInKey);
  });

  describe("built-ins", () => {
    it("are the default look, named Vantage, Catppuccin and Lila", () => {
      expect(builtInColorThemes().map((t) => [t.id, t.name])).toEqual([
        ["default", "Vantage"],
        ["catppuccin", "Catppuccin"],
        ["lila", "Lila"],
      ]);
    });
  });

  describe("applyColorTheme", () => {
    it("applies a built-in synchronously, as a <style> at the end of <head>", () => {
      // Something the app's own stylesheet would be: the theme must follow it
      // so an unlayered rule of equal specificity wins on source order.
      document.head.appendChild(document.createElement("style"));
      void applyColorTheme(builtIn("catppuccin"));
      const el = managed();
      expect(el?.tagName).toBe("STYLE");
      expect(document.head.lastElementChild).toBe(el);
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("the default look removes the element and the attribute", async () => {
      await applyColorTheme(builtIn("catppuccin"));
      await applyColorTheme(builtIn(DEFAULT_COLOR_THEME));
      expect(managed()).toBeNull();
      expect(root.hasAttribute(ATTR)).toBe(false);
      expect(root.hasAttribute("data-vantage-theme-source")).toBe(false);
    });

    it("keeps exactly one managed element across switches", async () => {
      await applyColorTheme(builtIn("catppuccin"));
      await applyColorTheme(builtIn("catppuccin"));
      expect(document.head.querySelectorAll("style").length).toBe(1);
    });

    it("loads a user theme as a <link>, and switches only once it has loaded", async () => {
      await applyColorTheme(builtIn("catppuccin"));
      const done = applyColorTheme(user("my theme"));

      const link = lastLink();
      expect(link.rel).toBe("stylesheet");
      expect(link.getAttribute("href")).toBe("/api/themes/my%20theme");
      // Until the sheet is live the previous theme stays whole: its element and
      // the attribute mermaid redraws on.
      expect(managed()?.tagName).toBe("STYLE");
      expect(root.getAttribute(ATTR)).toBe("catppuccin");

      link.dispatchEvent(new Event("load"));
      await expect(done).resolves.toBe(true);
      expect(managed()).toBe(link);
      expect(document.head.querySelectorAll("style").length).toBe(0);
      expect(document.head.lastElementChild).toBe(link);
      expect(root.getAttribute(ATTR)).toBe("my theme");
    });

    it("keeps the previous theme when a user theme fails to load", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await applyColorTheme(builtIn("catppuccin"));
      const done = applyColorTheme(user("gone"));
      lastLink().dispatchEvent(new Event("error"));

      await expect(done).resolves.toBe(false);
      expect(links()).toHaveLength(0);
      expect(managed()?.tagName).toBe("STYLE");
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
      expect(warn).toHaveBeenCalled();
    });

    it("a newer choice supersedes a user theme still loading", async () => {
      const slow = applyColorTheme(user("slow"));
      const stale = lastLink();
      await applyColorTheme(builtIn("catppuccin"));

      await expect(slow).resolves.toBe(false);
      expect(stale.isConnected).toBe(false);
      // A late load event from the abandoned sheet must not switch back to it.
      stale.dispatchEvent(new Event("load"));
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });
  });

  describe("listColorThemes", () => {
    it("merges the server's user themes after the built-ins", async () => {
      serve({ default: "", themes: [{ id: "nord", name: "nord" }] });
      const themes = await listColorThemes();
      expect(themes.map((t) => [t.id, t.source])).toEqual([
        ["default", "built-in"],
        ["catppuccin", "built-in"],
        ["lila", "built-in"],
        ["nord", "user"],
      ]);
      expect(mockedAxios.get).toHaveBeenCalledWith("/api/themes");
    });

    it("lets a user theme replace the built-in with the same id", async () => {
      serve({
        default: "",
        themes: [{ id: "catppuccin", name: "catppuccin" }],
      });
      const themes = await listColorThemes();
      // The built-in's name, not the file stem the server names it by.
      expect(themes.filter((t) => t.id === "catppuccin")).toEqual([
        { id: "catppuccin", name: "Catppuccin", source: "user" },
      ]);
    });

    it("ignores a user theme named default", async () => {
      serve({ default: "", themes: [{ id: "default", name: "default" }] });
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
      await chooseColorTheme(builtIn("catppuccin"));
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
      await chooseColorTheme(builtIn("catppuccin"));
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });
  });

  describe("initColorTheme", () => {
    it("applies a stored built-in before the server answers", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "catppuccin");
      let answer!: (v: { data: ThemeList }) => void;
      mockedAxios.get.mockReturnValue(new Promise((r) => (answer = r)));

      const done = initColorTheme();
      // No flash: the theme is in the page on the same tick.
      expect(managed()?.tagName).toBe("STYLE");
      expect(root.getAttribute(ATTR)).toBe("catppuccin");

      answer({ data: { default: "", themes: [] } });
      await done;
      expect(managed()?.tagName).toBe("STYLE");
    });

    it("switches a stored built-in to a user theme with the same id", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "catppuccin");
      serve({
        default: "",
        themes: [{ id: "catppuccin", name: "catppuccin" }],
      });

      const done = initColorTheme();
      await settleLink("load", "/api/themes/catppuccin");
      await done;
      expect(managed()?.tagName).toBe("LINK");
      expect(document.head.querySelectorAll("style").length).toBe(0);
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("tries an unknown stored id as a user theme", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "nord");
      const done = initColorTheme();
      await settleLink("load", "/api/themes/nord");
      await done;
      expect(root.getAttribute(ATTR)).toBe("nord");
    });

    // A stored user theme whose file is gone used to end startup: the
    // configured default never applied, and the dead id stayed stored, so
    // every later load requested the same 404.
    it("forgets a stored user theme that no longer loads, and falls through to the configured default", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "gone");
      serve({ default: "catppuccin", themes: [] });

      const done = initColorTheme();
      await settleLink("error", "/api/themes/gone");
      await done;
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBeNull();
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("keeps a choice made while a stored user theme was loading", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "slow");
      serve({ default: "catppuccin", themes: [] });

      const done = initColorTheme();
      await vi.waitFor(() => expect(lastLink()).toBeDefined());
      await chooseColorTheme(builtIn(DEFAULT_COLOR_THEME));
      await done;
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBe("default");
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("lets a stored choice outrank the server default", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "catppuccin");
      serve({ default: "nord", themes: [{ id: "nord", name: "nord" }] });
      await initColorTheme();
      expect(links()).toHaveLength(0);
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });

    it("keeps an explicit default over a configured one", async () => {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "default");
      serve({ default: "catppuccin", themes: [] });
      await initColorTheme();
      expect(managed()).toBeNull();
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("applies the server default when nothing is stored", async () => {
      serve({ default: "catppuccin", themes: [] });
      await initColorTheme();
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
      // The configured default is not a choice, so it is not remembered as one.
      expect(localStorage.getItem(COLOR_THEME_STORAGE_KEY)).toBeNull();
    });

    it("applies a user theme as the server default", async () => {
      serve({ default: "nord", themes: [{ id: "nord", name: "nord" }] });
      const done = initColorTheme();
      await settleLink("load", "/api/themes/nord");
      await done;
      expect(root.getAttribute(ATTR)).toBe("nord");
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
      await initColorTheme();
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("in static mode ignores a stored user theme", async () => {
      window.__VANTAGE_STATIC__ = true;
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, "nord");
      await initColorTheme();
      expect(links()).toHaveLength(0);
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("does not override a choice made while the list was loading", async () => {
      let answer!: (v: { data: ThemeList }) => void;
      mockedAxios.get.mockReturnValue(new Promise((r) => (answer = r)));
      const done = initColorTheme();
      await chooseColorTheme(builtIn(DEFAULT_COLOR_THEME));
      answer({ data: { default: "catppuccin", themes: [] } });
      await done;
      expect(root.hasAttribute(ATTR)).toBe(false);
    });

    it("falls back to the server default when localStorage throws", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      serve({ default: "catppuccin", themes: [] });
      await initColorTheme();
      expect(root.getAttribute(ATTR)).toBe("catppuccin");
    });
  });
});
