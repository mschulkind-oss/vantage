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

  // The files this spec rewrites are its own: fixtures/test_repo/livereload/
  // is read by no other spec. It used to rewrite page1.md and page2.md, which
  // half the suite reads, so a parallel run could catch "Success!" missing
  // from page2.md or "Page 1 UPDATED" in page1.md, depending on which of these
  // tests happened to be mid-edit. Keep it that way: a file written here must
  // not be one another spec opens.
  const dir = path.join(__dirname, "fixtures/test_repo/livereload");
  const watchedPath = path.join(dir, "watched.md");
  const otherPath = path.join(dir, "other.md");
  let originalWatched: string;
  let originalOther: string;

  test.beforeEach(() => {
    // Save original content; every test restores what it touched, so a
    // local run never leaves the tree dirty.
    originalWatched = fs.readFileSync(watchedPath, "utf-8");
    originalOther = fs.readFileSync(otherPath, "utf-8");
  });

  test.afterEach(() => {
    fs.writeFileSync(watchedPath, originalWatched);
    fs.writeFileSync(otherPath, originalOther);
  });

  test("updates content when file changes on disk", async ({ page }) => {
    await page.goto("/livereload/watched.md");
    const heading = page.locator(".prose h1");
    await expect(heading).toContainText("Live reload watched", {
      timeout: 10000,
    });

    // Now modify the file on disk
    const marker = `e2e-live-reload-${Date.now()}`;
    fs.writeFileSync(
      watchedPath,
      originalWatched.replace("Live reload watched", marker),
    );

    // Wait for live reload to update the content
    await expect(heading).toContainText(marker, { timeout: 15000 });
  });

  test("maintains sidebar expansion state when live reload occurs", async ({
    page,
  }) => {
    await page.goto("/");

    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();

    // Tree rows are real links (anchors), not divs; the recents section's
    // rows carry no cursor-pointer, so these match the tree alone.
    const dirRow = sidebar.locator('a.cursor-pointer[href="/livereload"]');
    await expect(dirRow).toBeVisible();
    const watchedRow = sidebar.locator(
      'a.cursor-pointer[href="/livereload/watched.md"]',
    );
    await expect(watchedRow).toHaveCount(0);

    // Expand the directory holding the file about to change, so the refresh
    // has to refetch the very listing it must keep open.
    await dirRow.locator("span").first().click();
    await expect(watchedRow).toBeVisible();

    // The push makes the tree refetch every expanded directory. Wait for that
    // refetch rather than for a fixed time, so the check below is the tree
    // after the refresh and not before it.
    const refreshed = page.waitForResponse(
      (r) =>
        r.url().includes("/api/tree?") &&
        new URL(r.url()).searchParams.get("path") === "livereload",
    );
    fs.writeFileSync(watchedPath, `${originalWatched}\nEdited.\n`);
    await (await refreshed).finished();

    // The refetched listing is applied in one render after the response;
    // let it land, then check the expansion survived it.
    await page.waitForTimeout(500);
    await expect(watchedRow).toBeVisible();
  });

  // A push refreshes what the viewer is on. While a click is still loading,
  // that is the document clicked, not the directory it was clicked from: the
  // directory's refresh would be the newer load, win, and leave the reader on
  // the directory under the document's URL. navigation.spec and ui_behavior
  // failed that way whenever any spec wrote a fixture during their click.
  // This holds the click's response until a push has been handled, so the
  // window is certain rather than a matter of luck.
  test("a push while a click is still loading does not send the reader back", async ({
    page,
  }) => {
    await page.goto("/livereload");
    const table = page.locator("table");
    const watchedLink = table.getByRole("link", {
      name: "watched.md",
      exact: true,
    });
    await expect(watchedLink).toBeVisible();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) =>
        url.pathname === "/api/content" &&
        url.searchParams.get("path") === "livereload/watched.md",
      async (route) => {
        await held;
        await route.continue();
      },
    );

    await watchedLink.click();
    await expect(page).toHaveURL(/\/livereload\/watched\.md$/);

    // The push's batch always refetches the root of the tree, after anything
    // it reloads for the page itself, so that request means the batch ran.
    const batchRan = page.waitForRequest((r) => {
      const url = new URL(r.url());
      return (
        url.pathname === "/api/tree" &&
        url.searchParams.get("path") === "." &&
        !url.searchParams.has("include_git")
      );
    });
    fs.writeFileSync(otherPath, `${originalOther}\nEdited.\n`);
    await batchRan;
    release();

    await expect(page.locator(".prose h1")).toContainText(
      "Live reload watched",
    );
    await expect(table).toHaveCount(0);
  });

  test("an edit to a different document does not disturb the open one", async ({
    page,
  }) => {
    const marker = `e2e-live-reload-other-${Date.now()}`;
    await page.goto("/livereload/watched.md");
    await expect(page.locator(".prose h1")).toContainText(
      "Live reload watched",
    );

    const bodyBefore = await page
      .locator("[data-content-scroll]")
      .innerText();

    fs.writeFileSync(otherPath, `# Live reload other\n\n${marker}\n`);

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
