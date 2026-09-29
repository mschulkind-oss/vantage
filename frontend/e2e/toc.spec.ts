import { test, expect } from "@playwright/test";

// The table of contents and the width toggle, in a real browser: jsdom lays
// nothing out, so "it sits beside the text" and "clicking an entry scrolls"
// are only answerable here.
test.describe("table of contents", () => {
  test("toggles, lists the headings, and scrolls to one", async ({ page }) => {
    await page.goto("/mermaid-diagrams-test.md");
    await expect(page.locator("h1").first()).toBeVisible();

    const toggle = page.getByRole("button", { name: "Show contents" });
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("table-of-contents")).toHaveCount(0);

    await toggle.click();
    const toc = page.getByTestId("table-of-contents");
    await expect(toc).toBeVisible();

    const entries = toc.locator("nav a");
    expect(await entries.count()).toBeGreaterThan(1);

    // The entry text has to match the heading it points at, with no "#" from
    // the hover anchor that lives inside every rendered heading.
    const secondText = (await entries.nth(1).innerText()).trim();
    expect(secondText.startsWith("#")).toBe(false);

    const scroller = page.locator("[data-content-scroll]");
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);

    await entries.nth(1).click();
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await expect(page).toHaveURL(/#.+/);

    // And the choice survives a reload, like the sidebar's collapse does.
    await page.reload();
    await expect(page.getByTestId("table-of-contents")).toBeVisible();

    await page.getByRole("button", { name: "Hide contents" }).click();
    await expect(page.getByTestId("table-of-contents")).toHaveCount(0);
  });

  test("entries are real links: a labeled nav, an href, and a new-tab open", async ({
    page,
    context,
  }) => {
    await page.goto("/mermaid-diagrams-test.md");
    await page.getByRole("button", { name: "Show contents" }).click();
    const toc = page.getByTestId("table-of-contents");

    // A second, unnamed navigation landmark (the breadcrumb has its own) is
    // indistinguishable to a screen reader without this.
    await expect(toc.getByRole("navigation")).toHaveAccessibleName(
      "Table of contents",
    );

    const entry = toc.locator("nav a").nth(1);
    await expect(entry).toHaveAttribute("href", /^#.+/);

    // Middle-click and Cmd/Ctrl-click open the section in a new tab, exactly
    // as the heading's own `#` anchor does — a `<button>` could not do this
    // regardless of its click handler, since the browser only offers it for
    // a real link.
    const href = await entry.getAttribute("href");
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      entry.click({ button: "middle" }),
    ]);
    // A same-document anchor navigation loads no new resource, so
    // `waitForLoadState` never has a network event to settle on — wait for
    // the URL itself instead.
    await popup.waitForURL((url) => url.hash === href);
    await popup.close();
  });

  test("sits beside the document rather than over it", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/mermaid-diagrams-test.md");
    await page.getByRole("button", { name: "Show contents" }).click();

    const toc = page.getByTestId("table-of-contents");
    const heading = page.locator("h1").first();
    const tocBox = (await toc.boundingBox())!;
    const headingBox = (await heading.boundingBox())!;

    expect(tocBox.x + tocBox.width).toBeLessThanOrEqual(headingBox.x);

    // And it stays put while the document scrolls under it.
    await page
      .locator("[data-content-scroll]")
      .evaluate((el) => el.scrollTo({ top: 1200 }));
    await expect
      .poll(async () => (await toc.boundingBox())!.y)
      .toBeLessThan(tocBox.y + 40);
  });

  test("is glued to the left and never centers the document", async ({
    page,
  }) => {
    // The band is left-aligned by design: file list, then contents, then
    // text, with the window's leftover width gathered on the right. On a
    // wide viewport a centered document would start well right of the
    // contents; a left-glued one starts immediately after the gap.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/mermaid-diagrams-test.md");
    await page.getByRole("button", { name: "Show contents" }).click();

    const toc = page.getByTestId("table-of-contents");
    const heading = page.locator("h1").first();
    const tocBox = (await toc.boundingBox())!;
    const headingBox = (await heading.boundingBox())!;

    // The document begins right after the contents and the 3rem gap —
    // nowhere near the viewport's center, which is where a centered
    // column would put it on a window this wide.
    expect(headingBox.x).toBeLessThan(800);
    expect(headingBox.x - (tocBox.x + tocBox.width)).toBeLessThanOrEqual(
      48 + 1,
    );

    // The measure assertions read the document column (the .min-w-0 child
    // of the band, the element that carries max-w-5xl), not the heading:
    // a heading's box hangs left of the column to park its `#` anchor, and
    // how far that hang widens it differs between engines.
    const column = page.locator("div.flex.gap-12 > div.min-w-0");

    // Closing the contents never costs the document width — it can only
    // reclaim it: on this 1600px window the open contents squeezed the
    // column below its max (sidebar + contents + gap + full measure does
    // not fit), and closing it hands the width back.
    const widthWithToc = (await column.boundingBox())!.width;
    await page.getByRole("button", { name: "Hide contents" }).click();
    expect((await column.boundingBox())!.width).toBeGreaterThanOrEqual(
      widthWithToc - 1,
    );
    expect((await heading.boundingBox())!.x).toBeLessThan(headingBox.x);

    // On a window wide enough for everything, the measure is exactly the
    // column's max (5xl = 1024px) with the contents open and closed alike.
    await page.setViewportSize({ width: 1900, height: 900 });
    await page.getByRole("button", { name: "Show contents" }).click();
    const openBox = (await column.boundingBox())!;
    expect(Math.abs(openBox.width - 1024)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Hide contents" }).click();
    const closedBox = (await column.boundingBox())!;
    expect(Math.abs(closedBox.width - 1024)).toBeLessThanOrEqual(1);
  });

  test("keeps the table of contents above the document", async ({ page }) => {
    // The table of contents is app chrome inside the document's scroll
    // container. A block of the document can reach over it with a negative
    // margin, which the inline-style filter keeps, and a block that paints in
    // the positioned layer then paints over it and takes its clicks: one with
    // `opacity`, a toned block, any heading, or a link the document points
    // where it likes. The fixture writes one of each after its headings.
    const navigated: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname.endsWith(".invalid")) {
        navigated.push(request.url());
      }
    });
    await page.goto("/toc-cover.md");
    await expect(
      page.getByText("Session expired. Sign in again."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show contents" }).click();
    const entries = page.getByTestId("table-of-contents").locator("nav a");
    await expect(entries.filter({ hasText: "Gamma" })).toBeVisible();

    const hits = await entries.evaluateAll((links) =>
      links.map((link) => {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          entry: link.textContent,
          wins: hit !== null && link.contains(hit),
          hit: hit?.textContent?.slice(0, 40) ?? null,
        };
      }),
    );
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (const hit of hits)
      expect.soft(hit, hit.entry!).toMatchObject({ wins: true });

    // And a click where the reader sees an entry is the entry's: it scrolls to
    // the heading, and nothing is asked of the host the covering link names.
    // A mouse click at the entry's center, not a locator click, which would
    // wait out an element over the entry instead of clicking it.
    const beta = (await entries.filter({ hasText: "Beta" }).boundingBox())!;
    await page.mouse.click(beta.x + beta.width / 2, beta.y + beta.height / 2);
    await expect(page).toHaveURL(/#beta$/);
    expect(navigated).toEqual([]);
  });

  test("leaves a maximized diagram above the table of contents", async ({
    page,
  }) => {
    // The other half of the contents' stacking: the maximized diagram is not a
    // portal, so it sits inside the document column. Were that column its own
    // stacking context, the contents would paint over the diagram's backdrop.
    await page.goto("/mermaid-diagrams-test.md");
    await page.getByRole("button", { name: "Show contents" }).click();
    const entries = page.getByTestId("table-of-contents").locator("nav a");
    await expect(entries.first()).toBeVisible();
    await page
      .locator('.prose button[aria-label="Maximize diagram"]')
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const covered = await entries.evaluateAll((links) =>
      links.slice(0, 5).map((link) => {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return hit !== null && !link.contains(hit);
      }),
    );
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.every(Boolean)).toBe(true);
  });
});
test.describe("full width", () => {
  test("recalculates the active heading when full width changes the layout", async ({
    page,
  }) => {
    // Wide enough that toggling full width visibly reflows the text — on a
    // narrow viewport the fixed column and full width render identically.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/mermaid-diagrams-test.md");
    await page.getByRole("button", { name: "Show contents" }).click();

    const scroller = page.locator("[data-content-scroll]");
    await scroller.evaluate((el) =>
      el.scrollTo({ top: (el.scrollHeight - el.clientHeight) / 2 }),
    );
    const before = await page
      .getByTestId("table-of-contents")
      .locator("[aria-current]")
      .innerText();

    // Toggling full width reflows every heading below the fold without
    // touching the DOM tree — nothing is inserted, removed or scrolled — so
    // this is the case a plain MutationObserver on childList alone would
    // miss entirely.
    await page.getByRole("button", { name: "Use full width" }).click();

    await expect
      .poll(() =>
        page
          .getByTestId("table-of-contents")
          .locator("[aria-current]")
          .innerText(),
      )
      .not.toBe(before);
  });

  test("widens the document and is remembered", async ({ page }) => {
    // Wider than the fixed column, or there is nothing for full width to add.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/mermaid-diagrams-test.md");
    const heading = page.locator("h1").first();
    const fixed = (await heading.boundingBox())!.width;

    await page.getByRole("button", { name: "Use full width" }).click();
    await expect
      .poll(async () => (await heading.boundingBox())!.width)
      .toBeGreaterThan(fixed);

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Use fixed width" }),
    ).toBeVisible();
    expect((await heading.boundingBox())!.width).toBeGreaterThan(fixed);

    await page.getByRole("button", { name: "Use fixed width" }).click();
    await expect
      .poll(async () => (await heading.boundingBox())!.width)
      .toBe(fixed);
  });
});

// Two tabs, one browser context — so one `localStorage` and real `storage`
// events between them. This is the half the unit tests cannot reach: there,
// the second tab's event is hand-dispatched, and whether a browser raises it
// at all is precisely what is being assumed.
test.describe("preferences shared between tabs", () => {
  test("a toggle in one tab lands in the other without a reload", async ({
    context,
  }) => {
    const open = async () => {
      const tab = await context.newPage();
      await tab.setViewportSize({ width: 1600, height: 900 });
      await tab.goto("/mermaid-diagrams-test.md");
      await expect(tab.locator("h1").first()).toBeVisible();
      return tab;
    };

    const first = await open();
    const second = await open();
    await expect(second.getByTestId("table-of-contents")).toHaveCount(0);

    // Contents, opened in the first tab and adopted by the second.
    await first.getByRole("button", { name: "Show contents" }).click();
    await expect(second.getByTestId("table-of-contents")).toBeVisible();

    // Width, the other way round — the listener is not one tab's privilege.
    await second.getByRole("button", { name: "Use full width" }).click();
    await expect(
      first.getByRole("button", { name: "Use fixed width" }),
    ).toBeVisible();

    // And turning a preference back off propagates too, rather than latching.
    await first.getByRole("button", { name: "Hide contents" }).click();
    await expect(second.getByTestId("table-of-contents")).toHaveCount(0);
  });
});
