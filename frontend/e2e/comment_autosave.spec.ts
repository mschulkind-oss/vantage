import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveFixture } from "./ownServer";

// Comment autosave (docs/reference/comment-autosave.md, done-when 6), in
// a real browser against the real server: a comment box saves as it is typed
// in, every way of leaving it keeps the text, and a save that fails says so
// and lands once the server answers again. The fixture is
// `fixtures/comment_autosave/notes.md`, which no other spec reads.

const here = path.dirname(fileURLToPath(import.meta.url));
const DOC = "/notes.md";

const prose = (page: Page) => page.locator("[data-content-scroll] .prose");
const popover = (page: Page) => page.getByPlaceholder("Your comment...");
const cards = (page: Page) =>
  prose(page).locator("[data-review-inline-comment]");

async function openInReview(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("vantage.reviewMode:notes.md", "on");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(DOC);
  await expect(prose(page).locator("h1")).toContainText("Autosave");
}

async function clearReview(page: Page) {
  await page.evaluate(() =>
    fetch("/api/review?path=notes.md", { method: "DELETE" }),
  );
}

test.describe("comment autosave", () => {
  test.describe.configure({ mode: "serial" });
  serveFixture(path.join(here, "fixtures/comment_autosave"));

  test("saves as it is typed, and Esc keeps the text", async ({ page }) => {
    await openInReview(page);
    await prose(page).getByText("A paragraph to comment on.").click();
    await popover(page).fill("Saved while typing.");
    await expect(page.getByText("Saved just now")).toBeVisible();
    // Filed while the box is still open, and the box is still there.
    await expect(cards(page).filter({ hasText: "Saved while typing." }))
      .toBeVisible();
    await expect(popover(page)).toBeFocused();

    await popover(page).press("End");
    await popover(page).pressSequentially(" And more.");
    await popover(page).press("Escape");
    await expect(popover(page)).toHaveCount(0);
    await page.reload();
    await expect(
      cards(page).filter({ hasText: "Saved while typing. And more." }),
    ).toBeVisible();
    await clearReview(page);
  });

  test("says Not saved, retrying, while the server is away, and saves once it is back", async ({
    page,
  }) => {
    await openInReview(page);
    await page.route("**/api/review/comments**", (route) => route.abort());
    await prose(page).getByText("Another paragraph, below it.").click();
    await popover(page).fill("Typed while the server was away.");
    await expect(page.getByText("Not saved, retrying").first()).toBeVisible();
    // Closing it keeps the text, which the app shell now holds.
    await popover(page).press("Escape");
    await expect(page.getByText("1 comment not saved, retrying")).toBeVisible();

    await page.unroute("**/api/review/comments**");
    await expect(page.getByText("1 comment not saved, retrying")).toHaveCount(
      0,
      { timeout: 10_000 },
    );
    await page.reload();
    await expect(
      cards(page).filter({ hasText: "Typed while the server was away." }),
    ).toBeVisible();
    await clearReview(page);
  });
});
