import { test, expect } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A server of a describe block's own, over a fixture no other spec reads, for
// a spec whose documents must not reach test_repo's planning lists: every
// question in test_repo is counted by planning_page.spec.ts. The page's API
// requests, the scan worker's included, go to it; the live-reload socket is
// answered here and never opened, so test_repo's server sends it nothing.
//
// The same arrangement as planning_roadmaps.spec.ts, which predates this
// helper and keeps its own copy.

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");

/** A port nothing is listening on, as the kernel hands one out. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Serve `fixture` to every test of the enclosing describe block, which must
 * run its tests in one worker (`mode: "serial"`): one server, started once.
 */
export function serveFixture(fixture: string): void {
  let server: ChildProcess | null = null;
  let home = "";
  let backend = "";

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    // Its own home, as playwright.config.ts gives the suite's server, so the
    // review store it writes goes nowhere the developer keeps anything.
    home = mkdtempSync(path.join(tmpdir(), "vantage-e2e-own-"));
    const binary = path.join(home, "vantage");
    // Built and run as a binary rather than with `go run`, so stopping it
    // stops the server itself and not only the go command in front of it.
    const built = spawnSync("go", ["build", "-o", binary, "./cmd/vantage"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (built.status !== 0) throw new Error(`go build: ${built.stderr}`);
    const port = await freePort();
    backend = `http://127.0.0.1:${port}`;
    server = spawn(
      binary,
      ["serve", fixture, "--port", String(port), "--no-open"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: path.join(home, ".config"),
          VANTAGE_NO_TIPS: "1",
        },
        stdio: "ignore",
      },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${backend}/api/health`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 60_000 },
      )
      .toBe(200);
  });

  test.afterAll(() => {
    server?.kill();
    server = null;
    if (home) rmSync(home, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: `${backend}${url.pathname}${url.search}`,
        });
        await route.fulfill({ response });
      },
    );
    await page.routeWebSocket(/\/api\/ws$/, () => {});
  });

  // An API request still in flight when a test ends would otherwise fail it
  // from inside the route handler: closing the page disposes the response the
  // handler fetched, and its fulfill throws "Fetch response has been disposed".
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
}
