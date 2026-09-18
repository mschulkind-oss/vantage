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
      .locator("a.flex.items-center.cursor-pointer")
      .filter({ hasText: "subdir" });
    await expect(subdirRow).toBeVisible({ timeout: 10000 });

    // The nested README is counted by its own href, not by text: other
    // things in the sidebar legitimately show the same text (a recents
    // row, the hover-portal clone of a filename), so text counts are not
    // the tree's state. Collapsed, the nested link is not in the DOM.
    const nestedReadme = sidebar.locator('a.cursor-pointer[href="/subdir/README.md"]');
    await expect(nestedReadme).toHaveCount(0);

    // Click the arrow to expand (clicking row no longer expands)
    const arrow = subdirRow.locator("span").first();
    await arrow.click();

    // After expanding, the nested README is reachable by its own link.
    await expect(nestedReadme).toBeVisible({ timeout: 10000 });
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
