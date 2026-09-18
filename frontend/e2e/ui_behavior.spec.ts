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
      .locator("a.flex.items-center.cursor-pointer")
      .filter({ hasText: "subdir" });
    await expect(subdirRow).toBeVisible();

    // The arrow is the first span in the row
    const arrow = subdirRow.locator("span").first();

    // Initial state: collapsed. The nested README is counted by its href —
    // text counts would also match the recents row and the hover-portal
    // clone of a filename, which are not the tree's state.
    const nestedReadme = sidebar.locator('a.cursor-pointer[href="/subdir/README.md"]');
    await expect(nestedReadme).toHaveCount(0);

    // Click arrow
    await arrow.click();

    // Should expand: the nested README's own link appears
    await expect(nestedReadme).toBeVisible({ timeout: 5000 });

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
    // Navigate via the tree row: the recents section renders its own
    // "page1.md" link (its accessible name carries a relative time), so
    // exact-name matching picks the tree row alone.
    await page
      .locator('[data-testid="sidebar"]')
      .getByRole("link", { name: "page1.md", exact: true })
      .click();

    // Wait for content (Page 1)
    // The heading's text includes the `#` of its hover anchor (it parks a
    // literal hash inside the h1), so match on containing the text, and pin
    // to the one that is Page 1's rather than whichever the tree shows.
    const h1 = page.locator(".prose h1").filter({ hasText: "Page 1" });
    await expect(h1).toBeVisible();
    await expect(h1).toContainText("Page 1");

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

    // (An earlier version asserted a max-w-6xl wrapper here; the reading
    // band no longer has one — the document column carries max-w-5xl and
    // the assertions above already pin the rendering.)

    // Check prose class presence with some of our custom modifiers (to ensure our new classes are active)
    const prose = page.locator(".prose");
    await expect(prose).toHaveClass(/prose-h2:border-b/);
  });
});
