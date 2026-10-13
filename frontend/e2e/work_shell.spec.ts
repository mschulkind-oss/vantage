import { test, expect } from "@playwright/test";

test.describe("Work in the shared shell", () => {
  test("reaches Decisions and returns to Work without changing g p", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/.vantage/work");
    await expect(
      page.getByRole("heading", { level: 1, name: "Work" }),
    ).toBeVisible();
    const pageNav = page.getByRole("navigation", {
      name: "Work and Decisions pages",
    });
    await expect(pageNav.getByRole("link", { name: "Work" })).toBeVisible();
    await expect(
      pageNav.getByRole("link", { name: "Decisions" }),
    ).toBeVisible();

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Decisions" }),
    ).toBeVisible();
    await page
      .locator(".viewer-header")
      .getByRole("link", { name: "Work" })
      .click();
    await expect(page).toHaveURL(/\/\.vantage\/work$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Work" }),
    ).toBeVisible();
  });

  test("stacks cards on a narrow viewport and keeps document links keyboard-operable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/.vantage/work");
    const first = page.locator("[data-work-document]").first();
    await expect(first).toBeVisible();
    const cards = page.locator("[data-work-document]");
    const firstBox = await first.boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThan(2);
    await expect
      .poll(() =>
        page
          .locator("[data-content-scroll]")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      )
      .toBe(true);
    const documentLink = first.locator("a").first();
    await documentLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\.md$/);
  });

  test("keeps encoded multi-repository routes and document links encoded", async ({
    page,
  }) => {
    const repo = "team #1";
    const repoSegment = encodeURIComponent(repo);
    await page.route("**/api/repos", (route) =>
      route.fulfill({ json: [{ name: repo, last_activity: null }] }),
    );
    await page.route(
      (url) => url.pathname.startsWith(`/api/r/${repoSegment}/`),
      async (route) => {
        const url = new URL(route.request().url());
        const apiPath = url.pathname.replace(`/api/r/${repoSegment}`, "/api");
        const response = await route.fetch({
          url: `http://localhost:8101${apiPath}${url.search}`,
        });
        await route.fulfill({ response });
      },
    );
    await page.routeWebSocket(/\/api\/r\/team%20%231\/ws$/, () => {});

    await page.goto(`/.vantage/work/${repoSegment}`);
    await expect(page).toHaveURL(new RegExp(`\\.vantage/work/${repoSegment}$`));
    const documentLink = page
      .locator("[data-work-document]")
      .first()
      .getByRole("link")
      .first();
    await expect(documentLink).toHaveAttribute(
      "href",
      `/${repoSegment}/plans/design.md`,
    );
  });

  test("keeps a static export's missing planning index unavailable", async ({
    page,
  }) => {
    const historyRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/git/planning-snapshots")) {
        historyRequests.push(request.url());
      }
    });
    await page.addInitScript(() => {
      Object.assign(window, { __VANTAGE_STATIC__: true });
    });

    await page.goto("/#/.vantage/work");
    await expect(
      page.getByRole("heading", { name: "Planning index unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByText(/static export, which has no planning index/),
    ).toBeVisible();
    expect(historyRequests).toEqual([]);
  });
});
