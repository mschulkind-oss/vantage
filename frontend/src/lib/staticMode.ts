/**
 * Static mode detection and API URL rewriting for Vantage.
 *
 * When the app is built with `vantage build`, the static builder injects
 * `window.__VANTAGE_STATIC__ = true` into index.html. This module detects
 * that flag and installs an axios interceptor that rewrites API requests
 * to point at pre-generated JSON files.
 *
 * URL rewriting rules:
 *   /api/repos           → /api/repos.json
 *   /api/info            → /api/info.json
 *   /api/files           → /api/files.json
 *   /api/health          → /api/health.json
 *   /api/tree?path=X     → /api/tree/X.json  (root "." → /api/tree/_.json)
 *   /api/content?path=X  → /api/content/X.json
 *   /api/git/history?path=X      → /api/git/history/X.json
 *   /api/git/status?path=X       → /api/git/status/X.json
 *   /api/git/recent?limit=N      → /api/git/recent.json
 *   /api/git/diff?path=X&commit=Y → /api/git/diff/X/Y.json
 *
 * An export also runs under HashRouter rather than BrowserRouter (`main.tsx`),
 * so its route is the URL's fragment, and a heading's fragment rides after it:
 * `#/guides/setup.md#install`. The rest of this module is that URL scheme's
 * frontend side — the hrefs the app hands out (`routeHref`, `fragmentHref`)
 * and the bare fragments it is handed (`routeForBareFragment`).
 */

import axios, { AxiosError, type AxiosResponse } from "axios";
import { createPath, resolvePath } from "react-router-dom";

declare global {
  interface Window {
    __VANTAGE_STATIC__?: boolean;
  }
}

/** Whether the app is running in static (no-backend) mode. */
export const isStaticMode = (): boolean => {
  return !!window.__VANTAGE_STATIC__;
};

/**
 * Parse query parameters from a URL string.
 */
function parseParams(url: string): { base: string; params: URLSearchParams } {
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return { base: url, params: new URLSearchParams() };
  return {
    base: url.substring(0, qIdx),
    params: new URLSearchParams(url.substring(qIdx + 1)),
  };
}

/**
 * Rewrite a live API URL to a static JSON file path.
 * Returns relative paths (./api/...) so the site works from any directory.
 */
function rewriteUrl(url: string): string {
  const { base, params } = parseParams(url);

  // Strip any /api/r/{repo} prefix (static mode is always single-repo)
  const apiPath = base.replace(/^\/api\/r\/[^/]+/, "/api");

  // Helper: convert /api/foo to ./api/foo
  const rel = (path: string): string => `.${path}`;

  // Simple endpoints without query params
  const simpleEndpoints = [
    "/api/repos",
    "/api/info",
    "/api/files",
    "/api/health",
  ];
  if (simpleEndpoints.includes(apiPath)) {
    return rel(`${apiPath}.json`);
  }

  // Tree endpoint
  if (apiPath === "/api/tree") {
    const path = params.get("path") || ".";
    const treePath = path === "." ? "_" : path;
    return rel(`/api/tree/${treePath}.json`);
  }

  // Content endpoint
  if (apiPath === "/api/content") {
    const path = params.get("path") || "";
    return rel(`/api/content/${path}.json`);
  }

  // Git history
  if (apiPath === "/api/git/history") {
    const path = params.get("path") || "";
    return rel(`/api/git/history/${path}.json`);
  }

  // Git status
  if (apiPath === "/api/git/status") {
    const path = params.get("path") || "";
    return rel(`/api/git/status/${path}.json`);
  }

  // Git recent
  if (apiPath === "/api/git/recent") {
    return rel("/api/git/recent.json");
  }

  // Git diff
  if (apiPath === "/api/git/diff") {
    const path = params.get("path") || "";
    const commit = params.get("commit") || "";
    return rel(`/api/git/diff/${path}/${commit}.json`);
  }

  // Fallback: just append .json
  return rel(`${apiPath}.json`);
}

/**
 * Whether a static host answered with a page where an API file was asked for.
 *
 * That is how many hosts answer for a file they do not have. Cloudflare's
 * `not_found_handling = "single-page-application"` sends index.html with a
 * 200, so the request succeeds and its "JSON" is a string of HTML — which the
 * directory view then tried to `.map`, unmounting the whole app and leaving a
 * blank page for any route that names no document. Every file an export
 * writes under `api/` holds an object, an array or `null`, never a string, so
 * a string body is never one of them. A host that answers with a 404
 * (GitHub Pages and S3 serve the export's 404.html) fails the request already.
 */
export function isHostFallback(
  response: Pick<AxiosResponse, "data" | "headers">,
): boolean {
  const type = String(
    (response.headers as Record<string, unknown> | undefined)?.[
      "content-type"
    ] ?? "",
  );
  return type.includes("text/html") || typeof response.data === "string";
}

/**
 * The `href` that reaches the app route `route` (`/guides/setup.md#install`).
 *
 * Live, the app runs under BrowserRouter, where a route is the URL's path, so a
 * route is its own href. In an export it is the URL's fragment, so the href is
 * `#` and the route — what HashRouter itself writes for `navigate(route)` (the
 * builder strips any `<base>`, the one thing that would change that). Its `.`
 * and `..` segments are collapsed here, as `navigate` collapses them: a browser
 * does that to a path but never to a fragment, so `#/guides/../setup.md`,
 * opened in a new tab, named a route no document has.
 *
 * Every in-app link's `href` goes through here. A click on one is caught and
 * routed either way, but "Copy link", a middle-click and "Open in new tab"
 * read the attribute: a path-style one sent the reader to a path the host has
 * no file at, which it answers with a 404, or with the export's index.html —
 * the route lost, and any fragment left over as a bare one.
 */
export function routeHref(route: string): string {
  return isStaticMode() ? `#${createPath(resolvePath(route))}` : route;
}

/**
 * The `href` of the element `id` on the page at the route `route`.
 *
 * Live, that is `#id`, which the browser resolves against the page's own path.
 * In an export the page's route is itself in the fragment, so a bare `#id`
 * replaces it, and the link leaves the document for the export's front page
 * (the root folder's listing, its README beneath).
 * https://docs.yolo-jail.mschulkind.dev/#other-ways-to-get-nix, reported as a
 * blank page, is one: it names a heading of that site's getting-started.md and
 * no longer says so. Here the fragment rides after the route instead:
 * `#/getting-started.md#other-ways-to-get-nix`.
 */
export function fragmentHref(route: string, id: string): string {
  return isStaticMode() ? routeHref(`${route}#${id}`) : `#${id}`;
}

/**
 * The route-qualified form of an export's `location.hash`, or `null` when it
 * is already a route (or empty).
 *
 * A hash that does not start with `/` is not a route but a bare fragment — what
 * a heading anchor is on github.com/owner/repo#section, where it names a
 * section of the README on the repository's front page, and what this app's
 * own heading links wrote until they named their document. An export's front
 * page shows its root README beneath the listing just the same, so a bare
 * fragment becomes that fragment on the root route: `#install` → `#/#install`.
 * Left as it was, HashRouter read it as the route `/install`.
 */
export function routeForBareFragment(hash: string): string | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment === "" || fragment.startsWith("/")) return null;
  return `#/#${fragment}`;
}

/**
 * Rewrite a bare-fragment URL to its route-qualified form (see
 * `routeForBareFragment`): now, before the router first reads the URL, and on
 * every history step after — a fragment typed into the address bar arrives as
 * a `popstate`. This listener is added before HashRouter mounts, so it runs
 * before the router's own and the router reads the rewritten URL. Returns what
 * stops it; the app never does.
 */
export function followBareFragments(): () => void {
  if (!isStaticMode()) return () => {};
  const qualify = () => {
    const route = routeForBareFragment(window.location.hash);
    if (route !== null) {
      window.history.replaceState(window.history.state, "", route);
    }
  };
  qualify();
  window.addEventListener("popstate", qualify);
  return () => window.removeEventListener("popstate", qualify);
}

/**
 * Install the static-mode axios interceptors.
 * Should be called once at app startup.
 */
export function initStaticMode(): void {
  if (!isStaticMode()) return;

  console.log("[Vantage] Running in static mode — no backend required");

  axios.interceptors.request.use((config) => {
    const url = config.url || "";

    // Only rewrite /api/* requests
    if (url.startsWith("/api/") || url.startsWith("/api?")) {
      config.url = rewriteUrl(url);
      // Force GET method (no POST/PUT/DELETE in static mode)
      config.method = "get";
    }

    return config;
  });

  // A page where an API file was asked for is the host saying it has no such
  // file (see `isHostFallback`), so it fails like the 404 it stands for.
  axios.interceptors.response.use((response) => {
    const url = response.config.url ?? "";
    if (!url.startsWith("./api/") || !isHostFallback(response)) return response;
    return Promise.reject(
      new AxiosError(
        `Not found: ${url}`,
        AxiosError.ERR_BAD_REQUEST,
        response.config,
        response.request,
        { ...response, status: 404, statusText: "Not Found" },
      ),
    );
  });
}
