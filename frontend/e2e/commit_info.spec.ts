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

    // The commit button carries the styled tooltip the app shows instead of a
    // native title, and keeps the message/date/action sentence available.
    const commitButton = page.locator(".hdr-commit");
    await expect(commitButton).toBeVisible({ timeout: 10_000 });
    await expect(commitButton).toContainText(COMMIT_MESSAGE);
    await expect(commitButton).not.toHaveAttribute("title");
    const tipText = await commitButton.getAttribute("data-tip");
    expect(tipText).toContain(`${COMMIT_MESSAGE}\n`);
    expect(tipText).toContain("click to view diff");
    await commitButton.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(COMMIT_MESSAGE);
    await expect(tooltip).toContainText("click to view diff");

    // Opening it renders the diff viewer, headed with the same message.
    await commitButton.click();
    await expect(
      page.getByRole("heading", { name: "Commit Diff" }),
    ).toBeVisible();
    await expect(page.getByLabel("Close diff viewer")).toBeVisible();
  });
});
