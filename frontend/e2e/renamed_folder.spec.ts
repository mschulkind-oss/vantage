import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A folder renamed under the document the reader has open, and one moved out
// of the served tree. The watcher reports either as a removed directory, which
// names no file of its own: a renamed folder's files move without an event
// (internal/live/watcher.go, filesChangedMessage). So this is the viewer's
// reading of `removed_dirs`, end to end.
test.describe("A folder renamed under the reader", () => {
  // Both tests move the same folder, so they run one at a time.
  test.describe.configure({ mode: "serial" });

  // fixtures/test_repo/moving/ is this spec's own: no other spec reads it, so a
  // rename here can never land in the middle of someone else's test. Keep it
  // that way.
  const moving = path.join(__dirname, "fixtures/test_repo/moving");
  const before = path.join(moving, "before");
  const after = path.join(moving, "after");
  // Outside the served tree, and on the same filesystem, so a rename reaches it.
  const outside = path.join(__dirname, "fixtures/.moved-out-of-test-repo");

  // Every test puts the folder back, and so does the next one, in case a run
  // was stopped halfway: a local run never leaves the tree changed.
  const restore = () => {
    for (const from of [after, outside]) {
      if (fs.existsSync(from) && !fs.existsSync(before)) {
        fs.renameSync(from, before);
      }
    }
  };
  test.beforeEach(restore);
  test.afterEach(restore);
  // The review test files comments in this run's review store, under whichever
  // address the document had; none may be left for the next test or run.
  test.afterEach(async ({ request }) => {
    for (const doc of ["moving/before/book.md", "moving/after/book.md"]) {
      await request.delete(`/api/review?path=${encodeURIComponent(doc)}`);
    }
  });

  const heading = (page: Page) => page.locator(".prose h1");
  const content = (page: Page) => page.locator("[data-content-scroll]");
  const sidebar = (page: Page) => page.locator('[data-testid="sidebar"]');
  // Tree rows are links carrying cursor-pointer; the recent files' rows are
  // links without it.
  const treeRow = (page: Page, href: string) =>
    sidebar(page).locator(`a.cursor-pointer[href="${href}"]`);
  const recentRow = (page: Page, href: string) =>
    sidebar(page).locator(`a:not(.cursor-pointer)[href="${href}"]`);

  /**
   * Open `url` and wait until the page's socket has had the server's hello.
   * The document can be on screen before the socket is up, above all on a busy
   * machine, and a push sent before then never reaches the page: a mount's
   * first connection does not reload the document it finds.
   */
  const open = async (page: Page, url: string) => {
    const socketUp = new Promise<void>((resolve) => {
      page.on("websocket", (socket) => {
        if (!socket.url().endsWith("/api/ws")) return;
        socket.on("framereceived", ({ payload }) => {
          if (typeof payload === "string" && payload.includes('"hello"')) {
            resolve();
          }
        });
      });
    });
    await page.goto(url);
    await socketUp;
  };

  test("follows the open document to the folder's new name, where the reader was in it", async ({
    page,
  }) => {
    // Written now, so it is the newest file in the recent-files list. In a
    // fresh checkout it is at best the 30th newest before this, and out of the
    // 30 once earlier specs have written files; the server keeps the list it
    // last worked out for 30 seconds, which a page an earlier spec opened may
    // have left: the push for this write is what drops that list
    // (internal/live/watcher.go, flush).
    const book = path.join(before, "book.md");
    fs.writeFileSync(book, fs.readFileSync(book, "utf-8"));

    // Every layout shift in the document from here on, the way the browser
    // scores them (stable_paint.spec.ts measures the same thing).
    await page.addInitScript(() => {
      const shifts: string[] = [];
      (window as unknown as { __documentShifts: string[] }).__documentShifts =
        shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          sources: { node: Node | null }[];
        })[]) {
          for (const { node } of entry.sources) {
            const el =
              node instanceof Element ? node : (node?.parentElement ?? null);
            if (el?.closest("[data-content-scroll]")) {
              shifts.push(`${el.tagName} "${el.textContent?.slice(0, 30)}"`);
            }
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    await open(page, "/moving/before/book.md");
    await expect(heading(page)).toContainText("Moving book");
    await expect(treeRow(page, "/moving/before/book.md")).toBeVisible();
    await expect(recentRow(page, "/moving/before/book.md")).toBeVisible();

    // The reader is well into the document.
    await content(page).evaluate((el) => {
      el.scrollTop = 900;
    });
    const where = await content(page).evaluate((el) => el.scrollTop);
    expect(where).toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as unknown as { __documentShifts: string[] }).__documentShifts =
        [];
    });

    fs.renameSync(before, after);

    // The same document, under its new address, in place of the old one.
    await expect(page).toHaveURL(/\/moving\/after\/book\.md$/);
    await expect(page.getByTestId("viewer-header")).toContainText("after");
    await expect(heading(page)).toContainText("Moving book");
    await expect(page.getByText("Failed to load file content")).toHaveCount(0);

    // Where the reader was, and still there once everything has landed.
    expect(await content(page).evaluate((el) => el.scrollTop)).toBe(where);
    await page.waitForTimeout(1000);
    expect(await content(page).evaluate((el) => el.scrollTop)).toBe(where);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __documentShifts: string[] })
            .__documentShifts,
      ),
    ).toEqual([]);

    // The tree lists the folder under its new name, open on the document, and
    // the recent files name the document where it is now.
    await expect(treeRow(page, "/moving/after/book.md")).toBeVisible();
    await expect(treeRow(page, "/moving/before")).toHaveCount(0);
    await expect(recentRow(page, "/moving/after/book.md")).toBeVisible();
    await expect(recentRow(page, "/moving/before/book.md")).toHaveCount(0);

    // The old address was replaced rather than left behind it in the history.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/moving\/before\/book\.md$/);
  });

  // Reviewing the document when its folder is renamed: the comments go with
  // it, the one being written stays open, and the page does not move. The
  // comment is above where the reader is, where losing its card on the way
  // shifted the page up by its height and put the reader somewhere else.
  test("follows a document in review with its comments, the one being written, and the reader's place", async ({
    page,
  }) => {
    await open(page, "/moving/before/book.md");
    await expect(heading(page)).toContainText("Moving book");
    const header = page.getByTestId("viewer-header");
    await header.getByRole("button", { name: "Review", exact: true }).click();
    const cards = content(page).locator("[data-review-inline-comment]");
    const popover = page.getByPlaceholder("Your comment...");

    // A comment near the top, filed before the rename.
    const prose = content(page).locator(".prose");
    await prose.getByText("Paragraph 2,", { exact: false }).click();
    await popover.fill("filed before the rename");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      cards.filter({ hasText: "filed before the rename" }),
    ).toBeVisible();

    // Well past it, with a second comment half written.
    await content(page).evaluate((el) => {
      el.scrollTop = 900;
    });
    const target = prose.getByText("Paragraph 12,", { exact: false });
    await target.click();
    await popover.fill("half written");
    const where = await content(page).evaluate((el) => el.scrollTop);
    expect(where).toBeGreaterThan(0);
    const top = await target.boundingBox();

    fs.renameSync(before, after);

    await expect(page).toHaveURL(/\/moving\/after\/book\.md$/);
    await expect(page.getByTestId("viewer-header")).toContainText("after");
    await page.waitForTimeout(1000);
    await expect(popover).toHaveValue("half written");
    await expect(
      cards.filter({ hasText: "filed before the rename" }),
    ).toHaveCount(1);
    expect(await content(page).evaluate((el) => el.scrollTop)).toBe(where);
    expect((await target.boundingBox())?.y).toBe(top?.y);

    // Filed under the new address now: a fresh load there shows it.
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await expect(heading(page)).toContainText("Moving book");
    await expect(
      cards.filter({ hasText: "filed before the rename" }),
    ).toBeVisible();
  });

  test("says the document is gone when its folder leaves the tree, and shows it again when it is back", async ({
    page,
  }) => {
    await open(page, "/moving/before/book.md");
    await expect(heading(page)).toContainText("Moving book");
    await expect(treeRow(page, "/moving/before")).toBeVisible();

    // Moved out of the served tree: the push names the folder and nothing
    // else, so nothing says where the document went.
    fs.renameSync(before, outside);

    await expect(page.getByText("Failed to load file content")).toBeVisible();
    await expect(
      page.getByText(/loads it automatically if it comes back/),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/moving\/before\/book\.md$/);
    await expect(treeRow(page, "/moving/before")).toHaveCount(0);

    fs.renameSync(outside, before);

    await expect(heading(page)).toContainText("Moving book");
    await expect(page.getByText("Failed to load file content")).toHaveCount(0);
  });
});
