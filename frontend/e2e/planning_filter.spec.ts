import { test, expect, type Page } from "@playwright/test";

// The planning filter in a real browser, against test_repo
// (docs/reference/planning-index.md §18, its criteria). Its roadmap routes
// plans/design.md's two open questions, OQ-E1 and OQ-E2, which
// `path:/plans/design.md is:open` keeps and nothing else: criterion 2's page.
// Unfiltered, Needs you holds them and paged.md's twelve, ten to a page.

const FILTER = "path:/plans/design.md is:open";
const FILTERED = "/.vantage/planning?filter=path:/plans/design.md+is:open";
const KEPT = ["OQ-E1: Which way does it go?", "OQ-E2: How soon?"];

/**
 * What `vantage-check index --filter 'path:/plans/design.md is:open'` prints
 * around its link (criterion 1): the link ends with the checkout's space id
 * (docs/reference/planning-index.md §13.6), which a paste ignores.
 */
const CHECKER_BLOCK = [
  "Filtered by `path:/plans/design.md is:open`: 2 of 52 entries, in 1 of 20 paths, 2 of them open questions.",
  "Run without --filter to see the other 50.",
  `Planning page: ${FILTERED}&space=q4zmuykxw2a7hbne`,
  "  Press / on the planning page and paste this line, or put the scheme, host and port you open Vantage at in front of the link.",
  "  space= is this checkout's id, kept in .vantage/space: with an address in front, the link opens this project's page even where one Vantage serves several.",
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
/**
 * The filter line's counts, *N match · M hidden*, which replaced the notice's
 * first line (planning-index.md §6.18).
 */
const counts = (page: Page) => page.getByTestId("planning-filter-counts");
const needYou = (page: Page) => page.getByTestId("needs-you-count");

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

/** Criterion 8's long tasks, reported, not asserted (planning-index.md §18). */
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
    await expect(needYou(page)).toHaveText("2");
    await expect(box(page)).toHaveValue(FILTER);
    await expect(counts(page)).toHaveText(/^2 match · \d+ hidden$/);
    await expect(notice(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe(
      "?filter=path:/plans/design.md+is:open",
    );
    const shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await reportLongTasks(page, "cold filtered link");

    // Cleared: every listed document's reviews are already in hand. ✕
    // adds a history entry (OQ-TD13).
    await page.getByRole("button", { name: "Clear the filter" }).click();
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await expect(box(page)).toBeFocused();
    await page.waitForTimeout(500);
    expect(reads.filter((read) => read === "POST").length).toBeLessThanOrEqual(
      2,
    );
    expect(reads.filter((read) => read.startsWith("GET"))).toEqual([]);
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  });

  // planning-index.md §6.16, OQ-TD6, OQ-TD13: pressing *hidden* clears
  // the filter as a new history entry, so Back brings it back; neither the
  // counts arriving nor the clear moves anything painted.
  test("clears the filter on hidden, as a history entry Back undoes, moving nothing painted", async ({
    page,
  }) => {
    await watchPaint(page);
    await page.goto(FILTERED);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    const entries = await page.evaluate(() => history.length);
    const hidden = page.getByTestId("planning-filter-hidden");
    await expect(hidden).toHaveText(/^\d+ hidden$/);
    await hidden.click();
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await expect(counts(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue("");
    await expect(box(page)).toBeFocused();
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    let shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
    await page.goBack();
    await expect(page).toHaveURL(/\?filter=path:\/plans\/design\.md\+is:open$/);
    await expect(box(page)).toHaveValue(FILTER);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await expect(counts(page)).toHaveText(/^2 match · \d+ hidden$/);
    shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
    // Esc never clears.
    await box(page).focus();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\?filter=path:\/plans\/design\.md\+is:open$/);
  });

  test("shows only hidden at a phone's width, which still clears the filter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(FILTERED);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await expect(counts(page)).toBeHidden();
    const narrow = page.getByTestId("planning-filter-hidden-narrow");
    await expect(narrow).toBeVisible();
    await expect(narrow).toHaveText(/^\d+ hidden$/);
    const fit = await narrow.evaluate((node) => ({
      scrollWidth: node.parentElement!.scrollWidth,
      clientWidth: node.parentElement!.clientWidth,
    }));
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    await narrow.click();
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
  });

  test("rewrites a link to its canonical text in place", async ({ page }) => {
    await page.goto(
      "/.vantage/planning?filter=path:./plans/design.md&filter=is:open",
    );
    const entries = await page.evaluate(() => history.length);
    await expect(page).toHaveURL(
      /\/\.vantage\/planning\?filter=path:\/plans\/design\.md\+is:open$/,
    );
    await expect(box(page)).toHaveValue(FILTER);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test("follows the box a key at a time with no Enter, moving nothing painted, adding no history entry, and the address takes the text after the pause (criterion 13)", async ({
    page,
  }) => {
    const reads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/planning/reviews")) reads.push("POST");
      if (pathname.endsWith("/api/review")) reads.push(`GET ${pathname}`);
    });
    await watchPaint(page);
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    const entries = await page.evaluate(() => history.length);
    const before = await cards(page, "Needs you").evaluateAll((all) =>
      all.map((a) => a.getAttribute("aria-label")),
    );
    await page.keyboard.press("/");
    await expect(box(page)).toBeFocused();
    // The long tasks of typing alone, not of the page's load.
    await page.evaluate(() => {
      (window as unknown as { __longTasks: number[] }).__longTasks.length = 0;
    });
    const sections = page.locator("[data-planning-sections]");
    const counted: string[] = [];
    for (const [at, key] of [..."oq-e"].entries()) {
      await page.keyboard.type(key);
      // Each key's own results are painted, before the next key and with
      // no Enter: the sections carry the filter they were laid out under.
      await expect(sections).toHaveAttribute(
        "data-planning-filter",
        "oq-e".slice(0, at + 1),
      );
      counted.push((await needYou(page).textContent()) ?? "");
    }
    expect(
      await cards(page, "Needs you").evaluateAll((all) =>
        all.map((a) => a.getAttribute("aria-label")),
      ),
    ).toEqual(KEPT);
    expect(before).not.toEqual(KEPT);
    await expect(needYou(page)).toHaveText("2");
    expect(counted.at(-1)).toBe("2");
    await expect(counts(page)).toHaveText(/^2 match · \d+ hidden$/);
    // The caret stays where the reader typed.
    expect(
      await box(page).evaluate((input: HTMLInputElement) => [
        input.value,
        input.selectionStart,
        input.selectionEnd,
      ]),
    ).toEqual(["oq-e", 4, 4]);
    // The address takes it once the idle pause has passed, in place.
    await expect(page).toHaveURL(/\/\.vantage\/planning\?filter=oq-e$/);
    await expect(page.getByTestId("planning-filter-status")).toContainText(
      /^2 match, \d+ hidden\./,
    );
    await expect(box(page)).toHaveValue("oq-e");
    await expect(box(page)).toBeFocused();
    const shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await page.waitForTimeout(500);
    expect(reads.filter((read) => read === "POST").length).toBeLessThanOrEqual(
      2,
    );
    expect(reads.filter((read) => read.startsWith("GET"))).toEqual([]);
    await reportLongTasks(page, "typing oq-e");
  });

  test("keeps the page while a text it cannot read is typed, says so in a hint that fits its slot, and Enter names it (criterion 14)", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await box(page).click();
    await page.keyboard.type('path:plans/design.md "is');
    const hint = page.getByTestId("planning-filter-hint");
    await expect(hint).toHaveText("Not applied: Enter says why");
    const fit = await hint.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await expect(page.locator("[data-planning-sections]")).toHaveAttribute(
      "data-planning-filter",
      "path:plans/design.md",
    );
    await expect(box(page)).not.toHaveAttribute("aria-invalid");
    await page.keyboard.press("Enter");
    await expect(notice(page)).toContainText(
      "Not filtered: this Vantage cannot read an unclosed quote.",
    );
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await expect(box(page)).toHaveAttribute("aria-invalid", "true");
    await expect(hint).toHaveText("");
    // The focus stays, for the reader to correct what the notice names.
    await expect(box(page)).toBeFocused();
  });

  test("applies typed text as it is typed, and Enter writes it at once: the agent's address and page, in place, moving nothing painted (criteria 3, 8)", async ({
    page,
  }) => {
    await watchPaint(page);
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    const entries = await page.evaluate(() => history.length);
    await box(page).click();
    await box(page).fill("path:/plans/design.md is:open");
    // Applied with no Enter, and never said to be otherwise.
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await expect(page.getByTestId("planning-filter-hint")).not.toContainText(
      "Not applied",
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
    await expect(page.locator("[data-content-scroll]")).toBeFocused();
    await expect(page.getByTestId("planning-filter-hint")).not.toContainText(
      "Not applied",
    );
    await expect(page.getByTestId("planning-filter-status")).toContainText(
      /^2 match, \d+ hidden\./,
    );
    const shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
    expect(await page.evaluate(() => history.length)).toBe(entries);
    await reportLongTasks(page, "Enter");
  });

  // planning-index.md §6.17, OQ-PF9: typing has applied the text already,
  // so Enter also leaves the box for the results, from their start.
  test("leaves the box on Enter for the top of the results, whose keys then scroll them, moving nothing painted", async ({
    page,
  }) => {
    await watchPaint(page);
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    const pane = page.locator("[data-content-scroll]");
    const top = () => pane.evaluate((node) => node.scrollTop);
    await box(page).click();
    await page.keyboard.type("is:open");
    await expect(counts(page)).toBeVisible();
    // Scrolled down the results with the focus still in the box, once the
    // filtered page is tall enough to scroll: under load its layout can
    // still be landing when the counts first show.
    await expect
      .poll(async () => {
        await pane.evaluate((node) => {
          node.scrollTop = 600;
        });
        return top();
      })
      .toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(pane).toBeFocused();
    await expect(box(page)).not.toBeFocused();
    expect(await top()).toBe(0);
    await expect(filterLine(page)).toBeInViewport();
    // The pane's own keys scroll it now, not the box's caret.
    await page.keyboard.press("PageDown");
    await expect.poll(top).toBeGreaterThan(0);
    const shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
  });

  // planning-index.md §6.16: a typed text that keeps no entry applies only
  // once the idle pause has written it into the address, so the sections
  // never take its filter before the URL does. Every test_repo path ends in
  // `.md`, so `-m` keeps nothing.
  test("holds a typed text that keeps nothing until the idle pause, so the page never empties under it", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await page.evaluate(() => {
      const seen: { filter: string | null; search: string }[] = [];
      (window as unknown as { __shown: typeof seen }).__shown = seen;
      new MutationObserver(() => {
        seen.push({
          filter:
            document
              .querySelector("[data-planning-sections]")
              ?.getAttribute("data-planning-filter") ?? null,
          search: location.search,
        });
      }).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-planning-filter"],
      });
    });
    await box(page).click();
    await page.keyboard.type("-m");
    await expect(page).toHaveURL(/\?filter=-m$/);
    await expect(counts(page)).toHaveText(/^0 match · \d+ hidden$/);
    await expect(cards(page, "Needs you")).toHaveCount(0);
    const shown = await page.evaluate(
      () =>
        (
          window as unknown as {
            __shown: { filter: string | null; search: string }[];
          }
        ).__shown,
    );
    const held = shown.filter((s) => s.filter === "-m");
    expect(held.length, JSON.stringify(shown)).toBeGreaterThan(0);
    expect(
      held.every((s) => s.search === "?filter=-m"),
      JSON.stringify(shown),
    ).toBe(true);
  });

  // Ruled 2026-10-06: a filter that keeps no entry says so in place of the
  // sections, never as a bare page under its notice. A typed word that
  // matches nothing waits for the idle pause, then shows it.
  test("says Nothing matches once the pause passes after a word that matches nothing, and its Clear the filter brings every entry back, moving nothing painted", async ({
    page,
  }) => {
    await watchPaint(page);
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    const entries = await page.evaluate(() => history.length);
    await page.keyboard.press("/");
    await expect(box(page)).toBeFocused();
    await page.keyboard.type("zqxj");
    const empty = page.getByTestId("nothing-matches");
    await expect(page).toHaveURL(/\?filter=zqxj$/);
    await expect(empty.getByRole("heading")).toHaveText(
      "Nothing matches zqxj.",
    );
    await expect(empty).toContainText(
      "Words and quoted phrases are matched only against a question's id, title and leaning, and a document's path, stage and next step.",
    );
    await expect(counts(page)).toHaveText(/^0 match · \d+ hidden$/);
    // No notice line repeats the box, and no row's room stands between the
    // box and Nothing matches, which read as something that failed to load.
    await expect(notice(page)).toHaveCount(0);
    const lineBox = (await filterLine(page).boundingBox())!;
    const emptyBox = (await empty.boundingBox())!;
    expect(emptyBox.y - (lineBox.y + lineBox.height)).toBeLessThan(28);
    await expect(cards(page, "Needs you")).toHaveCount(0);
    await expect(page.getByTestId("nothing-needs-you")).toHaveCount(0);
    await expect(page.getByTestId("planning-filter-status")).toContainText(
      "Nothing matches zqxj.",
    );
    await empty.getByRole("button", { name: "Clear the filter" }).click();
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await expect(empty).toHaveCount(0);
    await expect(box(page)).toHaveValue("");
    await expect(box(page)).toBeFocused();
    const shifts = await shiftsOf(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
    // Clear the filter does what ✕ does: a history entry of its own.
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  });

  test("shows the page of criterion 2 after / and a paste of the checker's output (criterion 11)", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you")).toHaveCount(10);
    await page.keyboard.press("/");
    await expect(box(page)).toBeFocused();
    await paste(page, CHECKER_BLOCK);
    await expect(page).toHaveURL(/\?filter=path:\/plans\/design\.md\+is:open$/);
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
    await expect(page).toHaveURL(/\?filter=path:\/plans\/design\.md\+is:open$/);
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
    // The hint gives way first, to the narrow slot that holds only *hidden*,
    // then the visible label, which stays the box's accessible name.
    await expect(page.getByTestId("planning-filter-hint")).toBeHidden();
    const narrowSlot = (await page
      .getByTestId("planning-filter-hint-icon")
      .boundingBox())!;
    expect(narrowSlot.y + narrowSlot.height).toBeLessThanOrEqual(
      narrow.y + narrow.height,
    );
    expect((await label().boundingBox())!.width).toBeLessThanOrEqual(1);
    await expect(box(page)).toHaveAccessibleName("Filter");
  });

  test("breaks a long path under Nothing matches rather than scroll the page sideways at a phone's width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    // A browser breaks a path after a `/` or a `-` of its own accord, and
    // nowhere in a name with neither: this one's 52 characters are past the
    // 47 or so that a 343 px column holds on one line.
    const term =
      "path:docs/design/planning_filter_with_a_much_longer_name_than_fits.md";
    await page.goto(`/.vantage/planning?filter=${term}`);
    // It keeps nothing, so the term is named under Nothing matches, as the
    // reason, and its headline holds the term too.
    const empty = page.getByTestId("nothing-matches");
    await expect(empty).toContainText(
      `${term} matches no path the index lists.`,
    );
    for (const el of [empty, page.locator("[data-content-scroll]")]) {
      const { scrollWidth, clientWidth } = await el.evaluate((node) => ({
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }
  });

  test("closes the shortcuts help on /, and gives the box the focus in sight", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you").first()).toBeVisible();
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await page.keyboard.press("/");
    await expect(help).toBeHidden();
    await expect(box(page)).toBeFocused();
    await page.keyboard.type("abc");
    await expect(box(page)).toHaveValue("abc");
  });

  test("takes no room in a printout with no filter, and prints the filter it has", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(cards(page, "Needs you").first()).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const line = filterLine(page).locator("..");
    await expect(line).toBeHidden();
    // The sections are the first thing printed, as they were before the
    // filter line was on the page.
    const gap = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      const first = document.querySelector("[data-planning-sections]")!;
      return Math.round(
        first.getBoundingClientRect().top - main.getBoundingClientRect().top,
      );
    });
    expect(gap).toBe(0);
    await page.emulateMedia({ media: "screen" });
    await page.goto(FILTERED);
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await page.emulateMedia({ media: "print" });
    await expect(filterLine(page)).toBeHidden();
    await expect(page.getByTestId("planning-filter-print")).toHaveText(
      new RegExp(`^Filter: ${FILTER}, 2 match, \\d+ hidden$`),
    );
  });

  test("opens a document's own filter, as its Referenced by line links it, with the box holding it", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning?filter=path:/plans/design.md");
    await expect(box(page)).toHaveValue("path:/plans/design.md");
    await expect(cards(page, "Needs you")).toHaveCount(2);
    await expect(counts(page)).toHaveText(/^\d+ match(es)? · \d+ hidden$/);
  });
});
