import { test, expect, type Page } from "@playwright/test";

// The planning page in a real browser, against the real planning endpoint and
// the real review store (docs/design/planning-index.md §6, §15). The fixture
// is `fixtures/test_repo/plans/`, whose roadmap `.vantage.toml` names: it
// routes design.md's two questions, and unrouted.md's one it does not.
test.describe("the planning page", () => {
  // Two tests file a comment on the same document and delete it afterwards.
  test.describe.configure({ mode: "serial" });

  const UNROUTED = "plans/unrouted.md";

  test.afterEach(async ({ request }) => {
    // Filed comments live in this run's review store; take them back out so
    // the next test, and the next run, start from none.
    await request.delete(`/api/review?path=${encodeURIComponent(UNROUTED)}`);
  });

  const card = (page: Page, title: string) =>
    page.getByRole("article", { name: title });
  const section = (page: Page, name: string) =>
    page.getByRole("region", { name: new RegExp(`^${name}`) });

  test("loads by its URL, listing the fixture's unrouted question under Unrouted", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
    await expect(
      section(page, "Unrouted").getByRole("article", {
        name: "OQ-U1: Is anyone tracking this?",
      }),
    ).toBeVisible();
    await expect(
      section(page, "Needs you").getByRole("article"),
    ).toHaveCount(2);
    await expect(
      section(page, "Graduate").getByRole("link", { name: "plans/shipped.md" }),
    ).toBeVisible();
    // The card is the question as its document renders it, and only it: the
    // second question's card holds the first too, in the same list, hidden,
    // and keeps the number the document gives it.
    const second = card(page, "OQ-E2: How soon?");
    await expect(second.getByText("Leaning: soon.")).toBeVisible();
    await expect(second.getByText("Which way does it go?")).toBeHidden();
    await expect(second.locator("li[data-planning-card-unit]")).toHaveAttribute(
      "value",
      "2",
    );
  });

  test("opens with g p from the viewer, and Back costs no second scan", async ({
    page,
  }) => {
    // Each build is one planning stream, which the scan worker asks for; a
    // dedicated worker's requests reach the page's own network events.
    const builds: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/planning/stream")) {
        builds.push(request.url());
      }
    });

    await page.goto("/plans/roadmap.md");
    // The index is ready once a badge is drawn.
    await expect(
      page.locator("[data-content-scroll] [data-vantage-planning-badge]").first(),
    ).toBeVisible();

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(
      card(page, "OQ-U1: Is anyone tracking this?"),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/plans\/roadmap\.md$/);
    await expect(
      page.locator("[data-content-scroll] [data-vantage-planning-badge]").first(),
    ).toBeVisible();
    // Long enough for a socket each page opened, React's StrictMode double
    // included, to connect: none of them is a reconnect, so none rescans.
    await page.waitForTimeout(2000);
    expect(builds).toHaveLength(1);
  });

  // The usual way onto the page is g p from a document. The viewer the card's
  // link mounts used to reload the document the store still named on its
  // socket's first connection, which superseded the route's load: the URL was
  // right and the content was still the roadmap's.
  test("Open document after g p from a document shows the card's document", async ({
    page,
  }) => {
    const title = page.locator("[data-content-scroll] .prose h1");
    await page.goto("/plans/roadmap.md");
    await expect(title).toContainText("Roadmap");
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    // Hold the document back until the new viewer's socket has connected,
    // which is the order a slower document or a busy machine gives.
    await page.route("**/api/content?path=plans%2Funrouted.md*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await card(page, "OQ-U1: Is anyone tracking this?")
      .getByRole("link", { name: "Open document" })
      .click();
    await expect(page).toHaveURL(/\/plans\/unrouted\.md$/);
    // Long enough for the held document, and a reload the socket triggered,
    // to land.
    await page.waitForTimeout(2000);
    await expect(title).toContainText("A plan the roadmap does not mention");
  });

  test("takes a leaning that Open document shows as the in-page button's own", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    const unrouted = card(page, "OQ-U1: Is anyone tracking this?");
    await unrouted.getByRole("button", { name: "Take this leaning" }).click();
    await expect(unrouted.getByText("Leaning taken")).toBeVisible();
    const comments = unrouted.getByRole("list", {
      name: "Comments on this question",
    });
    await expect(comments).toContainText("Put it on the roadmap.");
    await expect(comments).toContainText("waiting on the agent");
    await expect(page.getByTestId("pending-answers")).toHaveText("1");

    await unrouted.getByRole("link", { name: "Open document" }).click();
    await expect(page).toHaveURL(/\/plans\/unrouted\.md$/);
    const prose = page.locator("[data-content-scroll] .prose");
    // The document opens in review mode by the existing rule for a document
    // with comments, and shows the same comment, anchored where it was filed.
    await expect(
      prose.locator("[data-review-inline-comment]").filter({
        hasText: "Put it on the roadmap.",
      }),
    ).toBeVisible();
    await expect(prose.locator(".review-highlight-block")).toHaveCount(1);
    await expect(prose.locator(".review-highlight-block-divergent")).toHaveCount(
      0,
    );
    // And the in-page button recognizes it as its own take: the same anchor
    // and the same text, measured by this browser's layout.
    await expect(prose.locator(".review-oq-taken")).toHaveText("Leaning taken");
    await expect(prose.locator(".review-oq-take")).toHaveCount(0);
  });

  test("Open document lands at the top, and Back returns to the same scroll position", async ({
    page,
  }) => {
    // Short enough that both the page and the document scroll.
    await page.setViewportSize({ width: 1280, height: 360 });
    await page.goto("/.vantage/planning");
    // A comment on the last card, so the bottom of the page is its comment
    // list — which a returning page fetches again, after it has rendered.
    const last = card(page, "OQ-U1: Is anyone tracking this?");
    await last.getByRole("button", { name: "Take this leaning" }).click();
    await expect(
      last.getByRole("list", { name: "Comments on this question" }),
    ).toBeVisible();

    // The reader scrolls to the very bottom.
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(100);
    // The page saves as the reader scrolls, one frame behind.
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => window.scrollY);

    // Followed where it stands: a real click would scroll the link into view
    // first, and the reader would then be returning somewhere else.
    await card(page, "OQ-E2: How soon?")
      .getByRole("link", { name: "Open document" })
      .dispatchEvent("click");
    await expect(page).toHaveURL(/\/plans\/design\.md$/);
    await expect(
      page.getByRole("heading", { name: "The fixture design" }),
    ).toBeVisible();
    // The top of the document, not the question: no fragment, no scroll.
    expect(new URL(page.url()).hash).toBe("");
    const scroller = page.locator("[data-content-scroll]");
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);

    await page.goBack();
    await expect(
      last.getByRole("list", { name: "Comments on this question" }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeCloseTo(before, 0);
  });
});
