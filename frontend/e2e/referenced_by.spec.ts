import { test, expect, type Page } from "@playwright/test";
import { openWithIndex } from "./planningIndex";

// Referenced by in a real browser, against the real planning endpoint
// (docs/reference/planning-index.md §7). `fixtures/test_repo/plans/hub.md` is the
// heavily cited document: the roadmap links it once, hub-citations.md from
// eight headings and hub-neighbors.md from three.

/**
 * How many rows the list had before it collapsed to one line: one per linking
 * document and heading, 1 + 8 + 3 for hub.md, which put its body 353px below
 * its frontmatter card at this viewport.
 */
const ROWS_BEFORE = 12;

const prose = (page: Page) => page.locator("[data-content-scroll] .prose");
const surface = (page: Page) => page.locator("[data-vantage-referenced-by]");
const toggle = (page: Page) =>
  surface(page).getByRole("button", { name: /Referenced by/ });

/** The body's top, below the card's bottom, in pixels. */
async function bodyGap(page: Page): Promise<number> {
  const card = await prose(page)
    .getByText("Metadata")
    .locator("xpath=ancestor::div[contains(@class,'mb-8')][1]")
    .boundingBox();
  const h1 = await prose(page)
    .getByRole("heading", { name: "The hub", level: 1 })
    .boundingBox();
  return h1!.y - (card!.y + card!.height);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("a heavily cited document's Referenced by is one line above its body", async ({
  page,
}) => {
  await page.goto("/plans/hub.md");
  await expect(toggle(page)).toHaveText(
    "Referenced by 3 documents · on the roadmap under Later",
  );
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

  // One line: the line box is its own line-height tall, however long the
  // list behind it.
  const { height, lineHeight } = await toggle(page)
    .locator("span")
    .first()
    .evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
  expect(height).toBeLessThan(lineHeight * 1.5);

  // The body moved up: the old list's rows alone were taller than the whole
  // gap now is.
  const collapsed = await bodyGap(page);
  expect(collapsed).toBeLessThan(ROWS_BEFORE * lineHeight);
  expect(collapsed).toBeLessThan(lineHeight * 5);

  // Opened, it is one row per document, and the body moves down by the list.
  await toggle(page).click();
  const list = surface(page).getByRole("navigation", { name: "Referenced by" });
  // innerText: the headings past "+4 more" are in the row for print only.
  await expect(list.getByRole("listitem")).toHaveText(
    [
      "roadmap.md · Later",
      /^hub-citations\.md · Citations of the hub · 1\. Section 1 · 2\. Section 2 · 3\. Section 3 · \+4 more$/,
      "hub-neighbors.md · Lifecycle · Delivery · The neighbors",
    ],
    { useInnerText: true },
  );
  const opened = await bodyGap(page);
  const listBox = await list.boundingBox();
  expect(opened - collapsed).toBeGreaterThanOrEqual(listBox!.height);
  expect(listBox!.height).toBeLessThan(ROWS_BEFORE * lineHeight);
});

test("it opens and closes from the keyboard, and moves focus into a row's more", async ({
  page,
}) => {
  await page.goto("/plans/hub.md");
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Space");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(surface(page).getByRole("navigation")).toBeHidden();

  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    surface(page).getByRole("link", { name: "roadmap.md" }),
  ).toBeFocused();
  await surface(page)
    .getByRole("button", { name: "+4 more headings in hub-citations.md" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    surface(page).getByRole("link", { name: "4. Section 4" }),
  ).toBeFocused();
});

test("it is collapsed again on the next visit", async ({ page }) => {
  await page.goto("/plans/hub.md");
  await toggle(page).click();
  await surface(page).getByRole("link", { name: "Lifecycle" }).click();
  await expect(page).toHaveURL(/\/plans\/hub-neighbors\.md#L10$/);
  // Loaded, not just navigated to: until its content arrives the viewer is
  // still showing the hub, and going back then is no second visit.
  await expect(
    prose(page).getByRole("heading", { name: "Neighbors of the hub" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    prose(page).getByRole("heading", { name: "The hub", level: 1 }),
  ).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
});

test("a heading link lands on the line that links here, a screen down", async ({
  page,
}) => {
  await page.goto("/plans/hub.md");
  await toggle(page).click();
  await surface(page)
    .getByRole("link", { name: "Citations of the hub" })
    .click();
  await expect(page).toHaveURL(/\/plans\/hub-citations\.md#L72$/);
  // The line is marked in the document the link named, not in the hub that
  // was still on screen when the URL changed, and it is scrolled into view.
  const marked = prose(page).locator(".line-anchor-highlight");
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText("Before any section");
  await expect(marked).toBeInViewport();
  await expect(
    prose(page).getByRole("heading", { name: "Citations of the hub" }),
  ).not.toBeInViewport();
});

test("the line prints, and the list prints only when open", async ({
  page,
}) => {
  await page.goto("/plans/hub.md");
  await expect(toggle(page)).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(toggle(page)).toBeVisible();
  await expect(surface(page).getByRole("navigation")).toBeHidden();
  await toggle(page).click();
  await expect(
    surface(page).getByRole("navigation", { name: "Referenced by" }),
  ).toBeVisible();
  // Paper has no "+M more" to press, so every heading prints instead.
  await expect(
    surface(page).getByRole("button", { name: /more headings in/ }),
  ).toBeHidden();
  await expect(
    surface(page).getByRole("link", { name: "7. Section 7" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await expect(
    surface(page).getByRole("link", { name: "7. Section 7" }),
  ).toBeHidden();
});

test("a document nothing links to still counts its unrouted questions", async ({
  page,
}) => {
  await page.goto("/plans/unrouted.md");
  await expect(surface(page)).toHaveText(
    "1 open question not routed by the roadmap",
  );
  await expect(surface(page).getByRole("button")).toHaveCount(0);
});

test("on a narrow screen the line wraps rather than hide the roadmap's answer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  // With the index at first paint, as on any visit after the first: a line
  // that fills the one line reserved while the index was on its way stays one
  // line for that visit (docs/reference/planning-index.md §12.2).
  await openWithIndex(page, "/plans/hub.md");
  // The roadmap's part of the line is the point of it, so it is shown in
  // full, not cut off at the edge with the rest in a hover title.
  const status = toggle(page).getByText("on the roadmap under Later");
  await expect(status).toBeVisible();
  const clipped = await toggle(page)
    .locator("span")
    .first()
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(false);
  const box = await status.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

test("on a narrow screen a long file name wraps inside its row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  // shipped.md, not design.md, which the long-named document used to cite:
  // planning.spec.ts rewrites design.md while this runs beside it.
  await page.goto("/plans/shipped.md");
  await toggle(page).click();
  const name = surface(page).getByRole("link", {
    name: "working_directory_diffs_and_review_state_architecture_notes.md",
  });
  await expect(name).toBeVisible();
  const box = await name.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  const scroll = page.locator("[data-content-scroll]");
  const overflow = await scroll.evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
