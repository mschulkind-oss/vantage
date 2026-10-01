import { test, expect, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveFixture } from "./ownServer";

// A static export — `vantage build` over fixtures/static_export — in a real
// browser. An export runs under HashRouter, so its route is the URL's
// fragment (`#/getting-started.md`), and a heading's fragment rides after it
// (`#/getting-started.md#other-ways-to-get-nix`). These tests pin the URLs the
// export hands out and the ones it is handed.
//
// The report behind them: https://docs.yolo-jail.mschulkind.dev/#other-ways-to-get-nix
// showed a blank page. A heading's own `#` link on that site's
// getting-started.md writes exactly that into the address bar, and "Copy link"
// on a link to the heading copies it: a bare fragment, which replaces the
// route. The router read it as the route `/other-ways-to-get-nix`, and the host
// answered the missing `api/tree/other-ways-to-get-nix.json` with index.html
// and a 200, which the directory view tried to `.map`.
//
// The export is built from this tree's frontend sources, not whatever bundle
// the binary embeds (`--frontend-dist`), and served the two ways a static host
// answers for a file it does not have: a plain 404 (GitHub Pages, S3), and
// index.html with a 200 — what Cloudflare's
// `not_found_handling = "single-page-application"` does, and what the reported
// site does.

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const FIXTURE = path.join(here, "fixtures/static_export");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** Serve `site`, answering a missing file with a 404 or, `spa`, with index.html. */
function serveSite(site: string, spa: boolean): Promise<Server> {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://x").pathname,
    );
    let file = path.join(site, pathname === "/" ? "index.html" : pathname);
    const found =
      file.startsWith(site) &&
      (statSync(file, { throwIfNoEntry: false })?.isFile() ?? false);
    if (!found && !spa) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    if (!found) file = path.join(site, "index.html");
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

const urlOf = (server: Server) =>
  `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/** Run a build step, failing the suite with its output when it fails. */
function run(command: string, args: string[], cwd: string): void {
  const done = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (done.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")}:\n${done.stdout}\n${done.stderr}`,
    );
  }
}

const prose = (page: Page) => page.locator("[data-content-scroll] .prose");
const NIX = "other-ways-to-get-nix";

test.describe("a static export's URLs", () => {
  test.describe.configure({ mode: "serial" });

  let work = "";
  /** Answers a missing file with a 404. */
  let plain: Server | null = null;
  /** Answers a missing file with index.html and a 200. */
  let spa: Server | null = null;
  let spaUrl = "";

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    work = mkdtempSync(path.join(tmpdir(), "vantage-e2e-static-"));
    const bundle = path.join(work, "bundle");
    const binary = path.join(work, "vantage");
    const site = path.join(work, "site");
    run(
      "npx",
      [
        "vite",
        "build",
        "--outDir",
        bundle,
        "--emptyOutDir",
        "--logLevel",
        "warn",
      ],
      path.join(ROOT, "frontend"),
    );
    run("go", ["build", "-o", binary, "./cmd/vantage"], ROOT);
    run(
      binary,
      [
        "build",
        FIXTURE,
        "-o",
        site,
        "-n",
        "fixture",
        "--frontend-dist",
        bundle,
      ],
      ROOT,
    );
    plain = await serveSite(site, false);
    spa = await serveSite(site, true);
    spaUrl = urlOf(spa);
  });

  test.afterAll(async () => {
    await Promise.all(
      [plain, spa].map(
        (server) =>
          new Promise<void>((resolve) =>
            server ? server.close(() => resolve()) : resolve(),
          ),
      ),
    );
    plain = spa = null;
    if (work) rmSync(work, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("a heading's own link names its document, so the URL it leaves reopens it", async ({
    page,
  }) => {
    await page.goto(`${spaUrl}/#/getting-started.md`);
    const heading = prose(page).locator(`h3#${NIX}`);
    await expect(heading).toBeAttached();
    const anchor = heading.locator("a.heading-anchor");
    await expect(anchor).toHaveAttribute("href", `#/getting-started.md#${NIX}`);

    await heading.scrollIntoViewIfNeeded();
    await heading.hover();
    await anchor.click();
    await expect(page).toHaveURL(`${spaUrl}/#/getting-started.md#${NIX}`);

    // The URL a reader copies out of the address bar: it opens the document
    // at that heading, where the bare `#other-ways-to-get-nix` it used to be
    // opened a blank page.
    await page.reload();
    await expect(prose(page).locator("h1")).toHaveText(/Getting Started/);
    await expect(heading).toBeInViewport();
  });

  test("an in-document link and the table of contents name the document too", async ({
    page,
  }) => {
    await page.goto(`${spaUrl}/#/getting-started.md`);
    await expect(
      prose(page).getByRole("link", { name: "Official installer" }),
    ).toHaveAttribute("href", `#/getting-started.md#${NIX}`);

    await page.getByRole("button", { name: "Show contents" }).click();
    const entry = page
      .getByTestId("table-of-contents")
      .getByRole("link", { name: "Other ways to get Nix" });
    await expect(entry).toHaveAttribute("href", `#/getting-started.md#${NIX}`);
    await entry.click();
    await expect(page).toHaveURL(`${spaUrl}/#/getting-started.md#${NIX}`);
    await expect(prose(page).locator(`h3#${NIX}`)).toBeInViewport();
  });

  test("links to other documents carry the export's own URLs", async ({
    page,
    context,
  }) => {
    await page.goto(`${spaUrl}/#/guides/setup.md`);
    const across = prose(page).getByRole("link", { name: "the Nix section" });
    await expect(across).toHaveAttribute("href", `#/getting-started.md#${NIX}`);
    // The sidebar's entries, which "Open in new tab" and "Copy link" read.
    await expect(
      page
        .getByTestId("sidebar")
        .locator(`a[href="#/getting-started.md"]`)
        .first(),
    ).toBeAttached();

    // What a middle-click opens: the document, at the heading.
    const href = await across.evaluate((a) => (a as HTMLAnchorElement).href);
    const tab = await context.newPage();
    await tab.setViewportSize({ width: 1280, height: 720 });
    await tab.goto(href);
    await expect(prose(tab).locator("h1")).toHaveText(/Getting Started/);
    await expect(prose(tab).locator(`h3#${NIX}`)).toBeInViewport();
    await tab.close();
  });

  test("a bare fragment is a heading in the README on the front page", async ({
    page,
  }) => {
    // github.com/owner/repo#section names a section of the README on the
    // repository's front page; so does a bare fragment on an export.
    await page.goto(`${spaUrl}/#landing-section`);
    await expect(page).toHaveURL(`${spaUrl}/#/#landing-section`);
    await expect(page.getByRole("cell", { name: "README.md" })).toBeVisible();
    await expect(page.locator("h2#landing-section")).toBeInViewport();

    // One that names nothing there still opens the front page.
    await page.goto(`${spaUrl}/#no-such-heading`);
    await expect(page.getByRole("cell", { name: "README.md" })).toBeVisible();
    await expect(page.locator("h1#static-export-fixture")).toBeVisible();
  });

  test("a route that matches no document shows the not-found state on either kind of host", async ({
    page,
  }) => {
    for (const server of [plain!, spa!]) {
      await page.goto(`${urlOf(server)}/#/no-such-page`);
      await expect(page.getByText("Failed to load directory")).toBeVisible();
      await page.goto(`${urlOf(server)}/#/no-such-page.md`);
      await expect(page.getByText("Failed to load file content")).toBeVisible();
      // Nothing in an export comes back by itself, so the page does not say
      // it is waiting for it to.
      await expect(page.getByText(/Waiting/)).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Go to Home" }),
      ).toBeVisible();
    }
  });
});

test.describe("the same URLs on a live server", () => {
  test.describe.configure({ mode: "serial" });
  serveFixture(FIXTURE);

  test("a fragment on the root is a heading in the README on the front page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/#landing-section");
    await expect(page.getByRole("cell", { name: "README.md" })).toBeVisible();
    await expect(page.locator("h2#landing-section")).toBeInViewport();
  });

  test("a route that matches no document shows the not-found state", async ({
    page,
  }) => {
    await page.goto("/no-such-page");
    await expect(page.getByText("Failed to load directory")).toBeVisible();
    await page.goto("/no-such-page.md");
    await expect(page.getByText("Failed to load file content")).toBeVisible();
  });
});
