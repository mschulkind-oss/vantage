import { defineConfig, devices } from "@playwright/test";

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
    url: "http://localhost:5201",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
