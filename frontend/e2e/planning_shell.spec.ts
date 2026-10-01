import { test, expect, type Page } from "@playwright/test";

// The planning page in the app shell, with the planning outline in its
// contents column (docs/reference/planning-index.md §6.9), in a real browser.
// The fixture is test_repo's plans/, as planning_page.spec.ts reads it: Needs
// you holds design.md's two questions and paged.md's twelve, ten to a page,
// Unrouted holds 27 questions over two pages, and Graduate one document.

const section = (page: Page, name: string) =>
  page.getByRole("region", { name: new RegExp(`^${name}`) });
const outline = (page: Page) =>
  page.getByRole("navigation", { name: "Planning outline" });
const outlineSection = (page: Page, title: string) =>
  outline(page).getByRole("link", { name: new RegExp(`^${title} \\d`) });
const outlineDocument = (page: Page, path: string) =>
  outline(page).locator(`[data-testid=outline-document][data-path="${path}"]`);
const pane = (page: Page) => page.locator("[data-content-scroll]");

/** Open the page with the contents column shown, as a reader who keeps it. */
async function openWithOutline(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("vantage:tocOpen", "true");
  });
  await page.goto("/.vantage/planning");
  await expect(outlineSection(page, "Needs you")).toBeVisible();
  await expect(section(page, "Needs you").getByRole("article")).toHaveCount(10);
}

test.describe("the planning page in the app shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("sits beside the sidebar, which b puts away and brings back", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar.getByText("plans", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Planning" }),
    ).toBeVisible();
    await page.keyboard.press("b");
    await expect(sidebar).not.toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Open sidebar" }),
    ).toBeVisible();
    await page.keyboard.press("b");
    await expect(sidebar).toBeInViewport();
  });

  test("widens the cards on Use full width", async ({ page }) => {
    await page.goto("/.vantage/planning");
    const card = section(page, "Needs you").getByRole("article").first();
    await expect(card).toBeVisible();
    const narrow = (await card.boundingBox())!.width;
    await page.getByRole("button", { name: "Use full width" }).click();
    await expect
      .poll(async () => (await card.boundingBox())!.width)
      .toBeGreaterThan(narrow + 100);
  });

  test("goes to a section and to a document from the keyboard", async ({
    page,
  }) => {
    await openWithOutline(page);
    // A section: its heading comes into view with the focus.
    await outlineSection(page, "Graduate").focus();
    await page.keyboard.press("Enter");
    const graduate = section(page, "Graduate").getByRole("heading", {
      level: 2,
    });
    await expect(graduate).toBeFocused();
    await expect(graduate).toBeInViewport();

    // A document on a section's second page: the section flips to it.
    await outlineDocument(page, "tree-badges/bake-images.md").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?unrouted=2$/);
    await expect(
      section(page, "Unrouted").getByRole("link", {
        name: "tree-badges/bake-images.md",
      }),
    ).not.toHaveCount(0);
    // Its first card, found by the id every card carries (planningCardId),
    // is brought into view with the focus on its first control.
    const card = section(page, "Unrouted")
      .locator('article[id^="pq-tree-badges%2Fbake-images.md--"]')
      .first();
    await expect(card).toBeInViewport();
    await expect
      .poll(() => card.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);

    // A document's row: in view, with its link focused.
    await outlineDocument(page, "plans/shipped.md").focus();
    await page.keyboard.press("Enter");
    const row = section(page, "Graduate").locator(
      '[data-planning-document="plans/shipped.md"]',
    );
    await expect(row).toBeInViewport();
    await expect(
      row.getByRole("link", { name: "plans/shipped.md" }),
    ).toBeFocused();
  });

  test("marks where the reader is as the pane scrolls", async ({ page }) => {
    await openWithOutline(page);
    await expect(outlineSection(page, "Needs you")).toHaveAttribute(
      "aria-current",
      "location",
    );
    // Scrolled to the end, the last section is the one on screen.
    await pane(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(outlineSection(page, "Graduate")).toHaveAttribute(
      "aria-current",
      "location",
    );
    await expect(outlineSection(page, "Needs you")).not.toHaveAttribute(
      "aria-current",
    );
    // And a section's heading at the top of the pane marks that section.
    await section(page, "Unrouted")
      .getByRole("heading", { level: 2 })
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await expect(outlineSection(page, "Unrouted")).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  // The file name wins (a file name never loses width to a decoration): a
  // document's count wraps under its name rather than take any of its room.
  test("gives each document's name its whole width, whatever its count", async ({
    page,
  }) => {
    await openWithOutline(page);
    const names = outline(page).getByTestId("outline-document-name");
    await expect(names).not.toHaveCount(0);
    const widths = await names.evaluateAll((els) =>
      els.map((el) => {
        const counted = el.getBoundingClientRect().width;
        const count = el.nextElementSibling as HTMLElement | null;
        if (count !== null) count.style.display = "none";
        const alone = el.getBoundingClientRect().width;
        if (count !== null) count.style.display = "";
        return {
          name: el.textContent,
          counted,
          alone,
          clipped: el.scrollWidth > el.clientWidth + 0.5,
        };
      }),
    );
    for (const { name, counted, alone, clipped } of widths) {
      expect(counted, String(name)).toBeCloseTo(alone, 0);
      expect(clipped, String(name)).toBe(false);
    }
  });

  // One shell for the viewer and the planning page (App.tsx's layout
  // route): `g p` replaces the main column and nothing else, so the sidebar's
  // tree is where the reader left it, and nothing it shows is asked again.
  test("keeps the sidebar as it was across g p, tree scroll and all", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 520 });
    // No live-reload socket: the other specs change the fixture as this one
    // runs, and a push about it refreshes the tree whichever page is drawn.
    await page.routeWebSocket(/\/api\/ws$/, () => {});
    await page.goto("/plans/design.md");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "The fixture design",
    );
    const sidebar = page.getByTestId("sidebar");
    const tree = sidebar.locator(".overflow-y-auto").first();
    await expect(sidebar.getByText("plans", { exact: true })).toBeVisible();
    await expect
      .poll(() => tree.evaluate((el) => el.scrollHeight > el.clientHeight + 60))
      .toBe(true);
    await tree.evaluate((el) => el.scrollTo(0, 60));
    // What the sidebar asks for when it is drawn.
    const sidebarRequests: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (/^\/api\/(tree|git\/recent|repos)\b/.test(pathname)) {
        sidebarRequests.push(pathname);
      }
    });
    await page.locator("body").click({ position: { x: 900, y: 300 } });
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    expect(await tree.evaluate((el) => el.scrollTop)).toBe(60);
    // Long enough for anything the page asks for late.
    await page.waitForTimeout(500);
    expect(sidebarRequests).toEqual([]);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "The fixture design",
    );
    expect(await tree.evaluate((el) => el.scrollTop)).toBe(60);
  });

  // The pane scrolls, not the window, so the browser's own scrolling keys
  // need the focus in it: the page gives it the focus as it opens.
  test("scrolls with PageDown, Space and End after g p, with nothing clicked", async ({
    page,
  }) => {
    await page.goto("/plans/design.md");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "The fixture design",
    );
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    const top = () => pane(page).evaluate((el) => el.scrollTop);
    expect(await top()).toBe(0);
    await page.keyboard.press("PageDown");
    await expect.poll(top).toBeGreaterThan(0);
    const afterPageDown = await top();
    await page.keyboard.press("Space");
    await expect.poll(top).toBeGreaterThan(afterPageDown);
    await page.keyboard.press("End");
    await expect
      .poll(() =>
        pane(page).evaluate(
          (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
        ),
      )
      .toBe(true);
  });

  test("scrolls with PageDown on a direct load, and the viewer does too", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => pane(page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);

    await page.setViewportSize({ width: 1440, height: 400 });
    await page.goto("/plans/paged.md");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => pane(page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
  });

  // The keys that act on a document do nothing here, so the help leaves them
  // out rather than offer them.
  test("lists only the keys that work here in the shortcuts help", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help.getByText("Go to the planning page")).toBeVisible();
    await expect(help.getByText("Scroll down")).toBeVisible();
    await expect(help.getByText("View latest diff")).toHaveCount(0);
    await expect(help.getByText("View file history")).toHaveCount(0);
    await expect(help.getByText("Copy absolute file path")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);

    // And the viewer's lists them.
    await page.goto("/plans/design.md");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("?");
    await expect(help.getByText("View latest diff")).toBeVisible();
  });

  test("moves nothing painted on a load with the outline open", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const shifts: { value: number; sources: string[] }[] = [];
      (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: { node?: Node | null }[];
        })[]) {
          if (entry.hadRecentInput) continue;
          const sources = (entry.sources ?? []).map((source) => {
            const node = source.node ?? null;
            const el =
              node instanceof Element ? node : (node?.parentElement ?? null);
            // The sidebar's file tree filling a folder late is the shell's
            // own layout-shift source, as stable_paint.spec.ts records it.
            if (el?.closest('[data-testid="sidebar"]')) return "sidebar";
            return el
              ? `${el.tagName}.${String(el.className).slice(0, 60)}`
              : "?";
          });
          if (sources.length > 0 && sources.every((s) => s === "sidebar")) {
            continue;
          }
          shifts.push({ value: entry.value, sources });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await openWithOutline(page);
    // Long enough for the second reviews request, and anything late.
    await page.waitForTimeout(1500);
    const shifts = await page.evaluate(
      () =>
        (
          window as unknown as {
            __shifts: { value: number; sources: string[] }[];
          }
        ).__shifts,
    );
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
  });
});
