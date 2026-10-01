import { test, expect, type Page } from "@playwright/test";
import { drawnIn, sameBox } from "./drawnIn";
import { planningIndexReady } from "./planningIndex";

// The planning page in a real browser, against the real planning endpoint and
// the real review store (docs/reference/planning-index.md §6). The fixture
// is `fixtures/test_repo/plans/`, whose roadmap `.vantage.toml` names: it
// routes design.md's two questions and paged.md's twelve, so Needs you holds
// more than its first page (planning-index.md §6.4), and not
// unrouted.md's one, or oversized.md's, whose card is past the size a card
// renders unasked.
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
  // The pane, which is what scrolls in the app shell.
  const pane = (page: Page) => page.locator("[data-content-scroll]");
  const paneTop = (page: Page) => pane(page).evaluate((el) => el.scrollTop);
  // The document's name at the top of a card, which opens the document in
  // this tab; Open document opens a new one.
  const nameLink = (page: Page, title: string, path: string) =>
    card(page, title).getByRole("link", { name: path, exact: true });

  test("loads by its URL, listing the fixture's unrouted question under Not on a roadmap", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
    await expect(
      section(page, "Not on a roadmap").getByRole("article", {
        name: "OQ-U1: Is anyone tracking this?",
      }),
    ).toBeVisible();
    // One page of Needs you: ten of its fourteen.
    await expect(section(page, "Needs you").getByRole("article")).toHaveCount(
      10,
    );
    await expect(
      section(page, "Ready to graduate").getByRole("link", {
        name: "plans/shipped.md",
      }),
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
    await planningIndexReady(page);

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    await expect(card(page, "OQ-U1: Is anyone tracking this?")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/plans\/roadmap\.md$/);
    await expect(
      page
        .locator("[data-content-scroll] [data-vantage-planning-badge]")
        .first(),
    ).toBeVisible();
    // Long enough for a socket each page opened, React's StrictMode double
    // included, to connect: none of them is a reconnect, so none rescans.
    await page.waitForTimeout(2000);
    expect(builds).toHaveLength(1);
  });

  // The usual way onto the page is g p from a document. The viewer a card's
  // link mounts in this tab, its document's name, used to reload the document
  // the store still named on its socket's first connection, which superseded
  // the route's load: the URL was right and the content was still the
  // roadmap's. It was found through Open document, which opened its document
  // in this tab until 2026-10-01.
  test("a card's document name after g p from a document shows the card's document", async ({
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
    await page.route(
      "**/api/content?path=plans%2Funrouted.md*",
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.continue();
      },
    );
    await nameLink(
      page,
      "OQ-U1: Is anyone tracking this?",
      "plans/unrouted.md",
    ).click();
    await expect(page).toHaveURL(/\/plans\/unrouted\.md$/);
    // Long enough for the held document, and a reload the socket triggered,
    // to land.
    await page.waitForTimeout(2000);
    await expect(title).toContainText("A plan the roadmap does not mention");
  });

  test("takes a leaning that its document, opened from the card, shows as the in-page button's own", async ({
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

    await unrouted
      .getByRole("link", { name: "plans/unrouted.md", exact: true })
      .click();
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
    await expect(
      prose.locator(".review-highlight-block-divergent"),
    ).toHaveCount(0);
    // And the in-page button recognizes it as its own take: the same anchor
    // and the same text, measured by this browser's layout.
    await expect(prose.locator(".review-oq-taken")).toHaveText("Leaning taken");
    await expect(prose.locator(".review-oq-take")).toHaveCount(0);
  });

  test("a card's document name lands at the top, and Back returns to the same scroll position", async ({
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
    await pane(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => paneTop(page)).toBeGreaterThan(100);
    // The page saves as the reader scrolls, one frame behind.
    await page.waitForTimeout(100);
    const before = await paneTop(page);

    // Followed where it stands: a real click would scroll the link into view
    // first, and the reader would then be returning somewhere else.
    await nameLink(page, "OQ-E2: How soon?", "plans/design.md").dispatchEvent(
      "click",
    );
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
    await expect.poll(() => paneTop(page)).toBeCloseTo(before, 0);
  });

  // Its icon is the one for a link that opens elsewhere, and a reader who
  // clicked it expected a new tab (user direction, 2026-10-01).
  test("Open document opens its document in a new tab, at its top, and leaves the page as it was", async ({
    page,
    context,
  }) => {
    // Short enough that the page scrolls.
    await page.setViewportSize({ width: 1280, height: 360 });
    await page.goto("/.vantage/planning");
    const open = card(page, "OQ-E2: How soon?").getByRole("link", {
      name: "Open document (opens in a new tab)",
      exact: true,
    });
    // Brought into view first, so that the click itself scrolls nothing.
    await open.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const before = await paneTop(page);
    const at = page.url();

    const opened = context.waitForEvent("page");
    await open.click();
    const tab = await opened;
    await expect(
      tab.getByRole("heading", { name: "The fixture design" }),
    ).toBeVisible();
    // The top of the document, not the question: no fragment, no scroll.
    const url = new URL(tab.url());
    expect(url.pathname).toBe("/plans/design.md");
    expect(url.hash).toBe("");
    await expect
      .poll(() =>
        tab.locator("[data-content-scroll]").evaluate((el) => el.scrollTop),
      )
      .toBe(0);
    // With no handle on the planning page's tab.
    expect(await tab.evaluate(() => window.opener)).toBeNull();

    // And the planning page is where it was, in its own tab.
    expect(page.url()).toBe(at);
    await expect(card(page, "OQ-E2: How soon?")).toBeVisible();
    expect(await paneTop(page)).toBe(before);
    await tab.close();
  });

  /**
   * Every layout shift after the page's first paint, as it happens. Each
   * source says whether it is in the app shell's sidebar, whose file tree
   * filling a folder late is a layout-shift source of the shell's own
   * (`stable_paint.spec.ts` records it and holds it to nothing either).
   */
  async function watchShifts(page: Page): Promise<void> {
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
          shifts.push({
            value: entry.value,
            sources: (entry.sources ?? []).map((source) => {
              const node = source.node as HTMLElement | null | undefined;
              const el =
                node instanceof Element ? node : (node?.parentElement ?? null);
              const where = el?.closest('[data-testid="sidebar"]')
                ? "sidebar:"
                : "";
              return node
                ? `${where}${node.nodeName}.${String(node.className).slice(0, 60)}`
                : "?";
            }),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
  }
  /** The shifts with a source anywhere but the sidebar. */
  const shifted = (page: Page) =>
    page.evaluate(() =>
      (
        window as unknown as {
          __shifts: { value: number; sources: string[] }[];
        }
      ).__shifts.filter(
        (shift) =>
          shift.sources.length === 0 ||
          shift.sources.some((source) => !source.startsWith("sidebar:")),
      ),
    );

  const pager = (page: Page, name: string) =>
    page.getByRole("navigation", { name: `${name} pages`, exact: true });

  test("pages Needs you in tens, and Back from a document returns to page 2 at the same scroll", async ({
    page,
  }) => {
    // The page's review requests, and any one document's.
    const reads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/planning/reviews")) reads.push("POST");
      if (pathname.endsWith("/api/review")) reads.push(`GET ${pathname}`);
    });
    await watchShifts(page);
    // Short enough that the page scrolls.
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto("/.vantage/planning");
    const needsYou = section(page, "Needs you");
    await expect(needsYou.getByRole("article")).toHaveCount(10);
    await expect(pager(page, "Needs you")).toContainText(/^1–10 of 1[34]/);
    await expect(
      page.getByRole("navigation", { name: "Sections" }),
    ).toContainText("Needs you 1");

    // A visit reads its reviews in two requests at most, and no document's
    // alone: the first holds the shown pages' documents and every one with a
    // question that needs you, which here is every listed document.
    await expect.poll(() => reads.length).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(reads).toEqual(["POST"]);

    // D12: nothing painted moved.
    const shifts = await shifted(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);

    await pager(page, "Needs you")
      .getByRole("button", { name: "Next ›" })
      .click();
    await expect(page).toHaveURL(/\?needs-you=2$/);
    const last = card(page, "OQ-P12: Which way for part 12?");
    await expect(last).toBeVisible();
    await expect(
      needsYou.getByRole("article", { name: "OQ-E2: How soon?" }),
    ).toHaveCount(0);
    // Flipping read nothing more, and nothing one document at a time.
    await page.waitForTimeout(300);
    expect(reads).toEqual(["POST"]);

    // The reader scrolls, then opens a page-2 card's document where it stands,
    // in this tab, by its name.
    await pane(page).evaluate((el) => el.scrollTo(0, 200));
    await expect.poll(() => paneTop(page)).toBe(200);
    // The page saves as the reader scrolls, one frame behind.
    await page.waitForTimeout(100);
    await last
      .getByRole("link", { name: "plans/paged.md", exact: true })
      .dispatchEvent("click");
    await expect(page).toHaveURL(/\/plans\/paged\.md$/);
    await expect(
      page.getByRole("heading", { name: "The paged plan" }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/\.vantage\/planning\?needs-you=2$/);
    await expect(last).toBeVisible();
    await expect.poll(() => paneTop(page)).toBe(200);

    // And Back from the planning page leaves it, for what came before the
    // visit, rather than stepping back to its first page: the flip replaced
    // the entry it was on.
    await page.goBack();
    await expect(page).toHaveURL("about:blank");
  });

  // A control that goes away or turns disabled under the keyboard drops the
  // focus to the body, which jsdom does not do, so this is where it shows.
  test("keeps the keyboard's place through a flip, a jump and Show question", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto("/.vantage/planning");
    const needsYou = section(page, "Needs you");
    await expect(needsYou.getByRole("article")).toHaveCount(10);
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el === null || el === document.body
          ? "BODY"
          : `${el.tagName}:${el.textContent?.trim()}`;
      });

    // Onto the last page: Next stays focused, and inert.
    const next = pager(page, "Needs you").getByRole("button", {
      name: "Next ›",
    });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?needs-you=2$/);
    await expect(next).toHaveAttribute("aria-disabled", "true");
    expect(await focused()).toBe("BUTTON:Next ›");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?needs-you=2$/);

    // From the bottom pager: the heading comes into view, and the focus
    // with it.
    await page
      .getByRole("navigation", { name: "Needs you pages, below" })
      .getByRole("button", { name: "‹ Previous" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/\.vantage\/planning$/);
    const heading = needsYou.getByRole("heading", { level: 2 });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();

    // A jump from the section bar takes the focus to the section.
    await page
      .getByRole("navigation", { name: "Sections" })
      .getByRole("link", { name: /^Not on a roadmap/ })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      section(page, "Not on a roadmap").getByRole("heading", { level: 2 }),
    ).toBeFocused();

    // Show question goes, and the card it became takes the focus.
    const oversized = card(page, "OQ-V1: Is the long question shown whole?");
    await oversized.getByRole("button", { name: "Show question" }).focus();
    await page.keyboard.press("Enter");
    await expect(oversized.getByText("The end of the question.")).toBeVisible();
    await expect(oversized).toBeFocused();
  });

  test("draws a question past the size limit as a preview card, and Show question renders it whole", async ({
    page,
  }) => {
    await page.goto("/.vantage/planning");
    const oversized = card(page, "OQ-V1: Is the long question shown whole?");
    await expect(oversized).toContainText("Open · Leaning: Only when asked.");
    await expect(
      oversized.getByRole("button", { name: "Take this leaning" }),
    ).toHaveCount(0);
    await oversized.getByRole("button", { name: "Show question" }).click();
    await expect(oversized.getByText("The end of the question.")).toBeVisible();
    await expect(
      oversized.getByRole("button", { name: "Take this leaning" }),
    ).toBeVisible();
    await expect(
      oversized.getByRole("button", { name: "Show question" }),
    ).toHaveCount(0);
  });

  test("explains each section, and copies an agent request from the real index, moving nothing and printing no button", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/.vantage/planning");
    const unrouted = section(page, "Not on a roadmap");
    await expect(unrouted.getByRole("article")).toHaveCount(10);
    // The line under each heading, with the section.
    await expect(unrouted).toHaveAccessibleDescription(
      "Open questions no roadmap links to. An agent proposes where each goes; you confirm.",
    );
    await expect(
      section(page, "Ready to graduate").getByText(
        "Built, with no questions left. An agent turns it into a reference doc.",
      ),
    ).toBeVisible();
    // An agent's sections have the button, and Needs you has none.
    await expect(
      section(page, "Needs you").locator("[data-planning-agent-request]"),
    ).toHaveCount(0);

    const copy = page.getByRole("button", {
      name: "Copy agent request for Not on a roadmap",
    });
    const about = unrouted.locator("[data-planning-section-about]");
    // Measured where the click will find it, so the click scrolls nothing.
    await copy.scrollIntoViewIfNeeded();
    const before = {
      copy: await copy.boundingBox(),
      about: await about.boundingBox(),
      first: await unrouted.getByRole("article").first().boundingBox(),
    };
    await copy.click();
    await expect(copy).toHaveText("Copied");
    // Copied stands in the label's own room: nothing moved.
    expect({
      copy: await copy.boundingBox(),
      about: await about.boundingBox(),
      first: await unrouted.getByRole("article").first().boundingBox(),
    }).toEqual(before);
    // For every one of the section's 27, not only this page's ten, and the
    // repository by the root the server reports.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^Repository: \/\S*test_repo\n/);
    expect(copied.match(/^- \S+:\d+ /gm)).toHaveLength(27);
    expect(copied).toContain(`${UNROUTED}:`);
    expect(copied).toMatch(/Verify: .*vantage-check index/);
    await expect(copy).toHaveText("Copy agent request", { timeout: 4000 });

    await page.getByRole("button", { name: "Copy all agent requests" }).click();
    const all = await page.evaluate(() => navigator.clipboard.readText());
    expect(all).toContain("Not on a roadmap (27)");
    expect(all).toContain("Ready to graduate (1)");
    expect(all).toContain("- plans/shipped.md");

    await page.emulateMedia({ media: "print" });
    await expect(
      page.locator("[data-planning-agent-request]:visible"),
    ).toHaveCount(0);
    await expect(about).toBeVisible();
  });

  // A copy button keeps the room of its longer label, so Copied moves
  // nothing, and draws what it says centered in that room: its icon, its
  // label and, on Copy answers, the count, with as much room before them as
  // after. Copy answers once left its count outside that room, so "Copied"
  // centered its icon and label in the room and drew the count at the end,
  // with three times as much room before the icon as after the count.
  test("draws Copy answers and Copy agent request centered in their room, before the click and after it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/.vantage/planning");
    // An answer waiting on the agent, so Copy answers has one to copy.
    await card(page, "OQ-U1: Is anyone tracking this?")
      .getByRole("button", { name: "Take this leaning" })
      .click();
    const count = page.getByTestId("pending-answers");
    await expect(count).toHaveText("1");
    await expect(page.getByTestId("planning-header")).not.toHaveAttribute(
      "data-yield",
      /\blabels\b/,
    );

    const request = page.getByRole("button", {
      name: "Copy agent request for Not on a roadmap",
    });
    // Measured where the click will find it, so the click scrolls nothing.
    await request.scrollIntoViewIfNeeded();
    for (const [button, rest] of [
      [page.locator("button", { has: count }), "Copy answers1"],
      [request, "Copy agent request"],
    ] as const) {
      const handle = (await button.elementHandle())!;
      const was = await drawnIn(handle);
      expect(was.text).toBe(rest);
      expect(
        Math.abs(was.before - was.after),
        `${rest}: ${JSON.stringify(was)}`,
      ).toBeLessThanOrEqual(1);

      await handle.click();
      await expect(button).toContainText("Copied");
      const now = await drawnIn(handle);
      expect(
        sameBox(now.box, was.box),
        `${rest} → Copied: ${JSON.stringify(was.box)} → ${JSON.stringify(now.box)}`,
      ).toBe(true);
      expect(
        Math.abs(now.before - now.after),
        `${rest} → Copied: ${JSON.stringify(now)}`,
      ).toBeLessThanOrEqual(1);
      // Copied is the shorter label by far, so it has room either side.
      expect(now.before, JSON.stringify(now)).toBeGreaterThan(now.padding + 5);
    }
  });

  test("moves nothing painted on a load that has to build the index first", async ({
    page,
  }) => {
    await watchShifts(page);
    await page.goto("/.vantage/planning");
    await expect(
      section(page, "Not on a roadmap").getByRole("article"),
    ).toHaveCount(10);
    // Long enough for the second reviews request, and anything late.
    await page.waitForTimeout(1500);
    const shifts = await shifted(page);
    expect(shifts, JSON.stringify(shifts)).toEqual([]);
  });
});
