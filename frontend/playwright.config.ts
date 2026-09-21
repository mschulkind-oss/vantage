import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * A home directory of this run's own, for the real `vantage serve` below.
 *
 * The backend writes user-level state outside the repository — the review store,
 * and now the bookmark store — resolved from `$HOME` (and `%USERPROFILE%` on
 * Windows, which is what `os.UserHomeDir` reads there). Without this, the first
 * e2e run that stars anything writes a bookmark file into the developer's own
 * home and leaves it there.
 *
 * `XDG_CONFIG_HOME` is pinned too, because `config.UserFilePath` reads it
 * straight from the environment: a developer who exports it would otherwise keep
 * their real config directory in play while `$HOME` looked isolated.
 */
const runHome = mkdtempSync(join(tmpdir(), "vantage-e2e-home-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5201", // Different port than dev
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "cd .. && TARGET_REPO=frontend/e2e/fixtures/test_repo go run ./cmd/vantage serve --port 8101 --no-open & VITE_API_TARGET=http://localhost:8101 VITE_WS_TARGET=ws://localhost:8101 npm run dev -- --port 5201",
    // Readiness must mean BOTH servers: the dev server that serves this URL
    // and the Go backend behind its /api proxy. Vite boots in a second; a
    // cold `go run` takes tens, and a vite-only readiness URL let the suite
    // start against a refused backend — reliably, in CI, where the module
    // cache starts empty.
    url: "http://localhost:5201/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    // Applies to the shell that runs both halves of the command above, so the
    // Go backend inherits it. See `runHome`.
    env: {
      HOME: runHome,
      USERPROFILE: runHome,
      XDG_CONFIG_HOME: join(runHome, ".config"),
    },
  },
});
