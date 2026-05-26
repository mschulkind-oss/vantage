import { test, expect } from "@playwright/test";

test.describe("Sidebar file tree", () => {
  test("expands directory to show children when clicked", async ({ page }) => {
    await page.goto("/");

    // Wait for the sidebar to load
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();

    // Verify subdir is visible in the sidebar tree
    // Target the row specifically
    const subdirRow = sidebar
      .locator("div.flex.items-center.cursor-pointer")
      .filter({ hasText: "subdir" });
    await expect(subdirRow).toBeVisible({ timeout: 10000 });

    // Before clicking, there should be NO nested README.md (inside subdir)
    // The only README.md visible should be at the root level
    const allReadmes = sidebar.getByText("README.md");
    await expect(allReadmes).toHaveCount(1);

    // Click the arrow to expand (clicking row no longer expands)
    const arrow = subdirRow.locator("span").first();
    await arrow.click();

    // After expanding, we should see TWO README.md entries - one at root, one nested
    await expect(sidebar.getByText("README.md")).toHaveCount(2, {
      timeout: 10000,
    });
  });

  test("navigating via sidebar updates URL", async ({ page }) => {
    await page.goto("/");

    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();

    // Click on a markdown file in the sidebar
    const readmeInSidebar = sidebar.getByText("README.md").first();
    await expect(readmeInSidebar).toBeVisible({ timeout: 10000 });
    await readmeInSidebar.click();

    // URL should update
    await expect(page).toHaveURL(/README\.md/);
  });
});
