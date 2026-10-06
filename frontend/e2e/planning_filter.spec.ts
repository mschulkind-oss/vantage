import { test, expect, type Page } from "@playwright/test";

// The planning filter in a real browser, against test_repo
// (docs/design/planning-filter.md §15). Its roadmap routes plans/design.md's
// two open questions, OQ-E1 and OQ-E2, which `path:plans/design.md is:open`
// keeps and nothing else: criterion 2's page. Unfiltered, Needs you holds
// them and paged.md's twelve, ten to a page.

const FILTER = "path:plans/design.md is:open";
const FILTERED = "/.vantage/planning?filter=path:plans/design.md+is:open";
const KEPT = ["OQ-E1: Which way does it go?", "OQ-E2: How soon?"];

/** What `vantage-check index --filter 'path:/plans/design.md is:open'` prints around its link (criterion 1). */
const CHECKER_BLOCK = [
  "Filtered by `path:plans/design.md is:open`: 2 of 52 entries, in 1 of 20 paths, 2 of them open questions.",
  "Run without --filter to see the other 50.",
  `Planning page: ${FILTERED}`,
  "  Press / on the planning page and paste this line, or put the scheme, host and port you open Vantage at in front of the link.",
  "",
].join("\n");

const section = (page: Page, name: string) =>
  page.getByRole("region", { name: new RegExp(`^${name}`) });
const cards = (page: Page, name: string) =>
  section(page, name).getByRole("article");
const box = (page: Page) => page.getByRole("textbox", { name: "Filter" });
const filterLine = (page: Page) =>
  page.getByRole("search", { name: "Filter the planning page" });
const notice = (page: Page) => page.getByTestId("filter-notice");
const sectionBar = (page: Page) =>
  page.getByRole("navigation", { name: "Sections" });

/**
 * Record every layout shift and every long task from the first paint, with
 * what moved: a shift is kept whether or not input preceded it, since the
 * filter's own Enter is input and must move nothing either. A shift whose
 * every source is in the sidebar is the sidebar's, which loads its tree on
 * its own time.
 */
async function watchPaint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: { value: number; sources: string[] }[] = [];
    const longTasks: number[] = [];
    Object.assign(window, { __shifts: shifts, __longTasks: longTasks });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        sources?: { node?: Node | null }[];
      })[]) {
        const sources = (entry.sources ?? []).map((source) => {
          const node = source.node ?? null;
          const el =
            node instanceof Element ? node : (node?.parentElement ?? null);
          const where = el?.closest('[data-testid="sidebar"]')
            ? "sidebar:"
            : "";
          return node === null
            ? "?"
            : `${where}${node.nodeName}.${String((node as Element).className ?? "").slice(0, 60)} "${(el?.textContent ?? "").slice(0, 40)}"`;
        });
        if (
          sources.length > 0 &&
          sources.every((s) => s.startsWith("sidebar:"))
        ) {
          continue;
        }
        shifts.push({ value: entry.value, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // No long task timing in this browser: nothing to report.
    }
  });
}

/** The shifts so far, once two frames have let the observer report the last paint. */
const shiftsOf = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve((window as unknown as { __shifts: unknown }).__shifts),
          ),
        ),
      ),
  );

/** Criterion 8's long tasks, reported rather than asserted (sketch risk 6). */
async function reportLongTasks(page: Page, what: string): Promise<void> {
  const tasks = await page.evaluate(
    () => (window as unknown as { __longTasks: number[] }).__longTasks,
  );
  const over = tasks.filter((ms) => ms > 50);
  test.info().annotations.push({
    type: "long tasks",
    description: `${what}: ${tasks.length} long tasks, ${over.length} over 50 ms, longest ${Math.round(Math.max(0, ...tasks))} ms`,
  });
}

/** Paste `text` into the focused box, as the browser hands a paste over. */
async function paste(page: Page, text: string): Promise<void> {
  await box(page).evaluate((input, pasted) => {
    const data = new DataTransfer();
    data.setData("text/plain", pasted);
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

test.describe("the planning filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("opens a filtered link cold with only what it keeps, moving nothing painted, and at most two review requests with the filter cleared after (criteria 2, 8)", async ({
    page,
  }) => {
    const reads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/planning/reviews")) reads.push("POST");
      if (pathname.endsWith("/api/review")) reads.push(`GET ${pathname}`);
    });
    await watchPaint(page);
    await page.goto(FILTERED);
    const entries = await page.evaluate(() => history.length);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    expect(
      await cards(page, "Needs you").evaluateAll((all) =>
        all.map((a) => a.getAttribute("aria-label")),
      ),
    ).toEqual(KEPT);
    await expect(sectionBar(page)).toHaveText(/^Needs you 2$/);
    await expect(box(page)).toHaveValue(FILTER);
    await expect(notice(page)).toContainText(`Filtered by ${FILTER}: 2 of `);
    await expect(notice(page)).toContainText(
      "Clear the filter to see the other",
    );
    expect(new URL(page.url()).search).toBe(
      "?filter=path:plans/design.md+is:open",
    );
    const shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await reportLongTasks(page, "cold filtered link");

    // Cleared: every listed document's reviews are already in hand.
    await page.getByRole("button", { name: "Clear the filter" }).click();
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await expect(box(page)).toBeFocused();
    await page.waitForTimeout(500);
    expect(reads.filter((read) => read === "POST").length).toBeLessThanOrEqual(
      2,
    );
    expect(reads.filter((read) => read.startsWith("GET"))).toEqual([]);
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test("rewrites a link to its canonical text in place", async ({ page }) => {
    await page.goto(
      "/.vantage/planning?filter=path:./plans/design.md&filter=is:open",
    );
    const entries = await page.evaluate(() => history.length);
    await expect(page).toHaveURL(
      /\/\.vantage\/planning\?filter=path:plans\/design\.md\+is:open$/,
    );
    await expect(box(page)).toHaveValue(FILTER);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test("applies typed text on Enter: the agent's address and page, in place, moving nothing painted (criteria 3, 8)", async ({
    page,
  }) => {
    await watchPaint(page);
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    const entries = await page.evaluate(() => history.length);
    await box(page).click();
    await box(page).fill("path:/plans/design.md is:open");
    await expect(page.getByTestId("planning-filter-hint")).toHaveText(
      "Enter to apply",
    );
    // The long tasks of the filter change alone, not of the page's load.
    await page.evaluate(() => {
      (window as unknown as { __longTasks: number[] }).__longTasks.length = 0;
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`${FILTERED.replace(/[.?+]/g, "\\$&")}$`),
    );
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await expect(box(page)).toHaveValue(FILTER);
    await expect(box(page)).toBeFocused();
    await expect(page.getByTestId("planning-filter-hint")).toHaveText("");
    await expect(page.getByTestId("planning-filter-status")).toContainText(
      `Filtered by ${FILTER}`,
    );
    const shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await reportLongTasks(page, "Enter");
  });

  test("shows the page of criterion 2 after / and a paste of the checker's output (criterion 11)", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await page.keyboard.press("/");
    await expect(box(page)).toBeFocused();
    await paste(page, CHECKER_BLOCK);
    await expect(page).toHaveURL(/\?filter=path:plans\/design\.md\+is:open$/);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await expect(box(page)).toHaveValue(FILTER);
  });

  test("opens the bare page on g p, and Back returns to the filtered one with the box holding its text (criterion 9)", async ({
    page,
  }) => {
    await page.goto(FILTERED);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(box(page)).toHaveValue("");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await expect(notice(page)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\?filter=path:plans\/design\.md\+is:open$/);
    await expect(box(page)).toHaveValue(FILTER);
    await expect(cards(page, "Needs you")).toHaveCount(2);
  });

  test("keeps the filter line one unwrapped row at a phone's width", async ({
    page,
  }) => {
    const label = () => filterLine(page).locator("label");
    await page.goto(FILTERED);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    const wide = (await filterLine(page).boundingBox())!;
    expect((await label().boundingBox())!.width).toBeGreaterThan(10);
    await page.setViewportSize({ width: 375, height: 800 });
    await expect
      .poll(async () => (await filterLine(page).boundingBox())!.width)
      .toBeLessThan(wide.width);
    const narrow = (await filterLine(page).boundingBox())!;
    expect(narrow.height).toBe(wide.height);
    const input = (await box(page).boundingBox())!;
    expect(input.width).toBeGreaterThanOrEqual(120);
    // Every slot on the one row: ✕ and the spinner's beside the input.
    const clear = (await page
      .getByRole("button", { name: "Clear the filter" })
      .boundingBox())!;
    const slot = (await page
      .getByTestId("planning-filter-spinner-slot")
      .boundingBox())!;
    for (const part of [input, clear, slot]) {
      expect(part.y).toBeGreaterThanOrEqual(narrow.y);
      expect(part.y + part.height).toBeLessThanOrEqual(
        narrow.y + narrow.height,
      );
    }
    // The hint gives way first, then the visible label, which stays the
    // box's accessible name.
    await expect(page.getByTestId("planning-filter-hint")).toBeHidden();
    expect((await label().boundingBox())!.width).toBeLessThanOrEqual(1);
    await expect(box(page)).toHaveAccessibleName("Filter");
  });

  test("opens a document's own filter, as its Referenced by line links it, with the box holding it", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning?filter=path:plans/design.md");
    await expect(box(page)).toHaveValue("path:plans/design.md");
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await expect(notice(page)).toContainText(
      "Filtered by path:plans/design.md: 2 of ",
    );
  });
});
