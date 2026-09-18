import { test, expect } from "@playwright/test";

// The git repository this spec serves is built by scripts/e2e-fixture.sh,
// which runs before the suite boots its servers: the server binds a repo's
// git root once at startup, so a repo created from inside a test would be
// invisible — the served directory would resolve to vantage's own history
// instead. The fixture carries one commit on page1.md, message below.
const COMMIT_MESSAGE = "e2e: commit info fixture";

test.describe("Commit Info", () => {
  test("displays the latest commit and opens its diff", async ({ page }) => {
    await page.goto("/page1.md");
    await expect(page.getByRole("heading", { name: "Page 1" })).toBeVisible();

    // The commit bar names the fixture commit. Its title is
    // "<date> — click to view diff", so match on the stable part.
    const commitButton = page.locator('button[title*="click to view diff"]');
    await expect(commitButton).toBeVisible({ timeout: 10_000 });
    await expect(commitButton).toContainText(COMMIT_MESSAGE);

    // Opening it renders the diff viewer, headed with the same message.
    await commitButton.click();
    await expect(
      page.getByRole("heading", { name: "Commit Diff" }),
    ).toBeVisible();
    await expect(page.getByLabel("Close diff viewer")).toBeVisible();
  });
});
