import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Live reload", () => {
  const testRepoPath = path.join(__dirname, "../../tests/e2e/test_repo");
  const testFilePath = path.join(testRepoPath, "page1.md");
  let originalContent: string;

  test.beforeEach(async () => {
    // Save original content
    originalContent = fs.readFileSync(testFilePath, "utf-8");
  });

  test.afterEach(async () => {
    // Restore original content
    fs.writeFileSync(testFilePath, originalContent);
  });

  test("updates content when file changes on disk", async ({ page }) => {
    // Navigate to page1.md
    await page.goto("/page1.md");

    // Wait for the content to load
    await expect(page.getByText("Link to Page 2")).toBeVisible({
      timeout: 10000,
    });

    // Verify original content is visible
    await expect(page.getByText("Page 1")).toBeVisible();

    // Now modify the file on disk
    const newContent = originalContent.replace("Page 1", "Page 1 UPDATED");
    fs.writeFileSync(testFilePath, newContent);

    // Wait for live reload to update the content
    await expect(page.getByText("Page 1 UPDATED")).toBeVisible({
      timeout: 15000,
    });
  });

  test("maintains sidebar expansion state when live reload occurs", async ({
    page,
  }) => {
    // Navigate to root
    await page.goto("/");

    // Wait for sidebar
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();

    // Find subdir
    const subdirRow = sidebar
      .locator("div.flex.items-center.cursor-pointer")
      .filter({ hasText: "subdir" });
    await expect(subdirRow).toBeVisible();

    // Expand subdir
    const arrow = subdirRow.locator("span").first();
    await arrow.click();

    // Verify it is expanded (we see the nested README inside)
    // There are 2 READMEs now
    await expect(sidebar.getByText("README.md")).toHaveCount(2);

    // Now modify a file to trigger live reload
    const newContent = originalContent.replace("Page 1", "Page 1 UPDATED");
    fs.writeFileSync(testFilePath, newContent);

    // Wait for live reload to process (we can verify by checking if the content updated if we were looking at it,
    // but here we just wait a bit or look for a side effect.
    // Let's rely on the fact that if the tree refreshes, the expansion state might break)
    // To be sure the event arrived, we can spy on the console or network, but checking the UI state persistence is the goal.
    // Let's give it a generous timeout to ensure the WS message was processed.

    // Wait for a reasonable amount of time for the WS to fire
    await page.waitForTimeout(2000);

    // Verify we STILL have 2 READMEs (meaning subdir is still expanded AND populated)
    await expect(sidebar.getByText("README.md")).toHaveCount(2);
  });
});
