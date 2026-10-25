import { expect, test } from "@playwright/test";

const evidence = {
  command: "git --no-optional-locks ls-files --others -- '*.md'",
  elapsedMs: 30001,
  timeoutMs: 30000,
  gitignored: true,
  timedOut: true,
};

const diagnostic = {
  method: "filesystem_directory_entries_and_readdir_time",
  partial: true,
  reason: "Entry budget reached; unvisited directories are unknown.",
  elapsedMs: 150,
  entries: 100,
  directories: [
    {
      path: "generated",
      elapsedMs: 120,
      entries: 90,
      examples: ["generated/example.md", `generated/${"x".repeat(200)}.md`],
    },
  ],
  comparison: {
    status: "unknown",
    elapsedMs: 0,
    entries: 0,
    reason: "Comparison time budget exhausted.",
  },
  recommendations: [
    {
      path: "generated",
      reason:
        "Inspect these documents before excluding this observed high-work directory.",
      examples: ["generated/example.md", `generated/${"x".repeat(200)}.md`],
    },
  ],
};

test("timeout link opens evidence only; deliberate diagnosis renders honest partial results", async ({
  page,
}, testInfo) => {
  let posts = 0;
  await page.route("**/api/degraded", (route) =>
    route.fulfill({
      json: [
        {
          repo: "",
          kind: "walk_timeout",
          message:
            "Recent files may be missing untracked documents: finding them took longer than walk_timeout (30s).",
        },
      ],
    }),
  );
  await page.route("**/api/git/scan-analysis", (route) => {
    const isPost = route.request().method() === "POST";
    if (isPost) posts += 1;
    return route.fulfill({
      json: { evidence, diagnostic: isPost ? diagnostic : null },
    });
  });
  await page.goto("/page1.md");
  const link = page.getByRole("link", { name: "Analyze recent-file scan" });
  await expect(link).toHaveAttribute("href", "/.vantage/scan-analysis");
  await link.click();
  await expect(page).toHaveURL(/\/\.vantage\/scan-analysis$/);
  await expect(
    page.getByRole("heading", { name: "Recent-file scan analysis" }),
  ).toBeVisible();
  await expect(page.getByText(evidence.command, { exact: true })).toBeVisible();
  expect(posts).toBe(0);
  await page
    .getByRole("button", { name: "Run bounded diagnostic", exact: true })
    .click();
  await expect(
    page.getByText("Diagnostic results", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Partial result/)).toBeVisible();
  await expect(
    page.getByText(
      "Unknown — comparison could not be completed. Run the diagnostic again to retry it.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/generated\/example\.md/).first()).toBeVisible();
  expect(posts).toBe(1);
  await page.screenshot({
    path: testInfo.outputPath("scan-analysis-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("navigation", {
      name: "Overview and Questions pages",
      exact: true,
    }),
  ).not.toBeInViewport();
  await page.locator("[data-content-scroll]").evaluate((pane) => {
    pane.scrollTop = 0;
  });
  await expect(
    page.getByRole("heading", { name: "Recent-file scan analysis" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>("[data-content-scroll]");
      return (
        document.documentElement.scrollWidth <= window.innerWidth &&
        (!pane || pane.scrollWidth <= pane.clientWidth)
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("scan-analysis-phone.png"),
    fullPage: true,
  });
  await page
    .getByText("Diagnostic results", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("scan-analysis-phone-results.png"),
    fullPage: true,
  });
});

test("encoded multi-project deep link requests only that project's evidence", async ({
  page,
}) => {
  const repo = "notes@work + %#";
  const segment = encodeURIComponent(repo);
  const analysisRequests: string[] = [];
  const automaticScanRequests: string[] = [];
  await page.route("**/api/repos", (route) =>
    route.fulfill({ json: [{ name: "alpha" }, { name: repo }] }),
  );
  await page.route("**/api/degraded", (route) =>
    route.fulfill({
      json: [
        { repo: "alpha", kind: "walk_timeout", message: "Alpha timed out." },
        { repo, kind: "walk_timeout", message: "Notes timed out." },
      ],
    }),
  );
  await page.route("**/api/r/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      pathname.endsWith("/git/recent") ||
      pathname.endsWith("/tree") ||
      pathname.endsWith("/planning/sources")
    )
      automaticScanRequests.push(pathname);
    if (pathname.endsWith("/git/scan-analysis")) {
      analysisRequests.push(pathname);
      return route.fulfill({ json: { evidence, diagnostic: null } });
    }
    if (pathname.endsWith("/tree")) return route.fulfill({ json: [] });
    if (pathname.endsWith("/info"))
      return route.fulfill({ json: { name: repo } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/.vantage/scan-analysis/${segment}`);
  await expect(
    page.getByRole("heading", { name: "Recent-file scan analysis" }),
  ).toBeVisible();
  await expect(
    page.getByText(`Project: ${repo}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(evidence.command, { exact: true })).toBeVisible();
  // Vite's development StrictMode replays the opening GET effect. Both
  // requests must remain cheap, evidence-only and explicitly project-scoped.
  expect(analysisRequests).toEqual([
    `/api/r/${segment}/git/scan-analysis`,
    `/api/r/${segment}/git/scan-analysis`,
  ]);
  expect(automaticScanRequests).toEqual([]);
  const banner = page.getByRole("status", {
    name: "Project too big to serve fully",
  });
  await expect(banner).toContainText("Notes timed out.");
  await expect(banner).not.toContainText("Alpha timed out.");
  await expect(
    banner.getByRole("link", { name: "Analyze recent-file scan" }),
  ).toHaveAttribute("href", `/.vantage/scan-analysis/${segment}`);
});

test("opening single-project analysis does not start tree or recent-file scans", async ({
  page,
}) => {
  const automaticScanRequests: string[] = [];
  await page.route("**/api/degraded", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/tree?**", (route) => {
    automaticScanRequests.push(route.request().url());
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/git/recent?**", (route) => {
    automaticScanRequests.push(route.request().url());
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/planning/sources**", (route) => {
    automaticScanRequests.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/git/scan-analysis", (route) =>
    route.fulfill({ json: { evidence: null, diagnostic: null } }),
  );
  await page.goto("/.vantage/scan-analysis");
  await expect(
    page.getByRole("heading", { name: "Recent-file scan analysis" }),
  ).toBeVisible();
  await expect(
    page.getByText(/No past scan evidence is available/),
  ).toBeVisible();
  expect(automaticScanRequests).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Run bounded diagnostic", exact: true }),
  ).toBeEnabled();
});

test("real bounded diagnostic completes through the served project API", async ({
  page,
}) => {
  const automatic: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.endsWith("/tree") ||
      pathname.endsWith("/git/recent") ||
      pathname.endsWith("/planning/sources")
    )
      automatic.push(pathname);
  });
  await page.goto("/.vantage/scan-analysis");
  await expect(
    page.getByRole("heading", { name: "Recent-file scan analysis" }),
  ).toBeVisible();
  const result = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/git/scan-analysis" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run bounded diagnostic", exact: true })
    .click();
  const response = await result;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.diagnostic.method).toBe(
    "filesystem_directory_entries_and_readdir_time",
  );
  expect(body.diagnostic.partial).toBe(false);
  expect(body.diagnostic.comparison.status).toBe("completed");
  expect(
    body.diagnostic.directories.some(
      (directory: { path: string }) => directory.path === ".",
    ),
  ).toBe(true);
  await expect(
    page.getByText("Diagnostic results", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Complete within diagnostic bound/),
  ).toBeVisible();
  await expect(
    page.getByText(/^Completed: .*Markdown pathspec matches$/),
  ).toBeVisible();
  expect(automatic).toEqual([]);
});
