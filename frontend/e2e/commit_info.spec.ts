import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The fixture cannot ship as a git repository (a nested .git cannot be
// committed), so this spec builds one at run time and takes it apart after.
// The commit bar and diff viewer are what it exercises: the message of the
// latest commit for the open file, and the diff that opens from it.
const testRepoPath = path.join(__dirname, "fixtures/test_repo");
const COMMIT_MESSAGE = "e2e: commit info fixture";

test.describe("Commit Info", () => {
  test.beforeAll(() => {
    const git = (args: string) =>
      execSync(`git -C ${JSON.stringify(testRepoPath)} ${args}`, {
        stdio: "pipe",
      });
    git("init -q");
    git("config user.email e2e@vantage.local");
    git("config user.name Vantage e2e");
    git("add page1.md");
    git(`commit -qm ${JSON.stringify(COMMIT_MESSAGE)}`);
  });

  test.afterAll(() => {
    execSync(`rm -rf ${JSON.stringify(path.join(testRepoPath, ".git"))}`);
  });

  test("displays the latest commit and opens its diff", async ({ page }) => {
    await page.goto("/page1.md");
    await expect(page.getByRole("heading", { name: "Page 1" })).toBeVisible();

    // The commit bar names the commit this spec made. Its title is
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
