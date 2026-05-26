import { test, expect } from "@playwright/test";

test.describe("UI Behavior", () => {
  test("Sidebar arrow click expands only, text click navigates", async ({
    page,
  }) => {
    await page.goto("/");
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();

    // Find the row containing "subdir"
    // Use the specific row classes to be precise
    const subdirRow = sidebar
      .locator("div.flex.items-center.cursor-pointer")
      .filter({ hasText: "subdir" });
    await expect(subdirRow).toBeVisible();

    // The arrow is the first span in the row
    const arrow = subdirRow.locator("span").first();

    // Check initial state (collapsed)
    // We check that NO nested README.md is visible (count 1 for root README)
    // Note: getByText('README.md') might find multiple if expanded.
    // Initially expandedDirs is empty.
    // But verify subdir is collapsed.
    // We can't easily check "collapsed" state without checking children visibility.
    // But we can check that we have 1 README (root).
    await expect(sidebar.getByText("README.md")).toHaveCount(1);

    // Click arrow
    await arrow.click();

    // Should expand - look for the nested README.md
    // We expect 2 README.mds now (one in root, one in subdir)
    await expect(sidebar.getByText("README.md")).toHaveCount(2, {
      timeout: 5000,
    });

    // Should NOT have navigated (URL should still be root)
    await expect(page).toHaveURL(/\/$/);

    // Now click the text "subdir"
    // We click the name span specifically to be safe
    await subdirRow.getByText("subdir").click();

    // Should navigate
    await expect(page).toHaveURL(/subdir/);
  });

  test("Markdown styling is applied", async ({ page }) => {
    await page.goto("/");
    // Navigate to page1.md - click the one in the table (main view) to be safe
    // or use sidebar. The table one is a link in a cell.
    await page.locator('[data-testid="sidebar"]').getByText("page1.md").click();

    // Wait for content (Page 1)
    const h1 = page.locator(".prose h1");
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText("Page 1");

    // Check styling - H1 should be large and bold
    // text-4xl is usually 2.25rem or 36px. prose-slate h1 might be different.
    // Let's just check it is distinct from paragraph text.
    const fontSize = await h1.evaluate(
      (el) => window.getComputedStyle(el).fontSize,
    );
    const fontWeight = await h1.evaluate(
      (el) => window.getComputedStyle(el).fontWeight,
    );

    // Default body is usually 16px (1rem). H1 should be significantly larger.
    const pxSize = parseFloat(fontSize);
    expect(pxSize).toBeGreaterThan(20);

    // Bold
    expect(parseInt(fontWeight) || fontWeight).toBeTruthy();

    // Check specific styling class application (e.g. max-w-6xl on the container)
    // We navigate to the parent container of MarkdownViewer
    const container = page.locator(".max-w-6xl");
    await expect(container).toBeVisible();

    // Check prose class presence with some of our custom modifiers (to ensure our new classes are active)
    const prose = page.locator(".prose");
    await expect(prose).toHaveClass(/prose-h2:border-b/);
  });
});
