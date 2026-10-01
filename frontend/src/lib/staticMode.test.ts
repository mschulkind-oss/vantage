import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { HashRouter, useHref } from "react-router-dom";
import {
  followBareFragments,
  fragmentHref,
  isHostFallback,
  routeForBareFragment,
  routeHref,
} from "./staticMode";

// We need to test the URL rewriting logic.
// Since isStaticMode reads from window, we mock it.

describe("staticMode", () => {
  beforeEach(() => {
    // Reset module state
    vi.resetModules();
    (window as Record<string, unknown>).__VANTAGE_STATIC__ = undefined;
  });

  afterEach(() => {
    delete (window as Record<string, unknown>).__VANTAGE_STATIC__;
  });

  describe("isStaticMode", () => {
    it("returns false when flag is not set", async () => {
      const { isStaticMode } = await import("./staticMode");
      expect(isStaticMode()).toBe(false);
    });

    it("returns true when flag is set", async () => {
      (window as Record<string, unknown>).__VANTAGE_STATIC__ = true;
      const { isStaticMode } = await import("./staticMode");
      expect(isStaticMode()).toBe(true);
    });
  });

  describe("URL rewriting (via axios interceptor)", () => {
    it("should not install interceptor when not in static mode", async () => {
      const axios = await import("axios");
      const useSpy = vi.spyOn(axios.default.interceptors.request, "use");

      const { initStaticMode } = await import("./staticMode");
      initStaticMode();

      expect(useSpy).not.toHaveBeenCalled();
      useSpy.mockRestore();
    });

    it("should install interceptor when in static mode", async () => {
      (window as Record<string, unknown>).__VANTAGE_STATIC__ = true;
      const axios = await import("axios");
      const useSpy = vi.spyOn(axios.default.interceptors.request, "use");

      const { initStaticMode } = await import("./staticMode");
      initStaticMode();

      expect(useSpy).toHaveBeenCalledOnce();
      useSpy.mockRestore();
    });

    it("should rewrite API URLs to relative JSON paths", async () => {
      (window as Record<string, unknown>).__VANTAGE_STATIC__ = true;

      const axios = await import("axios");
      const useSpy = vi.spyOn(axios.default.interceptors.request, "use");
      const { initStaticMode } = await import("./staticMode");
      initStaticMode();

      // Capture the interceptor function
      const interceptorFn = useSpy.mock.calls[0]?.[0] as unknown as (config: {
        url?: string;
        method?: string;
      }) => { url?: string; method?: string };

      if (!interceptorFn) throw new Error("Interceptor not installed");

      // Test simple endpoints
      expect(interceptorFn({ url: "/api/repos" }).url).toBe("./api/repos.json");
      expect(interceptorFn({ url: "/api/info" }).url).toBe("./api/info.json");
      expect(interceptorFn({ url: "/api/files" }).url).toBe("./api/files.json");
      expect(interceptorFn({ url: "/api/health" }).url).toBe(
        "./api/health.json",
      );

      // Test tree endpoint
      expect(interceptorFn({ url: "/api/tree?path=." }).url).toBe(
        "./api/tree/_.json",
      );
      expect(interceptorFn({ url: "/api/tree?path=docs" }).url).toBe(
        "./api/tree/docs.json",
      );

      // Test content endpoint
      expect(interceptorFn({ url: "/api/content?path=README.md" }).url).toBe(
        "./api/content/README.md.json",
      );

      // Test git endpoints
      expect(
        interceptorFn({ url: "/api/git/history?path=README.md" }).url,
      ).toBe("./api/git/history/README.md.json");
      expect(interceptorFn({ url: "/api/git/recent?limit=10" }).url).toBe(
        "./api/git/recent.json",
      );
      expect(
        interceptorFn({
          url: "/api/git/diff?path=README.md&commit=abc123",
        }).url,
      ).toBe("./api/git/diff/README.md/abc123.json");

      // Test repo-scoped URLs are stripped
      expect(
        interceptorFn({ url: "/api/r/myrepo/content?path=README.md" }).url,
      ).toBe("./api/content/README.md.json");

      useSpy.mockRestore();
    });

    it("should force GET method in static mode", async () => {
      (window as Record<string, unknown>).__VANTAGE_STATIC__ = true;

      const axios = await import("axios");
      const useSpy = vi.spyOn(axios.default.interceptors.request, "use");
      const { initStaticMode } = await import("./staticMode");
      initStaticMode();

      const interceptorFn = useSpy.mock.calls[0]?.[0] as unknown as (config: {
        url?: string;
        method?: string;
      }) => { url?: string; method?: string };

      if (!interceptorFn) throw new Error("Interceptor not installed");

      const result = interceptorFn({ url: "/api/repos", method: "post" });
      expect(result.method).toBe("get");
      useSpy.mockRestore();
    });

    it("should not rewrite non-API URLs", async () => {
      (window as Record<string, unknown>).__VANTAGE_STATIC__ = true;

      const axios = await import("axios");
      const useSpy = vi.spyOn(axios.default.interceptors.request, "use");
      const { initStaticMode } = await import("./staticMode");
      initStaticMode();

      const interceptorFn = useSpy.mock.calls[0]?.[0] as unknown as (config: {
        url?: string;
        method?: string;
      }) => { url?: string; method?: string };

      if (!interceptorFn) throw new Error("Interceptor not installed");

      expect(interceptorFn({ url: "/other/path" }).url).toBe("/other/path");
      expect(interceptorFn({ url: "https://example.com" }).url).toBe(
        "https://example.com",
      );
      useSpy.mockRestore();
    });
  });
});

/**
 * The export's URL scheme (main.tsx runs it under HashRouter): the hrefs the app
 * hands out and the bare fragments it is handed. The report behind it:
 * https://docs.yolo-jail.mschulkind.dev/#other-ways-to-get-nix opened a blank
 * page — a heading's link had replaced the route with a bare fragment, and the
 * host answered the request it led to with index.html.
 */
describe("static export URLs", () => {
  const setStatic = (on: boolean) => {
    if (on) window.__VANTAGE_STATIC__ = true;
    else delete window.__VANTAGE_STATIC__;
  };
  afterEach(() => {
    setStatic(false);
    window.history.replaceState(null, "", "/");
  });

  describe("routeHref", () => {
    it("is the route itself live, where a route is the URL's path", () => {
      expect(routeHref("/guides/setup.md#install")).toBe(
        "/guides/setup.md#install",
      );
      // Left for the browser to collapse, as it does in a path: daemon mode's
      // `/repo/../other/x.md` reaches a sibling project that way.
      expect(routeHref("/guides/../x.md")).toBe("/guides/../x.md");
    });

    it("is the hash route in an export, its dot segments collapsed", () => {
      setStatic(true);
      expect(routeHref("/guides/setup.md#install")).toBe(
        "#/guides/setup.md#install",
      );
      expect(routeHref("/")).toBe("#/");
      expect(routeHref("/guides/../getting-started.md#nix")).toBe(
        "#/getting-started.md#nix",
      );
      expect(routeHref("/guides/./setup.md")).toBe("#/guides/setup.md");
    });

    it("agrees with what HashRouter writes for the same route", () => {
      setStatic(true);
      for (const route of [
        "/getting-started.md",
        "/getting-started.md#other-ways-to-get-nix",
        "/guides/../getting-started.md#nix",
        "/.vantage/planning?roadmap=a#OQ-1",
      ]) {
        const { result } = renderHook(() => useHref(route), {
          wrapper: HashRouter,
        });
        expect(routeHref(route)).toBe(result.current);
      }
    });
  });

  describe("fragmentHref", () => {
    it("is a bare fragment live, which the browser resolves against the page", () => {
      expect(fragmentHref("/getting-started.md", "other-ways-to-get-nix")).toBe(
        "#other-ways-to-get-nix",
      );
    });

    it("names the document in an export, where a bare one replaces the route", () => {
      setStatic(true);
      expect(fragmentHref("/getting-started.md", "other-ways-to-get-nix")).toBe(
        "#/getting-started.md#other-ways-to-get-nix",
      );
    });
  });

  describe("routeForBareFragment", () => {
    it("puts a bare fragment on the root route", () => {
      expect(routeForBareFragment("#other-ways-to-get-nix")).toBe(
        "#/#other-ways-to-get-nix",
      );
      expect(routeForBareFragment("#L42")).toBe("#/#L42");
    });

    it("leaves a route, and no fragment at all, alone", () => {
      expect(routeForBareFragment("#/getting-started.md")).toBeNull();
      expect(routeForBareFragment("#/getting-started.md#nix")).toBeNull();
      expect(routeForBareFragment("#/")).toBeNull();
      expect(routeForBareFragment("#")).toBeNull();
      expect(routeForBareFragment("")).toBeNull();
    });
  });

  describe("followBareFragments", () => {
    it("does nothing live, where a fragment is not a route", () => {
      window.history.replaceState(null, "", "/#other-ways-to-get-nix");
      const stop = followBareFragments();
      expect(window.location.hash).toBe("#other-ways-to-get-nix");
      stop();
    });

    it("rewrites the URL it starts on, and later ones before the router reads them", () => {
      setStatic(true);
      window.history.replaceState(null, "", "/#other-ways-to-get-nix");
      const stop = followBareFragments();
      expect(window.location.hash).toBe("#/#other-ways-to-get-nix");

      // HashRouter's listener is added when it mounts, after this one.
      const seen: string[] = [];
      const router = () => seen.push(window.location.hash);
      window.addEventListener("popstate", router);
      try {
        window.history.replaceState(null, "", "/#typed-later");
        window.dispatchEvent(new PopStateEvent("popstate"));
        expect(seen).toEqual(["#/#typed-later"]);
      } finally {
        window.removeEventListener("popstate", router);
        stop();
      }
    });
  });

  describe("isHostFallback", () => {
    const html = "<!doctype html><html><head></head></html>";

    it("is a page served where an API file was asked for", () => {
      expect(
        isHostFallback({
          data: html,
          headers: { "content-type": "text/html" },
        }),
      ).toBe(true);
      // The type is not always there (a file:// export has none), the body is.
      expect(isHostFallback({ data: html, headers: {} })).toBe(true);
    });

    it("is never one of the export's own files", () => {
      const json = { "content-type": "application/json" };
      expect(isHostFallback({ data: [], headers: json })).toBe(false);
      expect(isHostFallback({ data: { path: "a.md" }, headers: json })).toBe(
        false,
      );
      // A clean file's git status and diff are written as a literal null.
      expect(isHostFallback({ data: null, headers: json })).toBe(false);
    });
  });

  it("fails an API request a host answered with its index.html, as the 404 it is", async () => {
    setStatic(true);
    const axios = await import("axios");
    const useSpy = vi.spyOn(axios.default.interceptors.response, "use");
    const { initStaticMode } = await import("./staticMode");
    initStaticMode();
    const onResponse = useSpy.mock.calls[0]?.[0] as unknown as (
      response: unknown,
    ) => unknown;
    useSpy.mockRestore();
    if (!onResponse) throw new Error("Response interceptor not installed");

    const page = {
      config: { url: "./api/tree/other-ways-to-get-nix.json" },
      data: "<!doctype html>",
      headers: { "content-type": "text/html" },
      status: 200,
    };
    await expect(onResponse(page)).rejects.toMatchObject({
      response: { status: 404 },
    });

    const file = { ...page, data: [], headers: {} };
    expect(onResponse(file)).toBe(file);
    // Only the export's own API files are its to judge.
    const other = { ...page, config: { url: "./theme.css" } };
    expect(onResponse(other)).toBe(other);
  });
});
