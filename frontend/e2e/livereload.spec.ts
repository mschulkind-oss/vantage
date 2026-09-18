import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Live reload", () => {
  // These tests edit the same fixture files, so they run one at a time:
  // under fullyParallel, one test's edit is another test's spurious reload.
  test.describe.configure({ mode: "serial" });

  const testRepoPath = path.join(__dirname, "fixtures/test_repo");
  const page1Path = path.join(testRepoPath, "page1.md");
  const page2Path = path.join(testRepoPath, "page2.md");
  let originalPage1: string;
  let originalPage2: string;

  test.beforeEach(() => {
    // Save original content; every test restores what it touched, so a
    // local run never leaves the tree dirty.
    originalPage1 = fs.readFileSync(page1Path, "utf-8");
    originalPage2 = fs.readFileSync(page2Path, "utf-8");
  });

  test.afterEach(() => {
    fs.writeFileSync(page1Path, originalPage1);
    fs.writeFileSync(page2Path, originalPage2);
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
    const newContent = originalPage1.replace("Page 1", "Page 1 UPDATED");
    fs.writeFileSync(page1Path, newContent);

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
      // Tree rows are real links (anchors), not divs.
      .locator("a.flex.items-center.cursor-pointer")
      .filter({ hasText: "subdir" });
    await expect(subdirRow).toBeVisible();

    // Expand subdir
    const arrow = subdirRow.locator("span").first();
    await arrow.click();

    // Verify it is expanded (we see the nested README inside)
    // There are 2 READMEs now
    await expect(sidebar.getByText("README.md")).toHaveCount(2);

    // Now modify a file to trigger live reload
    const newContent = originalPage1.replace("Page 1", "Page 1 UPDATED");
    fs.writeFileSync(page1Path, newContent);

    // Wait for a reasonable amount of time for the WS message to be
    // processed, then check the side effect the test exists for: the tree
    // refreshed without losing its expansion state.
    await page.waitForTimeout(2000);

    // Verify we STILL have 2 READMEs (meaning subdir is still expanded AND
    // populated)
    await expect(sidebar.getByText("README.md")).toHaveCount(2);
  });

  test("an edit to a different document does not disturb the open one", async ({
    page,
  }) => {
    const marker = `e2e-live-reload-other-${Date.now()}`;
    await page.goto("/page1.md");
    await expect(page.getByText("Link to Page 2")).toBeVisible();

    const bodyBefore = await page
      .locator("[data-content-scroll]")
      .innerText();

    fs.writeFileSync(page2Path, `# Page 2\n\n${marker}\n`);

    // Give any spurious reload or refetch time to land, then assert nothing
    // did: same text, and the other file's marker never appears here.
    await page.waitForTimeout(2500);
    const bodyAfter = await page
      .locator("[data-content-scroll]")
      .innerText();
    expect(bodyAfter).toBe(bodyBefore);
    await expect(page.getByText(marker)).toHaveCount(0);
  });
});
