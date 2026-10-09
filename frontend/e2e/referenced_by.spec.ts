import { test, expect, type Page } from "@playwright/test";
import { openWithIndex } from "./planningIndex";

// Referenced by in a real browser, against the real planning endpoint
// (docs/reference/planning-index.md §7). `fixtures/test_repo/plans/hub.md` is the
// heavily cited document: the roadmap links it once, hub-citations.md from
// eight headings and hub-neighbors.md from three. It holds no question, so its
// line has no link to the planning page; paged.md's and unrouted.md's do
// (docs/reference/planning-index.md §7.1).

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
/** The line itself, without the list behind it. */
const lineRow = (page: Page) => surface(page).locator(":scope > div").first();
/** The line's link to the planning page filtered to the document. */
const planningLink = (page: Page) =>
  surface(page).getByRole("link", {
    name: "its questions on the planning page",
  });

/** Hold every planning stream until the returned function is called. */
async function holdTheStream(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/planning/stream", async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

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
  // It holds no question, so there is nothing to show it on the planning page.
  await expect(planningLink(page)).toHaveCount(0);

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
    "1 open question not on the roadmap · its questions on the planning page",
  );
  await expect(surface(page).getByRole("button")).toHaveCount(0);
});

// planning-index.md §7.1: a live document holding a question links to the
// planning page filtered to it, `path:/plans/paged.md`, pinned to the root.
test("a live document's line links to the planning page filtered to it", async ({
  page,
}) => {
  const filtered = "/.vantage/planning?filter=path:/plans/paged.md";
  await page.goto("/plans/paged.md");
  await expect(lineRow(page)).toHaveText(
    "Referenced by 1 document · on the roadmap under Later · its questions on the planning page",
  );
  // After the disclosure button, never inside it.
  await expect(toggle(page)).toHaveText(
    "Referenced by 1 document · on the roadmap under Later",
  );
  await expect(toggle(page).getByRole("link")).toHaveCount(0);
  const link = planningLink(page);
  await expect(link).toHaveAttribute("href", filtered);

  // A plain link: Ctrl-click opens it in a tab of its own, and this one stays.
  const [tab] = await Promise.all([
    page.context().waitForEvent("page"),
    link.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  // The address is the point, so wait for the tab to commit to it, not for
  // its load: a cold planning page on the dev server, beside a full run's
  // workers, once took longer than `toHaveURL`'s five seconds to fire `load`.
  await tab.waitForURL(`${new URL(page.url()).origin}${filtered}`, {
    waitUntil: "commit",
  });
  await tab.close();
  await expect(page).toHaveURL(/\/plans\/paged\.md$/);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

  // A click follows it in the app, opening the planning page filtered to the
  // document: the box holds its filter and only its entries are shown
  // (planning-index.md §18, criterion 12).
  await link.click();
  await expect(page).toHaveURL(`${new URL(page.url()).origin}${filtered}`);
  const needsYou = page.getByRole("region", { name: /^Needs you/ });
  await expect(needsYou).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Filter" })).toHaveValue(
    "path:/plans/paged.md",
  );
  await expect(page.getByTestId("planning-filter-counts")).toHaveText(
    /^\d+ match(es)? · \d+ hidden$/,
  );
  await expect(needsYou.getByRole("article").first()).toContainText("OQ-P");
  await expect(
    needsYou.getByRole("article").filter({ hasNotText: /OQ-P\d+:/ }),
  ).toHaveCount(0);
});

// §12.2: the line is reserved at first paint for a planning document, and the
// link arrives in it with the rest of the line. On a phone the line that
// fills a reservation is one line, so the words give way and the link does not.
for (const width of [1280, 320]) {
  test(`the link arrives in the reserved line, moving nothing, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const release = await holdTheStream(page);
    await page.goto("/plans/paged.md");
    const title = prose(page).getByRole("heading", {
      name: "The paged plan",
      level: 1,
    });
    await expect(title).toBeVisible();
    const reserved = page.locator("[data-vantage-referenced-by-reserved]");
    const slot = await reserved.boundingBox();
    expect(slot?.height).toBeGreaterThan(0);
    const before = await title.boundingBox();

    release();
    await expect(planningLink(page)).toBeVisible();
    await expect(reserved).toHaveCount(0);
    expect((await surface(page).boundingBox())?.height).toBeCloseTo(
      slot!.height,
      1,
    );
    expect(await title.boundingBox()).toEqual(before);

    // The link is whole and on screen, never cut off: its part, the
    // separator and the link, keeps its width, and the link is one box on
    // one line, inside the row.
    const link = await planningLink(page).evaluate((el) => {
      const part = el.parentElement!;
      const row = el
        .closest("[data-vantage-referenced-by]")!
        .firstElementChild!.getBoundingClientRect();
      return {
        right: el.getBoundingClientRect().right,
        rowRight: row.right,
        boxes: el.getClientRects().length,
        clipped: part.scrollWidth > part.clientWidth,
      };
    });
    expect(link.clipped).toBe(false);
    expect(link.boxes).toBe(1);
    expect(link.right).toBeLessThanOrEqual(link.rowRight + 0.5);
    expect(link.right).toBeLessThanOrEqual(width);
    const scroll = page.locator("[data-content-scroll]");
    expect(
      await scroll.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(0);
    // At a phone's width, the words before it are what gave way.
    const wordsClipped = await toggle(page)
      .locator("span")
      .first()
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(wordsClipped).toBe(width < 640);
  });
}

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

test("on a narrow screen, with the index at first paint, the line wraps and the link stays whole", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openWithIndex(page, "/plans/paged.md");
  await expect(planningLink(page)).toBeVisible();
  // Nothing was reserved, so nothing is cut off: the roadmap's answer is shown
  // in full, and the link is on screen.
  const clipped = await toggle(page)
    .locator("span")
    .first()
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(false);
  await expect(
    toggle(page).getByText("on the roadmap under Later"),
  ).toBeVisible();
  const box = await planningLink(page).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  const scroll = page.locator("[data-content-scroll]");
  expect(
    await scroll.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(0);
});

// With nothing reserved, below `sm` the link takes a line of its own,
// starting where the words start: after the chevron for the disclosure
// button, at the edge for the plain-text line. Its separator would join
// nothing there, so it is not drawn. Left to wrap item by item, the separator
// hung alone at the end of the words' line or opened the link's, and the link
// started under the chevron. From `sm` up the line is one line, the separator
// between the words and the link.
for (const [path, width] of [
  ["/plans/paged.md", 390],
  ["/plans/unrouted.md", 390],
  ["/plans/paged.md", 1280],
  ["/plans/unrouted.md", 1280],
] as const) {
  test(`with the index at first paint, the link's line is laid out whole: ${path} at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openWithIndex(page, path);
    await expect(planningLink(page)).toBeVisible();
    const geometry = await planningLink(page).evaluate((link) => {
      const row = link.closest(
        "[data-vantage-referenced-by]",
      )!.firstElementChild!;
      const separator = link.previousElementSibling as HTMLElement;
      // The words' own box: inside the button, past its chevron, or the
      // plain-text line itself.
      const button = row.querySelector("button");
      const words = (
        button === null ? row.firstElementChild : button.querySelector("span")
      )!.getBoundingClientRect();
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      };
      return {
        wordsLeft: words.x,
        wordsRight: words.right,
        wordsTop: words.y,
        wordsBottom: words.bottom,
        link: box(link),
        separatorShown: separator.getClientRects().length > 0,
        separator: box(separator),
        lineHeight: parseFloat(getComputedStyle(row).lineHeight),
        rowHeight: row.getBoundingClientRect().height,
      };
    });
    const { link, separator } = geometry;
    if (width < 640) {
      expect(geometry.separatorShown).toBe(false);
      // Under the words, starting where they start.
      expect(Math.abs(link.x - geometry.wordsLeft)).toBeLessThanOrEqual(0.5);
      expect(link.y).toBeGreaterThanOrEqual(geometry.wordsBottom - 0.5);
      // And one line more than the words, no more.
      expect(geometry.rowHeight).toBeCloseTo(
        geometry.wordsBottom - geometry.wordsTop + geometry.lineHeight,
        0,
      );
    } else {
      // One line: the separator after the words, the link after it.
      expect(geometry.separatorShown).toBe(true);
      expect(geometry.rowHeight).toBeCloseTo(geometry.lineHeight, 0);
      expect(separator.x).toBeGreaterThanOrEqual(geometry.wordsRight - 0.5);
      expect(link.x).toBeGreaterThanOrEqual(separator.right - 0.5);
      expect(Math.abs(separator.y - link.y)).toBeLessThanOrEqual(3);
    }
  });
}

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
