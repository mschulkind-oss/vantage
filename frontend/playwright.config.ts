import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
 *
 * **Made by the runner alone, and removed when it exits.** Every Playwright
 * process loads this file: the runner, and each worker again. Only the runner
 * starts the servers, so only the runner needs the directory, and a worker is
 * recognized by the `TEST_WORKER_INDEX` Playwright gives it before it loads
 * this file. Created at module load with no such check, a run with 16 workers
 * (the default on a 32-core machine) left 17 directories in the temp directory
 * and removed none. The servers the runner started are stopped before it
 * exits, so nothing is using the directory by then. The backend binary is
 * built here under the runner's original Go environment before the server gets
 * this isolated app home; `go run` would put its module cache under that home.
 */
const runHome =
  process.env.TEST_WORKER_INDEX === undefined
    ? mkdtempSync(join(tmpdir(), "vantage-e2e-home-"))
    : "";
const backendBinary = runHome ? join(runHome, "vantage") : "";
if (runHome) {
  process.on("exit", () => rmSync(runHome, { recursive: true, force: true }));
  const built = spawnSync(
    "go",
    ["build", "-o", backendBinary, "./cmd/vantage"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
    },
  );
  if (built.error || built.status !== 0) {
    const error = built.error?.message ?? "none";
    const status = built.status ?? "null";
    const signal = built.signal ?? "none";
    throw new Error(
      `go build for E2E backend failed (error: ${error}; status: ${status}; signal: ${signal})\nstderr: ${built.stderr || "(empty)"}`,
    );
  }
}

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
    command: `cd .. && TARGET_REPO=frontend/e2e/fixtures/test_repo "${backendBinary}" serve --port 8101 --no-open & VITE_API_TARGET=http://localhost:8101 VITE_WS_TARGET=ws://localhost:8101 npm run dev -- --port 5201`,
    // Readiness must mean BOTH servers: Vite and the Go backend behind its
    // /api proxy. The backend binary is built before Playwright applies the
    // isolated app HOME below, so the shared Go module cache stays warm; the
    // health check still waits for the backend to be ready before tests start.
    url: "http://localhost:5201/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    // The server process gets only an isolated app home. Its binary is built
    // above before this environment is applied, so Go keeps the runner's
    // standard GOCACHE, GOMODCACHE, and GOENV choices.
    env: {
      HOME: runHome,
      USERPROFILE: runHome,
      XDG_CONFIG_HOME: join(runHome, ".config"),
    },
  },
});
